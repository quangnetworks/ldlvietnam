#!/usr/bin/env node
/**
 * Chuyển dữ liệu từ bản đang chạy trên Cloudflare (D1 + R2) về máy chủ riêng (SQLite + thư mục tệp).
 *
 *   node scripts/import-cloudflare.mjs --data /srv/ldl-workspace/data
 *       tải CSDL D1 + toàn bộ tệp đính kèm R2 (cần "npx wrangler login" hoặc biến CLOUDFLARE_API_TOKEN,
 *       CLOUDFLARE_ACCOUNT_ID; tên D1 / R2 lấy trong wrangler.toml)
 *   node scripts/import-cloudflare.mjs --data ./data --dump d1.sql --skip-files
 *       dùng tệp SQL đã xuất sẵn (wrangler d1 export … --remote --output d1.sql), không tải tệp
 *
 * Tuỳ chọn: --force   ghi đè CSDL đang có (bản cũ được giữ lại thành app.db.bak-<thời gian>)
 *           --files-only   chỉ tải bổ sung tệp đính kèm còn thiếu vào CSDL đã nhập
 * Dừng ứng dụng (docker compose stop) trước khi nhập CSDL.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name) => args.includes(name);
const fail = (msg) => { console.error(`\n✗ ${msg}`); process.exit(1); };

const dataDir = path.resolve(opt('--data') || process.env.DATA_DIR || path.join(root, 'data'));
const dbFile = path.join(dataDir, 'app.db');
const uploads = path.join(dataDir, 'uploads');
const migrationsDir = path.join(root, 'migrations');

const toml = fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8');
const field = (k) => toml.match(new RegExp(`^${k}\\s*=\\s*"([^"]+)"`, 'm'))?.[1];
const DB_NAME = field('database_name');
const BUCKET = field('bucket_name');

const wranglerJs = process.env.WRANGLER || path.join(root, 'node_modules/wrangler/bin/wrangler.js');
const needWrangler = () => {
  if (!fs.existsSync(wranglerJs)) fail('Chưa cài wrangler. Chạy "npm install" trong thư mục server trước (cần cả devDependencies).');
};
function wrangler(argv, { capture = true } = {}) {
  const r = spawnSync(process.execPath, [wranglerJs, ...argv], { cwd: root, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 1 << 28 });
  if (r.status !== 0) fail(`Lệnh thất bại: wrangler ${argv.join(' ')}\n${r.stderr || r.stdout || ''}`);
  return r.stdout || '';
}
const parseJson = (s) => JSON.parse(s.slice(s.search(/[[{]/)));

// ---------------------------------------------------------------- 1. CSDL
function exportD1() {
  needWrangler();
  console.log(`→ Tìm CSDL D1 "${DB_NAME}"…`);
  const db = parseJson(wrangler(['d1', 'list', '--json'])).find((d) => d.name === DB_NAME);
  if (!db?.uuid) fail(`Không thấy D1 "${DB_NAME}" trong tài khoản Cloudflare đang đăng nhập.`);
  // wrangler.toml trong repo để database_id giả — dùng bản tạm có id thật
  const cfg = path.join(root, '.wrangler-import.toml');
  fs.writeFileSync(cfg, toml.replace(/^database_id = ".*"/m, `database_id = "${db.uuid}"`));
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ldl-d1-')), 'd1.sql');
  try {
    console.log('→ Xuất CSDL D1 (có thể mất vài phút)…');
    wrangler(['d1', 'export', DB_NAME, '--remote', '--output', out, '--config', cfg], { capture: false });
  } finally {
    fs.rmSync(cfg, { force: true });
  }
  return out;
}

function importDump(dumpFile) {
  if (fs.existsSync(dbFile) && !flag('--force')) {
    fail(`Đã có CSDL ${dbFile}. Thêm --force để thay bằng dữ liệu Cloudflare (bản cũ sẽ được giữ lại).`);
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = `${dbFile}.importing`;
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) fs.rmSync(f, { force: true });
  console.log(`→ Nhập ${dumpFile}…`);
  const db = new DatabaseSync(tmp);
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(fs.readFileSync(dumpFile, 'utf8'));
  const hasTable = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hasTable('users')) fail('Tệp SQL không chứa bảng users — có đúng là bản xuất D1 của LDL Workspace?');
  // đánh dấu migration đã chạy trên D1 để bản Node chỉ chạy tiếp các migration mới hơn
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const applied = hasTable('d1_migrations') ? db.prepare('SELECT name FROM d1_migrations').all().map((r) => r.name) : files;
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)');
  const mark = db.prepare('INSERT OR IGNORE INTO _migrations(name) VALUES (?)');
  for (const n of applied) mark.run(n);
  for (const t of ['d1_migrations', '_cf_KV', '_cf_METADATA']) if (hasTable(t)) db.exec(`DROP TABLE "${t}"`);
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  db.close();
  if (fs.existsSync(dbFile)) {
    const bak = `${dbFile}.bak-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
    fs.renameSync(dbFile, bak);
    console.log(`  (bản cũ giữ tại ${bak})`);
  }
  for (const f of [`${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });
  fs.renameSync(tmp, dbFile);
  const pending = files.filter((f) => !applied.includes(f));
  console.log(`✓ Đã nhập CSDL: ${users} tài khoản → ${dbFile}`);
  if (pending.length) console.log(`  ${pending.length} migration mới hơn bản Cloudflare sẽ tự chạy khi khởi động: ${pending.join(', ')}`);
}

// ---------------------------------------------------------------- 2. Tệp đính kèm (R2)
function fileKeys() {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  const keys = new Set();
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
    if (!db.prepare(`PRAGMA table_info("${name}")`).all().some((c) => c.name === 'filename')) continue;
    for (const r of db.prepare(`SELECT DISTINCT filename FROM "${name}" WHERE filename IS NOT NULL AND filename <> ''`).all()) keys.add(r.filename);
  }
  db.close();
  return [...keys];
}

function getObject(key) {
  return new Promise((resolve) => {
    const target = path.join(uploads, path.basename(key));
    const p = spawn(process.execPath, [wranglerJs, 'r2', 'object', 'get', `${BUCKET}/${key}`, '--remote', '--file', `${target}.part`], { cwd: root, stdio: 'ignore' });
    p.on('close', (code) => {
      if (code === 0 && fs.existsSync(`${target}.part`)) { fs.renameSync(`${target}.part`, target); resolve(true); } else {
        fs.rmSync(`${target}.part`, { force: true });
        resolve(false);
      }
    });
  });
}

async function pullFiles() {
  needWrangler();
  fs.mkdirSync(uploads, { recursive: true });
  const keys = fileKeys();
  const missing = keys.filter((k) => !fs.existsSync(path.join(uploads, path.basename(k))));
  console.log(`→ Tệp đính kèm: ${keys.length} tệp, cần tải ${missing.length} tệp từ R2 "${BUCKET}"…`);
  let done = 0; const failed = [];
  const queue = [...missing];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const k = queue.shift();
      if (!(await getObject(k))) failed.push(k);
      if (++done % 25 === 0 || done === missing.length) process.stdout.write(`\r  ${done}/${missing.length}`);
    }
  }));
  if (missing.length) process.stdout.write('\n');
  if (failed.length) {
    console.log(`⚠ ${failed.length} tệp không tải được (chạy lại lệnh với --files-only để thử tiếp):`);
    for (const k of failed.slice(0, 20)) console.log(`  - ${k}`);
  } else console.log('✓ Đã đủ tệp đính kèm');
}

// ----------------------------------------------------------------
if (!flag('--files-only')) importDump(opt('--dump') ? path.resolve(opt('--dump')) : exportD1());
else if (!fs.existsSync(dbFile)) fail(`Chưa có CSDL ${dbFile} — chạy không kèm --files-only trước.`);
if (!flag('--skip-files')) await pullFiles();
console.log('\nXong. Khởi động lại ứng dụng: docker compose up -d (hoặc ./start.sh).');
