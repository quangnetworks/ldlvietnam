// Tạo bản cấu hình không gắn tên miền riêng (chỉ workers.dev) — dùng khi gắn temp.vanquang.xyz thất bại.
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const json = JSON.parse(src.replace(/^\s*\/\/.*$/gm, ''));
delete json.routes;
delete json.$schema;
fs.writeFileSync(new URL('../wrangler.workersdev.json', import.meta.url), JSON.stringify(json, null, 2));
console.log('wrote wrangler.workersdev.json');
