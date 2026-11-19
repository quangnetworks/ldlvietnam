/**
 * QUANTUM FULL — Worker entry (Hono). Prefix API: /api/v1
 * Static assets (React SPA) được phục vụ bởi Workers Assets; Worker chỉ chạy trước cho /api/*.
 */
import { Hono } from 'hono';
import { ApiError } from './lib/http';
import { authenticate, writeRequiresAdmin } from './lib/auth';
import { rateLimit, requestLogger } from './lib/observability';
import type { AppEnv } from './lib/types';
import { auditRoutes } from './routes/audit';
import { backtestRoutes } from './routes/backtests';
import { capitalRoutes } from './routes/capital';
import { dashboardRoutes } from './routes/dashboard';
import { drawRoutes } from './routes/draws';
import { generatorRoutes } from './routes/generator';
import { modelRoutes } from './routes/models';
import { portfolioRoutes } from './routes/portfolios';
import { statisticsRoutes } from './routes/statistics';
import { systemRoutes } from './routes/system';

export const APP_VERSION = '1.0.0';

export function createApp(options: { authenticate?: ReturnType<typeof authenticate> } = {}) {
  const app = new Hono<AppEnv>();
  const api = new Hono<AppEnv>();

  api.use('*', requestLogger);
  api.use('*', async (c, next) => {
    await next();
    c.header('cache-control', 'no-store');
    c.header('x-content-type-options', 'nosniff');
  });

  // Public: chỉ kiểm tra sức khoẻ (không lộ dữ liệu).
  api.get('/health', async (c) => {
    let db = 'ok';
    try {
      await c.env.DB.prepare('SELECT 1').first();
    } catch {
      db = 'error';
    }
    return c.json({ status: db === 'ok' ? 'ok' : 'degraded', version: APP_VERSION, db, time: new Date().toISOString() }, db === 'ok' ? 200 : 503);
  });

  api.use('*', options.authenticate ?? authenticate());
  api.use('*', rateLimit(1));
  api.use('*', writeRequiresAdmin);

  for (const r of [systemRoutes, drawRoutes, statisticsRoutes, generatorRoutes, portfolioRoutes, modelRoutes, backtestRoutes, capitalRoutes, auditRoutes, dashboardRoutes]) api.route('/', r);

  api.notFound((c) => c.json({ error: { code: 'not_found', message: 'Endpoint không tồn tại' } }, 404));
  api.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: { code: err.code, message: err.message, details: err.details ?? null } }, err.status);
    const msg = String((err as Error).message ?? err);
    if (/immutable/.test(msg)) return c.json({ error: { code: 'immutable', message: 'Dữ liệu đã khoá (bất biến) — dùng quy trình điều chỉnh có audit.' } }, 409);
    if (/UNIQUE constraint failed/.test(msg)) return c.json({ error: { code: 'conflict', message: 'Dữ liệu bị trùng (ràng buộc duy nhất)' } }, 409);
    if (/FOREIGN KEY constraint failed/.test(msg)) return c.json({ error: { code: 'foreign_key', message: 'Tham chiếu không hợp lệ' } }, 409);
    console.error(JSON.stringify({ level: 'error', msg: 'unhandled', error: msg, stack: (err as Error).stack, requestId: c.get('requestId') }));
    return c.json({ error: { code: 'internal_error', message: 'Lỗi hệ thống', requestId: c.get('requestId') } }, 500);
  });

  app.route('/api/v1', api);
  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: 'Endpoint không tồn tại' } }, 404));
  return app;
}

const app = createApp();

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<AppEnv['Bindings']>;
