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

export function notify(userIds, { actorId = null, app, type, title, link = null }) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean))].filter((id) => id !== actorId);
  return batch(ids.map((uid) => [
    'INSERT INTO notifications(user_id, actor_id, app, type, title, link) VALUES (?,?,?,?,?,?)',
    [uid, actorId, app, type, title, link],
  ]));
}
