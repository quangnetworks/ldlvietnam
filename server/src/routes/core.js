import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { all, get, run, getSetting, setSetting } from '../db.js';
import { COOKIE, signToken, loadUser, requireAuth, requireAdmin, PUBLIC_USER_FIELDS } from '../auth.js';
import { badRequest, notFound, toInt } from '../util.js';

const r = Router();

// ---------- Auth ----------
r.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) throw badRequest('Vui lòng nhập tên đăng nhập và mật khẩu');
  const u = get('SELECT * FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)', username, username);
  if (!u || !u.active || !bcrypt.compareSync(password, u.password_hash)) {
    return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
  }
  const token = signToken(u);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
  res.json({ user: loadUser(u.id), token });
});

r.post('/auth/logout', (_req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

r.use(requireAuth);

r.get('/auth/me', (req, res) => {
  res.json({ user: req.user, company: getSetting('company_name', 'Công ty') });
});

r.put('/auth/me', (req, res) => {
  const { name, email, phone, title, color } = req.body || {};
  if (name !== undefined && !String(name).trim()) throw badRequest('Tên không được để trống');
  run(
    `UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), phone = COALESCE(?, phone),
     title = COALESCE(?, title), color = COALESCE(?, color) WHERE id = ?`,
    name ?? null, email ?? null, phone ?? null, title ?? null, color ?? null, req.user.id
  );
  res.json({ user: loadUser(req.user.id) });
});

r.put('/auth/password', (req, res) => {
  const { current, next } = req.body || {};
  const u = get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
  if (!bcrypt.compareSync(current || '', u.password_hash)) throw badRequest('Mật khẩu hiện tại không đúng');
  if (!next || String(next).length < 6) throw badRequest('Mật khẩu mới phải có ít nhất 6 ký tự');
  run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(next, 10), req.user.id);
  res.json({ ok: true });
});

// ---------- Settings ----------
r.get('/settings', (_req, res) => {
  res.json({ company_name: getSetting('company_name', 'Công ty') });
});
r.put('/settings', requireAdmin, (req, res) => {
  if (req.body?.company_name) setSetting('company_name', String(req.body.company_name).trim());
  res.json({ company_name: getSetting('company_name') });
});

// ---------- Users ----------
r.get('/users', (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  const includeInactive = req.query.all === '1' && req.user.role === 'admin';
  const rows = all(
    `SELECT ${PUBLIC_USER_FIELDS}, d.name AS department_name, m.name AS manager_name
     FROM users u LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN users m ON m.id = u.manager_id
     WHERE (u.name LIKE ? OR u.username LIKE ? OR IFNULL(u.email,'') LIKE ?)
     ${includeInactive ? '' : 'AND u.active = 1'}
     ORDER BY u.name COLLATE NOCASE`,
    q, q, q
  );
  res.json(rows);
});

r.get('/users/:id', (req, res) => {
  const u = loadUser(toInt(req.params.id));
  if (!u) throw notFound();
  res.json(u);
});

function validateUserBody(b, creating) {
  if (creating) {
    if (!b.username?.trim()) throw badRequest('Tên đăng nhập là bắt buộc');
    if (!b.password || String(b.password).length < 6) throw badRequest('Mật khẩu phải có ít nhất 6 ký tự');
  }
  if (creating && !b.name?.trim()) throw badRequest('Họ tên là bắt buộc');
  if (b.role && !['admin', 'member'].includes(b.role)) throw badRequest('Vai trò không hợp lệ');
}

r.post('/users', requireAdmin, (req, res) => {
  const b = req.body || {};
  validateUserBody(b, true);
  if (get('SELECT 1 FROM users WHERE lower(username) = lower(?)', b.username.trim())) {
    throw badRequest('Tên đăng nhập đã tồn tại');
  }
  const info = run(
    `INSERT INTO users(username, password_hash, name, email, phone, title, department_id, manager_id, role, color)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    b.username.trim(), bcrypt.hashSync(b.password, 10), b.name.trim(), b.email || null, b.phone || null,
    b.title || null, toInt(b.department_id), toInt(b.manager_id), b.role || 'member', b.color || null
  );
  res.status(201).json(loadUser(Number(info.lastInsertRowid)));
});

r.put('/users/:id', requireAdmin, (req, res) => {
  const id = toInt(req.params.id);
  const b = req.body || {};
  validateUserBody(b, false);
  if (!get('SELECT 1 FROM users WHERE id = ?', id)) throw notFound();
  if (toInt(b.manager_id) === id) throw badRequest('Không thể tự làm quản lý của chính mình');
  run(
    `UPDATE users SET name = COALESCE(?, name), email = ?, phone = ?, title = ?, department_id = ?, manager_id = ?,
     role = COALESCE(?, role), color = COALESCE(?, color), active = COALESCE(?, active) WHERE id = ?`,
    b.name?.trim() || null, b.email || null, b.phone || null, b.title || null, toInt(b.department_id),
    toInt(b.manager_id), b.role || null, b.color || null,
    b.active === undefined ? null : b.active ? 1 : 0, id
  );
  if (b.password) {
    if (String(b.password).length < 6) throw badRequest('Mật khẩu phải có ít nhất 6 ký tự');
    run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(b.password, 10), id);
  }
  res.json(loadUser(id));
});

r.delete('/users/:id', requireAdmin, (req, res) => {
  const id = toInt(req.params.id);
  if (id === req.user.id) throw badRequest('Không thể vô hiệu hóa chính mình');
  run('UPDATE users SET active = 0 WHERE id = ?', id);
  res.json({ ok: true });
});

// ---------- Departments ----------
r.get('/departments', (_req, res) => {
  res.json(
    all(`SELECT d.*, (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.active = 1) AS member_count
         FROM departments d ORDER BY d.name COLLATE NOCASE`)
  );
});
r.post('/departments', requireAdmin, (req, res) => {
  const { name, code, parent_id } = req.body || {};
  if (!name?.trim()) throw badRequest('Tên phòng ban là bắt buộc');
  const info = run('INSERT INTO departments(name, code, parent_id) VALUES (?,?,?)', name.trim(), code || null, toInt(parent_id));
  res.status(201).json(get('SELECT * FROM departments WHERE id = ?', Number(info.lastInsertRowid)));
});
r.put('/departments/:id', requireAdmin, (req, res) => {
  const id = toInt(req.params.id);
  const { name, code, parent_id } = req.body || {};
  if (toInt(parent_id) === id) throw badRequest('Phòng ban cha không hợp lệ');
  run('UPDATE departments SET name = COALESCE(?, name), code = ?, parent_id = ? WHERE id = ?',
    name?.trim() || null, code || null, toInt(parent_id), id);
  res.json(get('SELECT * FROM departments WHERE id = ?', id));
});
r.delete('/departments/:id', requireAdmin, (req, res) => {
  run('DELETE FROM departments WHERE id = ?', toInt(req.params.id));
  res.json({ ok: true });
});

// ---------- Notifications ----------
r.get('/notifications', (req, res) => {
  const where = ['n.user_id = ?'];
  const params = [req.user.id];
  if (req.query.app) { where.push('n.app = ?'); params.push(req.query.app); }
  if (req.query.unread === '1') where.push('n.is_read = 0');
  const rows = all(
    `SELECT n.*, a.name AS actor_name, a.color AS actor_color FROM notifications n
     LEFT JOIN users a ON a.id = n.actor_id WHERE ${where.join(' AND ')}
     ORDER BY n.id DESC LIMIT ?`,
    ...params, Math.min(200, toInt(req.query.limit, 30))
  );
  const unread = get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0', req.user.id).c;
  res.json({ items: rows, unread });
});
r.put('/notifications/read-all', (req, res) => {
  run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', req.user.id);
  res.json({ ok: true });
});
r.put('/notifications/:id/read', (req, res) => {
  run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', toInt(req.params.id), req.user.id);
  res.json({ ok: true });
});

export default r;
