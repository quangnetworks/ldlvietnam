import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { get, getSetting, setSetting } from './db.js';

function secret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  let s = getSetting('jwt_secret');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    setSetting('jwt_secret', s);
  }
  return s;
}

export const COOKIE = 'ldl_token';

export function signToken(user) {
  return jwt.sign({ uid: user.id }, secret(), { expiresIn: '30d' });
}

export const PUBLIC_USER_FIELDS =
  'u.id, u.username, u.name, u.email, u.phone, u.title, u.department_id, u.manager_id, u.role, u.color, u.active';

export function loadUser(id) {
  return get(
    `SELECT ${PUBLIC_USER_FIELDS}, d.name AS department_name
     FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?`,
    id
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const token = req.cookies?.[COOKIE] || (header?.startsWith('Bearer ') ? header.slice(7) : null);
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  try {
    const { uid } = jwt.verify(token, secret());
    const user = loadUser(uid);
    if (!user || !user.active) return res.status(401).json({ error: 'Tài khoản không hợp lệ' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Chỉ quản trị viên mới được thực hiện' });
  next();
}
