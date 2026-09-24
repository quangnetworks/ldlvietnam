import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { all, get, run, batch, getSetting, setSetting } from '../db.js';
import {
  COOKIE, TOKEN_TTL, signToken, loadUser, requireAdmin, assertCanManage, PUBLIC_USER_FIELDS, hashPassword, verifyPassword, inDeptSql,
} from '../auth.js';
import { badRequest, forbidden, notFound, toInt, idList, jsonBody } from '../util.js';
import { userApps, grantApps, audit, recordLogin, MODULES } from '../platform.js';
import { verifyTotp, ipAllowed } from '../security.js';
import { isExpired } from '../auth.js';
import { servePublicFile } from '../files.js';

const r = new Hono();

// Liên kết tạm tới tệp cho trình xem trực tuyến (không cần đăng nhập — token là thông tin xác thực)
r.get('/public/files/:token/:name?', servePublicFile);

// ---------- Auth ----------
r.post('/auth/login', async (c) => {
  const { username, password, otp } = await jsonBody(c);
  if (!username || !password) throw badRequest('Vui lòng nhập tên đăng nhập và mật khẩu');
  const u = await get('SELECT * FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)', username, username);
  if (!u || !u.active || !(await verifyPassword(password, u.password_hash))) {
    await recordLogin(c, u && u.active ? u : null, String(username).slice(0, 100), false);
    return c.json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' }, 401);
  }
  if (isExpired(u)) return c.json({ error: 'Tài khoản khách đã hết hạn truy cập. Liên hệ quản trị viên.' }, 401);
  if (!(await ipAllowed(c, u))) {
    await recordLogin(c, u, u.username, false);
    return c.json({ error: 'Địa chỉ IP của bạn không nằm trong danh sách được phép đăng nhập' }, 403);
  }
  if (u.totp_enabled) {
    if (!otp) return c.json({ error: 'Nhập mã xác thực 6 số từ ứng dụng Authenticator', need_otp: true }, 401);
    if (!(await verifyTotp(u.totp_secret, otp))) {
      await recordLogin(c, u, u.username, false);
      return c.json({ error: 'Mã xác thực không đúng hoặc đã hết hạn', need_otp: true }, 401);
    }
  }
  await recordLogin(c, u, u.username, true);
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

r.get('/auth/me', async (c) => c.json({
  user: c.get('user'),
  company: await getSetting('company_name', 'Công ty'),
  apps: await userApps(c.get('user')),
}));

/** Normalise the free-form profile sections (học vấn, kinh nghiệm, giải thưởng). */
export function cleanProfile(p) {
  if (p === undefined) return undefined;
  const obj = typeof p === 'string' ? JSON.parse(p || '{}') : p || {};
  const list = (v) => (Array.isArray(v) ? v : []).slice(0, 50).map((x) => ({
    title: String(x?.title || '').slice(0, 200), place: String(x?.place || '').slice(0, 200),
    from: String(x?.from || '').slice(0, 20), to: String(x?.to || '').slice(0, 20), note: String(x?.note || '').slice(0, 1000),
  })).filter((x) => x.title);
  return JSON.stringify({ education: list(obj.education), experience: list(obj.experience), awards: list(obj.awards) });
}

r.put('/auth/me', async (c) => {
  const { name, email, phone, title, color, birthday, address, bio, profile } = await jsonBody(c);
  if (name !== undefined && !String(name).trim()) throw badRequest('Tên không được để trống');
  await run(
    `UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), phone = COALESCE(?, phone),
     title = COALESCE(?, title), color = COALESCE(?, color), birthday = COALESCE(?, birthday),
     address = COALESCE(?, address), bio = COALESCE(?, bio), profile = COALESCE(?, profile) WHERE id = ?`,
    name ?? null, email ?? null, phone ?? null, title ?? null, color ?? null, birthday ?? null,
    address ?? null, bio ?? null, cleanProfile(profile) ?? null, c.get('user').id
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
  if (b.company_name) {
    await setSetting('company_name', String(b.company_name).trim());
    await audit(c.get('user').id, 'company', `Đổi tên công ty: ${String(b.company_name).trim()}`);
  }
  return c.json({ company_name: await getSetting('company_name') });
});

// ---------- Users ----------
r.get('/users', async (c) => {
  const qs = c.req.query();
  // Tài khoản khách chỉ thấy thông tin tối thiểu (tên) để chọn người nhận / người duyệt
  if (c.get('user').role === 'guest') {
    return c.json(await all("SELECT u.id, u.name, u.username, u.color, u.title, u.role, u.avatar_version FROM users u WHERE u.active = 1 ORDER BY u.name COLLATE NOCASE"));
  }
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

/** Phòng ban kiêm nhiệm (ngoài phòng ban chính). */
async function saveExtraDepartments(userId, primaryId, ids) {
  const list = idList(ids).filter((d) => d !== primaryId);
  await batch([
    ['DELETE FROM user_departments WHERE user_id = ?', [userId]],
    ...list.map((d) => ['INSERT OR IGNORE INTO user_departments(user_id, department_id) SELECT ?, id FROM departments WHERE id = ?', [userId, d]]),
  ]);
}

function validateUserBody(b, creating) {
  if (creating) {
    if (!b.username?.trim()) throw badRequest('Tên đăng nhập là bắt buộc');
    if (!b.password || String(b.password).length < 6) throw badRequest('Mật khẩu phải có ít nhất 6 ký tự');
    if (!b.name?.trim()) throw badRequest('Họ tên là bắt buộc');
  }
  if (b.role && !['owner', 'admin', 'member', 'guest'].includes(b.role)) throw badRequest('Vai trò không hợp lệ');
  if (b.expires_at && !/^\d{4}-\d{2}-\d{2}$/.test(b.expires_at)) throw badRequest('Ngày hết hạn không hợp lệ');
}

/**
 * Vai trò "owner" (Chủ doanh nghiệp) = role 'admin' + is_owner = 1.
 * Chỉ Chủ doanh nghiệp được trao / thu hồi vai trò này — trừ khi hệ thống chưa có Chủ doanh nghiệp nào.
 * Trả về is_owner mới (0/1) hoặc undefined nếu không đổi vai trò.
 */
async function ownerFlag(actor, b, targetId) {
  if (b.role === undefined || b.role === null || b.role === '') return undefined;
  const want = b.role === 'owner' ? 1 : 0;
  if (b.role === 'owner') b.role = 'admin';
  const current = targetId ? (await get('SELECT is_owner FROM users WHERE id = ?', targetId))?.is_owner || 0 : 0;
  if (want === current) return want;
  if (!actor.is_owner && (await get('SELECT 1 FROM users WHERE is_owner = 1 AND active = 1'))) {
    throw forbidden('Chỉ Chủ doanh nghiệp mới được trao hoặc thu hồi vai trò Chủ doanh nghiệp');
  }
  if (!want && !(await get('SELECT 1 FROM users WHERE is_owner = 1 AND active = 1 AND id <> ?', targetId))) {
    throw badRequest('Hệ thống cần ít nhất một Chủ doanh nghiệp');
  }
  return want;
}

r.post('/users', requireAdmin, async (c) => {
  const b = await jsonBody(c);
  validateUserBody(b, true);
  const owner = await ownerFlag(c.get('user'), b, null);
  if (await get('SELECT 1 FROM users WHERE lower(username) = lower(?)', b.username.trim())) {
    throw badRequest('Tên đăng nhập đã tồn tại');
  }
  const { lastId } = await run(
    `INSERT INTO users(username, password_hash, name, email, phone, title, department_id, manager_id, role, color)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    b.username.trim(), await hashPassword(b.password), b.name.trim(), b.email || null, b.phone || null,
    b.title || null, toInt(b.department_id), toInt(b.manager_id), b.role || 'member', b.color || null
  );
  await run('UPDATE users SET birthday = ?, address = ?, expires_at = ? WHERE id = ?', b.birthday || null, b.address || null,
    b.role === 'guest' ? b.expires_at || null : null, lastId);
  // Tài khoản khách: chỉ nhận ứng dụng được chọn rõ ràng
  if (owner) await run('UPDATE users SET is_owner = 1 WHERE id = ?', lastId);
  await grantApps(lastId, Array.isArray(b.apps) ? b.apps : b.role === 'guest' ? [] : null);
  if (b.extra_department_ids !== undefined) await saveExtraDepartments(lastId, toInt(b.department_id), b.extra_department_ids);
  await audit(c.get('user').id, 'user.create', `Tạo tài khoản @${b.username.trim()}`);
  return c.json(await loadUser(lastId), 201);
});

r.put('/users/:id', requireAdmin, async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await jsonBody(c);
  validateUserBody(b, false);
  if (!(await get('SELECT 1 FROM users WHERE id = ?', id))) throw notFound();
  await assertCanManage(c.get('user'), id);
  const owner = await ownerFlag(c.get('user'), b, id);
  if (toInt(b.manager_id) === id) throw badRequest('Không thể tự làm quản lý của chính mình');
  if (b.active === undefined || Object.keys(b).length > 1) {
    await run(
      `UPDATE users SET name = COALESCE(?, name), email = ?, phone = ?, title = ?, department_id = ?, manager_id = ?,
       role = COALESCE(?, role), color = COALESCE(?, color) WHERE id = ?`,
      b.name?.trim() || null, b.email || null, b.phone || null, b.title || null, toInt(b.department_id),
      toInt(b.manager_id), b.role || null, b.color || null, id
    );
  }
  if (owner !== undefined) await run('UPDATE users SET is_owner = ? WHERE id = ?', owner, id);
  if (b.birthday !== undefined || b.address !== undefined) {
    await run('UPDATE users SET birthday = COALESCE(?, birthday), address = COALESCE(?, address) WHERE id = ?',
      b.birthday ?? null, b.address ?? null, id);
  }
  if (Array.isArray(b.apps)) await grantApps(id, b.apps.filter((k) => MODULES[k]));
  if (b.extra_department_ids !== undefined) {
    const primary = b.department_id !== undefined ? toInt(b.department_id) : (await get('SELECT department_id FROM users WHERE id = ?', id)).department_id;
    await saveExtraDepartments(id, primary, b.extra_department_ids);
  }
  if (b.expires_at !== undefined || b.role !== undefined) {
    await run("UPDATE users SET expires_at = CASE WHEN role = 'guest' THEN ? ELSE NULL END WHERE id = ?", b.expires_at || null, id);
  }
  if (b.active !== undefined) {
    if (id === c.get('user').id && !b.active) throw badRequest('Không thể vô hiệu hóa chính mình');
    await run('UPDATE users SET active = ? WHERE id = ?', b.active ? 1 : 0, id);
  }
  const target = await get('SELECT username FROM users WHERE id = ?', id);
  await audit(c.get('user').id, 'user.update', b.active === true ? `Kích hoạt lại @${target.username}` : `Cập nhật tài khoản @${target.username}`);
  if (b.password) {
    if (String(b.password).length < 6) throw badRequest('Mật khẩu phải có ít nhất 6 ký tự');
    await run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(b.password), id);
  }
  return c.json(await loadUser(id));
});

r.delete('/users/:id', requireAdmin, async (c) => {
  const id = toInt(c.req.param('id'));
  if (id === c.get('user').id) throw badRequest('Không thể vô hiệu hóa chính mình');
  await assertCanManage(c.get('user'), id);
  await run('UPDATE users SET active = 0 WHERE id = ?', id);
  const target = await get('SELECT username FROM users WHERE id = ?', id);
  await audit(c.get('user').id, 'user.disable', `Vô hiệu hoá @${target?.username}`);
  return c.json({ ok: true });
});

// ---------- Departments ----------
r.get('/departments', async (c) => c.json(await all(
  `SELECT d.*, h.name AS head_name, (SELECT COUNT(*) FROM users u WHERE ${inDeptSql('u', 'd.id')} AND u.active = 1) AS member_count
   FROM departments d LEFT JOIN users h ON h.id = d.head_id ORDER BY d.name COLLATE NOCASE`
)));
r.post('/departments', requireAdmin, async (c) => {
  const { name, code, parent_id, head_id } = await jsonBody(c);
  if (!name?.trim()) throw badRequest('Tên phòng ban là bắt buộc');
  const { lastId } = await run('INSERT INTO departments(name, code, parent_id, head_id) VALUES (?,?,?,?)', name.trim(), code || null, toInt(parent_id), toInt(head_id));
  return c.json(await get('SELECT * FROM departments WHERE id = ?', lastId), 201);
});
r.put('/departments/:id', requireAdmin, async (c) => {
  const id = toInt(c.req.param('id'));
  const { name, code, parent_id, head_id } = await jsonBody(c);
  if (toInt(parent_id) === id) throw badRequest('Phòng ban cha không hợp lệ');
  await run('UPDATE departments SET name = COALESCE(?, name), code = ?, parent_id = ?, head_id = ? WHERE id = ?',
    name?.trim() || null, code || null, toInt(parent_id), toInt(head_id), id);
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
