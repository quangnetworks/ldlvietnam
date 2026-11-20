import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ldl-scale-'));
process.env.JWT_SECRET = 'test-secret';
const { initNode } = await import('../src/node.js');
const { createApp } = await import('../src/app.js');

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

const db = await import('../src/db.js');
const { housekeeping } = await import('../src/maintenance.js');

test('300+ staff: long id lists, two-phase task list, batched import, housekeeping', async () => {
  // 320 tài khoản thêm (một câu lệnh / lô)
  const hash = (await db.get("SELECT password_hash FROM users WHERE username = 'admin'")).password_hash;
  const base = (await db.get('SELECT MAX(id) AS m FROM users')).m;
  const ids = Array.from({ length: 320 }, (_, i) => base + 1 + i);
  await db.batch(ids.map((id) => ['INSERT INTO users(id, username, password_hash, name, role, manager_id) VALUES (?,?,?,?,?,?)',
    [id, `s${id}`, hash, `Nhân sự ${id}`, 'member', id > base + 1 ? base + 1 + Math.floor((id - base - 2) / 10) : null]]));
  const admin = await login('admin');

  // danh sách công việc: phân trang + sắp xếp đúng, cột phụ (việc con) chỉ tính cho trang trả về
  const parent = (await admin.post('/tasks', { title: 'Việc cha', due_date: '2030-01-01' })).data;
  for (let i = 0; i < 70; i++) await admin.post('/tasks', { title: `Việc ${i}`, due_date: `2029-${String((i % 12) + 1).padStart(2, '0')}-10` });
  await admin.post('/tasks', { title: 'Việc con', parent_id: parent.id });
  const page1 = (await admin.get('/tasks?sort=due&limit=50')).data;
  assert.equal(page1.items.length, 50);
  assert.ok(page1.total >= 72);
  const dues = page1.items.map((t) => t.due_date).filter(Boolean);
  assert.deepEqual(dues, [...dues].sort());
  const page2 = (await admin.get('/tasks?sort=due&limit=50&page=2')).data;
  assert.ok(!page2.items.some((t) => page1.items.some((x) => x.id === t.id)));
  const withParent = [...page1.items, ...page2.items].find((t) => t.id === parent.id);
  assert.equal(withParent.subtask_count, 1);

  // danh sách id dài (> 100 tham số D1): đổi mật khẩu hàng loạt, kênh chat riêng 300 thành viên, thông báo cả công ty
  assert.equal((await admin.post('/account/members/reset-passwords', { ids, password: 'Ldl@2026' })).data.affected, 320);
  const ch = (await admin.post('/chat/channels', { name: 'kinh-doanh-toan-quoc', kind: 'private', members: ids.slice(0, 300) })).data;
  assert.equal((await admin.put(`/chat/channels/${ch.id}`, { members: ids.slice(0, 250) })).status, 200);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM chat_members WHERE channel_id = ?', ch.id)).c, 251);
  await db.notify(ids, { app: 'office', type: 'notice', title: 'Thông báo toàn công ty', link: '/office' });
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM notifications WHERE title = 'Thông báo toàn công ty'")).c, 320);

  // nhập 300 hồ sơ (tạo tài khoản, quản lý, lịch sử, hợp đồng) trong một lần
  const hr = await login('chilan');
  const rows = Array.from({ length: 300 }, (_, i) => ({ username: `nv${i}`, employee_code: `NV${i}`, name: `Nhân viên ${i}`, department: 'Phòng Kho vận',
    manager_username: i ? `nv${Math.floor((i - 1) / 8)}` : 'truongkd', hire_date: '01/02/2024' }));
  const res = (await hr.post('/hrm/employees/import', { rows, create_accounts: true, password: 'Ldl@2026',
    careers: rows.map((r) => ({ username: r.username, type: 'Khen thưởng', effective_date: '2024-06-01', to_value: 'Xuất sắc' })),
    contracts: rows.map((r) => ({ username: r.username, code: `HD-${r.username}`, contract_type: '12 tháng', start_date: '2024-02-01' })) })).data;
  assert.deepEqual([res.created, res.careers, res.contracts, res.errors.length], [300, 300, 300, 0]);
  const nv9 = await db.get("SELECT u.manager_id, m.username AS mgr, h.contract_type FROM users u JOIN users m ON m.id = u.manager_id JOIN hr_profiles h ON h.user_id = u.id WHERE u.username = 'nv9'");
  assert.deepEqual([nv9.mgr, nv9.contract_type], ['nv1', '12 tháng']);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM departments WHERE name = 'Phòng Kho vận'")).c, 1);
  // nhập lại: không tạo trùng
  const again = (await hr.post('/hrm/employees/import', { rows: rows.slice(0, 5), careers: [{ username: 'nv1', type: 'Khen thưởng', effective_date: '2024-06-01', to_value: 'Xuất sắc' }] })).data;
  assert.deepEqual([again.created, again.careers, again.skipped], [0, 0, 1]);

  // dọn dẹp: thông báo đã đọc > 90 ngày bị xoá, thông báo mới giữ lại
  await db.run("UPDATE notifications SET is_read = 1, created_at = datetime('now', '-120 day') WHERE title = 'Thông báo toàn công ty' AND user_id <= ?", base + 100);
  const removed = await housekeeping();
  assert.equal(removed.notifications, 100);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM notifications WHERE title = 'Thông báo toàn công ty'")).c, 220);
});
