/** Node.js entry: local SQLite file + local upload folder, also serves the built client. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.js';
import { setDriver, get, batch } from './db.js';
import { setStorage } from './storage.js';
import { createNodeDriver } from './drivers/node-sqlite.js';
import { createFsStorage } from './drivers/fs-storage.js';
import { buildSeed, resetStatements } from './seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function initNode({ dataDir = process.env.DATA_DIR || path.resolve(here, '../data'), reset = false } = {}) {
  setDriver(createNodeDriver(process.env.DB_FILE || path.join(dataDir, 'app.db')));
  setStorage(createFsStorage(path.join(dataDir, 'uploads')));
  if (reset) await batch(resetStatements());
  if (reset || !(await get('SELECT 1 FROM users LIMIT 1'))) await batch(await buildSeed());
}

export function createNodeApp() {
  const app = createApp();
  const dist = path.resolve(here, '../../client/dist');
  if (fs.existsSync(dist)) {
    const root = path.relative(process.cwd(), dist) || '.';
    app.use('/*', serveStatic({ root }));
    app.get('*', serveStatic({ root, path: 'index.html' }));
  }
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const reset = process.argv.includes('--seed');
  await initNode({ reset });
  if (reset) {
    console.log('Đã tạo lại dữ liệu mẫu. Đăng nhập: admin / 123456 hoặc demo / 123456');
    process.exit(0);
  }
  const port = Number(process.env.PORT) || 4000;
  serve({ fetch: createNodeApp().fetch, port }, () => console.log(`LDL Workspace: http://localhost:${port}`));
}
