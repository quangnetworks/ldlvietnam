import type { MiddlewareHandler } from 'hono';
import { ApiError } from './http';
import type { AppEnv } from './types';

/** Structured logging (JSON) cho mỗi request — xem bằng Workers Logs / wrangler tail. */
export const requestLogger: MiddlewareHandler<AppEnv> = async (c, next) => {
  const requestId = c.req.header('cf-ray') ?? crypto.randomUUID();
  c.set('requestId', requestId);
  const start = Date.now();
  let status = 500;
  try {
    await next();
    status = c.res.status;
  } catch (e) {
    status = e instanceof ApiError ? e.status : 500;
    throw e;
  } finally {
    console.log(
      JSON.stringify({
        level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
        msg: 'request',
        requestId,
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status,
        durationMs: Date.now() - start,
        user: c.get('user')?.id ?? null,
      }),
    );
  }
  c.header('x-request-id', requestId);
};

const memoryBuckets = new Map<string, { count: number; reset: number }>();

/**
 * Rate limiting: dùng binding Cloudflare Rate Limiting nếu có; nếu không, fallback bộ đếm trong bộ nhớ isolate.
 * `cost` cho phép các endpoint tính toán nặng tiêu thụ nhiều hạn mức hơn.
 */
export function rateLimit(cost = 1, limitPerMinute = 600): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = c.get('user')?.id ?? c.req.header('cf-connecting-ip') ?? 'anonymous';
    let allowed = true;
    if (c.env.RATE_LIMITER) {
      for (let i = 0; i < cost && allowed; i++) allowed = (await c.env.RATE_LIMITER.limit({ key })).success;
    } else {
      const now = Date.now();
      const b = memoryBuckets.get(key);
      if (!b || b.reset < now) memoryBuckets.set(key, { count: cost, reset: now + 60_000 });
      else {
        b.count += cost;
        allowed = b.count <= limitPerMinute;
      }
    }
    if (!allowed) throw new ApiError(429, 'rate_limited', 'Quá nhiều yêu cầu, vui lòng thử lại sau ít phút');
    await next();
  };
}
