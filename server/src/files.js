/**
 * Liên kết tạm (15 phút) có chữ ký tới một tệp, để trình xem trực tuyến (Microsoft Office Online / Google Viewer)
 * tải được tệp mà không cần phiên đăng nhập. Mỗi nguồn tệp có một mã ngắn trong token.
 */
import { get } from './db.js';
import { signFileToken, verifyFileToken } from './auth.js';
import { forbidden, notFound, sendFile, toInt } from './util.js';

const SOURCES = {
  ta: 'task_attachments',
  da: 'document_attachments',
  ra: 'request_attachments',
  gf: 'request_group_files',
  cm: 'chat_messages',
  cf: 'comment_files',
};

const VIEW_TTL = 15 * 60;
const SHARE_TTL = 7 * 24 * 3600;

/**
 * Tạo liên kết tuyệt đối tới tệp (quyền xem phải được kiểm tra trước khi gọi).
 * ?share=1 → liên kết chia sẻ 7 ngày (gửi qua email, Zalo, Viber… cho người nhận tải được tệp); mặc định 15 phút cho trình xem trực tuyến.
 */
export async function publicFileLink(c, src, row) {
  if (!SOURCES[src]) throw new Error(`Nguồn tệp không hợp lệ: ${src}`);
  const ttl = c.req.query('share') === '1' ? SHARE_TTL : VIEW_TTL;
  const token = await signFileToken(c, { src, id: row.id }, ttl);
  const url = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0] || url.protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host') || url.host;
  return { url: `${proto}://${host}/api/public/files/${token}/${encodeURIComponent(row.original_name || 'tep')}`, expires_in: ttl };
}

/** GET /api/public/files/:token/:name — tệp theo liên kết tạm. */
export async function servePublicFile(c) {
  const p = await verifyFileToken(c, c.req.param('token'));
  // tương thích liên kết cũ { ta: id }
  const src = p?.src || (p?.ta ? 'ta' : null);
  const id = toInt(p?.id ?? p?.ta);
  if (!src || !SOURCES[src] || !id) throw forbidden('Liên kết đã hết hạn hoặc không hợp lệ');
  const row = await get(`SELECT * FROM ${SOURCES[src]} WHERE id = ?`, id);
  if (!row || !row.filename || row.deleted_at) throw notFound('Tệp không tồn tại');
  return sendFile(c, row, true);
}
