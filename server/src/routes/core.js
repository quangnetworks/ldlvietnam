import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { all, get, run, getSetting, setSetting } from '../db.js';
import {
  COOKIE, TOKEN_TTL, signToken, loadUser, requireAdmin, PUBLIC_USER_FIELDS, hashPassword, verifyPassword,
} from '../auth.js';
import { badRequest, notFound, toInt, jsonBody } from '../util.js';

const r = new Hono();

// ---------- Auth ----------
r.post('/auth/login', async (c) => {
  const { username, password } = await jsonBody(c);
  if (!username || !password) throw badRequest('Vui lòng nhập tên đăng nhập và mật khẩu');
  const u = await get('SELECT * FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)', username, username);
  if (!u || !u.active || !(await verifyPassword(password, u.password_hash))) {
    return c.json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' }, 401);
  }
  const token = await signToken(c, u);
  setCookie(c, COOKIE, token, {
    httpOnly: true, sameSite: 'Lax', path: '/', maxAge: TOKEN_TTL, secure: new URL(c.req.url).protocol === 'https:',
  });
  return c.json({ user: await loadUser(u.id), token });
});

r.post('/auth/logout', (c) => {
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

// Every route below requires a signed-in user (enforced in app.js)

r.get('/auth/me', async (c) => c.json({ user: c.get('user'), company: await getSetting('company_name', 'Công ty') }));

r.put('/auth/me', async (c) => {
  const { name, email, phone, title, color } = await jsonBody(c);
  if (name !== undefined && !String(name).trim()) throw badRequest('Tên không được để trống');
  await run(
    `UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), phone = COALESCE(?, phone),
     title = COALESCE(?, title), color = COALESCE(?, color) WHERE id = ?`,
    name ?? null, email ?? null, phone ?? null, title ?? null, color ?? null, c.get('user').id
  );
  return c.json({ user: await loadUser(c.get('user').id) });
});

r.put('/auth/password', async (c) => {
  const { current, next } = await jsonBody(c);
  const u = await get('SELECT password_hash FROM users WHERE id = ?', c.get('user').id);
  if (!(await verifyPassword(current || '', u.password_hash))) throw badRequest('Mật khẩu hiện tại không đúng');
  if (!next || String(next).length < 6) throw badRequest('Mật khẩu mới phải có ít nhất 6 ký tự');
  await run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(next), c.get('user').id);
  return c.json({ ok: true });
});

// ---------- Settings ----------
r.get('/settings', async (c) => c.json({ company_name: await getSetting('company_name', 'Công ty') }));
r.put('/settings', requireAdmin, async (c) => {
  const b = await jsonBody(c);
  if (b.company_name) await setSetting('company_name', String(b.company_name).trim());
  return c.json({ company_name: await getSetting('company_name') });
});

// ---------- Users ----------
r.get('/users', async (c) => {
  const qs = c.req.query();
  const q = `%${(qs.q || '').trim()}%`;
  const includeInactive = qs.all === '1' && c.get('user').role === 'admin';
  return c.json(await all(
    `SELECT ${PUBLIC_USER_FIELDS}, d.name AS department_name, m.name AS manager_name
     FROM users u LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN users m ON m.id = u.manager_id
     WHERE (u.name LIKE ? OR u.username LIKE ? OR IFNULL(u.email,'') LIKE ?)
     ${includeInactive ? '' : 'AND u.active = 1'}
     ORDER BY u.name COLLATE NOCASE`,
    q, q, q
  ));
});

r.get('/users/:id', async (c) => {
  const u = await loadUser(toInt(c.req.param('id')));
  if (!u) throw notFound();
  return c.json(u);
});

function validateUserBody(b, creating) {
  if (creating) {
    if (!b.username?.trim()) throw badRequest('Tên đăng nhập là bắt buộc');
    if (!b.password || String(b.password).length < 6) throw badRequest('Mật khẩu phải có ít nhất 6 ký tự');
    if (!b.name?.trim()) throw badRequest('Họ tên là bắt buộc');
  }
  if (b.role && !['admin', 'member'].includes(b.role)) throw badRequest('Vai trò không hợp lệ');
}

r.post('/users', requireAdmin, async (c) => {
  const b = await jsonBody(c);
  validateUserBody(b, true);
  if (await get('SELECT 1 FROM users WHERE lower(username) = lower(?)', b.username.trim())) {
    throw badRequest('Tên đăng nhập đã tồn tại');
  }
  const { lastId } = await run(
    `INSERT INTO users(username, password_hash, name, email, phone, title, department_id, manager_id, role, color)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    b.username.trim(), await hashPassword(b.password), b.name.trim(), b.email || null, b.phone || null,
    b.title || null, toInt(b.department_id), toInt(b.manager_id), b.role || 'member', b.color || null
  );
  return c.json(await loadUser(lastId), 201);
});

r.put('/users/:id', requireAdmin, async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await jsonBody(c);
  validateUserBody(b, false);
  if (!(await get('SELECT 1 FROM users WHERE id = ?', id))) throw notFound();
  if (toInt(b.manager_id) === id) throw badRequest('Không thể tự làm quản lý của chính mình');
  if (b.active === undefined || Object.keys(b).length > 1) {
    await run(
      `UPDATE users SET name = COALESCE(?, name), email = ?, phone = ?, title = ?, department_id = ?, manager_id = ?,
       role = COALESCE(?, role), color = COALESCE(?, color) WHERE id = ?`,
      b.name?.trim() || null, b.email || null, b.phone || null, b.title || null, toInt(b.department_id),
      toInt(b.manager_id), b.role || null, b.color || null, id
    );
  }
  if (b.active !== undefined) await run('UPDATE users SET active = ? WHERE id = ?', b.active ? 1 : 0, id);
  if (b.password) {
    if (String(b.password).length < 6) throw badRequest('Mật khẩu phải có ít nhất 6 ký tự');
    await run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(b.password), id);
  }
  return c.json(await loadUser(id));
});

r.delete('/users/:id', requireAdmin, async (c) => {
  const id = toInt(c.req.param('id'));
  if (id === c.get('user').id) throw badRequest('Không thể vô hiệu hóa chính mình');
  await run('UPDATE users SET active = 0 WHERE id = ?', id);
  return c.json({ ok: true });
});

// ---------- Departments ----------
r.get('/departments', async (c) => c.json(await all(
  `SELECT d.*, (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.active = 1) AS member_count
   FROM departments d ORDER BY d.name COLLATE NOCASE`
)));
r.post('/departments', requireAdmin, async (c) => {
  const { name, code, parent_id } = await jsonBody(c);
  if (!name?.trim()) throw badRequest('Tên phòng ban là bắt buộc');
  const { lastId } = await run('INSERT INTO departments(name, code, parent_id) VALUES (?,?,?)', name.trim(), code || null, toInt(parent_id));
  return c.json(await get('SELECT * FROM departments WHERE id = ?', lastId), 201);
});
r.put('/departments/:id', requireAdmin, async (c) => {
  const id = toInt(c.req.param('id'));
  const { name, code, parent_id } = await jsonBody(c);
  if (toInt(parent_id) === id) throw badRequest('Phòng ban cha không hợp lệ');
  await run('UPDATE departments SET name = COALESCE(?, name), code = ?, parent_id = ? WHERE id = ?',
    name?.trim() || null, code || null, toInt(parent_id), id);
  return c.json(await get('SELECT * FROM departments WHERE id = ?', id));
});
r.delete('/departments/:id', requireAdmin, async (c) => {
  await run('DELETE FROM departments WHERE id = ?', toInt(c.req.param('id')));
  return c.json({ ok: true });
});

// ---------- Notifications ----------
r.get('/notifications', async (c) => {
  const q = c.req.query();
  const uid = c.get('user').id;
  const where = ['n.user_id = ?'];
  const params = [uid];
  if (q.app) { where.push('n.app = ?'); params.push(q.app); }
  if (q.unread === '1') where.push('n.is_read = 0');
  const items = await all(
    `SELECT n.*, a.name AS actor_name, a.color AS actor_color FROM notifications n
     LEFT JOIN users a ON a.id = n.actor_id WHERE ${where.join(' AND ')}
     ORDER BY n.id DESC LIMIT ?`,
    ...params, Math.min(200, toInt(q.limit, 30))
  );
  const unread = (await get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0', uid)).c;
  return c.json({ items, unread });
});
r.put('/notifications/read-all', async (c) => {
  await run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', c.get('user').id);
  return c.json({ ok: true });
});
r.put('/notifications/:id/read', async (c) => {
  await run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', toInt(c.req.param('id')), c.get('user').id);
  return c.json({ ok: true });
});

export default r;
