// TẠM THỜI — chẩn đoán vì sao một tài khoản tích Hoàn thành không chuyển "Chờ đánh giá" (chỉ đọc D1).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const who = String(process.env.WHO || '').trim();
if (!/^[\w.@-]{2,80}$/.test(who)) { console.error('WHO không hợp lệ'); process.exit(1); }
const toml = fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8');
const DB = toml.match(/^database_name\s*=\s*"([^"]+)"/m)[1];
const w = path.join(root, 'node_modules/wrangler/bin/wrangler.js');
const run = (args) => spawnSync(process.execPath, [w, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
const db = JSON.parse(run(['d1', 'list', '--json']).stdout.replace(/^[^[]*/, '')).find((d) => d.name === DB);
const cfg = path.join(root, '.wrangler-diag.toml');
fs.writeFileSync(cfg, toml.replace(/^database_id = ".*"/m, `database_id = "${db.uuid}"`));
const q = (title, sql) => {
  const r = run(['d1', 'execute', DB, '--remote', '--json', '--config', cfg, '--command', sql]);
  const out = r.stdout.slice(r.stdout.indexOf('['));
  console.log(`\n===== ${title}`);
  try { console.log(JSON.stringify(JSON.parse(out)[0].results, null, 1)); } catch { console.log(r.stdout, r.stderr); }
};
const W = `(lower(u.username) = lower('${who}') OR lower(u.email) = lower('${who}') OR lower(u.username) = lower('${who.split('@')[0]}'))`;
q('Tài khoản', `SELECT u.id, u.username, u.email, u.role, u.title, u.is_owner, u.department_id, u.active FROM users u WHERE ${W}`);
q('Phòng ban của tài khoản', `SELECT d.id, d.name, d.task_approval, d.head_id, h.username AS head FROM users u JOIN departments d
  ON d.id = u.department_id OR d.id IN (SELECT department_id FROM user_departments WHERE user_id = u.id) LEFT JOIN users h ON h.id = d.head_id WHERE ${W}`);
q('Phòng ban đang bật duyệt', `SELECT d.id, d.name, d.head_id, h.username AS head FROM departments d LEFT JOIN users h ON h.id = d.head_id WHERE d.task_approval = 1`);
q('Là trưởng phòng của', `SELECT d.id, d.name, d.task_approval FROM departments d JOIN users u ON u.id = d.head_id WHERE ${W}`);
q('Chức danh quản trị Wework', `SELECT value FROM settings WHERE key = 'wework_settings'`);
q('Hoạt động công việc gần nhất', `SELECT l.entity_id AS task_id, l.action, l.detail, l.created_at, t.status, t.assignee_id, a.username AS assignee,
  a.department_id AS assignee_dep FROM activity_logs l JOIN users u ON u.id = l.user_id LEFT JOIN tasks t ON t.id = l.entity_id
  LEFT JOIN users a ON a.id = t.assignee_id WHERE l.entity_type = 'task' AND ${W} ORDER BY l.id DESC LIMIT 15`);
fs.rmSync(cfg, { force: true });
