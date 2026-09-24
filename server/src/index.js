import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { get } from './db.js';
import { seed } from './seed.js';
import { HttpError } from './util.js';
import coreRoutes from './routes/core.js';
import officeRoutes from './routes/office.js';
import weworkRoutes from './routes/wework.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', coreRoutes);
  app.use('/api', officeRoutes);
  app.use('/api', weworkRoutes);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API không tồn tại' }));

  // Serve built client (production)
  const dist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Tệp quá lớn (tối đa 50MB)' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Dữ liệu gửi lên không hợp lệ' });
    console.error(err);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  });
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!get('SELECT 1 FROM users LIMIT 1')) seed();
  const port = Number(process.env.PORT) || 4000;
  createApp().listen(port, () => console.log(`LDL Workspace server: http://localhost:${port}`));
}
