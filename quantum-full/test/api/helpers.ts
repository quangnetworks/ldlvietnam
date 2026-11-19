import { SELF } from 'cloudflare:test';
import type { GameRules } from '../../src/shared/game';
import { syntheticDraws } from '../fixtures';

export const ADMIN = 'test-admin-token-0123456789';
export const VIEWER = 'test-viewer-token-0123456789';

export interface ApiResponse<T = any> {
  status: number;
  body: T;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; token?: string | null; headers?: Record<string, string> } = {}): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const token = opts.token === undefined ? ADMIN : opts.token;
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await SELF.fetch(`https://quantum.test/api/v1${path}`, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** CSV từ lịch sử TỔNG HỢP (chỉ dùng trong test). */
export function syntheticCsv(rules: GameRules, count: number, seed: string): string {
  const draws = syntheticDraws(rules, count, seed);
  const lines = ['draw_code,draw_date,numbers,special'];
  for (const d of draws) lines.push(`${d.drawCode},${d.drawAt.slice(0, 10)},${d.main.join(' ')},${d.special ?? ''}`);
  return lines.join('\n');
}

export async function importAndVerify(game: 'lotto535' | 'power655', rules: GameRules, count: number, seed = 'api'): Promise<number[]> {
  const imp = await api('/admin/draws/import', { body: { game, format: 'csv', content: syntheticCsv(rules, count, seed), data_source_id: 2 } });
  if (imp.status !== 201) throw new Error(JSON.stringify(imp.body));
  const ids: number[] = [];
  for (let page = 1; ; page++) {
    const list = await api(`/draws?game=${game}&page_size=200&page=${page}&import_job_id=${imp.body.data.jobId}`);
    ids.push(...list.body.data.map((d: { id: number }) => d.id));
    if (page >= list.body.meta.total_pages) break;
  }
  for (let i = 0; i < ids.length; i += 500) {
    const v = await api('/admin/draws/verify-batch', { body: { ids: ids.slice(i, i + 500), note: 'test' } });
    if (v.status !== 200) throw new Error(JSON.stringify(v.body));
  }
  return ids;
}
