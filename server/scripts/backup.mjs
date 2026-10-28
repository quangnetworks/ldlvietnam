#!/usr/bin/env node
/**
 * Sao lưu LDL Workspace khi đang chạy: chụp CSDL (VACUUM INTO — an toàn khi ứng dụng vẫn ghi) + sao chép tệp đính kèm mới.
 *
 *   node scripts/backup.mjs [--data <thư mục dữ liệu>] [--out <thư mục sao lưu>] [--keep 14]
 *   Docker: docker compose exec ldl-workspace npm run -s backup
 *
 * Kết quả: <out>/app-YYYYMMDD-HHMM.db (giữ lại --keep bản mới nhất, mặc định 14) và <out>/uploads/ (cộng dồn).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const dataDir = path.resolve(opt('--data') || process.env.DATA_DIR || path.join(root, 'data'));
const outDir = path.resolve(opt('--out') || path.join(dataDir, 'backups'));
const keep = Math.max(1, Number(opt('--keep')) || 14);
const dbFile = process.env.DB_FILE || path.join(dataDir, 'app.db');
if (!fs.existsSync(dbFile)) { console.error(`Không thấy CSDL ${dbFile}`); process.exit(1); }

fs.mkdirSync(outDir, { recursive: true });
const p2 = (n) => String(n).padStart(2, '0');
const d = new Date(Date.now() + 7 * 3600e3);
const stamp = `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}-${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}`;
const target = path.join(outDir, `app-${stamp}.db`);
fs.rmSync(target, { force: true });

const db = new DatabaseSync(dbFile);
db.exec('PRAGMA busy_timeout = 10000');
db.prepare('VACUUM INTO ?').run(target);
db.close();
console.log(`✓ CSDL → ${target} (${(fs.statSync(target).size / 1048576).toFixed(1)} MB)`);

// tệp đính kèm: chỉ chép tệp chưa có (tên tệp là duy nhất, không bị sửa sau khi tải lên)
const src = path.join(dataDir, 'uploads');
const dst = path.join(outDir, 'uploads');
let copied = 0;
if (fs.existsSync(src) && path.resolve(src) !== path.resolve(dst)) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    if (fs.existsSync(path.join(dst, f))) continue;
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
    copied++;
  }
}
console.log(`✓ Tệp đính kèm: chép thêm ${copied} tệp → ${dst}`);

const old = fs.readdirSync(outDir).filter((f) => /^app-\d{8}-\d{4}\.db$/.test(f)).sort().slice(0, -keep);
for (const f of old) fs.rmSync(path.join(outDir, f));
if (old.length) console.log(`  Đã xoá ${old.length} bản cũ (giữ ${keep} bản mới nhất)`);
