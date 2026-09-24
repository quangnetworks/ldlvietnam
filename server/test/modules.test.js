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
  // popup chi tiết: số công việc trong từng nhóm khớp với biểu đồ
  for (const b of ['on_time', 'late', 'doing', 'review', 'overdue', 'failed']) {
    const d = await admin.get(`/wework/reports/tasks?from=2020-01-01&bucket=${b}&limit=200`);
    assert.equal(d.data.total, s[b], b);
    assert.ok(d.data.items.every((t) => t.bucket === b));
  }
  const m = r.data.assigned[0];
  assert.equal((await admin.get(`/wework/reports/tasks?from=2020-01-01&assignee_id=${m.id}`)).data.total, m.total);
  assert.equal((await admin.get('/wework/reports/tasks?from=2020-01-01&priority=urgent')).data.total, e.urgent);
  assert.equal((await admin.get('/wework/reports/tasks?from=2020-01-01&no_due=1')).data.total, r.data.not_on_time.no_due);
  assert.equal((await admin.get('/wework/reports/tasks?from=2020-01-01&bucket=overdue,late')).data.total, s.overdue + s.late);
});

test('wework reports: only admins and granted people can view', async () => {
  const admin = await login('admin');
  const demo = await login('demo');
  assert.equal((await demo.get('/wework/meta')).data.can_view_reports, false);
  assert.equal((await demo.get('/wework/reports/overview?from=2020-01-01')).status, 403);
  assert.equal((await demo.get('/wework/reports/tasks?from=2020-01-01')).status, 403);
  assert.equal((await demo.put('/wework/settings', { report_users: [demo.user.id] })).status, 403);
  // cấp quyền theo cá nhân
  await admin.put('/wework/settings', { report_users: [demo.user.id] });
  assert.equal((await demo.get('/wework/meta')).data.can_view_reports, true);
  const all = await admin.get('/wework/reports/overview?from=2020-01-01');
  const mine = await demo.get('/wework/reports/overview?from=2020-01-01');
  assert.equal(mine.data.summary.total, all.data.summary.total);
  // người xem báo cáo mở được công việc từ popup
  const any = (await admin.get('/wework/reports/tasks?from=2020-01-01&limit=200')).data.items.at(-1);
  assert.equal((await demo.get(`/tasks/${any.id}`)).status, 200);
  // cấp theo phòng ban
  await admin.put('/wework/settings', { report_departments: [demo.user.department_id] });
  assert.equal((await demo.get('/wework/meta')).data.can_view_reports, true);
  await admin.put('/wework/settings', {});
  assert.equal((await demo.get('/wework/reports/overview')).status, 403);
});

test('wework task results: text, links and files; viewer link and byte ranges', async () => {
  const demo = await login('demo');
  const admin = await login('admin');
  const { data: t } = await demo.post('/tasks', { title: 'Báo cáo thị trường Q3' });
  assert.equal((await demo.post(`/tasks/${t.id}/results`, { content: '<p> </p>' })).status, 400);
  assert.equal((await demo.post(`/tasks/${t.id}/results`, { links: 'javascript:alert(1)' })).status, 400);
  const fd = new FormData();
  fd.append('content', '<p>Đã hoàn thành khảo sát 120 điểm bán</p>');
  fd.append('links', 'https://example.com/bao-cao\nhttps://youtu.be/abc');
  fd.append('files', new Blob(['0123456789'], { type: 'video/mp4' }), 'clip.mp4');
  fd.append('files', new Blob(['PK'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'Báo cáo.docx');
  const res = await demo.post(`/tasks/${t.id}/results`, fd);
  assert.equal(res.status, 201);
  const [first] = res.data;
  assert.equal(first.links.length, 2);
  assert.equal(first.files.length, 2);
  // tệp kết quả không lẫn vào tệp đính kèm, có đếm số kết quả
  const full = (await demo.get(`/tasks/${t.id}`)).data;
  assert.equal(full.attachments.length, 0);
  assert.equal(full.result_count, 1);
  // người khác (không liên quan) không cập nhật được
  const mkt = await login('minhtrang');
  assert.equal((await mkt.post(`/tasks/${t.id}/results`, { content: 'x' })).status, 403);

  // tua video: phản hồi 206 theo Range
  const token = (await raw('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'demo', password: '123456' }) })).data.token;
  const clip = first.files.find((f) => f.original_name === 'clip.mp4');
  const part = await app.fetch(new Request(`${base}/tasks/${t.id}/attachments/${clip.id}?inline=1`, { headers: { Authorization: `Bearer ${token}`, Range: 'bytes=2-5' } }));
  assert.equal(part.status, 206);
  assert.equal(await part.text(), '2345');
  assert.equal(part.headers.get('content-range'), 'bytes 2-5/10');
  assert.match(part.headers.get('content-disposition'), /^inline/);

  // liên kết tạm cho trình xem Office trực tuyến: không cần đăng nhập, sai chữ ký bị chặn
  const doc = first.files.find((f) => f.original_name.endsWith('.docx'));
  const { data: link } = await demo.post(`/tasks/${t.id}/attachments/${doc.id}/link`);
  const pub = await app.fetch(new Request(link.url.replace(/^https?:\/\/[^/]+/, 'http://test.local')));
  assert.equal(pub.status, 200);
  assert.equal(await pub.text(), 'PK');
  const bad = await app.fetch(new Request(`http://test.local/api/public/files/${token}/x.docx`));
  assert.equal(bad.status, 403);

  // sửa / xoá: chỉ người cập nhật hoặc quản trị
  assert.equal((await demo.put(`/tasks/${t.id}/results/${first.id}`, { content: '<p>Bổ sung</p>' })).data[0].content, '<p>Bổ sung</p>');
  assert.equal((await admin.del(`/tasks/${t.id}/results/${first.id}`)).data.length, 0);
});

test('office: a new policy supersedes the old one, reverting when it is withdrawn', async () => {
  const admin = await login('admin');
  const demo = await login('demo');
  const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
  const { data: oldDoc } = await admin.post('/documents', fd({ title: 'Chính sách công tác phí 2025', kind: 'notice' }));
  assert.equal(oldDoc.status, 'issued');
  // không thay thế được văn bản nháp
  const { data: draft } = await admin.post('/documents', fd({ title: 'Nháp', draft: '1' }));
  assert.equal((await admin.post('/documents', fd({ title: 'X', replaces_id: draft.id }))).status, 400);
  const today = new Date().toISOString().slice(0, 10);
  const { data: newDoc } = await admin.post('/documents', fd({ title: 'Chính sách công tác phí 2026', replaces_id: oldDoc.id, effective_date: today }));
  assert.equal(newDoc.replaces.id, oldDoc.id);
  const old = (await demo.get(`/documents/${oldDoc.id}`)).data;
  assert.equal(old.is_superseded, true);
  assert.equal(old.superseded_doc.id, newDoc.id);
  assert.deepEqual(old.versions.map((v) => v.id), [oldDoc.id, newDoc.id]);
  // rời khỏi danh sách đang áp dụng, sang mục "Đã bị thay thế"
  assert.ok(!(await demo.get('/documents?box=home&limit=200')).data.items.some((d) => d.id === oldDoc.id));
  assert.ok((await demo.get('/documents?box=superseded')).data.items.some((d) => d.id === oldDoc.id));
  // một văn bản chỉ bị thay thế một lần
  assert.equal((await admin.post('/documents', fd({ title: 'Y', replaces_id: oldDoc.id }))).status, 400);
  // người đã xem văn bản cũ nhận thông báo
  const notes = (await demo.get('/notifications')).data;
  assert.ok((notes.items || notes).some((n) => n.type === 'superseded'));
  // huỷ văn bản mới → văn bản cũ trở lại hiệu lực
  await admin.del(`/documents/${newDoc.id}`);
  assert.equal((await demo.get(`/documents/${oldDoc.id}`)).data.is_superseded, false);
  // hiệu lực trong tương lai: đã lên lịch thay thế, văn bản cũ vẫn áp dụng
  const { data: later } = await admin.post('/documents', fd({ title: 'Công tác phí 2027', replaces_id: oldDoc.id, effective_date: '2099-01-01' }));
  const o2 = (await demo.get(`/documents/${oldDoc.id}`)).data;
  assert.equal(o2.is_superseded, false);
  assert.equal(o2.supersede_scheduled, true);
  assert.equal(o2.superseded_doc.id, later.id);
});

test('chat: history visibility for added members, admin deletes channels', async () => {
  const demo = await login('demo');
  const mkt = await login('minhtrang');
  const hr = await login('chilan');
  const admin = await login('admin');
  const { data: ch } = await demo.post('/chat/channels', { name: 'bi-mat', kind: 'private' });
  await demo.post(`/chat/channels/${ch.id}/messages`, { content: 'tin cũ 1' });
  await demo.post(`/chat/channels/${ch.id}/messages`, { content: 'tin cũ 2' });
  await demo.put(`/chat/channels/${ch.id}`, { members: [demo.user.id, mkt.user.id], history: 'none' });
  assert.equal((await mkt.get(`/chat/channels/${ch.id}/messages`)).data.length, 0);
  assert.equal((await mkt.get('/chat/search?q=tin%20c%C5%A9')).data.length, 0);
  assert.equal((await mkt.get('/chat/channels')).data.find((x) => x.id === ch.id).unread, 0);
  await demo.post(`/chat/channels/${ch.id}/messages`, { content: 'tin mới' });
  assert.deepEqual((await mkt.get(`/chat/channels/${ch.id}/messages`)).data.map((m) => m.content), ['tin mới']);
  await demo.put(`/chat/channels/${ch.id}`, { members: [demo.user.id, mkt.user.id, hr.user.id], history: 'all' });
  assert.equal((await hr.get(`/chat/channels/${ch.id}/messages`)).data.length, 3);
  // người đã có không bị đổi quyền
  assert.equal((await mkt.get(`/chat/channels/${ch.id}/messages`)).data.length, 1);
  // xoá kênh: thành viên thường không được, quản trị viên được
  assert.equal((await mkt.del(`/chat/channels/${ch.id}`)).status, 403);
  assert.equal((await admin.del(`/chat/channels/${ch.id}`)).status, 200);
  assert.equal((await demo.get(`/chat/channels/${ch.id}`)).status, 404);
});

test('request groups: forms and process guides for requesters', async () => {
  const admin = await login('admin');
  const demo = await login('demo');
  const g = (await demo.get('/request-groups')).data[0];
  const fd = new FormData();
  fd.append('kind', 'form');
  fd.append('files', new Blob(['mau'], { type: 'application/pdf' }), 'Mẫu đề xuất.pdf');
  assert.equal((await demo.post(`/request-groups/${g.id}/files`, fd)).status, 403);
  const up = await admin.post(`/request-groups/${g.id}/files`, fd);
  assert.equal(up.status, 201);
  const full = (await admin.get(`/request-groups/${g.id}`)).data;
  await admin.put(`/request-groups/${g.id}`, { ...full, approvers: full.approvers.map((a) => a.user_id), followers: full.followers.map((f) => f.user_id), guide: '<p>Bước 1: tải mẫu</p>' });
  const seen = (await demo.get(`/request-groups/${g.id}`)).data;
  assert.equal(seen.files[0].original_name, 'Mẫu đề xuất.pdf');
  assert.equal(seen.guide, '<p>Bước 1: tải mẫu</p>');
  assert.equal((await demo.get(`/request-groups/${g.id}/files/${seen.files[0].id}`)).data, 'mau');
  assert.ok((await demo.get('/request-groups')).data.find((x) => x.id === g.id).file_count >= 1);
});

test('home agenda lists important tasks to keep an eye on', async () => {
  const demo = await login('demo');
  await demo.post('/tasks', { title: 'Việc khẩn cần lưu ý', priority: 'urgent' });
  const a = (await demo.get('/home/agenda')).data;
  const item = a.important.find((i) => i.title === 'Việc khẩn cần lưu ý');
  assert.equal(item.role, 'assignee');
  assert.ok(a.important.every((i) => ['urgent', 'important'].includes(i.priority)));
});

test('wework permissions: who may assign to whom, what an assignee may change', async () => {
  const admin = await login('admin');
  const kd = await login('truongkd');     // trưởng phòng Kinh doanh, quản lý trực tiếp của demo
  const demo = await login('demo');
  const mkt = await login('duylinh');     // phòng Marketing, không do truongkd quản lý
  // nhân viên không giao được cho người ngoài phạm vi quản lý
  assert.equal((await demo.post('/tasks', { title: 'Giao ngang', assignee_id: mkt.user.id })).status, 403);
  assert.equal((await demo.post('/tasks', { title: 'Tự giao' })).status, 201);
  // trưởng phòng / quản lý trực tiếp giao cho nhân viên của mình, không giao sang phòng khác
  const scope = (await kd.get('/wework/assignable')).data;
  assert.ok(scope.ids.includes(demo.user.id) && !scope.ids.includes(mkt.user.id));
  assert.equal((await kd.post('/tasks', { title: 'Sang phòng khác', assignee_id: mkt.user.id })).status, 403);
  const { data: t } = await kd.post('/tasks', { title: 'Khảo sát đại lý', assignee_id: demo.user.id, due_date: '2026-10-10' });
  // quản trị viên giao cho mọi người
  assert.equal((await admin.get('/wework/assignable')).data.all, true);
  assert.equal((await admin.post('/tasks', { title: 'Việc của Marketing', assignee_id: mkt.user.id })).status, 201);
  // người được giao: cập nhật trạng thái được, không đổi thời gian / mô tả / dự án / lặp lại, không xoá
  const seen = (await demo.get(`/tasks/${t.id}`)).data;
  assert.equal(seen.can_edit, true);
  assert.equal(seen.can_manage, false);
  assert.equal(seen.can_delete, false);
  assert.equal((await demo.put(`/tasks/${t.id}`, { status: 'doing' })).status, 200);
  for (const patch of [{ due_date: '2026-12-31' }, { start_date: '2026-10-01' }, { description: 'x' }, { recurring: 'weekly' }]) {
    assert.equal((await demo.put(`/tasks/${t.id}`, patch)).status, 403, JSON.stringify(patch));
  }
  assert.equal((await demo.del(`/tasks/${t.id}`)).status, 403);
  assert.equal((await kd.put(`/tasks/${t.id}`, { due_date: '2026-12-31' })).status, 200);
});

test('a member can belong to several departments', async () => {
  const admin = await login('admin');
  const demo = await login('demo');
  const deps = (await admin.get('/departments')).data;
  const mktDep = deps.find((d) => d.name === 'Phòng Marketing');
  const before = mktDep.member_count;
  await admin.put(`/users/${demo.user.id}`, { ...(await admin.get(`/users/${demo.user.id}`)).data, extra_department_ids: [mktDep.id] });
  const me = (await demo.get(`/users/${demo.user.id}`)).data;
  assert.deepEqual(me.extra_department_ids, [mktDep.id]);
  assert.equal((await admin.get('/departments')).data.find((d) => d.id === mktDep.id).member_count, before + 1);
  // thấy kênh chat của phòng ban kiêm nhiệm
  const chans = (await demo.get('/home/chat')).data.channels;
  assert.ok(chans.some((c) => c.name === 'Phòng Marketing'));
  // nhận văn bản gửi cho phòng ban kiêm nhiệm
  const fd = new FormData();
  fd.append('title', 'Thông báo riêng phòng Marketing');
  fd.append('recipient_departments', String(mktDep.id));
  const { data: doc } = await admin.post('/documents', fd);
  assert.equal((await demo.get(`/documents/${doc.id}`)).status, 200);
  // trưởng phòng Marketing giao việc được cho người kiêm nhiệm
  const mkt = await login('minhtrang');
  assert.ok((await mkt.get('/wework/assignable')).data.ids.includes(demo.user.id));
  await admin.put(`/users/${demo.user.id}`, { ...me, extra_department_ids: [] });
});

test('goals: link related tasks, progress follows completed tasks; critical priority fills the Eisenhower matrix', async () => {
  const demo = await login('demo');
  const admin = await login('admin');
  const { data: g } = await demo.post('/goals', { title: 'Mở 20 điểm bán mới Q4', progress: 0 });
  const { data: a } = await demo.post('/tasks', { title: 'Khảo sát khu vực A' });
  const { data: b } = await demo.post('/tasks', { title: 'Ký hợp đồng điểm bán B', goal_id: g.id, priority: 'critical' });
  const linked = await demo.post(`/goals/${g.id}/tasks`, { task_ids: [a.id] });
  assert.equal(linked.data.linked, 1);
  assert.equal(linked.data.goal.task_count, 2);
  assert.equal((await demo.get(`/goals/${g.id}/tasks`)).data.length, 2);
  await demo.put(`/tasks/${a.id}`, { status: 'done' });
  assert.equal((await demo.get('/goals')).data.find((x) => x.id === g.id).progress, 50);
  assert.equal((await demo.get(`/tasks/${b.id}`)).data.goal.title, 'Mở 20 điểm bán mới Q4');
  // bỏ gắn → tiến độ tính lại
  const after = (await demo.del(`/goals/${g.id}/tasks/${a.id}`)).data;
  assert.equal(after.task_count, 1);
  assert.equal(after.progress, 0);
  // người khác không xem được mục tiêu của tôi
  assert.equal((await admin.get(`/goals/${g.id}/tasks`)).status, 404);
  // mức ưu tiên "Quan trọng & khẩn cấp" được tính vào ô "both" và lọc khẩn cấp
  const r = (await admin.get('/wework/reports/overview?from=2020-01-01')).data;
  assert.ok(r.eisenhower.both >= 1);
  assert.equal((await admin.get('/wework/reports/tasks?from=2020-01-01&priority=critical')).data.total, r.eisenhower.both);
  assert.ok((await demo.get('/tasks?status=urgent&scope=mine')).data.items.some((t) => t.id === b.id));
  assert.ok((await demo.get('/home/agenda')).data.important.some((t) => t.id === b.id));
});

test('project members: add people or whole departments, change role, remove; multi-department projects', async () => {
  const admin = await login('admin');
  const mkt = await login('minhtrang');
  const demo = await login('demo');
  const deps = (await admin.get('/departments')).data;
  const kd = deps.find((d) => d.name === 'Phòng Kinh doanh');
  const mk = deps.find((d) => d.name === 'Phòng Marketing');
  // dự án phối hợp 2 phòng ban, thêm luôn nhân sự các phòng ban
  const { data: p } = await mkt.post('/projects', { name: 'Ra mắt dòng sản phẩm mới', department_ids: [mk.id, kd.id], add_department_members: true });
  assert.deepEqual(p.departments.map((d) => d.id).sort(), [kd.id, mk.id].sort());
  assert.ok(p.members.some((m) => m.id === demo.user.id));
  // thành viên thường không quản lý được thành viên
  assert.equal((await demo.post(`/projects/${p.id}/members`, { user_ids: [admin.user.id] })).status, 403);
  // xoá, thêm lại, đổi vai trò
  assert.ok(!(await mkt.del(`/projects/${p.id}/members/${demo.user.id}`)).data.members.some((m) => m.id === demo.user.id));
  const add = await mkt.post(`/projects/${p.id}/members`, { user_ids: [demo.user.id], role: 'member' });
  assert.equal(add.data.added, 1);
  const promoted = await mkt.put(`/projects/${p.id}/members/${demo.user.id}`, { role: 'manager' });
  assert.equal(promoted.data.members.find((m) => m.id === demo.user.id).role, 'manager');
  assert.equal((await mkt.del(`/projects/${p.id}/members/${mkt.user.id}`)).status, 400); // chủ sở hữu
  // quản trị viên là thành viên thường vẫn quản lý được
  await mkt.post(`/projects/${p.id}/members`, { user_ids: [admin.user.id], role: 'member' });
  assert.equal((await admin.get(`/projects/${p.id}`)).data.my_role, 'manager');
  assert.equal((await admin.put(`/projects/${p.id}/members/${demo.user.id}`, { role: 'member' })).status, 200);
  // đổi phòng ban phối hợp
  const upd = await mkt.put(`/projects/${p.id}`, { department_ids: [kd.id] });
  assert.deepEqual(upd.data.departments.map((d) => d.id), [kd.id]);
});

test('task comments: @mention notifies the person and lets them open the task', async () => {
  const kd = await login('truongkd');
  const demo = await login('demo');
  const hr = await login('chilan');
  const { data: t } = await kd.post('/tasks', { title: 'Chuẩn bị hồ sơ thầu', assignee_id: demo.user.id });
  assert.equal((await hr.get(`/tasks/${t.id}`)).status, 403);
  await kd.post(`/tasks/${t.id}/comments`, { content: 'Nhờ @chilan kiểm tra giúp hồ sơ nhân sự.' });
  const notes = (await hr.get('/notifications')).data;
  const n = (notes.items || notes).find((x) => x.type === 'mention');
  assert.ok(n && n.link === `/wework/task/${t.id}` && /nhắc đến bạn/.test(n.title));
  assert.equal((await hr.get(`/tasks/${t.id}`)).status, 200);
  // người thực hiện vẫn nhận thông báo bình luận thường
  assert.ok(((await demo.get('/notifications')).data.items || []).some((x) => x.type === 'comment' && x.link === `/wework/task/${t.id}`));
});

test('chat: opening a direct conversation repeatedly never duplicates it', async () => {
  const demo = await login('demo');
  const mkt = await login('minhtrang');
  const ids = await Promise.all([1, 2, 3, 4].map(() => demo.post('/chat/direct', { user_id: mkt.user.id })));
  assert.equal(new Set(ids.map((r) => r.data.id)).size, 1);
  assert.equal((await mkt.post('/chat/direct', { user_id: demo.user.id })).data.id, ids[0].data.id);
  assert.equal((await demo.get('/chat/channels')).data.filter((c) => c.kind === 'direct' && c.peer?.id === mkt.user.id).length, 1);
});

test('department / project tasks: outside people join a single task without joining the project', async () => {
  const mkt = await login('minhtrang');   // chủ Project MKT
  const hr = await login('chilan');       // phòng HCNS, không thuộc Project MKT
  const projects = (await mkt.get('/projects')).data;
  const p = projects.find((x) => x.name === 'Project MKT');
  assert.equal((await hr.get(`/projects/${p.id}`)).status, 403);
  // mời theo dõi / phối hợp một công việc của dự án
  const { data: t } = await mkt.post('/tasks', { title: 'Tuyển CTV cho sự kiện', project_id: p.id, followers: [hr.user.id] });
  const seen = await hr.get(`/tasks/${t.id}`);
  assert.equal(seen.status, 200);
  assert.equal(seen.data.can_contribute, true);
  assert.equal(seen.data.outside_project, true);
  assert.equal((await hr.post(`/tasks/${t.id}/comments`, { content: 'Đã có danh sách ứng viên' })).status, 201);
  assert.equal((await hr.post(`/tasks/${t.id}/results`, { content: '<p>12 CTV đã xác nhận</p>' })).status, 201);
  // vẫn không xem được các công việc khác / toàn bộ dự án
  assert.equal((await hr.get(`/projects/${p.id}`)).status, 403);
  assert.ok(!(await hr.get(`/tasks?project_id=${p.id}&scope=all`)).data.items.some((x) => x.id !== t.id));
});

test('business owner: top admin tier, protected from other admins; only an owner grants the role', async () => {
  const gd = await login('giamdoc');
  const admin = await login('admin');
  assert.equal(gd.user.is_owner, 1);
  assert.equal(gd.user.role, 'admin');
  const chilan = admin.user && (await admin.get('/users')).data.find((u) => u.username === 'chilan');
  // quản trị viên thường không sửa / khoá / đổi mật khẩu được Chủ doanh nghiệp
  assert.equal((await admin.put(`/users/${gd.user.id}`, { name: 'X', role: 'member' })).status, 403);
  assert.equal((await admin.del(`/users/${gd.user.id}`)).status, 403);
  assert.equal((await admin.post('/account/members/reset-passwords', { ids: [gd.user.id], password: 'abcdef' })).status, 403);
  // quản trị viên thường không trao được vai trò Chủ doanh nghiệp khi đã có Chủ doanh nghiệp
  assert.equal((await admin.put(`/users/${chilan.id}`, { ...chilan, role: 'owner' })).status, 403);
  // Chủ doanh nghiệp trao vai trò cho người khác → người đó có toàn quyền quản trị
  const up = await gd.put(`/users/${chilan.id}`, { ...chilan, role: 'owner' });
  assert.equal(up.status, 200);
  assert.equal(up.data.is_owner, 1);
  assert.equal(up.data.role, 'admin');
  const lan = await login('chilan');
  assert.equal((await lan.get('/account/security')).status, 200);
  const members = await admin.get('/account/members?tab=admins');
  assert.equal(members.data.counts.owners, 2);
  assert.equal(members.data.items[0].is_owner, 1);
  // thu hồi; không được bỏ Chủ doanh nghiệp cuối cùng
  assert.equal((await gd.put(`/users/${chilan.id}`, { ...chilan, role: 'member' })).data.is_owner, 0);
  const me = (await gd.get(`/users/${gd.user.id}`)).data;
  assert.equal((await gd.put(`/users/${gd.user.id}`, { ...me, role: 'admin' })).status, 400);
});

test('web push: subscribe a device, notifications are encrypted (RFC 8291) and VAPID-signed, gone devices are removed', async () => {
  const { flushBackground, unb64url, b64url } = await import('../src/push.js');
  const demo = await login('demo');
  const gd = await login('giamdoc');
  const key = (await demo.get('/push/key')).data.key;
  assert.equal(unb64url(key).length, 65);
  // "trình duyệt" giả lập: cặp khoá ECDH của subscription
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const endpoint = 'https://web.push.apple.com/QTest-device';
  assert.equal((await demo.post('/push/subscribe', { endpoint: 'http://x', keys: {} })).status, 400);
  assert.equal((await demo.post('/push/subscribe', { endpoint, keys: { p256dh: b64url(uaPublic), auth: b64url(authSecret) } })).status, 200);
  assert.equal((await demo.post('/push/status', { endpoint })).data.subscribed, true);

  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { sent.push({ url, opts }); return new Response(null, { status: sent.length === 1 ? 201 : 410 }); };
  try {
    await gd.post('/tasks', { title: 'Việc có thông báo đẩy', assignee_id: demo.user.id });
    await flushBackground();
    assert.equal(sent.length, 1);
    const { url, opts } = sent[0];
    assert.equal(url, endpoint);
    assert.equal(opts.headers['Content-Encoding'], 'aes128gcm');
    // VAPID: JWT ES256 ký bằng khoá công khai đã công bố, aud = origin của dịch vụ đẩy
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(opts.headers.Authorization);
    assert.equal(k, key);
    const [h, p, s] = jwt.split('.');
    const pub = await crypto.subtle.importKey('raw', unb64url(key), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64url(s), new TextEncoder().encode(`${h}.${p}`)));
    assert.equal(JSON.parse(new TextDecoder().decode(unb64url(p))).aud, 'https://web.push.apple.com');
    // Giải mã như trình duyệt
    const body = new Uint8Array(opts.body);
    const salt = body.slice(0, 16);
    const idlen = body[20];
    const asPublic = body.slice(21, 21 + idlen);
    const cipher = body.slice(21 + idlen);
    const hk = async (saltB, ikm, info, bits) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: saltB, info },
      await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), bits));
    const te = new TextEncoder();
    const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
    const info = new Uint8Array([...te.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
    const ikm = await hk(authSecret, ecdh, info, 256);
    const cek = await hk(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 128);
    const nonce = await hk(salt, ikm, te.encode('Content-Encoding: nonce\0'), 96);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce },
      await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), cipher));
    assert.equal(plain[plain.length - 1], 2);
    const msg = JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
    assert.equal(msg.title, 'LDL Wework');
    assert.match(msg.body, /Việc có thông báo đẩy/);
    assert.match(msg.url, /^\/wework\/task\/\d+$/);
    assert.ok(msg.badge >= 1);
    // Dịch vụ đẩy báo 410 (thiết bị đã huỷ) → tự xoá đăng ký
    await gd.post('/tasks', { title: 'Việc thứ hai', assignee_id: demo.user.id });
    await flushBackground();
    assert.equal((await demo.post('/push/status', { endpoint })).data.subscribed, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('opening a task / chat marks its notifications as read (keeps the app icon badge accurate)', async () => {
  const demo = await login('demo');
  const gd = await login('giamdoc');
  const before = (await demo.get('/notifications?limit=1')).data.unread;
  const t = (await gd.post('/tasks', { title: 'Việc kiểm tra số chưa đọc', assignee_id: demo.user.id })).data;
  assert.equal((await demo.get('/notifications?limit=1')).data.unread, before + 1);
  await demo.get(`/tasks/${t.id}`);
  assert.equal((await demo.get('/notifications?limit=1')).data.unread, before);
  const dm = (await gd.post('/chat/direct', { user_id: demo.user.id })).data;
  const fd = new FormData(); fd.append('content', 'Chào em');
  await gd.post(`/chat/channels/${dm.id}/messages`, fd);
  assert.equal((await demo.get('/notifications?limit=1')).data.unread, before + 1);
  await demo.post(`/chat/channels/${dm.id}/read`, {});
  assert.equal((await demo.get('/notifications?limit=1')).data.unread, before);
});
