import { sign, verify } from 'hono/jwt';
import { getCookie } from 'hono/cookie';
import { get, getSetting, setSetting } from './db.js';
import { ipAllowed } from './security.js';

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

export const PUBLIC_USER_FIELDS =
  'u.id, u.username, u.name, u.email, u.phone, u.title, u.department_id, u.manager_id, u.role, u.color, u.active, u.birthday, u.address, u.bio, u.profile, u.last_login_at, u.created_at, u.totp_enabled, u.expires_at';

export function loadUser(id) {
  return get(
    `SELECT ${PUBLIC_USER_FIELDS}, d.name AS department_name
     FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?`,
    id
  );
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

export async function requireAdmin(c, next) {
  if (c.get('user')?.role !== 'admin') return c.json({ error: 'Chỉ quản trị viên mới được thực hiện' }, 403);
  await next();
}
