/** Platform-level helpers shared by every module: app catalog, per-user app access, audit log. */
import { all, get, run, batch, logActivity } from './db.js';
import { forbidden } from './util.js';

/** Modules implemented in this code base that can be granted per user. */
export const MODULES = {
  office: 'Base Office',
  wework: 'Base Wework',
  request: 'Base Request',
};

/** API path prefixes owned by each module (used to enforce app access). */
const PREFIXES = [
  ['/api/documents', 'office'], ['/api/office', 'office'],
  ['/api/tasks', 'wework'], ['/api/projects', 'wework'], ['/api/wework', 'wework'], ['/api/goals', 'wework'],
  ['/api/filters', 'wework'], ['/api/search', 'wework'],
  ['/api/requests', 'request'], ['/api/request-groups', 'request'], ['/api/request', 'request'],
];

export function moduleForPath(path) {
  for (const [prefix, key] of PREFIXES) if (path === prefix || path.startsWith(`${prefix}/`)) return key;
  return null;
}

/** Keys of the modules this user may open. Admins get every enabled module. */
export async function userApps(user) {
  if (user.role === 'admin') return (await all('SELECT key FROM apps WHERE enabled = 1')).map((a) => a.key);
  return (await all(`SELECT a.key FROM apps a JOIN app_access x ON x.app_key = a.key AND x.user_id = ?
    WHERE a.enabled = 1`, user.id)).map((a) => a.key);
}

/** Middleware: block API calls into a module the signed-in user has no access to. */
export async function requireModule(c, next) {
  const key = moduleForPath(c.req.path);
  if (key) {
    const user = c.get('user');
    const app = await get('SELECT enabled FROM apps WHERE key = ?', key);
    if (app && !app.enabled) throw forbidden(`Ứng dụng ${MODULES[key]} đang tạm tắt`);
    if (user.role !== 'admin' && !(await get('SELECT 1 FROM app_access WHERE app_key = ? AND user_id = ?', key, user.id))) {
      throw forbidden(`Bạn chưa được cấp quyền sử dụng ${MODULES[key]}`);
    }
  }
  await next();
}

/** Grant the given modules (default: every enabled module) to a user. */
export async function grantApps(userId, keys = null) {
  const list = keys ?? (await all('SELECT key FROM apps WHERE enabled = 1')).map((a) => a.key);
  await batch([
    ['DELETE FROM app_access WHERE user_id = ?', [userId]],
    ...list.filter((k) => MODULES[k]).map((k) => ['INSERT OR IGNORE INTO app_access(app_key, user_id) VALUES (?,?)', [k, userId]]),
  ]);
}

/** System-level audit trail (Account → Lịch sử hệ thống). */
export const audit = (actorId, action, detail) => logActivity('system', 0, actorId, action, detail);

export async function recordLogin(c, user, username, success) {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || null;
  await run('INSERT INTO login_logs(user_id, username, success, ip, user_agent) VALUES (?,?,?,?,?)',
    user?.id ?? null, username, success ? 1 : 0, ip, (c.req.header('user-agent') || '').slice(0, 300));
  if (success) await run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", user.id);
}
