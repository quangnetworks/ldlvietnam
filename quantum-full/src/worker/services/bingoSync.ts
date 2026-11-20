/**
 * Đồng bộ Bingo18 từ nguồn dữ liệu mở (bingo18.jsonl ~ 100k kỳ, > 13MB).
 * Dùng HTTP Range để chỉ tải phần cần thiết:
 *  - Phần đuôi (kỳ mới) mỗi lần chạy.
 *  - Tải dần lịch sử cũ theo từng đoạn ~400KB (con trỏ lưu trong app_settings.bingo18_sync).
 * Dữ liệu là nguồn bên thứ ba ⇒ lưu ở trạng thái CHƯA XÁC MINH.
 */
import { isValidResult, type BingoResult } from '../../engine/bingo18';
import { getAnyGame } from '../db/games';
import { getSetting } from '../db/settings';
import type { ActorCtx } from '../lib/audit';
import { sha256Hex } from '../lib/hash';
import { OPEN_SOURCE_NAME, USER_AGENT, type Fetcher } from './sync';

export const BINGO_URL = 'https://raw.githubusercontent.com/vietvudanh/vietlott-data/master/data/bingo18.jsonl';
const TAIL_BYTES = 131_072;
const BACKFILL_BYTES = 409_600;

export interface BingoRow {
  code: string;
  date: string;
  result: BingoResult;
}

export interface BingoChunk {
  rows: BingoRow[];
  invalid: { line: string; reason: string }[];
  /** Byte offset (trong tệp) của dòng hoàn chỉnh đầu tiên trong đoạn. */
  firstLineOffset: number;
  totalSize: number | null;
}

/** Parse một đoạn byte [start, …) của tệp JSONL; bỏ dòng đầu bị cắt dở khi start > 0. */
export function parseBingoChunk(bytes: Uint8Array, start: number, totalSize: number | null): BingoChunk {
  let skip = 0;
  if (start > 0) {
    const nl = bytes.indexOf(10);
    skip = nl < 0 ? bytes.length : nl + 1;
  }
  const text = new TextDecoder().decode(bytes.subarray(skip));
  const lines = text.split('\n');
  // Dòng cuối có thể bị cắt nếu đoạn không kết thúc ở cuối tệp — chỉ giữ khi kết thúc bằng '}'.
  const rows: BingoRow[] = [];
  const invalid: BingoChunk['invalid'] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.endsWith('}')) continue;
    try {
      const o = JSON.parse(line) as { id?: unknown; date?: unknown; result?: unknown; total?: unknown };
      const code = String(o.id ?? '');
      const date = String(o.date ?? '');
      if (!/^\d{1,12}$/.test(code) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !isValidResult(o.result)) {
        invalid.push({ line: line.slice(0, 120), reason: 'Sai định dạng hoặc số ngoài miền 1–6' });
        continue;
      }
      const r = o.result as BingoResult;
      if (o.total !== undefined && o.total !== r[0] + r[1] + r[2]) {
        invalid.push({ line: line.slice(0, 120), reason: 'Tổng không khớp các số' });
        continue;
      }
      rows.push({ code, date, result: [r[0], r[1], r[2]] });
    } catch {
      invalid.push({ line: line.slice(0, 120), reason: 'JSON không hợp lệ' });
    }
  }
  return { rows, invalid, firstLineOffset: start + skip, totalSize };
}

async function fetchRange(fetcher: Fetcher, range: string): Promise<{ bytes: Uint8Array; start: number; total: number | null }> {
  const res = await fetcher(BINGO_URL, { headers: { 'user-agent': USER_AGENT, range }, signal: AbortSignal.timeout(20_000) });
  if (res.status !== 206 && res.status !== 200) throw new Error(`Nguồn trả về HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (res.status === 200) return { bytes, start: 0, total: bytes.length };
  const m = /bytes (\d+)-(\d+)\/(\d+|\*)/.exec(res.headers.get('content-range') ?? '');
  return { bytes, start: m ? Number(m[1]) : 0, total: m && m[3] !== '*' ? Number(m[3]) : null };
}

const vnToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

async function storeRows(actor: ActorCtx, gameId: number, sourceId: number, rows: BingoRow[], invalid: BingoChunk['invalid'], label: string): Promise<{ jobId: number | null; inserted: number }> {
  const db = actor.db;
  const today = vnToday();
  const valid = rows.filter((r) => r.date <= today);
  if (!valid.length && !invalid.length) return { jobId: null, inserted: 0 };
  const payloadHash = await sha256Hex(valid.map((r) => `${r.code}|${r.date}|${r.result.join('')}`).join('\n'));
  const job = await db
    .prepare(
      `INSERT INTO import_jobs (game_id, data_source_id, format, status, source_url, retrieved_at, payload_hash, total_rows, inserted, duplicates, conflicts, invalid, errors_json, created_by)
       VALUES (?, ?, 'api', 'completed', ?, ?, ?, ?, 0, 0, 0, ?, ?, ?) RETURNING id`,
    )
    .bind(gameId, sourceId, `${BINGO_URL}#${label}`, new Date().toISOString(), payloadHash, valid.length + invalid.length, invalid.length, JSON.stringify(invalid.slice(0, 100).map((x, i) => ({ row: i + 1, code: 'invalid', message: `${x.reason}: ${x.line}` }))), actor.actorId)
    .first<{ id: number }>();
  const jobId = job!.id;
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < valid.length; i += 8) {
    const chunk = valid.slice(i, i + 8);
    const vals: unknown[] = [];
    for (const r of chunk) {
      const hash = await sha256Hex(`bingo18|${r.code}|${r.date}|${r.result.join('-')}`);
      vals.push(r.code, r.date, r.result[0], r.result[1], r.result[2], r.result[0] + r.result[1] + r.result[2], sourceId, jobId, hash);
    }
    stmts.push(
      db.prepare(`INSERT OR IGNORE INTO bingo18_draws (draw_code, draw_date, d1, d2, d3, total, data_source_id, import_job_id, source_hash) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`).bind(...vals),
    );
  }
  let inserted = 0;
  for (let i = 0; i < stmts.length; i += 200) {
    const res = await db.batch(stmts.slice(i, i + 200));
    inserted += res.reduce((s, r) => s + (r.meta.changes ?? 0), 0);
  }
  const duplicates = valid.length - inserted;
  await db
    .prepare('UPDATE import_jobs SET inserted = ?, duplicates = ?, status = ? WHERE id = ?')
    .bind(inserted, duplicates, invalid.length ? 'partial' : 'completed', jobId)
    .run();
  return { jobId, inserted };
}

export interface BingoSyncResult {
  game: 'bingo18';
  tail: { fetched: number; inserted: number; jobId: number | null };
  backfill: { fetched: number; inserted: number; jobId: number | null; done: boolean; remainingBytes: number | null };
  error: string | null;
}

export async function syncBingo(actor: ActorCtx, fetcher: Fetcher = fetch): Promise<BingoSyncResult> {
  const db = actor.db;
  const out: BingoSyncResult = { game: 'bingo18', tail: { fetched: 0, inserted: 0, jobId: null }, backfill: { fetched: 0, inserted: 0, jobId: null, done: false, remainingBytes: null }, error: null };
  try {
    const game = await getAnyGame(db, 'bingo18');
    const src = await db.prepare('SELECT id FROM data_sources WHERE name = ?').bind(OPEN_SOURCE_NAME).first<{ id: number }>();
    if (!src) throw new Error('Chưa đăng ký nguồn dữ liệu mở');
    const state = await getSetting<{ backfillEndByte: number | null; done: boolean }>(db, 'bingo18_sync', { backfillEndByte: null, done: false });
    // 1) Phần đuôi: kỳ mới nhất.
    const tail = await fetchRange(fetcher, `bytes=-${TAIL_BYTES}`);
    const tc = parseBingoChunk(tail.bytes, tail.start, tail.total);
    const maxRow = await db.prepare('SELECT MAX(CAST(draw_code AS INTEGER)) AS m FROM bingo18_draws').first<{ m: number | null }>();
    const fresh = maxRow?.m == null ? tc.rows : tc.rows.filter((r) => Number(r.code) > (maxRow.m as number));
    const tr = fresh.length ? await storeRows(actor, game.id, src.id, fresh, [], 'tail') : { jobId: null, inserted: 0 };
    out.tail = { fetched: tc.rows.length, inserted: tr.inserted, jobId: tr.jobId };
    // 2) Tải dần lịch sử cũ.
    let end = state.backfillEndByte ?? tc.firstLineOffset;
    let done = state.done || end <= 0;
    if (!done) {
      const start = Math.max(0, end - BACKFILL_BYTES);
      const chunk = await fetchRange(fetcher, `bytes=${start}-${end - 1}`);
      const bc = parseBingoChunk(chunk.bytes, chunk.start, chunk.total);
      const br = await storeRows(actor, game.id, src.id, bc.rows, bc.invalid, `bytes=${start}-${end - 1}`);
      end = bc.firstLineOffset;
      done = chunk.start === 0;
      out.backfill = { fetched: bc.rows.length, inserted: br.inserted, jobId: br.jobId, done, remainingBytes: done ? 0 : end };
    } else out.backfill = { fetched: 0, inserted: 0, jobId: null, done: true, remainingBytes: 0 };
    await db.prepare("UPDATE app_settings SET value_json = ?, updated_by = ?, updated_at = ? WHERE key = 'bingo18_sync'").bind(JSON.stringify({ backfillEndByte: end, done }), actor.actorId, new Date().toISOString()).run();
  } catch (e) {
    out.error = (e as Error).message;
  }
  return out;
}
