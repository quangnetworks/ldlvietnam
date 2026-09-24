import { Hono } from 'hono';
import { requireAuth } from './auth.js';
import { HttpError } from './util.js';
import coreRoutes from './routes/core.js';
import officeRoutes from './routes/office.js';
import weworkRoutes from './routes/wework.js';
import accountRoutes from './routes/account.js';
import requestRoutes from './routes/request.js';
import { requireModule } from './platform.js';

const PUBLIC_API = new Set(['/api/health', '/api/auth/login', '/api/auth/logout']);

/** Runtime-independent HTTP app (used by both the Node server and the Cloudflare Worker). */
export function createApp() {
  const app = new Hono();

  app.use('/api/*', async (c, next) => {
    if (PUBLIC_API.has(c.req.path)) return next();
    return requireAuth(c, () => requireModule(c, next));
  });
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api', coreRoutes);
  app.route('/api', officeRoutes);
  app.route('/api', weworkRoutes);
  app.route('/api', accountRoutes);
  app.route('/api', requestRoutes);
  app.all('/api/*', (c) => c.json({ error: 'API không tồn tại' }, 404));

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    if (err instanceof SyntaxError) return c.json({ error: 'Dữ liệu gửi lên không hợp lệ' }, 400);
    console.error(err);
    return c.json({ error: 'Lỗi máy chủ' }, 500);
  });
  return app;
}
