import { sign, verify } from 'hono/jwt';
import { getCookie } from 'hono/cookie';
import { get, getSetting, setSetting } from './db.js';
import { ipAllowed } from './security.js';
import { forbidden } from './util.js';

export const COOKIE = 'ldl_token';
const ITERATIONS = 60000;
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

/** Hash format: pbkdf2$<iterations>$<salt b64>$<hash b64> */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(await derive(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, it, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'pbkdf2' || !hash) return false;
  const actual = new Uint8Array(await derive(password, unb64(salt), Number(it)));
  const expected = unb64(hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

let cachedSecret = null;
async function secret(env) {
  if (env?.JWT_SECRET) return env.JWT_SECRET;
  if (cachedSecret) return cachedSecret;
  let s = await getSetting('jwt_secret');
  if (!s) {
    s = b64(crypto.getRandomValues(new Uint8Array(32)));
    await setSetting('jwt_secret', s);
  }
  cachedSecret = s;
  return s;
}

export const TOKEN_TTL = 30 * 24 * 3600;

export async function signToken(c, user) {
  return sign({ uid: user.id, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL }, await secret(c.env), 'HS256');
}

/**
 * Short-lived signed link to one file (used by online viewers such as Microsoft Office Online, which fetch the file
 * without the user's session). Payload carries typ = 'file' so it can never be confused with a session token.
 */
export async function signFileToken(c, payload, ttl = 15 * 60) {
  return sign({ ...payload, typ: 'file', exp: Math.floor(Date.now() / 1000) + ttl }, await secret(c.env), 'HS256');
}
export async function verifyFileToken(c, token) {
  try {
    const p = await verify(token, await secret(c.env), 'HS256');
    return p?.typ === 'file' ? p : null;
  } catch {
    return null;
  }
}

export const PUBLIC_USER_FIELDS =
  'u.id, u.username, u.name, u.email, u.phone, u.title, u.department_id, u.manager_id, u.role, u.color, u.active, u.birthday, u.address, u.bio, u.profile, u.last_login_at, u.created_at, u.totp_enabled, u.expires_at, u.avatar_version, u.is_owner, '
  + '(SELECT GROUP_CONCAT(ud.department_id) FROM user_departments ud WHERE ud.user_id = u.id) AS extra_departments';

/** "3,5" (GROUP_CONCAT) → [3, 5] */
export const parseIds = (v) => String(v || '').split(',').map(Number).filter(Boolean);

/** Mọi phòng ban của tài khoản: phòng ban chính + phòng ban kiêm nhiệm. */
export const userDeptIds = (u) => [...new Set([u?.department_id, ...(u?.extra_department_ids || parseIds(u?.extra_departments))].filter(Boolean))];

/** Điều kiện SQL "cột thuộc một trong các phòng ban của tài khoản". */
export function deptIn(col, user) {
  const ids = userDeptIds(user);
  return ids.length ? { sql: `${col} IN (${ids.map(() => '?').join(',')})`, params: ids } : { sql: '0', params: [] };
}

/** Điều kiện SQL "tài khoản (cột uCol) thuộc phòng ban depExpr" — tính cả phòng ban kiêm nhiệm. */
export const inDeptSql = (uCol, depExpr) => `(${uCol}.department_id = ${depExpr}
  OR EXISTS (SELECT 1 FROM user_departments udx WHERE udx.user_id = ${uCol}.id AND udx.department_id = ${depExpr}))`;

export async function loadUser(id) {
  const u = await get(
    `SELECT ${PUBLIC_USER_FIELDS}, d.name AS department_name
     FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?`,
    id
  );
  if (u) {
    u.extra_department_ids = parseIds(u.extra_departments).filter((x) => x !== u.department_id);
    u.department_ids = userDeptIds(u);
  }
  return u;
}

export const isExpired = (u) => !!u.expires_at && u.expires_at < new Date().toISOString().slice(0, 10);

export async function requireAuth(c, next) {
  const header = c.req.header('authorization');
  const token = getCookie(c, COOKIE) || (header?.startsWith('Bearer ') ? header.slice(7) : null);
  if (!token) return c.json({ error: 'Chưa đăng nhập' }, 401);
  let uid;
  try {
    ({ uid } = await verify(token, await secret(c.env), 'HS256'));
  } catch {
    return c.json({ error: 'Phiên đăng nhập đã hết hạn' }, 401);
  }
  const user = await loadUser(uid);
  if (!user || !user.active) return c.json({ error: 'Tài khoản không hợp lệ' }, 401);
  if (isExpired(user)) return c.json({ error: 'Tài khoản khách đã hết hạn truy cập' }, 401);
  if (!(await ipAllowed(c, user))) return c.json({ error: 'Địa chỉ IP của bạn không nằm trong danh sách được phép truy cập' }, 403);
  c.set('user', user);
  await next();
}

/**
 * Chủ doanh nghiệp (is_owner) là cấp quản trị cao nhất: quản trị viên thường không được sửa, khoá,
 * đổi mật khẩu hay đặt lại bảo mật của tài khoản chủ doanh nghiệp.
 */
export async function assertCanManage(actor, ids) {
  if (actor.is_owner) return;
  const list = [].concat(ids).filter(Boolean);
  if (!list.length) return;
  const hit = await get(`SELECT name FROM users WHERE is_owner = 1 AND id IN (${list.map(() => '?').join(',')})`, ...list);
  if (hit) {
    throw forbidden(`Chỉ Chủ doanh nghiệp mới được thay đổi tài khoản của ${hit.name}`);
  }
}

export async function requireAdmin(c, next) {
  if (c.get('user')?.role !== 'admin') return c.json({ error: 'Chỉ quản trị viên mới được thực hiện' }, 403);
  await next();
}
