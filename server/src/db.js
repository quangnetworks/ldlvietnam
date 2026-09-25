/**
 * Database access shared by every runtime. A driver (Node's built-in SQLite or Cloudflare D1)
 * is installed once at startup with setDriver(); route code only uses the async helpers below.
 *
 * Driver interface:
 *   all(sql, params) -> rows[]      get(sql, params) -> row | undefined
 *   run(sql, params) -> { lastId, changes }
 *   batch([[sql, params], ...])     executes statements in order (atomically where supported)
 */
let driver = null;

export function setDriver(d) {
  driver = d;
}

export const all = (sql, ...p) => driver.all(sql, p);
export const get = (sql, ...p) => driver.get(sql, p);
export const run = (sql, ...p) => driver.run(sql, p);
export const batch = (stmts) => (stmts.length ? driver.batch(stmts) : Promise.resolve());

export async function getSetting(key, fallback = null) {
  const r = await get('SELECT value FROM settings WHERE key = ?', key);
  return r ? r.value : fallback;
}

export function setSetting(key, value) {
  return run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

export function logActivity(entityType, entityId, userId, action, detail = null) {
  return run(
    'INSERT INTO activity_logs(entity_type, entity_id, user_id, action, detail) VALUES (?,?,?,?,?)',
    entityType, entityId, userId ?? null, action, detail
  );
}

/**
 * Người được nhắc tên trong nội dung: "@tên_đăng_nhập" (không phân biệt hoa thường, bỏ dấu chấm / gạch cuối câu).
 * Trả về id các tài khoản đang hoạt động, bỏ qua người viết.
 */
export async function findMentions(content, excludeId = null) {
  const names = [...new Set([...String(content || '').matchAll(/@([\w.-]+)/g)].map((m) => m[1].replace(/[.-]+$/, '').toLowerCase()))].filter(Boolean);
  if (!names.length) return [];
  const rows = await all(`SELECT id FROM users WHERE active = 1 AND lower(username) IN (${names.map(() => '?').join(',')})`, ...names);
  return rows.map((r) => r.id).filter((id) => id !== excludeId);
}

/** Người dùng đã mở nội dung (công việc, đề xuất, văn bản, cuộc trò chuyện) → thông báo trỏ tới đó coi như đã đọc. */
export function markSeen(userId, link) {
  return run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND link = ? AND is_read = 0', userId, link);
}

let notifyHook = null;
/** Đăng ký xử lý thêm sau mỗi thông báo (vd. gửi thông báo đẩy tới điện thoại). */
export const onNotify = (fn) => { notifyHook = fn; };

export async function notify(userIds, { actorId = null, app, type, title, link = null }) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean))].filter((id) => id !== actorId);
  await batch(ids.map((uid) => [
    'INSERT INTO notifications(user_id, actor_id, app, type, title, link) VALUES (?,?,?,?,?,?)',
    [uid, actorId, app, type, title, link],
  ]));
  if (ids.length && notifyHook) notifyHook(ids, { actorId, app, type, title, link });
}
