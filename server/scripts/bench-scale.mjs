#!/usr/bin/env node
/**
 * Đo hiệu năng với dữ liệu quy mô lớn: sinh ~360 nhân sự theo cơ cấu kinh doanh (NSM → RSM → ASM × 2 ngành → SS → SREP/PG)
 * kèm công việc, đề xuất, chấm công, thông báo, tin nhắn; rồi đo thời gian + số truy vấn của các API chính.
 *   npm run bench:scale            (~6.500 công việc)
 *   BIG=1 npm run bench:scale      (~36.000 công việc, ~11.000 đề xuất — tương đương khoảng 1 năm sử dụng)
 * Dữ liệu tạo trong thư mục tạm, không đụng tới dữ liệu thật.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as db from '../src/db.js';

const { all, get, batch } = db;
async function genScale({ perSS = 5, tasksPerUser = 18, requestsPerUser = 8, notifPerUser = 60 } = {}) {
  const hash = (await get("SELECT password_hash FROM users WHERE username='admin'")).password_hash;
  const kd = (await get("SELECT id FROM departments WHERE code='KD'")).id;
  const nsm = (await get("SELECT id FROM users WHERE username='truongkd'")).id;
  const terr = await all('SELECT id, name, level, parent_id FROM territories');
  const S = []; let uid = (await get('SELECT MAX(id) m FROM users')).m;
  const users = [];
  const addU = (name, role, mgr, tid, ind, dep = kd) => {
    const id = ++uid; users.push(id);
    S.push(['INSERT INTO users(id, username, password_hash, name, email, title, department_id, role, color, manager_id, sales_role, sales_industry) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, `u${id}`, hash, `${name} ${id}`, `u${id}@ldl.vn`, role, dep, 'member', '#2d7ff9', mgr, role, ind]]);
    S.push(['INSERT INTO hr_profiles(user_id, employee_code, hire_date, work_status, gender, office) VALUES (?,?,?,?,?,?)', [id, `NV${id}`, '2023-01-01', 'working', id % 2 ? 'Nam' : 'Nữ', 'Văn phòng Hà Nội']]);
    if (tid) S.push(['INSERT INTO territory_members(territory_id, user_id, role, industry) VALUES (?,?,?,?)', [tid, id, role, ind]]);
    return id;
  };
  for (const r of terr.filter((t) => t.level === 'region')) {
    const rsm = addU('RSM', 'RSM', nsm, r.id, null);
    for (const a of terr.filter((t) => t.parent_id === r.id)) for (const ind of ['HMP', 'TP']) {
      const asm = addU('ASM', 'ASM', rsm, a.id, ind);
      for (const p of terr.filter((t) => t.parent_id === a.id)) {
        const ss = addU('SS', 'SS', asm, p.id, ind);
        for (let k = 0; k < perSS; k++) addU(k % 3 === 2 ? 'PG' : 'SREP', k % 3 === 2 ? 'PG' : 'SREP', ss, p.id, ind);
      }
    }
  }
  const office = (await all("SELECT id FROM departments WHERE code <> 'KD'")).map((d) => d.id);
  for (let k = 0; k < 20; k++) addU('NV văn phòng', 'Chuyên viên', null, null, null, office[k % office.length]);
  S.push(["INSERT OR IGNORE INTO app_access(app_key, user_id) SELECT a.key, u.id FROM apps a CROSS JOIN users u WHERE u.role <> 'guest'", []]);
  await batch(S); S.length = 0;
  const everyone = (await all("SELECT id, manager_id FROM users WHERE role <> 'guest'"));
  const proj = (await get('SELECT id FROM projects LIMIT 1')).id;
  const today = new Date(); const d = (o) => new Date(today.getTime() + o * 864e5).toISOString().slice(0, 10);
  const statuses = ['todo', 'doing', 'done', 'done', 'todo'];
  for (const u of everyone) for (let k = 0; k < tasksPerUser; k++) {
    S.push(['INSERT INTO tasks(project_id, title, creator_id, assignee_id, status, due_date, completed_at) VALUES (?,?,?,?,?,?,?)',
      [k % 3 ? null : proj, `Việc ${u.id}-${k}`, u.manager_id || u.id, u.id, statuses[k % 5], d((k % 30) - 15), statuses[k % 5] === 'done' ? d(-(k % 20)) : null]]);
  }
  await batch(S); S.length = 0;
  const g = (await get('SELECT id FROM request_groups LIMIT 1')).id;
  let rid = (await get('SELECT IFNULL(MAX(id),0) m FROM requests')).m;
  for (const u of everyone) for (let k = 0; k < requestsPerUser; k++) {
    rid++;
    S.push(['INSERT INTO requests(id, group_id, title, creator_id, status, submitted_at, created_at) VALUES (?,?,?,?,?,?,?)', [rid, g, `Đề xuất ${rid}`, u.id, ['pending', 'approved', 'rejected'][k % 3], d(-k), d(-k)]]);
    if (u.manager_id) S.push(['INSERT INTO request_approvers(request_id, user_id, step, status, stage) VALUES (?,?,?,?,?)', [rid, u.manager_id, 1, k % 3 ? 'approved' : 'pending', 'manager']]);
  }
  await batch(S); S.length = 0;
  const month = today.toISOString().slice(0, 7);
  for (const u of everyone) for (let day = 1; day <= Math.min(28, today.getDate()); day++) {
    S.push(['INSERT OR IGNORE INTO checkins(user_id, date, check_in_at, check_out_at) VALUES (?,?,?,?)', [u.id, `${month}-${String(day).padStart(2, '0')}`, `${month}-${String(day).padStart(2, '0')} 01:25:00`, `${month}-${String(day).padStart(2, '0')} 10:35:00`]]);
  }
  for (const u of everyone) for (let k = 0; k < notifPerUser; k++) S.push(['INSERT INTO notifications(user_id, app, type, title, link, is_read) VALUES (?,?,?,?,?,?)', [u.id, 'wework', 'assigned', `Thông báo ${k}`, `/wework/tasks/${k}`, k % 4 ? 1 : 0]]);
  S.push(["INSERT OR IGNORE INTO chat_members(channel_id, user_id) SELECT 1, id FROM users WHERE role <> 'guest'", []]);
  for (let k = 0; k < 3000; k++) S.push(['INSERT INTO chat_messages(channel_id, user_id, content) VALUES (1,?,?)', [everyone[k % everyone.length].id, `Tin nhắn ${k}`]]);
  await batch(S);
  return { users: everyone.length, tasks: (await get('SELECT COUNT(*) c FROM tasks')).c, requests: (await get('SELECT COUNT(*) c FROM requests')).c };
}
process.env.JWT_SECRET = 'bench';
const dir = path.join(os.tmpdir(), 'ldl-bench-scale'); fs.rmSync(dir, { recursive: true, force: true });
const { initNode } = await import('../src/node.js');

await initNode({ dataDir: dir, reset: true });
console.log(await genScale(process.env.BIG ? { tasksPerUser: 100, requestsPerUser: 30, notifPerUser: 200 } : {}));
// đếm truy vấn
const { createNodeDriver } = await import('../src/drivers/node-sqlite.js');
const base = createNodeDriver(`${dir}/app.db`);
let q = 0; const wrap = (f) => async (...a) => { q++; return f(...a); };
db.setDriver({ all: wrap(base.all), get: wrap(base.get), run: wrap(base.run), batch: wrap(base.batch) });
const { createApp } = await import('../src/app.js');
const app = createApp();
const call = async (token, method, url, body) => {
  const h = { Authorization: `Bearer ${token}` }; if (body) h['Content-Type'] = 'application/json';
  const r = await app.fetch(new Request(`http://x/api${url}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined }));
  const t = await r.text(); return { status: r.status, size: t.length, body: t };
};
const login = async (u) => JSON.parse(await (await app.fetch(new Request('http://x/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: '123456' }) }))).text()).token;
const who = { admin: 'admin', nsm: 'truongkd', hr: 'chilan', rsm: (await db.get("SELECT username FROM users WHERE sales_role='RSM'")).username,
  srep: (await db.get("SELECT username FROM users WHERE sales_role='SREP'")).username };
const tok = {}; for (const [k, u] of Object.entries(who)) tok[k] = await login(u);
const month = new Date().toISOString().slice(0, 7);
const cases = [
  ['admin', 'GET', '/auth/me'], ['admin', 'GET', '/users'], ['admin', 'GET', '/home/summary'], ['srep', 'GET', '/home/summary'],
  ['admin', 'GET', '/notifications'],
  ['admin', 'GET', '/tasks'], ['nsm', 'GET', '/tasks'], ['nsm', 'GET', '/tasks?scope=team'], ['rsm', 'GET', '/tasks?scope=team'], ['srep', 'GET', '/tasks'],
  ['admin', 'GET', '/wework/members?team=1'], ['nsm', 'GET', '/wework/members?team=1'], ['admin', 'GET', '/wework/reports'], ['nsm', 'GET', '/wework/reports'],
  ['admin', 'GET', '/requests'], ['nsm', 'GET', '/requests?box=approve'], ['rsm', 'GET', '/requests?box=approve'], ['srep', 'GET', '/requests'], ['admin', 'GET', '/request/reports'],
  ['hr', 'GET', '/hrm/employees'], ['hr', 'GET', '/hrm/employees?view=all'], ['nsm', 'GET', '/hrm/employees?view=mine'], ['hr', 'GET', '/hrm/stats'], ['hr', 'GET', '/hrm/report'],
  ['hr', 'GET', '/hrm/employees/export'], ['hr', 'GET', `/checkin/team?month=${month}`], ['hr', 'GET', `/checkin/team`], ['nsm', 'GET', `/checkin/team`], ['srep', 'GET', `/checkin/month?month=${month}`],
  ['hr', 'GET', '/timeoff/balances'], ['admin', 'GET', '/sales/structure'], ['hr', 'GET', '/sales/sync-managers'],
  ['admin', 'GET', '/chat/channels'], ['srep', 'GET', '/chat/channels'], ['srep', 'GET', '/chat/channels/1/messages'],
  ['admin', 'GET', '/account/members'], ['admin', 'GET', '/account/members?page=1'], ['admin', 'GET', '/asset/people'], ['admin', 'GET', '/assets'],
  ['admin', 'GET', '/goals?scope=all'], ['admin', 'GET', '/projects'], ['admin', 'GET', '/documents?box=inbox'], ['srep', 'GET', '/documents?box=inbox'],
  ['admin', 'GET', '/search?q=Vi'], ['admin', 'GET', '/departments'],
];
const rows = [];
for (const [u, m, url, body] of cases) {
  q = 0; const t0 = performance.now(); const r = await call(tok[u], m, url, body); const ms = performance.now() - t0;
  rows.push(`${String(r.status).padEnd(4)} ${ms.toFixed(0).padStart(6)}ms ${String(q).padStart(5)}q ${String((r.size / 1024).toFixed(0)).padStart(6)}KB  ${u.padEnd(5)} ${m} ${url}`);
}
console.log(rows.join('\n'));
