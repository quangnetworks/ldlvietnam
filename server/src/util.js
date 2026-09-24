import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { UPLOAD_DIR } from './db.js';

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

export const nowIso = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);

/** Busboy decodes multipart filenames as latin1; restore UTF-8 (Vietnamese names). */
export function fixName(name) {
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    return decoded.includes('�') ? name : decoded;
  } catch {
    return name;
  }
}

export const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(fixName(file.originalname)).slice(0, 16);
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 20 },
});

export function paginate(req, defLimit = 20) {
  const page = Math.max(1, toInt(req.query.page, 1));
  const limit = Math.min(200, Math.max(1, toInt(req.query.limit, defLimit)));
  return { page, limit, offset: (page - 1) * limit };
}
