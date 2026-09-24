/** Base Message: channels (public / private), direct messages, unread counters, attachments, @mentions. */
import { Hono } from 'hono';
import { all, get, run, batch, notify } from '../db.js';
import { badRequest, notFound, forbidden, toInt, idList, jsonBody, formBody, storeFiles, sendFile } from '../util.js';

const r = new Hono();

async function channelAccess(user, id) {
  const ch = await get('SELECT * FROM chat_channels WHERE id = ?', id);
  if (!ch) throw notFound('Kênh không tồn tại');
  const member = await get('SELECT * FROM chat_members WHERE channel_id = ? AND user_id = ?', id, user.id);
  if (ch.kind === 'public' ? user.role === 'guest' && !member : !member) throw forbidden('Bạn không phải thành viên của kênh này');
  return { ch, member };
}

const visibleWhere = (user) => (user.role === 'guest'
  ? { sql: 'EXISTS (SELECT 1 FROM chat_members m2 WHERE m2.channel_id = c.id AND m2.user_id = ?)', params: [user.id] }
  : { sql: "(c.kind = 'public' OR EXISTS (SELECT 1 FROM chat_members m2 WHERE m2.channel_id = c.id AND m2.user_id = ?))", params: [user.id] });

r.get('/chat/channels', async (c) => {
  const user = c.get('user');
  const v = visibleWhere(user);
  const rows = await all(`SELECT c.*, IFNULL(m.last_read_id, 0) AS last_read_id,
      (SELECT COUNT(*) FROM chat_messages x WHERE x.channel_id = c.id AND x.id > IFNULL(m.last_read_id, 0) AND IFNULL(x.user_id, 0) <> ? AND x.deleted_at IS NULL) AS unread,
      (SELECT x.content FROM chat_messages x WHERE x.channel_id = c.id AND x.deleted_at IS NULL ORDER BY x.id DESC LIMIT 1) AS last_content,
      (SELECT u.id FROM chat_members dm JOIN users u ON u.id = dm.user_id WHERE c.kind = 'direct' AND dm.channel_id = c.id AND dm.user_id <> ? LIMIT 1) AS peer_id
    FROM chat_channels c LEFT JOIN chat_members m ON m.channel_id = c.id AND m.user_id = ?
    WHERE ${v.sql} ORDER BY IFNULL(c.last_message_at, c.created_at) DESC`, user.id, user.id, user.id, ...v.params);
  const peers = rows.filter((x) => x.peer_id).map((x) => x.peer_id);
  const users = peers.length ? await all(`SELECT id, name, color, username FROM users WHERE id IN (${peers.map(() => '?').join(',')})`, ...peers) : [];
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  return c.json(rows.map((x) => ({ ...x, peer: x.peer_id ? byId[x.peer_id] : null, display_name: x.kind === 'direct' ? byId[x.peer_id]?.name || 'Trò chuyện' : x.name })));
});

r.get('/chat/unread', async (c) => {
  const user = c.get('user');
  const v = visibleWhere(user);
  const row = await get(`SELECT COUNT(*) AS n FROM chat_messages x JOIN chat_channels c ON c.id = x.channel_id
    LEFT JOIN chat_members m ON m.channel_id = c.id AND m.user_id = ?
    WHERE ${v.sql} AND x.id > IFNULL(m.last_read_id, 0) AND IFNULL(x.user_id, 0) <> ? AND x.deleted_at IS NULL`, user.id, ...v.params, user.id);
  return c.json({ unread: row.n });
});

r.post('/chat/channels', async (c) => {
  const user = c.get('user');
  if (user.role === 'guest') throw forbidden('Tài khoản khách không tạo được kênh');
  const b = await jsonBody(c);
  const name = String(b.name || '').trim().replace(/^#/, '').slice(0, 80);
  if (!name) throw badRequest('Tên kênh là bắt buộc');
  const kind = b.kind === 'private' ? 'private' : 'public';
  const { lastId } = await run('INSERT INTO chat_channels(name, description, kind, created_by) VALUES (?,?,?,?)', name, b.description || null, kind, user.id);
  const members = [...new Set([user.id, ...idList(b.members)])];
  await batch(members.map((uid) => ['INSERT OR IGNORE INTO chat_members(channel_id, user_id) VALUES (?,?)', [lastId, uid]]));
  await notify(members, { actorId: user.id, app: 'message', type: 'channel', title: `${user.name} đã thêm bạn vào kênh #${name}`, link: `/message/${lastId}` });
  return c.json(await get('SELECT * FROM chat_channels WHERE id = ?', lastId), 201);
});

r.post('/chat/direct', async (c) => {
  const user = c.get('user');
  const other = toInt((await jsonBody(c)).user_id);
  if (!other || other === user.id || !(await get('SELECT 1 FROM users WHERE id = ? AND active = 1', other))) throw badRequest('Người nhận không hợp lệ');
  const existing = await get(`SELECT c.id FROM chat_channels c WHERE c.kind = 'direct'
    AND EXISTS (SELECT 1 FROM chat_members a WHERE a.channel_id = c.id AND a.user_id = ?)
    AND EXISTS (SELECT 1 FROM chat_members b WHERE b.channel_id = c.id AND b.user_id = ?)`, user.id, other);
  if (existing) return c.json({ id: existing.id });
  const { lastId } = await run("INSERT INTO chat_channels(kind, created_by) VALUES ('direct', ?)", user.id);
  await batch([user.id, other].map((uid) => ['INSERT INTO chat_members(channel_id, user_id) VALUES (?,?)', [lastId, uid]]));
  return c.json({ id: lastId }, 201);
});

r.get('/chat/channels/:id', async (c) => {
  const { ch } = await channelAccess(c.get('user'), toInt(c.req.param('id')));
  const members = await all(`SELECT u.id, u.name, u.color, u.username, u.title FROM chat_members m JOIN users u ON u.id = m.user_id
    WHERE m.channel_id = ? ORDER BY u.name`, ch.id);
  return c.json({ ...ch, members });
});

r.put('/chat/channels/:id', async (c) => {
  const user = c.get('user');
  const { ch } = await channelAccess(user, toInt(c.req.param('id')));
  if (ch.kind === 'direct') throw badRequest('Không sửa được cuộc trò chuyện 1-1');
  if (ch.created_by !== user.id && user.role !== 'admin') throw forbidden('Chỉ người tạo kênh hoặc quản trị viên được sửa');
  const b = await jsonBody(c);
  if (b.name !== undefined) {
    const name = String(b.name || '').trim().replace(/^#/, '').slice(0, 80);
    if (!name) throw badRequest('Tên kênh là bắt buộc');
    await run('UPDATE chat_channels SET name = ?, description = ? WHERE id = ?', name, b.description || null, ch.id);
  }
  if (b.members !== undefined && ch.kind === 'private') {
    const members = [...new Set([...idList(b.members), ch.created_by].filter(Boolean))];
    await batch([
      [`DELETE FROM chat_members WHERE channel_id = ? AND user_id NOT IN (${members.map(() => '?').join(',')})`, [ch.id, ...members]],
      ...members.map((uid) => ['INSERT OR IGNORE INTO chat_members(channel_id, user_id) VALUES (?,?)', [ch.id, uid]]),
    ]);
  }
  return c.json({ ok: true });
});

r.delete('/chat/channels/:id', async (c) => {
  const user = c.get('user');
  const { ch } = await channelAccess(user, toInt(c.req.param('id')));
  if (ch.kind === 'direct' || (ch.created_by !== user.id && user.role !== 'admin')) throw forbidden();
  await run('DELETE FROM chat_channels WHERE id = ?', ch.id);
  return c.json({ ok: true });
});

const MSG_SELECT = `SELECT x.id, x.channel_id, x.user_id, CASE WHEN x.deleted_at IS NULL THEN x.content END AS content,
    CASE WHEN x.deleted_at IS NULL THEN x.original_name END AS original_name, x.mime, x.size, x.created_at, x.edited_at, x.deleted_at,
    u.name AS user_name, u.color AS user_color, u.username
  FROM chat_messages x LEFT JOIN users u ON u.id = x.user_id`;

r.get('/chat/channels/:id/messages', async (c) => {
  const { ch } = await channelAccess(c.get('user'), toInt(c.req.param('id')));
  const q = c.req.query();
  const after = toInt(q.after_id);
  const before = toInt(q.before_id);
  const limit = Math.min(100, toInt(q.limit, 50));
  let rows;
  if (after) rows = await all(`${MSG_SELECT} WHERE x.channel_id = ? AND x.id > ? ORDER BY x.id LIMIT ?`, ch.id, after, limit);
  else {
    rows = (await all(`${MSG_SELECT} WHERE x.channel_id = ? ${before ? 'AND x.id < ?' : ''} ORDER BY x.id DESC LIMIT ?`,
      ch.id, ...(before ? [before] : []), limit)).reverse();
  }
  return c.json(rows);
});

r.post('/chat/channels/:id/messages', async (c) => {
  const user = c.get('user');
  const { ch } = await channelAccess(user, toInt(c.req.param('id')));
  const { fields, files } = await formBody(c);
  const content = String(fields.content || '').trim().slice(0, 5000);
  if (!content && !files.length) throw badRequest('Tin nhắn trống');
  const stored = files.length ? (await storeFiles(files.slice(0, 1)))[0] : null;
  const { lastId } = await run('INSERT INTO chat_messages(channel_id, user_id, content, filename, original_name, mime, size) VALUES (?,?,?,?,?,?,?)',
    ch.id, user.id, content || null, stored?.filename ?? null, stored?.original_name ?? null, stored?.mime ?? null, stored?.size ?? null);
  await run("UPDATE chat_channels SET last_message_at = datetime('now') WHERE id = ?", ch.id);
  await run('INSERT INTO chat_members(channel_id, user_id, last_read_id) VALUES (?,?,?) ON CONFLICT DO UPDATE SET last_read_id = excluded.last_read_id',
    ch.id, user.id, lastId);
  // Thông báo: nhắc tên (@username) hoặc tin nhắn 1-1
  const mentioned = [];
  for (const m of content.matchAll(/@([\w.]+)/g)) {
    const u = await get('SELECT id FROM users WHERE username = ?', m[1]);
    if (u) mentioned.push(u.id);
  }
  if (ch.kind === 'direct') {
    const peer = await get('SELECT user_id FROM chat_members WHERE channel_id = ? AND user_id <> ?', ch.id, user.id);
    if (peer) mentioned.push(peer.user_id);
  }
  if (mentioned.length) {
    await notify(mentioned, { actorId: user.id, app: 'message', type: 'mention',
      title: `${user.name}${ch.kind === 'direct' ? ' nhắn tin' : ` nhắc đến bạn trong #${ch.name}`}: ${(content || stored?.original_name || '').slice(0, 80)}`,
      link: `/message/${ch.id}` });
  }
  return c.json(await get(`${MSG_SELECT} WHERE x.id = ?`, lastId), 201);
});

r.post('/chat/channels/:id/read', async (c) => {
  const user = c.get('user');
  const { ch } = await channelAccess(user, toInt(c.req.param('id')));
  const last = toInt((await jsonBody(c)).last_id) || (await get('SELECT MAX(id) AS m FROM chat_messages WHERE channel_id = ?', ch.id)).m || 0;
  await run(`INSERT INTO chat_members(channel_id, user_id, last_read_id) VALUES (?,?,?)
    ON CONFLICT DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`, ch.id, user.id, last);
  return c.json({ ok: true });
});

async function ownMessage(c) {
  const m = await get('SELECT * FROM chat_messages WHERE id = ?', toInt(c.req.param('id')));
  if (!m || m.deleted_at) throw notFound('Tin nhắn không tồn tại');
  if (m.user_id !== c.get('user').id) throw forbidden('Chỉ sửa / xoá được tin nhắn của bạn');
  return m;
}
r.put('/chat/messages/:id', async (c) => {
  const m = await ownMessage(c);
  const content = String((await jsonBody(c)).content || '').trim().slice(0, 5000);
  if (!content) throw badRequest('Tin nhắn trống');
  await run("UPDATE chat_messages SET content = ?, edited_at = datetime('now') WHERE id = ?", content, m.id);
  return c.json(await get(`${MSG_SELECT} WHERE x.id = ?`, m.id));
});
r.delete('/chat/messages/:id', async (c) => {
  const m = await ownMessage(c);
  await run("UPDATE chat_messages SET deleted_at = datetime('now') WHERE id = ?", m.id);
  return c.json({ ok: true });
});
r.get('/chat/messages/:id/file', async (c) => {
  const m = await get('SELECT * FROM chat_messages WHERE id = ?', toInt(c.req.param('id')));
  if (!m || !m.filename || m.deleted_at) throw notFound('Tệp không tồn tại');
  await channelAccess(c.get('user'), m.channel_id);
  return sendFile(c, m, c.req.query('inline') === '1');
});

r.get('/chat/search', async (c) => {
  const user = c.get('user');
  const q = String(c.req.query('q') || '').trim();
  if (!q) return c.json([]);
  const v = visibleWhere(user);
  return c.json(await all(`${MSG_SELECT} JOIN chat_channels c ON c.id = x.channel_id WHERE ${v.sql} AND x.deleted_at IS NULL AND x.content LIKE ?
    ORDER BY x.id DESC LIMIT 30`, ...v.params, `%${q}%`));
});

export default r;
