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

test('avatar: upload own / by admin, type check, serve, delete', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const form = (bytes, type) => { const fd = new FormData(); fd.append('files', new File([bytes], 'a.png', { type })); return fd; };
  const admin = await login('admin');
  const demo = await login('phuonglinh');
  const me = demo.user.id;
  // chỉ chính chủ hoặc admin
  assert.equal((await demo.post(`/account/users/${admin.user.id}/avatar`, form(png, 'image/png'))).status, 403);
  // giả mạo định dạng (HTML khai báo là PNG)
  assert.equal((await demo.post(`/account/users/${me}/avatar`, form(new TextEncoder().encode('<html>'), 'image/png'))).status, 400);
  const up = await demo.post(`/account/users/${me}/avatar`, form(png, 'image/png'));
  assert.equal(up.status, 200);
  assert.equal(up.data.avatar_version, 1);
  const img = await admin.get(`/account/users/${me}/avatar?v=1`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.match(img.headers.get('cache-control'), /immutable/);
  const dir = await admin.get('/users');
  assert.equal(dir.data.find((u) => u.id === me).avatar_version, 1);
  // admin đổi ảnh cho thành viên
  assert.equal((await admin.post(`/account/users/${me}/avatar`, form(png, 'image/png'))).data.avatar_version, 2);
  assert.equal((await demo.del(`/account/users/${me}/avatar`)).status, 200);
  assert.equal((await admin.get(`/account/users/${me}/avatar?v=2`)).status, 404);
  assert.equal((await admin.get('/users')).data.find((u) => u.id === me).avatar_version, -2);
  // tải lại ảnh sau khi xoá dùng phiên bản mới (không trùng cache cũ)
  assert.equal((await demo.post(`/account/users/${me}/avatar`, form(png, 'image/png'))).data.avatar_version, 3);
});

test('home agenda groups work items into overdue / today / upcoming', async () => {
  const demo = await login('demo');
  const r = await demo.get('/home/agenda');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.items));
  for (const i of r.data.items) assert.ok(['overdue', 'today', 'upcoming', 'todo'].includes(i.bucket));
  const total = Object.values(r.data.counts).reduce((a, b) => a + b, 0);
  assert.equal(total, r.data.items.length);
  // công việc quá hạn được xếp vào nhóm "overdue"
  const created = await demo.post('/tasks', { title: 'Việc quá hạn kiểm thử', assignee_id: demo.user.id, due_date: '2020-01-01' });
  assert.equal(created.status, 201);
  const again = await demo.get('/home/agenda');
  assert.equal(again.data.items.find((i) => i.key === `task-${created.data.id}`).bucket, 'overdue');
});

test('department chat channel: members of the department only, shown on home', async () => {
  const demo = await login('demo'); // Phòng Kinh doanh
  const mkt = await login('duylinh'); // Phòng Marketing
  const home = (await demo.get('/home/chat')).data.channels;
  assert.deepEqual(home.map((c) => c.label), ['Toàn công ty', 'Phòng ban']);
  const dep = home[1];
  assert.equal(dep.kind, 'department');
  assert.equal((await demo.get(`/chat/channels/${dep.id}/messages`)).status, 200);
  assert.equal((await demo.post(`/chat/channels/${dep.id}/messages`, { content: 'Chào cả phòng' })).status, 201);
  assert.equal((await mkt.get(`/chat/channels/${dep.id}/messages`)).status, 403);
  assert.ok(!(await mkt.get('/chat/channels')).data.some((c) => c.id === dep.id));
  // kênh phòng ban Marketing được tạo tự động
  const mktHome = (await mkt.get('/home/chat')).data.channels;
  assert.equal(mktHome[1].name, 'Phòng Marketing');
  assert.equal((await demo.put(`/chat/channels/${dep.id}`, { name: 'x' })).status, 400);
  const info = (await demo.get(`/chat/channels/${dep.id}`)).data;
  assert.ok(info.members.some((m) => m.id === demo.user.id));
  assert.ok(!info.members.some((m) => m.id === mkt.user.id));
});

test('wework report overview: buckets add up and filters apply', async () => {
  const admin = await login('admin');
  const r = await admin.get('/wework/reports/overview?from=2020-01-01');
  assert.equal(r.status, 200);
  const s = r.data.summary;
  assert.equal(s.on_time + s.late + s.doing + s.review + s.overdue + s.failed, s.total);
  assert.equal(r.data.scanned, s.total);
  assert.equal(r.data.cards.tasks.total, s.total);
  assert.ok(r.data.daily.length > 0 && r.data.daily.length <= 92);
  assert.equal(r.data.daily.at(-1).total <= s.total, true);
  const memberSum = r.data.assigned.reduce((a, m) => a + m.total, 0);
  assert.ok(memberSum <= s.total);
  const e = r.data.eisenhower;
  assert.equal(e.important + e.both + e.none + e.urgent, s.total);
  const done = await admin.get('/wework/reports/overview?from=2020-01-01&status=done');
  assert.equal(done.data.summary.doing + done.data.summary.overdue + done.data.summary.review, 0);
  const demo = await login('demo');
  const mine = await demo.get('/wework/reports/overview?from=2020-01-01');
  assert.ok(mine.data.summary.total <= s.total);
});
