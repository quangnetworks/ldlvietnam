import { Hono } from 'hono';
import { all, get, run, batch, getSetting, setSetting } from '../db.js';
import { requireAdmin, assertCanManage, hashPassword, verifyPassword, loadUser, PUBLIC_USER_FIELDS, deptIn, userDeptIds, inDeptSql } from '../auth.js';
import { randomBase32, otpauthUrl, verifyTotp, securitySettings, validIpRule, clientIp, ipMatches } from '../security.js';
import { badRequest, notFound, forbidden, toInt, idList, jsonBody, paginate, formBody, storeFiles, removeFile, sendFile } from '../util.js';
import { MODULES, userApps, grantApps, audit } from '../platform.js';
import { departmentChannel } from './chat.js';

const r = new Hono();

// ================================================================ profile
const guestGuard = (c) => {
  if (c.get('user').role === 'guest') throw forbidden('Tài khoản khách không xem được danh bạ công ty');
};

r.get('/account/profile/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  if (c.get('user').role === 'guest' && id !== c.get('user').id) guestGuard(c);
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
  guestGuard(c);
  const q = c.req.query();
  const where = [];
  const params = [];
  if (q.tab === 'admins') where.push("u.role = 'admin' AND u.active = 1");
  else if (q.tab === 'guests') where.push("u.role = 'guest' AND u.active = 1");
  else if (q.tab === 'disabled') where.push('u.active = 0');
  else where.push('u.active = 1');
  if (q.q) {
    const like = `%${q.q.trim()}%`;
    where.push("(u.name LIKE ? OR u.username LIKE ? OR IFNULL(u.email,'') LIKE ? OR IFNULL(u.phone,'') LIKE ?)");
    params.push(like, like, like, like);
  }
  const dep = toInt(q.department_id);
  if (dep) { where.push(inDeptSql('u', '?')); params.push(dep, dep); }
  const grp = toInt(q.group_id);
  if (grp) { where.push('EXISTS (SELECT 1 FROM user_group_members gm WHERE gm.user_id = u.id AND gm.group_id = ?)'); params.push(grp); }
  const items = await all(
    `SELECT ${PUBLIC_USER_FIELDS}, d.name AS department_name, m.name AS manager_name, m.color AS manager_color,
       m.username AS manager_username, m.title AS manager_title,
       (SELECT group_concat(x.app_key) FROM app_access x WHERE x.user_id = u.id) AS app_keys
     FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users m ON m.id = u.manager_id
     WHERE ${where.join(' AND ')} ORDER BY ${q.tab === 'admins' ? 'u.is_owner DESC, ' : ''}u.name COLLATE NOCASE`,
    ...params
  );
  for (const u of items) {
    u.apps = u.role === 'admin' ? Object.keys(MODULES) : (u.app_keys ? u.app_keys.split(',') : []);
    delete u.app_keys;
  }
  const counts = await get(`SELECT SUM(active = 1) AS all_count, SUM(active = 1 AND role = 'admin') AS admins, SUM(active = 1 AND is_owner = 1) AS owners, SUM(active = 0) AS disabled,
    SUM(active = 1 AND role = 'guest') AS guests FROM users`);
  return c.json({ items, counts: { all: counts.all_count || 0, admins: counts.admins || 0, owners: counts.owners || 0, disabled: counts.disabled || 0, guests: counts.guests || 0 } });
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
    const existing = await get('SELECT id, is_owner FROM users WHERE lower(username) = lower(?)', username);
    if (existing?.is_owner && !c.get('user').is_owner) { result.errors.push(`Dòng ${i + 1}: @${username} là Chủ doanh nghiệp — không được cập nhật`); continue; }
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
  await assertCanManage(c.get('user'), ids);
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
    const dep = deptIn('dr.department_id', user);
    const vis = user.role === 'admin' ? ['1=1', []] : [`(${user.role === 'guest' ? '0' : 'd.is_public'} = 1 OR EXISTS (SELECT 1 FROM document_recipients dr WHERE dr.document_id = d.id
      AND (dr.user_id = ? OR ${dep.sql})))`, [user.id, ...dep.params]];
    out.announcements = await all(`SELECT d.id, d.title, d.code, d.issued_at, u.name AS issuer_name FROM documents d
      LEFT JOIN users u ON u.id = d.issuer_id WHERE d.status = 'issued' AND d.deleted_at IS NULL AND ${vis[0]}
      AND NOT (d.superseded_by IS NOT NULL AND IFNULL(d.superseded_at, '') <= date('now'))
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

/**
 * Việc cần làm trên Home: gom từ Wework, Request, Office, Checkin, Timeoff và xếp vào
 * quá hạn / hôm nay / sắp tới (7 ngày) / cần xử lý. Ngày tính theo giờ Việt Nam.
 */
r.get('/home/agenda', async (c) => {
  const user = c.get('user');
  const apps = await userApps(user);
  const VN = 7 * 3600e3;
  const nowVn = new Date(Date.now() + VN);
  const today = nowVn.toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + VN + 7 * 864e5).toISOString().slice(0, 10);
  const vnDay = (utc) => (utc ? new Date(new Date(`${utc.replace(' ', 'T')}Z`).getTime() + VN).toISOString().slice(0, 10) : null);
  const bucketOf = (due) => (!due ? 'todo' : due < today ? 'overdue' : due === today ? 'today' : due <= in7 ? 'upcoming' : 'todo');
  const items = [];

  if (apps.includes('wework')) {
    const tasks = await all(`SELECT t.id, t.title, t.status, t.priority, date(t.due_date) AS due, p.name AS project_name FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.assignee_id = ? AND t.status IN ('todo', 'doing') ORDER BY t.due_date IS NULL, t.due_date LIMIT 40`, user.id);
    for (const t of tasks) {
      items.push({ key: `task-${t.id}`, type: 'task', title: t.title, sub: t.project_name || 'Công việc cá nhân', link: `/wework/task/${t.id}`,
        due: t.due, bucket: bucketOf(t.due), priority: t.priority, status: t.status });
    }
    const review = await all(`SELECT t.id, t.title, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.creator_id = ? AND t.assignee_id <> t.creator_id AND t.status = 'review' ORDER BY t.updated_at DESC LIMIT 10`, user.id);
    for (const t of review) {
      items.push({ key: `review-${t.id}`, type: 'review', title: t.title, sub: `${t.assignee_name || ''} đã hoàn thành — chờ bạn đánh giá`,
        link: `/wework/task/${t.id}`, due: null, bucket: 'today' });
    }
  }
  if (apps.includes('request')) {
    const reqs = await all(`SELECT q.id, q.title, q.deadline_at, u.name AS creator_name, g.name AS group_name FROM request_approvers ra
      JOIN requests q ON q.id = ra.request_id LEFT JOIN users u ON u.id = q.creator_id LEFT JOIN request_groups g ON g.id = q.group_id
      WHERE ra.user_id = ? AND ra.status = 'pending' AND q.status = 'pending'
      AND (q.flow = 'any' OR ra.step = (SELECT MIN(step) FROM request_approvers x WHERE x.request_id = q.id AND x.status = 'pending'))
      ORDER BY q.deadline_at IS NULL, q.deadline_at LIMIT 20`, user.id);
    for (const q of reqs) {
      const due = vnDay(q.deadline_at);
      items.push({ key: `req-${q.id}`, type: 'request', title: q.title, sub: `${q.creator_name} · ${q.group_name || 'Đề xuất'} — chờ bạn duyệt`,
        link: `/request/${q.id}`, due, bucket: due ? bucketOf(due) : 'today' });
    }
    const returned = await all(`SELECT q.id, q.title, g.name AS group_name FROM requests q LEFT JOIN request_groups g ON g.id = q.group_id
      WHERE q.creator_id = ? AND q.status = 'returned' ORDER BY q.updated_at DESC LIMIT 10`, user.id);
    for (const q of returned) {
      items.push({ key: `ret-${q.id}`, type: 'returned', title: q.title, sub: `${q.group_name || 'Đề xuất'} — bị trả lại, cần chỉnh sửa và gửi lại`,
        link: `/request/${q.id}`, due: null, bucket: 'today' });
    }
  }
  if (apps.includes('office')) {
    const docs = await all(`SELECT d.id, d.title, u.name AS creator_name FROM document_approvers da JOIN documents d ON d.id = da.document_id
      LEFT JOIN users u ON u.id = d.creator_id
      WHERE da.user_id = ? AND da.status = 'pending' AND d.status = 'pending' AND d.deleted_at IS NULL
      AND da.step = (SELECT MIN(step) FROM document_approvers x WHERE x.document_id = d.id AND x.status = 'pending') LIMIT 20`, user.id);
    for (const d of docs) {
      items.push({ key: `doc-${d.id}`, type: 'document', title: d.title, sub: `${d.creator_name || ''} — văn bản chờ bạn duyệt`,
        link: `/office/doc/${d.id}`, due: null, bucket: 'today' });
    }
  }
  if (apps.includes('checkin') && user.role !== 'guest') {
    let st = { start: '08:30', end: '17:30', work_saturday: true };
    try { st = { ...st, ...JSON.parse((await getSetting('checkin_settings')) || '{}') }; } catch { /* mặc định */ }
    const dow = nowVn.getUTCDay();
    const minutes = nowVn.getUTCHours() * 60 + nowVn.getUTCMinutes();
    const hm = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
    if (dow !== 0 && (dow !== 6 || st.work_saturday)) {
      const rec = await get('SELECT check_in_at, check_out_at FROM checkins WHERE user_id = ? AND date = ?', user.id, today);
      if (!rec?.check_in_at && minutes >= hm(st.start) - 60 && minutes < hm(st.end)) {
        items.push({ key: 'checkin-in', type: 'checkin', title: 'Bạn chưa chấm công vào hôm nay', sub: `Ca làm việc ${st.start} – ${st.end}`, link: '/checkin', due: today, bucket: 'today' });
      } else if (rec?.check_in_at && !rec.check_out_at && minutes >= hm(st.end)) {
        items.push({ key: 'checkin-out', type: 'checkin', title: 'Đừng quên chấm công ra', sub: `Hết ca lúc ${st.end}`, link: '/checkin', due: today, bucket: 'today' });
      }
    }
  }
  if (apps.includes('timeoff')) {
    let gid = null;
    try { gid = JSON.parse((await getSetting('timeoff_settings')) || '{}').group_id || null; } catch { /* mặc định */ }
    if (!gid) gid = (await get("SELECT id FROM request_groups WHERE name = 'Đề xuất nghỉ phép'"))?.id;
    if (gid) {
      const leaves = await all(`SELECT q.id, json_extract(q.data, '$.from') AS f, json_extract(q.data, '$.to') AS t, json_extract(q.data, '$.kind') AS kind
        FROM requests q WHERE q.group_id = ? AND q.creator_id = ? AND q.status = 'approved'
        AND json_extract(q.data, '$.from') BETWEEN ? AND ?`, gid, user.id, today, new Date(Date.now() + VN + 14 * 864e5).toISOString().slice(0, 10));
      for (const l of leaves) {
        items.push({ key: `leave-${l.id}`, type: 'leave', title: `Lịch nghỉ: ${l.kind || 'Nghỉ phép'}`, sub: l.t && l.t !== l.f ? `${l.f} → ${l.t}` : l.f,
          link: `/request/${l.id}`, due: l.f, bucket: l.f === today ? 'today' : 'upcoming' });
      }
    }
  }
  const order = { overdue: 0, today: 1, upcoming: 2, todo: 3 };
  items.sort((a, b) => order[a.bucket] - order[b.bucket] || String(a.due || '9999').localeCompare(String(b.due || '9999')));
  const counts = { overdue: 0, today: 0, upcoming: 0, todo: 0 };
  for (const i of items) counts[i.bucket]++;

  // Quan trọng cần lưu ý: công việc khẩn cấp / quan trọng chưa xong mà tôi thực hiện, đã giao hoặc đang theo dõi
  const important = [];
  if (apps.includes('wework')) {
    const rows = await all(`SELECT t.id, t.title, t.status, t.priority, date(t.due_date) AS due, t.assignee_id, t.creator_id,
        p.name AS project_name, a.name AS assignee_name, a.color AS assignee_color
      FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users a ON a.id = t.assignee_id
      WHERE t.status IN ('todo','doing','review') AND t.priority IN ('critical','urgent','important')
        AND (t.assignee_id = ? OR t.creator_id = ? OR EXISTS (SELECT 1 FROM task_followers f WHERE f.task_id = t.id AND f.user_id = ?))
      ORDER BY CASE t.priority WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END, t.due_date IS NULL, t.due_date LIMIT 30`, user.id, user.id, user.id);
    for (const t of rows) {
      important.push({
        key: `imp-${t.id}`, id: t.id, title: t.title, priority: t.priority, status: t.status, due: t.due, bucket: bucketOf(t.due),
        project_name: t.project_name, assignee_name: t.assignee_name, assignee_color: t.assignee_color, assignee_id: t.assignee_id,
        role: t.assignee_id === user.id ? 'assignee' : t.creator_id === user.id ? 'creator' : 'follower', link: `/wework/task/${t.id}`,
      });
    }
    // quá hạn trước, rồi khẩn cấp, rồi theo thời hạn
    const rank = { overdue: 0, today: 1, upcoming: 2, todo: 3 };
    const pr = { critical: 0, urgent: 1, important: 2 };
    important.sort((a, b) => rank[a.bucket] - rank[b.bucket] || pr[a.priority] - pr[b.priority]
      || String(a.due || '9999').localeCompare(String(b.due || '9999')));
  }
  return c.json({ today, counts, items, important });
});

/** Kênh chat nhóm trên Home: kênh toàn công ty + kênh phòng ban của người dùng. */
r.get('/home/chat', async (c) => {
  const user = c.get('user');
  if (user.role === 'guest' || !(await userApps(user)).includes('message')) return c.json({ channels: [] });
  const company = await get("SELECT id, name, description, kind FROM chat_channels WHERE kind = 'public' AND name = 'chung' ORDER BY id LIMIT 1");
  // một tài khoản có thể thuộc nhiều phòng ban → mỗi phòng ban một kênh
  const deps = [];
  for (const d of userDeptIds(user)) deps.push(await departmentChannel(d));
  const channels = [company && { ...company, label: 'Toàn công ty' },
    ...deps.filter(Boolean).map((dep) => ({ id: dep.id, name: dep.name, description: dep.description, kind: dep.kind, label: 'Phòng ban' }))].filter(Boolean);
  for (const ch of channels) {
    ch.unread = (await get(`SELECT COUNT(*) AS n FROM chat_messages x WHERE x.channel_id = ? AND x.deleted_at IS NULL AND IFNULL(x.user_id, 0) <> ?
      AND x.id > IFNULL((SELECT last_read_id FROM chat_members WHERE channel_id = ? AND user_id = ?), 0)`, ch.id, user.id, ch.id, user.id)).n;
  }
  return c.json({ channels });
});

// ================================================================ security (2FA, IP)
r.post('/account/2fa/setup', async (c) => {
  const user = c.get('user');
  if (user.totp_enabled) throw badRequest('Bảo mật hai lớp đang bật');
  const secret = randomBase32();
  await run('UPDATE users SET totp_secret = ? WHERE id = ?', secret, user.id);
  return c.json({ secret, url: otpauthUrl(secret, user.email || user.username) });
});
r.post('/account/2fa/enable', async (c) => {
  const user = c.get('user');
  const row = await get('SELECT totp_secret FROM users WHERE id = ?', user.id);
  if (!row.totp_secret) throw badRequest('Chưa tạo mã bí mật');
  if (!(await verifyTotp(row.totp_secret, (await jsonBody(c)).code))) throw badRequest('Mã xác thực không đúng. Kiểm tra lại giờ trên điện thoại.');
  await run('UPDATE users SET totp_enabled = 1 WHERE id = ?', user.id);
  await audit(user.id, 'security.2fa', 'Bật bảo mật hai lớp');
  return c.json({ ok: true });
});
r.post('/account/2fa/disable', async (c) => {
  const user = c.get('user');
  const row = await get('SELECT password_hash FROM users WHERE id = ?', user.id);
  if (!(await verifyPassword((await jsonBody(c)).password || '', row.password_hash))) throw badRequest('Mật khẩu không đúng');
  await run('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', user.id);
  await audit(user.id, 'security.2fa', 'Tắt bảo mật hai lớp');
  return c.json({ ok: true });
});
r.post('/account/2fa/reset/:id', requireAdmin, async (c) => {
  const u = await get('SELECT id, username FROM users WHERE id = ?', toInt(c.req.param('id')));
  if (!u) throw notFound();
  await assertCanManage(c.get('user'), u.id);
  await run('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', u.id);
  await audit(c.get('user').id, 'security.2fa', `Đặt lại bảo mật hai lớp cho @${u.username}`);
  return c.json({ ok: true });
});

r.get('/account/security', requireAdmin, async (c) => c.json({ ...(await securitySettings()), current_ip: clientIp(c) }));
r.put('/account/security', requireAdmin, async (c) => {
  const b = await jsonBody(c);
  const rules = (Array.isArray(b.ip_rules) ? b.ip_rules : String(b.ip_rules || '').split(/[\n,]/)).map((x) => x.trim()).filter(Boolean);
  const bad = rules.filter((x) => !validIpRule(x));
  if (bad.length) throw badRequest(`Dải IP không hợp lệ: ${bad.join(', ')}`);
  if (b.ip_enabled && !rules.length) throw badRequest('Cần ít nhất một địa chỉ IP khi bật giới hạn');
  const next = { ip_enabled: !!b.ip_enabled, ip_rules: rules.slice(0, 100) };
  await setSetting('security_settings', JSON.stringify(next));
  await audit(c.get('user').id, 'security.ip', next.ip_enabled ? `Bật giới hạn IP (${rules.length} dải)` : 'Tắt giới hạn IP');
  const ip = clientIp(c);
  return c.json({ ...next, current_ip: ip, current_ip_allowed: !next.ip_enabled || rules.some((x) => ipMatches(ip, x)) });
});

// ---------------------------------------------------------------- avatar
// avatar_version > 0: có ảnh (URL ?v=<version> để làm mới cache); <= 0: chưa có / đã xoá (giữ số lớn nhất để URL mới không trùng cache cũ)
const AVATAR_MAX = 2 * 1024 * 1024;
const AVATAR_TYPES = { 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff], 'image/webp': [0x52, 0x49, 0x46, 0x46], 'image/gif': [0x47, 0x49, 0x46] };

/** Chính chủ hoặc quản trị viên mới được đổi ảnh đại diện. */
async function avatarTarget(c) {
  const user = c.get('user');
  const id = toInt(c.req.param('id'));
  if (id !== user.id && user.role !== 'admin') throw forbidden('Chỉ quản trị viên được đổi ảnh đại diện của người khác');
  if (id !== user.id) await assertCanManage(user, id);
  const target = await get('SELECT id, username, avatar FROM users WHERE id = ?', id);
  if (!target) throw notFound('Tài khoản không tồn tại');
  return target;
}

r.get('/account/users/:id/avatar', async (c) => {
  const u = await get('SELECT avatar FROM users WHERE id = ?', toInt(c.req.param('id')));
  if (!u?.avatar) throw notFound('Chưa có ảnh đại diện');
  const ext = u.avatar.split('.').pop().toLowerCase();
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[ext] || 'image/jpeg';
  const res = await sendFile(c, { filename: u.avatar, original_name: `avatar.${ext}`, mime }, true);
  // URL có ?v=<phiên bản> nên được phép lưu đệm lâu
  res.headers.set('Cache-Control', 'private, max-age=31536000, immutable');
  return res;
});

r.post('/account/users/:id/avatar', async (c) => {
  const target = await avatarTarget(c);
  const { files } = await formBody(c);
  const f = files[0];
  if (!f) throw badRequest('Chưa chọn ảnh');
  if (f.size > AVATAR_MAX) throw badRequest('Ảnh quá lớn (tối đa 2MB)');
  const magic = AVATAR_TYPES[f.type];
  const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
  if (!magic || !magic.every((b, i) => head[i] === b)) throw badRequest('Chỉ chấp nhận ảnh PNG, JPG, WEBP hoặc GIF');
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[f.type];
  const [stored] = await storeFiles([new File([f], `avatar.${ext}`, { type: f.type })]);
  await run('UPDATE users SET avatar = ?, avatar_version = ABS(avatar_version) + 1 WHERE id = ?', stored.filename, target.id);
  if (target.avatar) await removeFile(target.avatar);
  if (target.id !== c.get('user').id) await audit(c.get('user').id, 'user.avatar', `Đổi ảnh đại diện của @${target.username}`);
  return c.json(await get('SELECT id, avatar_version FROM users WHERE id = ?', target.id));
});

r.delete('/account/users/:id/avatar', async (c) => {
  const target = await avatarTarget(c);
  await run('UPDATE users SET avatar = NULL, avatar_version = -ABS(avatar_version) WHERE id = ?', target.id);
  if (target.avatar) await removeFile(target.avatar);
  if (target.id !== c.get('user').id) await audit(c.get('user').id, 'user.avatar', `Xoá ảnh đại diện của @${target.username}`);
  return c.json({ ok: true });
});

export default r;
