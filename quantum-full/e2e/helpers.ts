import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

/** Lấy ADMIN_TOKEN từ .dev.vars (môi trường cục bộ) để đăng nhập không cần Cloudflare Access. */
export function adminToken(): string {
  const m = /^ADMIN_TOKEN=(.+)$/m.exec(readFileSync('.dev.vars', 'utf8'));
  return m ? m[1].trim() : '';
}

export async function login(page: Page) {
  const token = adminToken();
  await page.addInitScript((t) => localStorage.setItem('quantum.apiToken', t), token);
}

/** Lịch sử TỔNG HỢP chỉ dùng cho kiểm thử E2E trong D1 cục bộ riêng (.wrangler/e2e-state). */
export function syntheticCsv(count: number, seed = 1): string {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296);
  const lines = ['draw_code,draw_date,draw_time,numbers,special'];
  const start = Date.UTC(2024, 0, 1);
  for (let i = 0; i < count; i++) {
    const pool = Array.from({ length: 35 }, (_, k) => k + 1);
    for (let k = 0; k < 5; k++) {
      const j = k + Math.floor(rnd() * (35 - k));
      [pool[k], pool[j]] = [pool[j], pool[k]];
    }
    const main = pool.slice(0, 5).sort((a, b) => a - b);
    const date = new Date(start + Math.floor(i / 2) * 86400000).toISOString().slice(0, 10);
    lines.push(`E2E-${String(i + 1).padStart(4, '0')},${date},${i % 2 ? '21:00' : '13:00'},${main.join(' ')},${1 + Math.floor(rnd() * 12)}`);
  }
  return lines.join('\n');
}
