/** LDL Message: channels (public / private), direct messages, unread counters, attachments, @mentions. */
import { Hono } from 'hono';
import { all, get, run, batch, notify } from '../db.js';
import { audit } from '../platform.js';
import { badRequest, notFound, forbidden, toInt, idList, jsonBody, formBody, storeFiles, sendFile, removeFile } from '../util.js';
import { publicFileLink } from '../files.js';
import { userDeptIds, deptIn, inDeptSql } from '../auth.js';

import { pushToUsers } from '../push.js';

const r = new Hono();

async function channelAccess(user, id) {
  const ch = await get('SELECT * FROM chat_channels WHERE id = ?', id);
  if (!ch) throw notFound('Kênh không tồn tại');
  const member = await get('SELECT * FROM chat_members WHERE channel_id = ? AND user_id = ?', id, user.id);
  if (ch.kind === 'department') {
    // Kênh phòng ban: mọi nhân sự đang thuộc phòng ban (quản trị viên xem được mọi phòng ban)
    if (user.role === 'guest' || (!userDeptIds(user).includes(ch.department_id) && user.role !== 'admin')) throw forbidden('Kênh này dành cho thành viên phòng ban');
  } else if (ch.kind === 'public' ? user.role === 'guest' && !member : !member) throw forbidden('Bạn không phải thành viên của kênh này');
  // kênh riêng tư: thành viên được thêm sau chỉ thấy tin nhắn từ mốc được cấp (history_from_id)
  const floor = ch.kind === 'private' ? member?.history_from_id || 0 : 0;
  return { ch, member, floor };
}

/** Mốc lịch sử cho thành viên mới: all = toàn bộ, days7 = 7 ngày gần đây, none = chỉ tin nhắn từ lúc được thêm. */
async function historyFloorFor(channelId, mode) {
  if (mode === 'none') return (await get('SELECT IFNULL(MAX(id), 0) AS m FROM chat_messages WHERE channel_id = ?', channelId)).m;
  if (mode === 'days7') {
    return (await get("SELECT IFNULL(MAX(id), 0) AS m FROM chat_messages WHERE channel_id = ? AND created_at < datetime('now', '-7 day')", channelId)).m;
  }
  return 0;
}
const HISTORY_LABEL = { all: 'xem toàn bộ tin nhắn trước đó', days7: 'xem tin nhắn 7 ngày gần đây', none: 'không xem tin nhắn cũ' };

/** Kênh chat của một phòng ban (tạo nếu chưa có — vd. phòng ban mới thêm). */
export async function departmentChannel(departmentId) {
  if (!departmentId) return null;
  const found = await get("SELECT * FROM chat_channels WHERE kind = 'department' AND department_id = ?", departmentId);
  if (found) return found;
  const dep = await get('SELECT name FROM departments WHERE id = ?', departmentId);
  if (!dep) return null;
  const { lastId } = await run("INSERT INTO chat_channels(name, description, kind, department_id) VALUES (?, ?, 'department', ?)",
    dep.name, `Kênh trao đổi nội bộ ${dep.name}`, departmentId);
  return get('SELECT * FROM chat_channels WHERE id = ?', lastId);
}

const visibleWhere = (user) => (user.role === 'guest'
  ? { sql: "c.kind <> 'department' AND EXISTS (SELECT 1 FROM chat_members m2 WHERE m2.channel_id = c.id AND m2.user_id = ?)", params: [user.id] }
  : { sql: `(c.kind = 'public' OR (c.kind = 'department' AND ${deptIn('c.department_id', user).sql})
      OR (c.kind <> 'department' AND EXISTS (SELECT 1 FROM chat_members m2 WHERE m2.channel_id = c.id AND m2.user_id = ?)))`,
  params: [...deptIn('c.department_id', user).params, user.id] });

r.get('/chat/channels', async (c) => {
  const user = c.get('user');
  if (user.role !== 'guest') for (const d of userDeptIds(user)) await departmentChannel(d);
  const v = visibleWhere(user);
  const rows = await all(`SELECT c.*, IFNULL(m.last_read_id, 0) AS last_read_id,
      (SELECT COUNT(*) FROM chat_messages x WHERE x.channel_id = c.id AND x.id > IFNULL(m.last_read_id, 0) AND IFNULL(x.user_id, 0) <> ? AND x.deleted_at IS NULL) AS unread,
      (SELECT x.content FROM chat_messages x WHERE x.channel_id = c.id AND x.deleted_at IS NULL AND (c.kind <> 'private' OR x.id > IFNULL(m.history_from_id, 0)) ORDER BY x.id DESC LIMIT 1) AS last_content,
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
  // khoá duy nhất theo cặp người dùng: bấm liên tục / hai người cùng mở vẫn chỉ ra một cuộc trò chuyện
  const key = `${Math.min(user.id, other)}-${Math.max(user.id, other)}`;
  await run("INSERT OR IGNORE INTO chat_channels(kind, created_by, direct_key) VALUES ('direct', ?, ?)", user.id, key);
  const ch = await get("SELECT id FROM chat_channels WHERE kind = 'direct' AND direct_key = ?", key);
  await batch([user.id, other].map((uid) => ['INSERT OR IGNORE INTO chat_members(channel_id, user_id) VALUES (?,?)', [ch.id, uid]]));
  return c.json({ id: ch.id });
});

r.get('/chat/channels/:id', async (c) => {
  const { ch } = await channelAccess(c.get('user'), toInt(c.req.param('id')));
  const members = ch.kind === 'department'
    ? await all(`SELECT u.id, u.name, u.color, u.username, u.title FROM users u WHERE ${inDeptSql('u', '?')} AND u.active = 1 AND u.role <> 'guest' ORDER BY u.name`, ch.department_id, ch.department_id)
    : await all(`SELECT u.id, u.name, u.color, u.username, u.title, m.history_from_id FROM chat_members m JOIN users u ON u.id = m.user_id
    WHERE m.channel_id = ? ORDER BY u.name`, ch.id);
  return c.json({ ...ch, members });
});

r.put('/chat/channels/:id', async (c) => {
  const user = c.get('user');
  const { ch } = await channelAccess(user, toInt(c.req.param('id')));
  if (ch.kind === 'direct' || ch.kind === 'department') throw badRequest('Không sửa được kênh này (kênh phòng ban cập nhật theo phòng ban)');
  if (ch.created_by !== user.id && user.role !== 'admin') throw forbidden('Chỉ người tạo kênh hoặc quản trị viên được sửa');
  const b = await jsonBody(c);
  if (b.name !== undefined) {
    const name = String(b.name || '').trim().replace(/^#/, '').slice(0, 80);
    if (!name) throw badRequest('Tên kênh là bắt buộc');
    await run('UPDATE chat_channels SET name = ?, description = ? WHERE id = ?', name, b.description || null, ch.id);
  }
  if (b.members !== undefined && ch.kind === 'private') {
    const members = [...new Set([...idList(b.members), ch.created_by].filter(Boolean))];
    const existing = new Set((await all('SELECT user_id FROM chat_members WHERE channel_id = ?', ch.id)).map((x) => x.user_id));
    const added = members.filter((uid) => !existing.has(uid));
    const mode = HISTORY_LABEL[b.history] ? b.history : 'all';
    const floor = added.length ? await historyFloorFor(ch.id, mode) : 0;
    await batch([
      [`DELETE FROM chat_members WHERE channel_id = ? AND user_id NOT IN (${members.map(() => '?').join(',')})`, [ch.id, ...members]],
      // người mới: không tính tin nhắn ẩn là chưa đọc
      ...added.map((uid) => ['INSERT OR IGNORE INTO chat_members(channel_id, user_id, history_from_id, last_read_id) VALUES (?,?,?,?)', [ch.id, uid, floor, floor]]),
    ]);
    if (added.length) {
      await notify(added, { actorId: user.id, app: 'message', type: 'channel',
        title: `${user.name} đã thêm bạn vào kênh #${ch.name} (${HISTORY_LABEL[mode]})`, link: `/message/${ch.id}` });
    }
  }
  return c.json({ ok: true });
});

/** Xoá nhóm / kênh (quản trị viên hoặc người tạo kênh) cùng toàn bộ tin nhắn và tệp. */
r.delete('/chat/channels/:id', async (c) => {
  const user = c.get('user');
  const ch = await get('SELECT * FROM chat_channels WHERE id = ?', toInt(c.req.param('id')));
  if (!ch) throw notFound('Kênh không tồn tại');
  if (ch.kind === 'direct') throw badRequest('Không xoá được cuộc trò chuyện trực tiếp');
  if (ch.kind === 'department') throw badRequest('Kênh phòng ban gắn với phòng ban — không xoá được');
  if (ch.kind === 'public' && ch.name === 'chung' && !ch.created_by) throw badRequest('Không xoá được kênh chung toàn công ty');
  if (user.role !== 'admin' && ch.created_by !== user.id) throw forbidden('Chỉ quản trị viên hoặc người tạo kênh được xoá kênh');
  const files = await all('SELECT filename FROM chat_messages WHERE channel_id = ? AND filename IS NOT NULL', ch.id);
  await run('DELETE FROM chat_channels WHERE id = ?', ch.id);
  for (const f of files) await removeFile(f.filename);
  await audit(user.id, 'chat.delete', `Xoá kênh #${ch.name} (${files.length} tệp)`);
  return c.json({ ok: true });
});

const MSG_SELECT = `SELECT x.id, x.channel_id, x.user_id, CASE WHEN x.deleted_at IS NULL THEN x.content END AS content,
    CASE WHEN x.deleted_at IS NULL THEN x.original_name END AS original_name, x.mime, x.size, x.created_at, x.edited_at, x.deleted_at,
    u.name AS user_name, u.color AS user_color, u.username
  FROM chat_messages x LEFT JOIN users u ON u.id = x.user_id`;

r.get('/chat/channels/:id/messages', async (c) => {
  const { ch, floor } = await channelAccess(c.get('user'), toInt(c.req.param('id')));
  const q = c.req.query();
  const after = Math.max(toInt(q.after_id, 0), floor);
  const before = toInt(q.before_id);
  const limit = Math.min(100, toInt(q.limit, 50));
  let rows;
  if (toInt(q.after_id)) rows = await all(`${MSG_SELECT} WHERE x.channel_id = ? AND x.id > ? ORDER BY x.id LIMIT ?`, ch.id, after, limit);
  else {
    rows = (await all(`${MSG_SELECT} WHERE x.channel_id = ? AND x.id > ? ${before ? 'AND x.id < ?' : ''} ORDER BY x.id DESC LIMIT ?`,
      ch.id, floor, ...(before ? [before] : []), limit)).reverse();
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
  // Nhóm chat riêng tư: đẩy tin mới tới điện thoại các thành viên (không tạo thông báo trong hệ thống)
  if (ch.kind === 'private') {
    const members = (await all('SELECT user_id FROM chat_members WHERE channel_id = ? AND user_id <> ?', ch.id, user.id))
      .map((m) => m.user_id).filter((id) => !mentioned.includes(id));
    pushToUsers(members, { app: 'message', title: `#${ch.name}`, body: `${user.name}: ${(content || `📎 ${stored?.original_name || 'Tệp đính kèm'}`).slice(0, 140)}`,
      link: `/message/${ch.id}`, tag: `chat:/message/${ch.id}` });
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
async function messageFile(c) {
  const m = await get('SELECT * FROM chat_messages WHERE id = ?', toInt(c.req.param('id')));
  if (!m || !m.filename || m.deleted_at) throw notFound('Tệp không tồn tại');
  const { floor } = await channelAccess(c.get('user'), m.channel_id);
  if (m.id <= floor) throw forbidden('Bạn không được xem tin nhắn này');
  return m;
}
r.get('/chat/messages/:id/file', async (c) => sendFile(c, await messageFile(c), c.req.query('inline') === '1'));
r.post('/chat/messages/:id/file/link', async (c) => c.json(await publicFileLink(c, 'cm', await messageFile(c))));

r.get('/chat/search', async (c) => {
  const user = c.get('user');
  const q = String(c.req.query('q') || '').trim();
  if (!q) return c.json([]);
  const v = visibleWhere(user);
  return c.json(await all(`${MSG_SELECT} JOIN chat_channels c ON c.id = x.channel_id
    LEFT JOIN chat_members hm ON hm.channel_id = c.id AND hm.user_id = ?
    WHERE ${v.sql} AND x.deleted_at IS NULL AND x.content LIKE ? AND (c.kind <> 'private' OR x.id > IFNULL(hm.history_from_id, 0))
    ORDER BY x.id DESC LIMIT 30`, user.id, ...v.params, `%${q}%`));
});

export default r;
