/** LDL Drive: personal & company document storage with folder tree and sharing. */
import { Hono } from 'hono';
import { all, get, run, batch } from '../db.js';
import { badRequest, notFound, forbidden, toInt, jsonBody, formBody, storeFiles, removeFile, sendFile } from '../util.js';

const r = new Hono();
const SPACES = ['personal', 'company'];

/** Ancestors of an item (itself first), following parent_id. */
function chain(id) {
  return all(`WITH RECURSIVE up(id, parent_id, depth) AS (
      SELECT id, parent_id, 0 FROM drive_items WHERE id = ?
      UNION ALL SELECT d.id, d.parent_id, up.depth + 1 FROM drive_items d JOIN up ON d.id = up.parent_id)
    SELECT d.* FROM up JOIN drive_items d ON d.id = up.id ORDER BY up.depth`, id);
}

/** Returns 'edit' | 'view' | null for the viewer on this item (inherits shares from parent folders). */
async function accessOf(user, itemId) {
  const items = await chain(itemId);
  if (!items.length || items.some((x) => x.deleted_at)) return { perm: null, items };
  const item = items[0];
  if (item.space === 'company') {
    if (user.role === 'guest') return { perm: null, items };
    return { perm: user.role === 'admin' || item.owner_id === user.id ? 'edit' : 'view', items };
  }
  if (items.some((x) => x.owner_id === user.id)) return { perm: 'edit', items };
  const ids = items.map((x) => x.id);
  const shares = await all(`SELECT permission FROM drive_shares WHERE item_id IN (${ids.map(() => '?').join(',')})
    AND (user_id = ? OR (department_id IS NOT NULL AND department_id = ?)
      OR group_id IN (SELECT group_id FROM user_group_members WHERE user_id = ?))`, ...ids, user.id, user.department_id ?? -1, user.id);
  if (shares.some((s) => s.permission === 'edit')) return { perm: 'edit', items };
  return { perm: shares.length ? 'view' : null, items };
}

async function need(user, itemId, level) {
  const a = await accessOf(user, itemId);
  if (!a.items.length || a.items.some((x) => x.deleted_at)) throw notFound('Tệp / thư mục không tồn tại');
  if (!a.perm || (level === 'edit' && a.perm !== 'edit')) throw forbidden('Bạn không có quyền với tệp / thư mục này');
  return a;
}

const ITEM_SELECT = `SELECT i.id, i.parent_id, i.space, i.kind, i.name, i.owner_id, i.mime, i.size, i.created_at, i.updated_at, i.deleted_at,
    u.name AS owner_name, u.color AS owner_color,
    (SELECT COUNT(*) FROM drive_shares s WHERE s.item_id = i.id) AS share_count,
    (SELECT COUNT(*) FROM drive_items ch WHERE ch.parent_id = i.id AND ch.deleted_at IS NULL) AS child_count
  FROM drive_items i LEFT JOIN users u ON u.id = i.owner_id`;
const ORDER = "ORDER BY CASE i.kind WHEN 'folder' THEN 0 ELSE 1 END, i.name COLLATE NOCASE";

r.get('/drive/items', async (c) => {
  const user = c.get('user');
  const q = c.req.query();
  const parent = toInt(q.parent_id);
  const like = q.q ? `%${q.q.trim()}%` : null;
  if (parent) {
    const { perm, items } = await need(user, parent, 'view');
    const rows = await all(`${ITEM_SELECT} WHERE i.parent_id = ? AND i.deleted_at IS NULL ${like ? 'AND i.name LIKE ?' : ''} ${ORDER}`, parent, ...(like ? [like] : []));
    return c.json({ items: rows, perm, folder: items[0], breadcrumb: items.slice().reverse().map((x) => ({ id: x.id, name: x.name, space: x.space })) });
  }
  const space = q.space || 'personal';
  let rows = [];
  let perm = 'view';
  if (space === 'personal') {
    rows = await all(`${ITEM_SELECT} WHERE i.space = 'personal' AND i.owner_id = ? AND i.parent_id IS NULL AND i.deleted_at IS NULL
      ${like ? 'AND i.name LIKE ?' : ''} ${ORDER}`, user.id, ...(like ? [like] : []));
    perm = 'edit';
  } else if (space === 'company') {
    if (user.role === 'guest') throw forbidden('Tài khoản khách không xem được tài liệu công ty');
    rows = await all(`${ITEM_SELECT} WHERE i.space = 'company' AND i.parent_id IS NULL AND i.deleted_at IS NULL ${like ? 'AND i.name LIKE ?' : ''} ${ORDER}`, ...(like ? [like] : []));
    perm = 'edit'; // mọi nhân viên được tạo / tải lên tài liệu công ty; sửa / xoá theo quyền từng mục
  } else if (space === 'shared') {
    rows = await all(`${ITEM_SELECT} WHERE i.deleted_at IS NULL AND IFNULL(i.owner_id, 0) <> ? AND i.id IN (
        SELECT item_id FROM drive_shares WHERE user_id = ? OR (department_id IS NOT NULL AND department_id = ?)
          OR group_id IN (SELECT group_id FROM user_group_members WHERE user_id = ?)) ${ORDER}`, user.id, user.id, user.department_id ?? -1, user.id);
  } else if (space === 'recent') {
    rows = await all(`${ITEM_SELECT} WHERE i.kind = 'file' AND i.deleted_at IS NULL AND (i.owner_id = ? ${user.role === 'guest' ? '' : "OR i.space = 'company'"})
      ORDER BY i.updated_at DESC LIMIT 50`, user.id);
  } else if (space === 'trash') {
    rows = await all(`${ITEM_SELECT} WHERE i.owner_id = ? AND i.deleted_at IS NOT NULL ORDER BY i.deleted_at DESC`, user.id);
  } else throw badRequest('Không gian không hợp lệ');
  const usage = await get("SELECT COUNT(*) AS files, IFNULL(SUM(size), 0) AS bytes FROM drive_items WHERE owner_id = ? AND kind = 'file' AND deleted_at IS NULL", user.id);
  return c.json({ items: rows, perm, folder: null, breadcrumb: [], usage });
});

async function targetFor(user, parentId, space) {
  if (parentId) {
    const { items } = await need(user, parentId, 'edit');
    if (items[0].kind !== 'folder') throw badRequest('Chỉ tạo được bên trong thư mục');
    return { parent_id: parentId, space: items[0].space };
  }
  if (!SPACES.includes(space)) throw badRequest('Không gian không hợp lệ');
  if (space === 'company' && user.role === 'guest') throw forbidden();
  return { parent_id: null, space };
}

const cleanName = (n) => String(n || '').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 200);

r.post('/drive/folders', async (c) => {
  const user = c.get('user');
  const b = await jsonBody(c);
  const name = cleanName(b.name);
  if (!name) throw badRequest('Tên thư mục là bắt buộc');
  const t = await targetFor(user, toInt(b.parent_id), b.space || 'personal');
  const { lastId } = await run("INSERT INTO drive_items(parent_id, space, kind, name, owner_id) VALUES (?,?, 'folder', ?, ?)", t.parent_id, t.space, name, user.id);
  return c.json(await get(`${ITEM_SELECT} WHERE i.id = ?`, lastId), 201);
});

r.post('/drive/upload', async (c) => {
  const user = c.get('user');
  const { fields, files } = await formBody(c);
  if (!files.length) throw badRequest('Chưa chọn tệp');
  const t = await targetFor(user, toInt(fields.parent_id), fields.space || 'personal');
  const stored = await storeFiles(files);
  await batch(stored.map((f) => ["INSERT INTO drive_items(parent_id, space, kind, name, owner_id, filename, mime, size) VALUES (?,?, 'file', ?,?,?,?,?)",
    [t.parent_id, t.space, cleanName(f.original_name) || 'tep', user.id, f.filename, f.mime, f.size]]));
  return c.json({ uploaded: stored.length }, 201);
});

r.put('/drive/items/:id', async (c) => {
  const user = c.get('user');
  const id = toInt(c.req.param('id'));
  const { items } = await need(user, id, 'edit');
  const item = items[0];
  const b = await jsonBody(c);
  if (item.space === 'company' && user.role !== 'admin' && item.owner_id !== user.id) throw forbidden('Chỉ người tạo hoặc quản trị viên được sửa');
  if (b.name !== undefined) {
    const name = cleanName(b.name);
    if (!name) throw badRequest('Tên không hợp lệ');
    await run("UPDATE drive_items SET name = ?, updated_at = datetime('now') WHERE id = ?", name, id);
  }
  if (b.parent_id !== undefined) {
    const target = toInt(b.parent_id);
    if (target) {
      const t = await need(user, target, 'edit');
      if (t.items[0].kind !== 'folder') throw badRequest('Đích phải là thư mục');
      if (t.items.some((x) => x.id === id)) throw badRequest('Không thể chuyển thư mục vào chính nó');
      await run("UPDATE drive_items SET parent_id = ?, space = ?, updated_at = datetime('now') WHERE id = ?", target, t.items[0].space, id);
    } else {
      const space = SPACES.includes(b.space) ? b.space : item.space;
      if (space === 'company' && user.role === 'guest') throw forbidden();
      await run("UPDATE drive_items SET parent_id = NULL, space = ?, updated_at = datetime('now') WHERE id = ?", space, id);
    }
  }
  return c.json(await get(`${ITEM_SELECT} WHERE i.id = ?`, id));
});

async function subtreeFiles(id) {
  return all(`WITH RECURSIVE down(id) AS (SELECT ? UNION ALL SELECT d.id FROM drive_items d JOIN down ON d.parent_id = down.id)
    SELECT filename FROM drive_items WHERE id IN (SELECT id FROM down) AND filename IS NOT NULL`, id);
}

r.delete('/drive/items/:id', async (c) => {
  const user = c.get('user');
  const id = toInt(c.req.param('id'));
  const item = await get('SELECT * FROM drive_items WHERE id = ?', id);
  if (!item) throw notFound();
  const owner = item.owner_id === user.id || user.role === 'admin';
  if (c.req.query('permanent') === '1') {
    if (!owner || !item.deleted_at) throw forbidden('Chỉ xoá vĩnh viễn được mục của bạn trong thùng rác');
    const files = await subtreeFiles(id);
    await run('DELETE FROM drive_items WHERE id = ?', id);
    for (const f of files) await removeFile(f.filename);
    return c.json({ ok: true });
  }
  const { items } = await need(user, id, 'edit');
  if (items[0].space === 'company' && !owner) throw forbidden('Chỉ người tạo hoặc quản trị viên được xoá');
  await run("UPDATE drive_items SET deleted_at = datetime('now') WHERE id = ?", id);
  return c.json({ ok: true });
});

r.post('/drive/items/:id/restore', async (c) => {
  const user = c.get('user');
  const item = await get('SELECT * FROM drive_items WHERE id = ?', toInt(c.req.param('id')));
  if (!item || (item.owner_id !== user.id && user.role !== 'admin')) throw notFound();
  await run('UPDATE drive_items SET deleted_at = NULL WHERE id = ?', item.id);
  return c.json({ ok: true });
});

r.get('/drive/items/:id/download', async (c) => {
  const { items } = await need(c.get('user'), toInt(c.req.param('id')), 'view');
  const f = items[0];
  if (f.kind !== 'file') throw badRequest('Chỉ tải được tệp');
  return sendFile(c, { filename: f.filename, original_name: f.name, mime: f.mime }, c.req.query('inline') === '1');
});

// ---------------- sharing
r.get('/drive/items/:id/shares', async (c) => {
  const id = toInt(c.req.param('id'));
  await need(c.get('user'), id, 'view');
  return c.json(await all(`SELECT s.*, u.name AS user_name, u.color AS user_color, d.name AS department_name, g.name AS group_name
    FROM drive_shares s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN departments d ON d.id = s.department_id
    LEFT JOIN user_groups g ON g.id = s.group_id WHERE s.item_id = ? ORDER BY s.id`, id));
});

r.put('/drive/items/:id/shares', async (c) => {
  const user = c.get('user');
  const id = toInt(c.req.param('id'));
  const item = await get('SELECT * FROM drive_items WHERE id = ?', id);
  if (!item) throw notFound();
  if (item.owner_id !== user.id && user.role !== 'admin') throw forbidden('Chỉ chủ sở hữu được chia sẻ');
  const body = await jsonBody(c);
  const shares = Array.isArray(body.shares) ? body.shares : [];
  const rows = [];
  for (const s of shares.slice(0, 200)) {
    const perm = s.permission === 'edit' ? 'edit' : 'view';
    const uid = toInt(s.user_id); const did = toInt(s.department_id); const gid = toInt(s.group_id);
    if ([uid, did, gid].filter(Boolean).length !== 1) continue;
    rows.push(['INSERT INTO drive_shares(item_id, user_id, department_id, group_id, permission) VALUES (?,?,?,?,?)', [id, uid, did, gid, perm]]);
  }
  await batch([['DELETE FROM drive_shares WHERE item_id = ?', [id]], ...rows]);
  return c.json({ ok: true, count: rows.length });
});

export default r;
