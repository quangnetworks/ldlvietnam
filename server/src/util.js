import { getStorage } from './storage.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (msg) => new HttpError(400, msg);
export const notFound = (msg = 'Không tìm thấy') => new HttpError(404, msg);
export const forbidden = (msg = 'Bạn không có quyền thực hiện thao tác này') => new HttpError(403, msg);

export function toInt(v, fallback = null) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

export function idList(v) {
  if (v === undefined || v === null || v === '') return [];
  const arr = Array.isArray(v) ? v : String(v).split(',');
  return [...new Set(arr.map((x) => toInt(x)).filter((x) => x !== null))];
}

export const today = () => new Date().toISOString().slice(0, 10);

export function paginate(q, defLimit = 20) {
  const page = Math.max(1, toInt(q.page, 1));
  const limit = Math.min(200, Math.max(1, toInt(q.limit, defLimit)));
  return { page, limit, offset: (page - 1) * limit };
}

/** JSON request body (empty object when missing / invalid). */
export async function jsonBody(c) {
  try {
    return (await c.req.json()) || {};
  } catch {
    return {};
  }
}

export const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** Parse multipart/form-data: returns { fields, files }. Uploaded files live under the "files" key. */
export async function formBody(c) {
  const type = c.req.header('content-type') || '';
  if (!type.includes('multipart/form-data')) return { fields: await jsonBody(c), files: [] };
  const form = await c.req.formData();
  const fields = {};
  const files = [];
  for (const [k, v] of form.entries()) {
    if (typeof v === 'string') fields[k] = v;
    else if (k === 'files' && v.size > 0) files.push(v);
  }
  for (const f of files) if (f.size > MAX_FILE_SIZE) throw badRequest('Tệp quá lớn (tối đa 50MB)');
  if (files.length > 20) throw badRequest('Tối đa 20 tệp mỗi lần tải lên');
  return { fields, files };
}

/** Save uploaded files to storage, returning rows { filename, original_name, mime, size }. */
export async function storeFiles(files) {
  const out = [];
  for (const f of files) {
    const name = f.name || 'tep';
    const ext = (name.match(/\.[A-Za-z0-9]{1,10}$/) || [''])[0];
    const key = `${Date.now()}-${crypto.randomUUID().slice(0, 12)}${ext}`;
    await getStorage().put(key, f);
    out.push({ filename: key, original_name: name, mime: f.type || 'application/octet-stream', size: f.size });
  }
  return out;
}

export function removeFile(key) {
  return getStorage().remove(key).catch(() => {});
}

/** Parse a single "bytes=a-b" Range header against the object size (null = whole file / unsupported). */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m || (!m[1] && !m[2]) || !size) return null;
  let start; let end;
  if (!m[1]) { start = Math.max(0, size - Number(m[2])); end = size - 1; } // suffix: last N bytes
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  if (start > end || start >= size) return { invalid: true };
  return { offset: start, length: end - start + 1 };
}

/** Types that are safe to render directly in the browser (no script execution possible). */
const SAFE_INLINE = /^(image\/(png|jpe?g|gif|webp|bmp|avif)|application\/pdf|text\/plain|video\/(mp4|webm|ogg|quicktime)|audio\/(mpeg|mp3|mp4|aac|ogg|wav|x-wav|webm|flac))/;

/** Stream an attachment back to the client (supports byte ranges so videos can be seeked). */
export async function sendFile(c, att, inline = false) {
  const storage = getStorage();
  const range = c.req.header('range') && storage.size ? parseRange(c.req.header('range'), await storage.size(att.filename)) : null;
  if (range?.invalid) return new Response(null, { status: 416 });
  const obj = await storage.get(att.filename, range || undefined);
  if (!obj) throw notFound('Tệp không tồn tại trên máy chủ');
  // Only render known-safe types inline; everything else (HTML, SVG...) is forced to download.
  const safeInline = inline && SAFE_INLINE.test(att.mime || '');
  const disp = `${safeInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(att.original_name)}`;
  const headers = {
    'Content-Type': att.mime || 'application/octet-stream',
    'Content-Disposition': disp,
    'Content-Length': String(range ? range.length : obj.size),
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
  };
  if (range) headers['Content-Range'] = `bytes ${range.offset}-${range.offset + range.length - 1}/${obj.size}`;
  // Chrome refuses to render PDFs in a sandboxed document, so only sandbox other types.
  if (att.mime !== 'application/pdf') headers['Content-Security-Policy'] = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'";
  return new Response(obj.body, { status: range ? 206 : 200, headers });
}
