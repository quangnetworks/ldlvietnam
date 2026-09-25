/**
 * Ảnh / tệp đính kèm trong bình luận — dùng chung cho Wework (task), Request (request), Office (document).
 * Bình luận gửi dạng JSON { content } hoặc multipart (content + files); được phép chỉ có tệp mà không có chữ.
 */
import { all, batch, get } from './db.js';
import { badRequest, formBody, notFound, removeFile, storeFiles, toInt } from './util.js';

export const MAX_COMMENT_FILES = 10;

/** Đọc nội dung + tệp của bình luận mới; lỗi nếu cả hai đều trống. */
export async function readComment(c, maxLen = 5000) {
  const { fields, files } = await formBody(c);
  const content = String(fields.content || '').trim().slice(0, maxLen);
  if (files.length > MAX_COMMENT_FILES) throw badRequest(`Tối đa ${MAX_COMMENT_FILES} tệp mỗi bình luận`);
  if (!content && !files.length) throw badRequest('Nội dung bình luận trống');
  return { content, files };
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
