import { Hono } from 'hono';
import { all, get, run, batch, getSetting } from '../db.js';
import { requireAdmin, hashPassword, loadUser, PUBLIC_USER_FIELDS } from '../auth.js';
import { badRequest, notFound, toInt, idList, jsonBody, paginate } from '../util.js';
import { MODULES, userApps, grantApps, audit } from '../platform.js';

const r = new Hono();

// ================================================================ profile
r.get('/account/profile/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const u = await loadUser(id);
  if (!u) throw notFound('Tài khoản không tồn tại');
  const [manager, reports, groups, apps] = await Promise.all([
    u.manager_id ? get('SELECT id, name, color, title, username FROM users WHERE id = ?', u.manager_id) : null,
    all('SELECT id, name, color, title, username FROM users WHERE manager_id = ? AND active = 1 ORDER BY name', id),
    all(`SELECT g.id, g.name FROM user_groups g JOIN user_group_members m ON m.group_id = g.id WHERE m.user_id = ? ORDER BY g.name`, id),
    userApps(u),
  ]);
  return c.json({ ...u, manager, reports, groups, apps, company: await getSetting('company_name', '') });
});

// ================================================================ members
r.get('/account/members', async (c) => {
  const q = c.req.query();
  const where = [];
  const params = [];
  if (q.tab === 'admins') where.push("u.role = 'admin' AND u.active = 1");
  else if (q.tab === 'disabled') where.push('u.active = 0');
  else where.push('u.active = 1');
  if (q.q) {
    const like = `%${q.q.trim()}%`;
    where.push("(u.name LIKE ? OR u.username LIKE ? OR IFNULL(u.email,'') LIKE ? OR IFNULL(u.phone,'') LIKE ?)");
    params.push(like, like, like, like);
  }
  const dep = toInt(q.department_id);
  if (dep) { where.push('u.department_id = ?'); params.push(dep); }
  const grp = toInt(q.group_id);
  if (grp) { where.push('EXISTS (SELECT 1 FROM user_group_members gm WHERE gm.user_id = u.id AND gm.group_id = ?)'); params.push(grp); }
  const items = await all(
    `SELECT ${PUBLIC_USER_FIELDS}, d.name AS department_name, m.name AS manager_name, m.color AS manager_color,
       m.username AS manager_username, m.title AS manager_title,
       (SELECT group_concat(x.app_key) FROM app_access x WHERE x.user_id = u.id) AS app_keys
     FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users m ON m.id = u.manager_id
     WHERE ${where.join(' AND ')} ORDER BY u.name COLLATE NOCASE`,
    ...params
  );
  for (const u of items) {
    u.apps = u.role === 'admin' ? Object.keys(MODULES) : (u.app_keys ? u.app_keys.split(',') : []);
    delete u.app_keys;
  }
  const counts = await get(`SELECT SUM(active = 1) AS all_count, SUM(active = 1 AND role = 'admin') AS admins, SUM(active = 0) AS disabled FROM users`);
  return c.json({ items, counts: { all: counts.all_count || 0, admins: counts.admins || 0, disabled: counts.disabled || 0 } });
});

const csvEsc = (v) => `"${String(v ?? '').replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;
const CSV_HEADER = ['username', 'name', 'email', 'phone', 'title', 'department', 'manager_username', 'role', 'birthday', 'active'];

r.get('/account/members/export', requireAdmin, async (c) => {
  const rows = await all(`SELECT u.*, d.name AS department, m.username AS manager_username FROM users u
    LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users m ON m.id = u.manager_id ORDER BY u.id`);
  const lines = [CSV_HEADER.join(',')];
  for (const u of rows) lines.push(CSV_HEADER.map((k) => csvEsc(k === 'active' ? (u.active ? 1 : 0) : u[k])).join(','));
  return new Response(`﻿${lines.join('\r\n')}`, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="thanh-vien.csv"' },
  });
});

/** Minimal RFC 4180 CSV parser (handles quotes, commas and newlines inside quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** Import members from CSV: creates new accounts, updates existing ones (matched by username). */
r.post('/account/members/import', requireAdmin, async (c) => {
  const b = await jsonBody(c);
  const rows = parseCsv(String(b.csv || ''));
  if (rows.length < 2) throw badRequest('Tệp không có dữ liệu (cần dòng tiêu đề và ít nhất 1 dòng)');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (k) => header.indexOf(k);
  if (idx('username') < 0 || idx('name') < 0) throw badRequest('Thiếu cột bắt buộc: username, name');
  if (rows.length > 501) throw badRequest('Tối đa 500 tài khoản mỗi lần nhập');
  const defaultPassword = String(b.password || '');
  if (defaultPassword.length < 6) throw badRequest('Mật khẩu mặc định phải có ít nhất 6 ký tự');
  const hash = await hashPassword(defaultPassword);
  const deps = await all('SELECT id, name FROM departments');
  const result = { created: 0, updated: 0, errors: [] };
  const managerLinks = [];
  for (let i = 1; i < rows.length; i++) {
    const v = (k) => (idx(k) >= 0 ? String(rows[i][idx(k)] ?? '').trim() : '');
    const username = v('username');
    const name = v('name');
    if (!/^[\w.@-]{2,64}$/.test(username) || !name) { result.errors.push(`Dòng ${i + 1}: username/name không hợp lệ`); continue; }
    let depId = null;
    if (v('department')) {
      depId = deps.find((d) => d.name.toLowerCase() === v('department').toLowerCase())?.id ?? null;
      if (!depId) {
        depId = (await run('INSERT INTO departments(name) VALUES (?)', v('department'))).lastId;
        deps.push({ id: depId, name: v('department') });
      }
    }
    const role = v('role') === 'admin' ? 'admin' : 'member';
    const existing = await get('SELECT id FROM users WHERE lower(username) = lower(?)', username);
    if (existing) {
      await run(`UPDATE users SET name = ?, email = COALESCE(NULLIF(?, ''), email), phone = COALESCE(NULLIF(?, ''), phone),
        title = COALESCE(NULLIF(?, ''), title), department_id = COALESCE(?, department_id), birthday = COALESCE(NULLIF(?, ''), birthday) WHERE id = ?`,
      name, v('email'), v('phone'), v('title'), depId, v('birthday'), existing.id);
      result.updated++;
    } else {
      const { lastId } = await run(`INSERT INTO users(username, password_hash, name, email, phone, title, department_id, role, birthday)
        VALUES (?,?,?,?,?,?,?,?,?)`, username, hash, name, v('email') || null, v('phone') || null, v('title') || null, depId, role, v('birthday') || null);
      await grantApps(lastId);
      result.created++;
    }
    if (v('manager_username')) managerLinks.push([username, v('manager_username')]);
  }
  for (const [u, m] of managerLinks) {
    await run(`UPDATE users SET manager_id = (SELECT id FROM users WHERE lower(username) = lower(?))
      WHERE lower(username) = lower(?) AND lower(username) <> lower(?)`, m, u, m);
  }
  await audit(c.get('user').id, 'user.import', `Nhập từ Excel: ${result.created} tạo mới, ${result.updated} cập nhật`);
  return c.json(result);
});

r.post('/account/members/reset-passwords', requireAdmin, async (c) => {
  const b = await jsonBody(c);
  const ids = idList(b.ids).filter((id) => id !== c.get('user').id);
  if (!ids.length) throw badRequest('Chưa chọn tài khoản');
  if (!b.password || String(b.password).length < 6) throw badRequest('Mật khẩu mới phải có ít nhất 6 ký tự');
  const hash = await hashPassword(b.password);
  await batch(ids.map((id) => ['UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]]));
  await audit(c.get('user').id, 'user.password', `Đổi mật khẩu hàng loạt cho ${ids.length} tài khoản`);
  return c.json({ affected: ids.length });
});

// ================================================================ login history & audit
r.get('/account/login-logs', async (c) => {
  const user = c.get('user');
  const q = c.req.query();
  const { limit, offset, page } = paginate(q, 50);
  const target = toInt(q.user_id);
  const where = [];
  const params = [];
  if (user.role !== 'admin') { where.push('l.user_id = ?'); params.push(user.id); }
  else if (target) { where.push('l.user_id = ?'); params.push(target); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const items = await all(`SELECT l.*, u.name, u.color FROM login_logs l LEFT JOIN users u ON u.id = l.user_id ${w}
    ORDER BY l.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  const total = (await get(`SELECT COUNT(*) AS c FROM login_logs l ${w}`, ...params)).c;
  return c.json({ items, total, page, limit });
});

r.get('/account/audit', requireAdmin, async (c) => {
  const { limit, offset, page } = paginate(c.req.query(), 50);
  const items = await all(`SELECT l.*, u.name AS user_name, u.color AS user_color FROM activity_logs l
    LEFT JOIN users u ON u.id = l.user_id WHERE l.entity_type = 'system' ORDER BY l.id DESC LIMIT ? OFFSET ?`, limit, offset);
  const total = (await get("SELECT COUNT(*) AS c FROM activity_logs WHERE entity_type = 'system'")).c;
  return c.json({ items, total, page, limit });
});

// ================================================================ user groups
const groupSelect = `SELECT g.*, (SELECT COUNT(*) FROM user_group_members m JOIN users u ON u.id = m.user_id AND u.active = 1
  WHERE m.group_id = g.id) AS member_count FROM user_groups g`;

r.get('/account/groups', async (c) => c.json(await all(`${groupSelect} ORDER BY g.name COLLATE NOCASE`)));

r.get('/account/groups/:id', async (c) => {
  const g = await get(`${groupSelect} WHERE g.id = ?`, toInt(c.req.param('id')));
  if (!g) throw notFound('Nhóm không tồn tại');
  g.members = await all(`SELECT u.id, u.name, u.username, u.color, u.title FROM user_group_members m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ? AND u.active = 1 ORDER BY u.name`, g.id);
  return c.json(g);
});

async function saveGroup(c, id) {
  const b = await jsonBody(c);
  const name = String(b.name || '').trim();
  if (!name) throw badRequest('Tên nhóm là bắt buộc');
  let gid = id;
  if (gid) await run('UPDATE user_groups SET name = ?, description = ? WHERE id = ?', name, b.description || null, gid);
  else gid = (await run('INSERT INTO user_groups(name, description) VALUES (?,?)', name, b.description || null)).lastId;
  if (b.members !== undefined) {
    await batch([
      ['DELETE FROM user_group_members WHERE group_id = ?', [gid]],
      ...idList(b.members).map((uid) => ['INSERT OR IGNORE INTO user_group_members(group_id, user_id) VALUES (?,?)', [gid, uid]]),
    ]);
  }
  await audit(c.get('user').id, 'group', `${id ? 'Cập nhật' : 'Tạo'} nhóm người dùng "${name}"`);
  return gid;
}
r.post('/account/groups', requireAdmin, async (c) => c.json({ id: await saveGroup(c, null) }, 201));
r.put('/account/groups/:id', requireAdmin, async (c) => {
  const id = toInt(c.req.param('id'));
  if (!(await get('SELECT 1 FROM user_groups WHERE id = ?', id))) throw notFound('Nhóm không tồn tại');
  return c.json({ id: await saveGroup(c, id) });
});
r.delete('/account/groups/:id', requireAdmin, async (c) => {
  const g = await get('SELECT * FROM user_groups WHERE id = ?', toInt(c.req.param('id')));
  if (!g) throw notFound();
  await run('DELETE FROM user_groups WHERE id = ?', g.id);
  await audit(c.get('user').id, 'group', `Xoá nhóm người dùng "${g.name}"`);
  return c.json({ ok: true });
});

// ================================================================ apps (Quản lý ứng dụng)
r.get('/account/apps', async (c) => {
  const rows = await all(`SELECT a.key, a.enabled, (SELECT COUNT(*) FROM app_access x JOIN users u ON u.id = x.user_id AND u.active = 1
    WHERE x.app_key = a.key) AS user_count FROM apps a`);
  return c.json(rows.filter((a) => MODULES[a.key]).map((a) => ({ ...a, name: MODULES[a.key], enabled: !!a.enabled })));
});
r.get('/account/apps/:key/users', requireAdmin, async (c) => {
  const key = c.req.param('key');
  if (!MODULES[key]) throw notFound();
  return c.json((await all('SELECT user_id FROM app_access WHERE app_key = ?', key)).map((x) => x.user_id));
});
r.put('/account/apps/:key', requireAdmin, async (c) => {
  const key = c.req.param('key');
  if (!MODULES[key]) throw notFound('Ứng dụng không tồn tại');
  const b = await jsonBody(c);
  if (b.enabled !== undefined) {
    await run('INSERT INTO apps(key, enabled) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled', key, b.enabled ? 1 : 0);
    await audit(c.get('user').id, 'app', `${b.enabled ? 'Bật' : 'Tắt'} ứng dụng ${MODULES[key]}`);
  }
  if (b.users !== undefined) {
    const ids = idList(b.users);
    await batch([
      ['DELETE FROM app_access WHERE app_key = ?', [key]],
      ...ids.map((uid) => ['INSERT OR IGNORE INTO app_access(app_key, user_id) VALUES (?,?)', [key, uid]]),
    ]);
    await audit(c.get('user').id, 'app', `Cập nhật quyền sử dụng ${MODULES[key]} (${ids.length} tài khoản)`);
  }
  return c.json({ ok: true });
});

// ================================================================ preferences & notes (Home)
r.get('/me/prefs', async (c) => {
  const rows = await all('SELECT key, value FROM user_prefs WHERE user_id = ?', c.get('user').id);
  return c.json(Object.fromEntries(rows.map((x) => [x.key, x.value])));
});
r.put('/me/prefs', async (c) => {
  const b = await jsonBody(c);
  const entries = Object.entries(b).filter(([k]) => /^[a-z_.]{1,40}$/.test(k)).slice(0, 20);
  await batch(entries.map(([k, v]) => ['INSERT INTO user_prefs(user_id, key, value) VALUES (?,?,?) ON CONFLICT DO UPDATE SET value = excluded.value',
    [c.get('user').id, k, v === null ? null : String(v).slice(0, 2000)]]));
  return c.json({ ok: true });
});

r.get('/notes', async (c) => c.json(await all('SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC, id DESC', c.get('user').id)));
r.post('/notes', async (c) => {
  const b = await jsonBody(c);
  const content = String(b.content || '').trim();
  if (!content) throw badRequest('Nội dung ghi chú trống');
  const { lastId } = await run('INSERT INTO notes(user_id, content, color) VALUES (?,?,?)', c.get('user').id, content.slice(0, 5000), b.color || null);
  return c.json(await get('SELECT * FROM notes WHERE id = ?', lastId), 201);
});
r.put('/notes/:id', async (c) => {
  const b = await jsonBody(c);
  const id = toInt(c.req.param('id'));
  await run("UPDATE notes SET content = COALESCE(?, content), color = COALESCE(?, color), updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    b.content?.trim()?.slice(0, 5000) || null, b.color || null, id, c.get('user').id);
  return c.json(await get('SELECT * FROM notes WHERE id = ? AND user_id = ?', id, c.get('user').id));
});
r.delete('/notes/:id', async (c) => {
  await run('DELETE FROM notes WHERE id = ? AND user_id = ?', toInt(c.req.param('id')), c.get('user').id);
  return c.json({ ok: true });
});

/** Data for the Home launcher: company announcements + a few personal counters. */
r.get('/home/summary', async (c) => {
  const user = c.get('user');
  const apps = await userApps(user);
  const out = { apps, announcements: [], counters: {} };
  if (apps.includes('office')) {
    const vis = user.role === 'admin' ? ['1=1', []] : [`(d.is_public = 1 OR EXISTS (SELECT 1 FROM document_recipients dr WHERE dr.document_id = d.id
      AND (dr.user_id = ? OR dr.department_id = ?)))`, [user.id, user.department_id ?? -1]];
    out.announcements = await all(`SELECT d.id, d.title, d.code, d.issued_at, u.name AS issuer_name FROM documents d
      LEFT JOIN users u ON u.id = d.issuer_id WHERE d.status = 'issued' AND d.deleted_at IS NULL AND ${vis[0]}
      ORDER BY d.issued_at DESC LIMIT 6`, ...vis[1]);
    out.counters.documents_to_approve = (await get(`SELECT COUNT(*) AS c FROM document_approvers da JOIN documents d ON d.id = da.document_id
      WHERE da.user_id = ? AND da.status = 'pending' AND d.status = 'pending' AND d.deleted_at IS NULL
      AND da.step = (SELECT MIN(step) FROM document_approvers x WHERE x.document_id = d.id AND x.status = 'pending')`, user.id)).c;
  }
  if (apps.includes('wework')) {
    out.counters.tasks_active = (await get("SELECT COUNT(*) AS c FROM tasks WHERE assignee_id = ? AND status IN ('todo','doing')", user.id)).c;
    out.counters.tasks_overdue = (await get("SELECT COUNT(*) AS c FROM tasks WHERE assignee_id = ? AND status IN ('todo','doing') AND date(due_date) < date('now')", user.id)).c;
  }
  if (apps.includes('request')) {
    out.counters.requests_to_approve = (await get(`SELECT COUNT(*) AS c FROM request_approvers ra JOIN requests q ON q.id = ra.request_id
      WHERE ra.user_id = ? AND ra.status = 'pending' AND q.status = 'pending'
      AND (q.flow = 'any' OR ra.step = (SELECT MIN(step) FROM request_approvers x WHERE x.request_id = q.id AND x.status = 'pending'))`, user.id)).c;
  }
  out.birthdays = await all(`SELECT id, name, color, birthday FROM users WHERE active = 1 AND birthday IS NOT NULL
    AND substr(birthday, 6, 5) = strftime('%m-%d', 'now')`);
  return c.json(out);
});

export default r;
