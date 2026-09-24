#!/usr/bin/env node
/**
 * Provision + deploy LDL Workspace on Cloudflare (Workers + D1 + R2) using the wrangler login
 * already present on this machine (or CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID in CI).
 *
 *   node scripts/cf-setup.mjs            first deploy: creates a brand-new Worker, D1 and R2 bucket;
 *                                        stops if any of them already exists (never overwrites)
 *   node scripts/cf-setup.mjs --reuse    later deploys: update the existing Worker, keep all data
 *
 * Works on Windows, macOS and Linux (Node 22+).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tomlPath = path.join(root, 'wrangler.toml');
const reuse = process.argv.includes('--reuse');
const isWin = process.platform === 'win32';
// Run wrangler's JS entry with this Node binary: no shell, so arguments with spaces are safe on Windows.
// WRANGLER lets tests substitute a fake wrangler script.
const wranglerJs = process.env.WRANGLER || path.join(root, 'node_modules/wrangler/bin/wrangler.js');
if (!fs.existsSync(wranglerJs)) {
  console.error('Chưa cài wrangler. Chạy "npm ci" trong thư mục server trước.');
  process.exit(1);
}

function wrangler(args, { capture = false, allowFail = false, input } = {}) {
  const r = spawnSync(process.execPath, [wranglerJs, ...args], {
    cwd: root, encoding: 'utf8', input,
    stdio: capture ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit'],
  });
  if (r.status !== 0 && !allowFail) {
    if (capture) process.stderr.write(`${r.stdout || ''}${r.stderr || ''}`);
    fail(`Lệnh thất bại: wrangler ${args.join(' ')}`);
  }
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`, stdout: r.stdout || '' };
}

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

const step = (msg) => console.log(`\n==> ${msg}`);
const parseJson = (s) => JSON.parse(s.slice(s.search(/[[{]/)));

let toml = fs.readFileSync(tomlPath, 'utf8');
const field = (key) => toml.match(new RegExp(`^${key} = "(.*)"`, 'm'))?.[1];
const WORKER = field('name');
const DB_NAME = field('database_name');
const BUCKET = field('bucket_name');

// ------------------------------------------------------------------ account
step('Tài khoản Cloudflare');
const who = wrangler(['whoami'], { capture: true, allowFail: true });
if (!who.ok || /not authenticated|You are not/i.test(who.out)) {
  fail('Chưa đăng nhập Cloudflare. Chạy "npx wrangler login" (hoặc đặt CLOUDFLARE_API_TOKEN) rồi thử lại.');
}
console.log(who.out.split('\n').filter((l) => /logged in|account|│/i.test(l)).slice(0, 8).join('\n'));

// ------------------------------------------------------------------ safety: brand-new resources only
const listDbs = () => parseJson(wrangler(['d1', 'list', '--json'], { capture: true }).stdout);
const existingDb = listDbs().find((d) => d.name === DB_NAME);
const deployments = wrangler(['deployments', 'list', '--name', WORKER], { capture: true, allowFail: true });
const workerExists = deployments.ok;
if (!workerExists && !/does not exist|not found|10007/i.test(deployments.out)) {
  process.stderr.write(deployments.out);
  fail(`Không kiểm tra được Worker "${WORKER}" đã tồn tại hay chưa — dừng lại để an toàn.`);
}

if (!reuse && (existingDb || workerExists)) {
  fail([
    `Đã tồn tại ${[workerExists && `Worker "${WORKER}"`, existingDb && `D1 "${DB_NAME}"`].filter(Boolean).join(' và ')} trên tài khoản này.`,
    'Script dừng lại để không ghi đè lên tài nguyên đang có.',
    '  • Nếu đó chính là LDL Workspace đã deploy trước đây: chạy lại với --reuse để cập nhật.',
    '  • Nếu muốn tạo bản mới tách biệt: đổi "name", "database_name", "bucket_name" trong server/wrangler.toml.',
  ].join('\n'));
}
console.log(reuse ? `Chế độ cập nhật (--reuse): Worker "${WORKER}"` : `Tạo mới hoàn toàn: Worker "${WORKER}", D1 "${DB_NAME}", R2 "${BUCKET}"`);

// ------------------------------------------------------------------ D1
step(`D1 database: ${DB_NAME}`);
let db = existingDb;
if (!db) {
  wrangler(['d1', 'create', DB_NAME]);
  db = listDbs().find((d) => d.name === DB_NAME);
}
if (!db?.uuid) fail('Không lấy được database_id của D1');
toml = toml.replace(/^database_id = ".*"/m, `database_id = "${db.uuid}"`);
fs.writeFileSync(tomlPath, toml);
console.log(`database_id = ${db.uuid}`);

// ------------------------------------------------------------------ R2
step(`R2 bucket: ${BUCKET}`);
const r2 = wrangler(['r2', 'bucket', 'create', BUCKET], { capture: true, allowFail: true });
if (r2.ok) console.log('Đã tạo bucket');
else if (/already exists|10004/i.test(r2.out)) {
  if (!reuse) fail(`R2 bucket "${BUCKET}" đã tồn tại. Đổi "bucket_name" trong wrangler.toml hoặc chạy với --reuse.`);
  console.log('Bucket đã tồn tại — dùng lại');
} else {
  process.stderr.write(r2.out);
  fail('Không tạo được R2 bucket. Hãy bật R2 trong Cloudflare Dashboard (R2 Object Storage → Enable) rồi chạy lại.');
}

// ------------------------------------------------------------------ schema + data
step('Migrations');
wrangler(['d1', 'migrations', 'apply', 'DB', '--remote'], { input: 'y\n' });

step('Dữ liệu ban đầu');
const count = parseJson(wrangler(['d1', 'execute', 'DB', '--remote', '--json', '--command', 'SELECT COUNT(*) AS n FROM users'], { capture: true }).stdout);
const users = count[0].results[0].n;
if (users === 0) {
  const sqlFile = path.join(root, '.seed.sql');
  fs.writeFileSync(sqlFile, execFileSync(process.execPath, [path.join(root, 'src/seed.js'), '--sql'], { encoding: 'utf8' }));
  wrangler(['d1', 'execute', 'DB', '--remote', '--yes', '--file', sqlFile]);
  fs.rmSync(sqlFile, { force: true });
  console.log('Đã tạo dữ liệu mẫu (đăng nhập admin / 123456)');
} else {
  console.log(`Đã có ${users} người dùng — giữ nguyên dữ liệu`);
}

// ------------------------------------------------------------------ build + deploy
step('Build giao diện');
const npm = isWin ? 'npm.cmd' : 'npm';
const client = path.join(root, '../client');
for (const args of [['ci'], ['run', 'build']]) {
  const r = spawnSync(npm, args, { cwd: client, stdio: 'inherit', shell: isWin });
  if (r.status !== 0) fail(`npm ${args.join(' ')} (client) thất bại`);
}

step('Deploy Worker');
const dep = wrangler(['deploy'], { capture: true });
process.stdout.write(dep.out);
const url = dep.out.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
console.log(`\n✔ Hoàn tất${url ? `: ${url}` : ''}`);
console.log('  Đăng nhập admin / 123456 và đổi mật khẩu ngay.');
if (!reuse) console.log('  Lần deploy sau (cập nhật code, giữ dữ liệu): node scripts/cf-setup.mjs --reuse');
