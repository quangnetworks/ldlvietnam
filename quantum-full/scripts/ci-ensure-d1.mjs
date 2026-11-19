// CI: bảo đảm D1 "quantum-full-db" tồn tại và chèn database_id vào wrangler.jsonc CHỈ trong môi trường CI (không commit).
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const NAME = 'quantum-full-db';
const run = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const list = () => {
  const out = run('npx wrangler d1 list --json');
  return JSON.parse(out.slice(out.indexOf('[')));
};
let db = list().find((d) => d.name === NAME);
if (!db) {
  console.log(`Tạo D1 ${NAME}…`);
  run(`npx wrangler d1 create ${NAME}`);
  db = list().find((d) => d.name === NAME);
}
if (!db?.uuid) throw new Error('Không xác định được database_id của D1');
const cfg = readFileSync('wrangler.jsonc', 'utf8');
if (!cfg.includes('"database_name": "quantum-full-db",')) throw new Error('wrangler.jsonc không có database_name như mong đợi');
writeFileSync('wrangler.jsonc', cfg.replace('"database_name": "quantum-full-db",', `"database_name": "quantum-full-db",\n      "database_id": "${db.uuid}",`));
console.log(`D1 ${NAME}: ${db.uuid}`);
