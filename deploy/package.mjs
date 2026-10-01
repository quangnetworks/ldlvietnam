#!/usr/bin/env node
/**
 * Đóng gói LDL Workspace thành một tệp cài đặt cho máy chủ riêng (không cần Docker):
 *   npm run package            → release/ldl-workspace-<phiên bản>-<ngày>.tar.gz
 *
 * Gói gồm: giao diện đã build, mã server + migration, thư viện chạy (node_modules, thuần JavaScript nên
 * dùng được trên Linux / Windows / macOS), Dockerfile + docker-compose.yml, script chạy / sao lưu / nhập dữ liệu
 * và SERVER.md. Máy chủ chỉ cần Node.js >= 22.5 (hoặc Docker).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { console.error(`✗ Lệnh thất bại: ${cmd} ${args.join(' ')}`); process.exit(1); }
};
const copy = (from, to) => fs.cpSync(path.join(repo, from), path.join(stage, to ?? from), {
  recursive: true, filter: (src) => !/[\\/](node_modules|data|\.wrangler)([\\/]|$)/.test(path.relative(repo, src)),
});

const version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
const d = new Date(Date.now() + 7 * 3600e3);
const name = `ldl-workspace-${version}-${d.toISOString().slice(0, 10).replace(/-/g, '')}`;
const outDir = path.join(repo, 'release');
const stage = path.join(outDir, 'ldl-workspace');

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
for (const f of ['Dockerfile', '.dockerignore', 'docker-compose.yml', '.env.example', 'SERVER.md', 'deploy/docker-entrypoint.sh']) copy(f);
for (const f of ['start.sh', 'start.cmd', 'backup.sh', 'ldl-workspace.service']) copy(`deploy/${f}`, f);

console.log('→ Cài thư viện chạy (bỏ công cụ phát triển)…');
run(npm, ['ci', '--omit=dev', '--no-audit', '--no-fund'], path.join(stage, 'server'));
fs.writeFileSync(path.join(stage, 'VERSION'), `${name}\n`);

console.log('→ Nén…');
const archive = path.join(outDir, `${name}.tar.gz`);
fs.rmSync(archive, { force: true });
run('tar', ['-czf', archive, '-C', outDir, 'ldl-workspace'], repo);
console.log(`\n✓ ${path.relative(repo, archive)} (${(fs.statSync(archive).size / 1048576).toFixed(1)} MB)`);
console.log('  Chép lên máy chủ, giải nén, rồi làm theo SERVER.md.');
