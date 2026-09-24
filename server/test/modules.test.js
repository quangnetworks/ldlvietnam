import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ldl-mod-'));
process.env.JWT_SECRET = 'test-secret';
const { initNode } = await import('../src/node.js');
const { createApp } = await import('../src/app.js');
const { totpCode } = await import('../src/security.js');
const { ipMatches } = await import('../src/security.js');

let app;
const base = 'http://test.local/api';
before(async () => { await initNode({ dataDir: tmp, reset: true }); app = createApp(); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function raw(url, opts = {}) {
  const r = await app.fetch(new Request(base + url, opts));
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  return { status: r.status, data, headers: r.headers };
}
async function login(username, extra = {}, headers = {}) {
  const res = await raw('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ username, password: '123456', ...extra }) });
  if (res.status !== 200) return { fail: res };
  const { token, user } = res.data;
  const call = (method, url, body) => {
    const opts = { method, headers: { Authorization: `Bearer ${token}`, ...headers } };
    if (body instanceof FormData) opts.body = body;
    else if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return raw(url, opts);
  };
  return { user, get: (u) => call('GET', u), post: (u, b) => call('POST', u, b), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u) };
}

test('two-factor authentication: setup, login requires OTP, admin reset', async () => {
  const demo = await login('demo');
  const setup = await demo.post('/account/2fa/setup');
  assert.match(setup.data.url, /^otpauth:\/\/totp\//);
  assert.equal((await demo.post('/account/2fa/enable', { code: '000000' })).status, 400);
  const code = await totpCode(setup.data.secret, Math.floor(Date.now() / 30000));
  assert.equal((await demo.post('/account/2fa/enable', { code })).status, 200);
  const noOtp = await login('demo');
  assert.equal(noOtp.fail.status, 401);
  assert.equal(noOtp.fail.data.need_otp, true);
  const ok = await login('demo', { otp: await totpCode(setup.data.secret, Math.floor(Date.now() / 30000)) });
  assert.ok(ok.user);
  const admin = await login('admin');
  await admin.post(`/account/2fa/reset/${ok.user.id}`);
  assert.ok((await login('demo')).user);
});

test('IP allow-list blocks members outside the office network, never admins', async () => {
  assert.ok(ipMatches('203.0.113.77', '203.0.113.0/24'));
  assert.ok(!ipMatches('203.0.114.1', '203.0.113.0/24'));
  const admin = await login('admin');
  assert.equal((await admin.put('/account/security', { ip_enabled: true, ip_rules: 'abc' })).status, 400);
  await admin.put('/account/security', { ip_enabled: true, ip_rules: '203.0.113.0/24' });
  const outside = await login('demo', {}, { 'cf-connecting-ip': '198.51.100.9' });
  assert.equal(outside.fail.status, 403);
  assert.ok((await login('demo', {}, { 'cf-connecting-ip': '203.0.113.20' })).user);
  assert.ok((await login('admin', {}, { 'cf-connecting-ip': '198.51.100.9' })).user);
  await admin.put('/account/security', { ip_enabled: false, ip_rules: '' });
});

test('guest accounts: only granted apps, no directory, no public documents, expiry', async () => {
  const guest = await login('npp.hanam');
  assert.deepEqual((await guest.get('/auth/me')).data.apps, ['request']);
  assert.equal((await guest.get('/documents')).status, 403);
  assert.equal((await guest.get('/account/members')).status, 403);
  const admin = await login('admin');
  await admin.put('/account/apps/office', { users: [...(await admin.get('/account/apps/office/users')).data, guest.user.id] });
  const docs = await guest.get('/documents');
  assert.equal(docs.status, 200);
  assert.equal(docs.data.total, 0); // văn bản công khai toàn công ty không hiển thị với khách
  await admin.put(`/users/${guest.user.id}`, { name: 'NPP Hà Nam (khách)', role: 'guest', expires_at: '2020-01-01' });
  assert.equal((await guest.get('/auth/me')).status, 401);
});

test('webhooks: https only, fired on approval with signature, logged', async () => {
  const admin = await login('admin');
  assert.equal((await admin.post('/webhooks', { name: 'x', url: 'http://example.com', events: ['request.approved'] })).status, 400);
  assert.equal((await admin.post('/webhooks', { name: 'x', url: 'https://127.0.0.1/hook', events: ['request.approved'] })).status, 400);
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return new Response('ok', { status: 200 }); };
  try {
    const hook = await admin.post('/webhooks', { name: 'ERP', url: 'https://erp.example.com/hook', events: ['request.submitted', 'request.approved'] });
    assert.equal(hook.status, 201);
    const demo = await login('demo');
    const g = (await demo.get('/request-groups')).data.find((x) => x.name === 'Đề xuất cấp văn phòng phẩm');
    const fd = new FormData();
    fd.append('group_id', g.id);
    fd.append('data', JSON.stringify({ items: 'Giấy A4' }));
    const q = (await demo.post('/requests', fd)).data;
    const hr = await login('chilan');
    await hr.post(`/requests/${q.id}/decide`, { action: 'approve' });
    await new Promise((res) => setTimeout(res, 30));
    const events = calls.map((x) => x.opts.headers['X-LDL-Event']);
    assert.deepEqual(events, ['request.submitted', 'request.approved']);
    assert.match(calls[0].opts.headers['X-LDL-Signature'], /^sha256=[0-9a-f]{64}$/);
    assert.equal(JSON.parse(calls[1].opts.body).request.status, 'approved');
    const logs = await admin.get('/webhooks/logs');
    assert.equal(logs.data.items.length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('HRM: managers see profiles, members only themselves', async () => {
  const hr = await login('chilan');
  const demo = await login('demo');
  assert.equal((await demo.get('/hrm/employees')).status, 403);
  assert.equal((await demo.get(`/hrm/employees/${demo.user.id}`)).data.employee_code, 'LDL006');
  const list = await hr.get('/hrm/employees');
  assert.ok(list.data.length >= 9);
  const upd = await hr.put(`/hrm/employees/${demo.user.id}`, { employee_code: 'LDL006', id_number: '001095000111', work_status: 'working' });
  assert.equal(upd.data.id_number, '001095000111');
  const stats = await hr.get('/hrm/stats');
  assert.ok(stats.data.contracts_expiring.length >= 1);
});

test('Checkin: in/out once per day; manager sees team; timesheet', async () => {
  const demo = await login('demo');
  const today = await demo.get('/checkin/today');
  assert.equal(today.data.record, null);
  const inRes = await demo.post('/checkin/in');
  assert.ok(inRes.data.in_time);
  assert.equal((await demo.post('/checkin/in')).status, 400);
  assert.ok((await demo.post('/checkin/out')).data.out_time);
  const month = await demo.get('/checkin/month');
  assert.ok(month.data.summary.worked >= 1);
  const kd = await login('truongkd');
  const team = await kd.get('/checkin/team');
  assert.ok(team.data.items.some((u) => u.id === demo.user.id && u.record));
});

test('Timeoff: leave request via Request is counted after approval', async () => {
  const demo = await login('phuonglinh');
  const s0 = (await demo.get('/timeoff/summary')).data;
  const year = s0.year;
  const fd = new FormData();
  fd.append('group_id', s0.group_id);
  fd.append('data', JSON.stringify({ from: `${year}-12-01`, to: `${year}-12-02`, kind: 'Nghỉ phép năm', reason: 'Việc gia đình' }));
  fd.append('approvers', String((await demo.get('/users')).data.find((u) => u.username === 'truongkd').id));
  const q = (await demo.post('/requests', fd)).data;
  assert.equal((await demo.get('/timeoff/summary')).data.pending, 2);
  const kd = await login('truongkd');
  await kd.post(`/requests/${q.id}/decide`, { action: 'approve' });
  const s1 = (await demo.get('/timeoff/summary')).data;
  assert.equal(s1.used, s0.used + 2);
  assert.equal(s1.remaining, s1.quota - s1.used);
  const cal = await demo.get(`/timeoff/calendar?month=${year}-12`);
  assert.ok(cal.data.items.some((x) => x.id === q.id));
});

test('Drive: folders, upload, inherited sharing, trash', async () => {
  const demo = await login('demo');
  const other = await login('duylinh');
  const folder = (await demo.post('/drive/folders', { name: 'Hợp đồng', space: 'personal' })).data;
  const fd = new FormData();
  fd.append('parent_id', folder.id);
  fd.append('files', new Blob(['noi dung hop dong']), 'hop-dong-A.txt');
  assert.equal((await demo.post('/drive/upload', fd)).status, 201);
  const inside = (await demo.get(`/drive/items?parent_id=${folder.id}`)).data;
  const file = inside.items[0];
  assert.equal(inside.breadcrumb[0].name, 'Hợp đồng');
  assert.equal((await other.get(`/drive/items/${file.id}/download`)).status, 403);
  await demo.put(`/drive/items/${folder.id}/shares`, { shares: [{ user_id: other.user.id, permission: 'view' }] });
  const dl = await other.get(`/drive/items/${file.id}/download`);
  assert.equal(dl.data, 'noi dung hop dong');
  assert.ok((await other.get('/drive/items?space=shared')).data.items.some((x) => x.id === folder.id));
  assert.equal((await other.del(`/drive/items/${file.id}`)).status, 403);
  await demo.del(`/drive/items/${folder.id}`);
  assert.equal((await other.get(`/drive/items/${file.id}/download`)).status, 404);
  assert.ok((await demo.get('/drive/items?space=trash')).data.items.some((x) => x.id === folder.id));
  const company = (await demo.get('/drive/items?space=company')).data;
  assert.ok(company.items.length >= 3);
});

test('Message: public channel, private channel membership, direct message, unread', async () => {
  const demo = await login('demo');
  const mkt = await login('duylinh');
  const channels = (await demo.get('/chat/channels')).data;
  assert.ok(channels.some((c) => c.name === 'chung'));
  const priv = channels.find((c) => c.name === 'kinh-doanh');
  assert.ok(priv);
  assert.equal((await mkt.get(`/chat/channels/${priv.id}/messages`)).status, 403);
  const dm = (await demo.post('/chat/direct', { user_id: mkt.user.id })).data;
  assert.equal((await demo.post('/chat/direct', { user_id: mkt.user.id })).data.id, dm.id);
  const before = (await mkt.get('/chat/unread')).data.unread;
  const sent = await demo.post(`/chat/channels/${dm.id}/messages`, { content: 'Chào @duylinh, gửi em file thiết kế nhé' });
  assert.equal(sent.status, 201);
  assert.equal((await mkt.get('/chat/unread')).data.unread, before + 1);
  await mkt.post(`/chat/channels/${dm.id}/read`, {});
  assert.equal((await mkt.get('/chat/unread')).data.unread, before);
  assert.equal((await mkt.put(`/chat/messages/${sent.data.id}`, { content: 'x' })).status, 403);
  const msgs = (await mkt.get(`/chat/channels/${dm.id}/messages`)).data;
  assert.equal(msgs.at(-1).content, 'Chào @duylinh, gửi em file thiết kế nhé');
  assert.ok((await mkt.get('/notifications')).data.items.some((n) => n.app === 'message'));
});
