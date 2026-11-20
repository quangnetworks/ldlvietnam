#!/usr/bin/env node
// Cài đặt QUANTUM FULL chạy cục bộ (Windows / macOS / Linux) — một lệnh: npm run setup:local
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const run = (cmd) => execSync(cmd, { stdio: 'inherit', shell: true });
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(`Cần Node.js ≥ 22 (đang dùng ${process.versions.node}). Tải tại https://nodejs.org`);
  process.exit(1);
}
console.log('1/3 Tạo .dev.vars (cấu hình cục bộ, không commit)…');
if (!existsSync('.dev.vars')) {
  copyFileSync('.dev.vars.example', '.dev.vars');
  const token = randomBytes(32).toString('hex');
  writeFileSync('.dev.vars', readFileSync('.dev.vars', 'utf8').replace('change-me-local-admin-token', token));
  console.log('   Đã tạo .dev.vars với ALLOW_DEV_AUTH=true (chỉ dùng trên máy này).');
} else console.log('   .dev.vars đã tồn tại — giữ nguyên.');
console.log('2/3 Áp migration vào D1 cục bộ (.wrangler/state)…');
run('npx wrangler d1 migrations apply quantum-full-db --local');
console.log('3/3 Xong. Chạy: npm run dev  →  mở http://localhost:5190');
console.log('    Lần đầu: Data Center → Đồng bộ tự động → “Đồng bộ ngay” để tải dữ liệu thật từ nguồn mở.');
