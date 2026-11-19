import type { Context } from 'hono';
import { z } from 'zod';

export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, 'bad_request', message, details);
export const notFound = (what = 'Tài nguyên') => new ApiError(404, 'not_found', `${what} không tồn tại`);
export const conflict = (message: string, details?: unknown) => new ApiError(409, 'conflict', message, details);
export const unprocessable = (message: string, details?: unknown) => new ApiError(422, 'unprocessable', message, details);

/** Đọc & kiểm tra body JSON bằng Zod. */
export async function parseJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('Body phải là JSON hợp lệ');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ApiError(400, 'validation_error', 'Dữ liệu không hợp lệ', z.treeifyError(r.error));
  return r.data;
}

export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  const r = schema.safeParse(c.req.query());
  if (!r.success) throw new ApiError(400, 'validation_error', 'Tham số truy vấn không hợp lệ', z.treeifyError(r.error));
  return r.data;
}

export const IdParam = z.coerce.number().int().positive();

export function parseId(c: Context, name = 'id'): number {
  const r = IdParam.safeParse(c.req.param(name));
  if (!r.success) throw badRequest(`Tham số ${name} không hợp lệ`);
  return r.data;
}

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export function pageMeta(page: number, pageSize: number, total: number) {
  return { page, page_size: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export const BoolQuery = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

export function nowIso(): string {
  return new Date().toISOString();
}
