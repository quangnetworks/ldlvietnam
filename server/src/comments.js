/**
 * Ảnh / tệp đính kèm trong bình luận — dùng chung cho Wework (task), Request (request), Office (document).
 * Bình luận gửi dạng JSON { content } hoặc multipart (content + files); được phép chỉ có tệp mà không có chữ.
 */
import { all, batch, get, run, findMentions, notify } from './db.js';
import { badRequest, forbidden, formBody, idList, notFound, removeFile, storeFiles, toInt } from './util.js';

export const MAX_COMMENT_FILES = 10;

/**
 * Đọc nội dung + tệp của bình luận mới; lỗi nếu cả hai đều trống.
 * Trả lời bình luận: parent_id → luôn gắn vào bình luận gốc (một cấp); parent = bình luận được trả lời.
 */
export async function readComment(c, entity, entityId, maxLen = 5000) {
  const { fields, files } = await formBody(c);
  const content = String(fields.content || '').trim().slice(0, maxLen);
  if (files.length > MAX_COMMENT_FILES) throw badRequest(`Tối đa ${MAX_COMMENT_FILES} tệp mỗi bình luận`);
  if (!content && !files.length) throw badRequest('Nội dung bình luận trống');
  let parent = null;
  let parentId = null;
  if (toInt(fields.parent_id)) {
    parent = await commentOr404(entity, entityId, fields.parent_id);
    parentId = parent.parent_id || parent.id;
  }
  return { content, files, parent, parentId };
}

/**
 * Thông báo cho người được trả lời (người viết bình luận được trả lời và bình luận gốc).
 * Trả về danh sách đã thông báo để không gửi trùng thông báo nhắc tên / "bình luận" chung.
 */
export async function notifyReply(entity, entityId, user, parent, snippet) {
  if (!parent) return [];
  const k = KINDS[entity];
  const ids = [parent.user_id];
  if (parent.parent_id) {
    const root = await get(`SELECT user_id FROM ${k.table} WHERE id = ?`, parent.parent_id);
    if (root) ids.push(root.user_id);
  }
  const to = [...new Set(ids)].filter((id) => id && id !== user.id);
  if (!to.length) return [];
  const p = await get(`SELECT title FROM ${k.parent} WHERE id = ?`, entityId);
  await notify(to, { actorId: user.id, app: k.app, type: 'comment',
    title: `${user.name} đã trả lời bình luận của bạn trong ${k.noun}"${p?.title || ''}": ${snippet}`, link: k.link(entityId) });
  return to;
}

/** Lưu tệp của một bình luận. */
export async function saveCommentFiles(entity, entityId, commentId, userId, files) {
  if (!files.length) return;
  const stored = await storeFiles(files);
  await batch(stored.map((f) => [
    'INSERT INTO comment_files(entity, entity_id, comment_id, filename, original_name, mime, size, user_id) VALUES (?,?,?,?,?,?,?,?)',
    [entity, entityId, commentId, f.filename, f.original_name, f.mime, f.size, userId],
  ]));
}

/** Gắn danh sách tệp (files: [{id, original_name, mime, size}]) vào từng bình luận. */
export async function withCommentFiles(entity, entityId, comments) {
  const list = Array.isArray(comments) ? comments : [comments];
  if (!list.length) return comments;
  const rows = await all('SELECT id, comment_id, original_name, mime, size FROM comment_files WHERE entity = ? AND entity_id = ? ORDER BY id', entity, entityId);
  for (const cm of list) cm.files = rows.filter((f) => f.comment_id === cm.id).map(({ comment_id: _, ...f }) => f);
  return comments;
}

/** Tệp bình luận thuộc đúng bản ghi (đã kiểm tra quyền xem bản ghi trước khi gọi). */
export async function commentFileOr404(entity, entityId, fid) {
  const f = await get('SELECT * FROM comment_files WHERE id = ? AND entity = ? AND entity_id = ?', toInt(fid), entity, entityId);
  if (!f) throw notFound('Tệp không tồn tại');
  return f;
}

/** Tóm tắt ngắn cho thông báo: nội dung, hoặc "đã gửi N tệp" khi chỉ có tệp. */
export function commentSnippet(content, files) {
  const text = content.replace(/\s+/g, ' ').slice(0, 80);
  if (text) return text;
  const imgs = files.filter((f) => /^image\//.test(f.type || '')).length;
  return imgs === files.length ? `[${files.length} ảnh]` : `[${files.length} tệp đính kèm]`;
}

/** Xoá tệp bình luận (theo bình luận hoặc theo các bản ghi) cả trong CSDL lẫn kho lưu trữ. */
export async function purgeCommentFiles(entity, { entityIds = [], commentId = null } = {}) {
  let rows;
  if (commentId) rows = await all('SELECT id, filename FROM comment_files WHERE entity = ? AND comment_id = ?', entity, commentId);
  else if (entityIds.length) rows = await all(`SELECT id, filename FROM comment_files WHERE entity = ? AND entity_id IN (${entityIds.map(() => '?').join(',')})`, entity, ...entityIds);
  else return;
  if (!rows.length) return;
  await batch(rows.map((r) => ['DELETE FROM comment_files WHERE id = ?', [r.id]]));
  for (const r of rows) await removeFile(r.filename);
}

// ---------------------------------------------------------------- sửa / xoá bình luận
const KINDS = {
  task: { table: 'task_comments', fk: 'task_id', follow: ['task_followers', 'task_id'], parent: 'tasks', app: 'wework', link: (id) => `/wework/task/${id}`, noun: '' },
  request: { table: 'request_comments', fk: 'request_id', follow: ['request_followers', 'request_id'], parent: 'requests', app: 'request', link: (id) => `/request/${id}`, noun: 'đề xuất ' },
  document: { table: 'document_comments', fk: 'document_id', follow: ['document_follows', 'document_id'], parent: 'documents', app: 'office', link: (id) => `/office/doc/${id}`, noun: 'văn bản ' },
};

async function commentOr404(entity, entityId, cid) {
  const k = KINDS[entity];
  const cm = await get(`SELECT * FROM ${k.table} WHERE id = ? AND ${k.fk} = ?`, toInt(cid), entityId);
  if (!cm) throw notFound('Bình luận không tồn tại');
  return cm;
}

/**
 * Sửa bình luận (chỉ người viết): nội dung, bỏ tệp cũ (remove_files: danh sách id), thêm tệp mới (files).
 * Người mới được @nhắc tên trong nội dung sửa được thêm vào người theo dõi và nhận thông báo.
 */
export async function editComment(c, entity, entityId, cid, user) {
  const k = KINDS[entity];
  const cm = await commentOr404(entity, entityId, cid);
  if (cm.user_id !== user.id) throw forbidden('Chỉ người viết mới được sửa bình luận này');
  const { fields, files } = await formBody(c);
  const content = String(fields.content ?? cm.content ?? '').trim().slice(0, 5000);
  const current = await all('SELECT id, filename FROM comment_files WHERE entity = ? AND comment_id = ?', entity, cm.id);
  const drop = new Set(idList(fields.remove_files));
  const removed = current.filter((f) => drop.has(f.id));
  const keep = current.length - removed.length;
  if (keep + files.length > MAX_COMMENT_FILES) throw badRequest(`Tối đa ${MAX_COMMENT_FILES} tệp mỗi bình luận`);
  if (!content && !keep && !files.length) throw badRequest('Bình luận không được để trống — hãy xoá bình luận nếu không cần nữa');
  await run(`UPDATE ${k.table} SET content = ?, updated_at = datetime('now') WHERE id = ?`, content, cm.id);
  if (removed.length) {
    await batch(removed.map((f) => ['DELETE FROM comment_files WHERE id = ?', [f.id]]));
    for (const f of removed) await removeFile(f.filename);
  }
  await saveCommentFiles(entity, entityId, cm.id, user.id, files);
  const before = new Set(await findMentions(cm.content, user.id));
  const added = (await findMentions(content, user.id)).filter((id) => !before.has(id));
  if (added.length) {
    const [ft, fk] = k.follow;
    await batch(added.map((uid) => [`INSERT OR IGNORE INTO ${ft}(${fk}, user_id) VALUES (?,?)`, [entityId, uid]]));
    const parent = await get(`SELECT title FROM ${k.parent} WHERE id = ?`, entityId);
    await notify(added, { actorId: user.id, app: k.app, type: 'mention',
      title: `${user.name} đã nhắc đến bạn trong ${k.noun}"${parent?.title || ''}": ${commentSnippet(content, files)}`, link: k.link(entityId) });
  }
  return cm.id;
}

/** Xoá bình luận: người viết hoặc quản trị cấp cao / chủ doanh nghiệp; xoá luôn ảnh, tệp đính kèm. */
export async function deleteComment(entity, entityId, cid, user) {
  const k = KINDS[entity];
  const cm = await commentOr404(entity, entityId, cid);
  if (cm.user_id !== user.id && user.role !== 'admin') throw forbidden('Chỉ người viết hoặc quản trị viên mới được xoá bình luận');
  // xoá bình luận gốc → xoá luôn các trả lời của nó
  const replies = await all(`SELECT id FROM ${k.table} WHERE parent_id = ?`, cm.id);
  await run(`DELETE FROM ${k.table} WHERE id = ? OR parent_id = ?`, cm.id, cm.id);
  for (const r of [cm, ...replies]) await purgeCommentFiles(entity, { commentId: r.id });
  return cm;
}
