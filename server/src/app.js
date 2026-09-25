import { Hono } from 'hono';
import { requireAuth } from './auth.js';
import { HttpError } from './util.js';
import coreRoutes from './routes/core.js';
import officeRoutes from './routes/office.js';
import weworkRoutes from './routes/wework.js';
import accountRoutes from './routes/account.js';
import requestRoutes from './routes/request.js';
import webhookRoutes from './routes/webhooks.js';
import hrmRoutes from './routes/hrm.js';
import driveRoutes from './routes/drive.js';
import chatRoutes from './routes/chat.js';
import { requireModule } from './platform.js';
import pushRoutes from './routes/push.js';
import { backgroundContext } from './push.js';

const PUBLIC_API = new Set(['/api/health', '/api/auth/login', '/api/auth/logout']);

/** Runtime-independent HTTP app (used by both the Node server and the Cloudflare Worker). */
export function createApp() {
  const app = new Hono();

  app.use('/api/*', backgroundContext);
  app.use('/api/*', async (c, next) => {
    // /api/public/*: signed, short-lived file links (the token itself is the credential)
    if (PUBLIC_API.has(c.req.path) || c.req.path.startsWith('/api/public/')) return next();
    return requireAuth(c, () => requireModule(c, next));
  });
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api', coreRoutes);
  app.route('/api', officeRoutes);
  app.route('/api', weworkRoutes);
  app.route('/api', accountRoutes);
  app.route('/api', requestRoutes);
  app.route('/api', webhookRoutes);
  app.route('/api', hrmRoutes);
  app.route('/api', driveRoutes);
  app.route('/api', chatRoutes);
  app.route('/api', pushRoutes);
  app.all('/api/*', (c) => c.json({ error: 'API không tồn tại' }, 404));

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    if (err instanceof SyntaxError) return c.json({ error: 'Dữ liệu gửi lên không hợp lệ' }, 400);
    console.error(err);
    return c.json({ error: 'Lỗi máy chủ' }, 500);
  });
  return app;
}
