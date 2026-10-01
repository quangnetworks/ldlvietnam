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
import { housekeeping } from './maintenance.js';
import { hashPassword } from './auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Đọc biến môi trường từ tệp .env (KEY=VALUE) cạnh thư mục chạy — không ghi đè biến đã đặt sẵn. */
export function loadEnvFile(file = path.resolve(process.cwd(), '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

/**
 * Cài đặt mới cho công ty (DEMO_DATA=0): không tạo dữ liệu mẫu, chỉ tạo tài khoản Chủ doanh nghiệp
 * ADMIN_USERNAME (mặc định admin) với mật khẩu ADMIN_PASSWORD — để trống thì sinh ngẫu nhiên và in ra màn hình.
 */
async function bootstrapOwner() {
  const username = (process.env.ADMIN_USERNAME || 'admin').trim();
  let password = process.env.ADMIN_PASSWORD || '';
  const generated = !password;
  if (generated) password = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
  if (password.length < 6) throw new Error('ADMIN_PASSWORD phải có ít nhất 6 ký tự');
  await batch([
    ["INSERT OR REPLACE INTO settings(key, value) VALUES ('company_name', ?)", [process.env.COMPANY_NAME || 'Công ty LDL Việt Nam']],
    [`INSERT INTO users(username, password_hash, name, title, role, is_owner, color) VALUES (?,?,?,?, 'admin', 1, '#e8590c')`,
      [username, await hashPassword(password), 'Admin', 'Quản trị hệ thống']],
    ["INSERT OR IGNORE INTO app_access(app_key, user_id) SELECT a.key, u.id FROM apps a CROSS JOIN users u", []],
  ]);
  console.log(`Đã khởi tạo hệ thống trống. Đăng nhập: ${username} / ${generated ? password : '(mật khẩu trong ADMIN_PASSWORD)'}`);
  if (generated) console.log('→ Hãy đổi mật khẩu ngay sau lần đăng nhập đầu tiên.');
}

export async function initNode({ dataDir = process.env.DATA_DIR || path.resolve(here, '../data'), reset = false } = {}) {
  setDriver(createNodeDriver(process.env.DB_FILE || path.join(dataDir, 'app.db')));
  setStorage(createFsStorage(path.join(dataDir, 'uploads')));
  if (reset) await batch(resetStatements());
  if (reset) await batch(await buildSeed());
  else if (!(await get('SELECT 1 FROM users LIMIT 1'))) {
    if (process.env.DEMO_DATA === '0') await bootstrapOwner();
    else await batch(await buildSeed());
  }
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
  loadEnvFile();
  const reset = process.argv.includes('--seed');
  await initNode({ reset });
  if (reset) {
    console.log('Đã tạo lại dữ liệu mẫu. Đăng nhập: admin / 123456 hoặc demo / 123456');
    process.exit(0);
  }
  const port = Number(process.env.PORT) || 4000;
  const hostname = process.env.HOST || '0.0.0.0';
  serve({ fetch: createNodeApp().fetch, port, hostname }, () => console.log(`LDL Workspace: http://localhost:${port} (mở từ máy khác: http://<IP-máy-chủ>:${port})`));
  // dọn dẹp dữ liệu cũ mỗi ngày (trên Cloudflare dùng Cron Trigger)
  setInterval(() => housekeeping().catch((e) => console.error('housekeeping:', e)), 24 * 3600e3).unref();
}
