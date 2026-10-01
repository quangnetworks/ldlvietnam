#!/usr/bin/env node
/**
 * Đóng gói LDL Workspace thành tệp cài đặt cho máy chủ riêng (không cần Docker):
 *   npm run package            → release/ldl-workspace-<phiên bản>-<ngày>.tar.gz   (Linux / macOS, cần Node.js 22.5+)
 *   npm run package:windows    → release/ldl-workspace-<phiên bản>-<ngày>-windows.zip
 *                                kèm sẵn node.exe (Windows x64) — giải nén là chạy, kể cả Windows Server 2012 R2
 *   npm run package:windows -- --no-node   → …-windows-lite.zip (không kèm node.exe, tự đặt node\\node.exe sau)
 *
 * Gói gồm: giao diện đã build, mã server + migration, thư viện chạy (node_modules thuần JavaScript),
 * Dockerfile + docker-compose.yml, script chạy / sao lưu / nhập dữ liệu và SERVER.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.argv.includes('--windows');
const bundleNode = windows && !process.argv.includes('--no-node');   // --no-node: gói nhẹ, tự tải node.exe sau
const NODE_WIN = process.env.NODE_WIN_VERSION || 'v22.23.3';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { console.error(`✗ Lệnh thất bại: ${cmd} ${args.join(' ')}`); process.exit(1); }
};

const version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
const d = new Date(Date.now() + 7 * 3600e3);
const name = `ldl-workspace-${version}-${d.toISOString().slice(0, 10).replace(/-/g, '')}${windows ? (bundleNode ? '-windows' : '-windows-lite') : ''}`;
const outDir = path.join(repo, 'release');
const stage = path.join(outDir, 'ldl-workspace');
const copy = (from, to) => fs.cpSync(path.join(repo, from), path.join(stage, to ?? from), {
  recursive: true, filter: (src) => !/[\\/](node_modules|data|\.wrangler)([\\/]|$)/.test(path.relative(repo, src)),
});
/** Tệp .cmd / .ps1 phải xuống dòng kiểu Windows (CRLF) thì cmd.exe mới chạy đúng nhãn / goto. */
const toCrlf = (file) => fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n'));

console.log('→ Build giao diện…');
if (!fs.existsSync(path.join(repo, 'client/node_modules'))) run(npm, ['ci', '--no-audit', '--no-fund'], path.join(repo, 'client'));
run(npm, ['run', 'build'], path.join(repo, 'client'));

console.log('→ Chuẩn bị thư mục gói…');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
copy('client/dist');
for (const f of ['package.json', 'package-lock.json', 'wrangler.toml', 'src', 'migrations']) copy(`server/${f}`);
for (const f of ['backup.mjs', 'import-cloudflare.mjs']) copy(`server/scripts/${f}`);
// mã nguồn giao diện để build lại bằng Docker ngay trên máy chủ
for (const f of ['package.json', 'package-lock.json', 'index.html', 'vite.config.js', 'src', 'public']) {
  if (fs.existsSync(path.join(repo, 'client', f))) copy(`client/${f}`);
}
for (const f of ['Dockerfile', '.dockerignore', 'docker-compose.yml', '.env.example', 'SERVER.md', 'deploy/docker-entrypoint.sh', 'deploy/env.cmd', 'deploy/install-service.ps1']) copy(f);
for (const f of ['start.sh', 'backup.sh', 'ldl-workspace.service', 'start.cmd', 'run-service.cmd', 'backup.cmd', 'install-service.cmd', 'uninstall-service.cmd']) copy(`deploy/${f}`, f);
for (const f of ['start.cmd', 'run-service.cmd', 'backup.cmd', 'install-service.cmd', 'uninstall-service.cmd', 'deploy/env.cmd', 'deploy/install-service.ps1']) toCrlf(path.join(stage, f));
if (windows) toCrlf(path.join(stage, '.env.example'));

console.log('→ Cài thư viện chạy (bỏ công cụ phát triển)…');
run(npm, ['ci', '--omit=dev', '--no-audit', '--no-fund'], path.join(stage, 'server'));
fs.writeFileSync(path.join(stage, 'VERSION'), `${name}\n`);

if (bundleNode) {
  console.log(`→ Tải node.exe ${NODE_WIN} (Windows x64)…`);
  const base = `https://nodejs.org/dist/${NODE_WIN}`;
  const [exe, sums] = await Promise.all([
    fetch(`${base}/win-x64/node.exe`).then((r) => { if (!r.ok) throw new Error(`node.exe: HTTP ${r.status}`); return r.arrayBuffer(); }),
    fetch(`${base}/SHASUMS256.txt`).then((r) => r.text()),
  ]);
  const sha = crypto.createHash('sha256').update(Buffer.from(exe)).digest('hex');
  if (!sums.includes(`${sha}  win-x64/node.exe`)) { console.error('✗ Sai mã kiểm tra SHA-256 của node.exe'); process.exit(1); }
  fs.mkdirSync(path.join(stage, 'node'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'node', 'node.exe'), Buffer.from(exe));
}

if (windows && !bundleNode) {
  fs.mkdirSync(path.join(stage, 'node'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'node', 'TAI-NODE.txt'), `Tai node.exe (Windows 64-bit) tai:\r\nhttps://nodejs.org/dist/${NODE_WIN}/win-x64/node.exe\r\nroi dat vao thu muc nay (node\\node.exe).\r\n`);
}

console.log('→ Nén…');
const archive = path.join(outDir, `${name}${windows ? '.zip' : '.tar.gz'}`);
fs.rmSync(archive, { force: true });
if (windows) writeZip(stage, archive);
else run('tar', ['-czf', archive, '-C', outDir, 'ldl-workspace'], repo);
console.log(`\n✓ ${path.relative(repo, archive)} (${(fs.statSync(archive).size / 1048576).toFixed(1)} MB)`);
console.log('  Chép lên máy chủ, giải nén, rồi làm theo SERVER.md.');

/** Tạo .zip (Windows Server 2012 giải nén được bằng Explorer, không cần tar) — chỉ dùng thư viện có sẵn của Node. */
function writeZip(dir, file) {
  const top = path.basename(dir);
  const entries = [];
  const walk = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const a = path.join(abs, e.name); const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(a, r); else entries.push([a, r]);
    }
  };
  walk(dir, top);
  const fd = fs.openSync(file, 'w');
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const [abs, rel] of entries) {
    const data = fs.readFileSync(abs);
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const store = packed.length >= data.length;
    const body = store ? data : packed;
    const crc = zlib.crc32(data) >>> 0;
    const nameBuf = Buffer.from(rel, 'utf8');
    const head = (sig, extra) => {
      const b = Buffer.alloc(extra ? 46 : 30);
      let o = 0;
      b.writeUInt32LE(sig, o); o += 4;
      if (extra) { b.writeUInt16LE(20, o); o += 2; }
      b.writeUInt16LE(20, o); o += 2;                // version needed
      b.writeUInt16LE(0x0800, o); o += 2;            // UTF-8 names
      b.writeUInt16LE(store ? 0 : 8, o); o += 2;
      b.writeUInt16LE(dosTime, o); o += 2;
      b.writeUInt16LE(dosDate, o); o += 2;
      b.writeUInt32LE(crc, o); o += 4;
      b.writeUInt32LE(body.length, o); o += 4;
      b.writeUInt32LE(data.length, o); o += 4;
      b.writeUInt16LE(nameBuf.length, o); o += 2;
      b.writeUInt16LE(0, o); o += 2;                 // extra length
      if (extra) {
        b.writeUInt16LE(0, o); o += 2;               // comment
        b.writeUInt16LE(0, o); o += 2;               // disk
        b.writeUInt16LE(0, o); o += 2;               // internal attrs
        b.writeUInt32LE(0, o); o += 4;               // external attrs
        b.writeUInt32LE(offset, o); o += 4;
      }
      return b;
    };
    const local = head(0x04034b50, false);
    central.push(Buffer.concat([head(0x02014b50, true), nameBuf]));
    fs.writeSync(fd, local); fs.writeSync(fd, nameBuf); fs.writeSync(fd, body);
    offset += local.length + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeSync(fd, cd); fs.writeSync(fd, end);
  fs.closeSync(fd);
}
