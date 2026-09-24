import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ldl-platform-'));
process.env.JWT_SECRET = 'test-secret';
const { initNode } = await import('../src/node.js');
const { createApp } = await import('../src/app.js');

let app;
const base = 'http://test.local/api';
before(async () => {
  await initNode({ dataDir: tmp, reset: true });
  app = createApp();
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function login(username, password = '123456') {
  const res = await app.fetch(new Request(`${base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  }));
  assert.equal(res.status, 200, `login ${username}`);
  const { token, user } = await res.json();
  const call = async (method, url, body) => {
    const opts = { method, headers: { Authorization: `Bearer ${token}` } };
    if (body instanceof FormData) opts.body = body;
    else if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const r = await app.fetch(new Request(base + url, opts));
    const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
    return { status: r.status, data };
  };
  return { user, get: (u) => call('GET', u), post: (u, b) => call('POST', u, b), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u) };
}

test('me returns accessible apps; login is logged', async () => {
  const demo = await login('demo');
  const me = await demo.get('/auth/me');
  assert.deepEqual(me.data.apps.sort(), ['office', 'request', 'wework']);
  const logs = await demo.get('/account/login-logs');
  assert.ok(logs.data.items.length >= 1);
  assert.ok(logs.data.items.every((l) => l.user_id === demo.user.id));
});

test('app access: revoking an app blocks its API, admin keeps access', async () => {
  const admin = await login('admin');
  const demo = await login('demo');
  const users = (await admin.get('/account/apps/request/users')).data.filter((id) => id !== demo.user.id);
  assert.equal((await admin.put('/account/apps/request', { users })).status, 200);
  assert.equal((await demo.get('/requests')).status, 403);
  assert.equal((await demo.get('/documents')).status, 200);
  assert.ok(!(await demo.get('/auth/me')).data.apps.includes('request'));
  await admin.put('/account/apps/request', { users: [...users, demo.user.id] });
  assert.equal((await demo.get('/requests')).status, 200);
  // disabling the whole app
  await admin.put('/account/apps/office', { enabled: false });
  assert.equal((await demo.get('/documents')).status, 403);
  await admin.put('/account/apps/office', { enabled: true });
});

test('members list, groups, CSV import/export, audit log', async () => {
  const admin = await login('admin');
  const demo = await login('demo');
  const m = await admin.get('/account/members');
  assert.equal(m.data.counts.all, 10);
  assert.ok(m.data.items.find((u) => u.username === 'demo').apps.includes('wework'));
  assert.equal((await demo.get('/account/members/export')).status, 403);
  const csv = await admin.get('/account/members/export');
  assert.match(csv.data, /username,name,email/);
  const imp = await admin.post('/account/members/import', {
    password: 'abc123',
    csv: 'username,name,email,department,manager_username\nnv.moi,"Nguyễn Văn Mới",moi@ldl.vn,Phòng Kho vận,truongkd\ndemo,Base Demo 12,,,',
  });
  assert.deepEqual([imp.data.created, imp.data.updated], [1, 1]);
  const moi = await login('nv.moi', 'abc123');
  assert.equal((await moi.get(`/account/profile/${moi.user.id}`)).data.manager.username, 'truongkd');
  const g = await admin.post('/account/groups', { name: 'Kho vận', members: [moi.user.id, demo.user.id] });
  assert.equal((await admin.get(`/account/groups/${g.data.id}`)).data.members.length, 2);
  const auditLog = await admin.get('/account/audit');
  assert.ok(auditLog.data.items.some((a) => a.action === 'user.import'));
});

test('profile sections are saved and sanitised', async () => {
  const demo = await login('demo');
  await demo.put('/auth/me', { profile: { education: [{ title: 'Thạc sĩ', place: 'NEU', from: '2018', to: '2020' }, { title: '' }] } });
  const p = await demo.get(`/account/profile/${demo.user.id}`);
  assert.deepEqual(JSON.parse(p.data.profile).education.map((e) => e.title), ['Thạc sĩ']);
});

test('request: sequential approval with SLA, return & resubmit, then approve', async () => {
  const admin = await login('admin');
  const demo = await login('demo');
  const kt = await login('thuhuyen');
  const gd = await login('giamdoc');
  const groups = (await demo.get('/request-groups')).data;
  const tu = groups.find((g) => g.name === 'Đề nghị tạm ứng');
  // required field validation
  const bad = new FormData();
  bad.append('group_id', tu.id);
  bad.append('data', JSON.stringify({ purpose: 'x' }));
  assert.equal((await demo.post('/requests', bad)).status, 400);

  const fd = new FormData();
  fd.append('group_id', tu.id);
  fd.append('title', 'Tạm ứng hội chợ');
  fd.append('data', JSON.stringify({ amount: '5.000.000', purpose: 'Thuê gian hàng' }));
  fd.append('files', new Blob(['hoa don']), 'hoá đơn.txt');
  const created = await demo.post('/requests', fd);
  assert.equal(created.status, 201);
  const id = created.data.id;
  assert.equal(created.data.data.amount, 5000000);
  assert.ok(created.data.deadline_at);
  assert.deepEqual(created.data.approvers.map((a) => a.name), ['Nguyễn Thu Huyền', 'Võ Trung Cang']);

  assert.equal((await gd.post(`/requests/${id}/decide`, { action: 'approve' })).status, 403); // not yet
  assert.ok((await kt.get('/requests?tab=my_turn')).data.items.some((q) => q.id === id));
  assert.equal((await kt.post(`/requests/${id}/decide`, { action: 'return' })).status, 400); // reason required
  let r = await kt.post(`/requests/${id}/decide`, { action: 'return', comment: 'Bổ sung báo giá' });
  assert.equal(r.data.status, 'returned');
  r = await demo.post(`/requests/${id}/submit`);
  assert.equal(r.data.status, 'pending');
  r = await kt.post(`/requests/${id}/decide`, { action: 'approve' });
  assert.equal(r.data.status, 'pending');
  r = await gd.post(`/requests/${id}/decide`, { action: 'approve', comment: 'OK' });
  assert.equal(r.data.status, 'approved');
  const notes = (await demo.get('/notifications')).data.items;
  assert.ok(notes.some((n) => n.link === `/request/${id}`));
  // outsider cannot see it
  const mkt = await login('duylinh');
  assert.equal((await mkt.get(`/requests/${id}`)).status, 403);
  assert.ok((await admin.get('/request/reports')).data.by_group.length >= 1);
});

test('request: "any" flow finishes on the first approval; custom approvers', async () => {
  const demo = await login('demo');
  const hr = await login('chilan');
  const kd = await login('truongkd');
  const g = (await demo.get('/request-groups')).data.find((x) => x.name === 'Đề xuất mua hàng');
  const fd = new FormData();
  fd.append('group_id', g.id);
  fd.append('data', JSON.stringify({ items: 'Máy in', amount: 4000000 }));
  fd.append('approvers', `${hr.user.id},${kd.user.id}`);
  const { data } = await demo.post('/requests', fd);
  assert.equal(data.flow, 'any');
  const r = await kd.post(`/requests/${data.id}/decide`, { action: 'approve' });
  assert.equal(r.data.status, 'approved');
  assert.equal(r.data.approvers.find((a) => a.user_id === hr.user.id).status, 'skipped');
});

test('request groups: admin builds a form; members cannot manage', async () => {
  const admin = await login('admin');
  const demo = await login('demo');
  const body = {
    name: 'Đề xuất tăng ca', category: 'Hành chính - Nhân sự', flow: 'sequential', sla_hours: 12,
    fields: [{ label: 'Ngày tăng ca', type: 'date', required: true }, { label: 'Ca', type: 'select', options: 'Tối\nCuối tuần' }],
  };
  assert.equal((await demo.post('/request-groups', body)).status, 403);
  const { data } = await admin.post('/request-groups', body);
  const g = (await admin.get(`/request-groups/${data.id}`)).data;
  assert.deepEqual(g.fields.map((f) => f.type), ['date', 'select']);
  assert.deepEqual(g.fields[1].options, ['Tối', 'Cuối tuần']);
  await admin.post('/request-groups/bulk', { ids: [data.id], action: 'disable' });
  assert.ok(!(await demo.get('/request-groups')).data.some((x) => x.id === data.id));
  assert.ok((await admin.get('/request-groups?manage=1&status=paused')).data.some((x) => x.id === data.id));
});

test('office settings: restricted creators and numbering template', async () => {
  const admin = await login('admin');
  const demo = await login('demo');
  const hr = await login('chilan');
  await admin.put('/office/settings', { create_mode: 'restricted', creator_groups: [2], clerks: [hr.user.id], code_format: '{seq}/{year}/{prefix}-LDL', seq_digits: 2 });
  const fd = () => { const f = new FormData(); f.append('title', 'Thông báo thử'); f.append('need_numbering', '1'); f.append('type_id', '6'); return f; };
  assert.equal((await demo.post('/documents', fd())).status, 403);
  const { data: doc } = await hr.post('/documents', fd());
  assert.equal((await demo.get('/office/meta')).data.can_create, false);
  const numbered = await hr.post(`/documents/${doc.id}/number`, {});
  assert.match(numbered.data.code, /^\d{2}\/\d{4}\/TB-LDL$/);
  await admin.put('/office/settings', { create_mode: 'all' });
  assert.equal((await demo.post('/documents', fd())).status, 201);
});

test('home summary and notes', async () => {
  const demo = await login('demo');
  const h = await demo.get('/home/summary');
  assert.ok(h.data.announcements.length > 0);
  assert.equal(typeof h.data.counters.tasks_active, 'number');
  const n = await demo.post('/notes', { content: 'Gọi NPP Hà Nam' });
  assert.equal((await demo.get('/notes')).data[0].id, n.data.id);
  await demo.put('/me/prefs', { home_bg: '#123456' });
  assert.equal((await demo.get('/me/prefs')).data.home_bg, '#123456');
});
