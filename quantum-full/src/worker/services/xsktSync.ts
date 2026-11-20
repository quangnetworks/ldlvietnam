/**
 * Đồng bộ kết quả XSKT 3 miền từ nguồn dữ liệu mở (GitHub, giấy phép MIT).
 * - Lần đầu: tải toàn bộ tệp CSV, nhập dần theo lô (cắt ở RANH GIỚI NGÀY để không bỏ sót đài cùng ngày).
 * - Các lần sau: chỉ tải phần đuôi tệp bằng HTTP Range; nếu phần đuôi không phủ hết khoảng trống ⇒ tải toàn bộ.
 * Dữ liệu bên thứ ba ⇒ lưu trạng thái CHƯA XÁC MINH. Chạy lại không tạo bản ghi trùng (UNIQUE + INSERT OR IGNORE).
 */
import { slotDigits, type Region } from '../../engine/xskt';
import { getSetting } from '../db/settings';
import type { ActorCtx } from '../lib/audit';
import { sha256Hex } from '../lib/hash';
import { USER_AGENT, type Fetcher } from './sync';

export interface XsktSource {
  region: Region;
  url: string;
  sourceName: string;
  kind: 'mb_wide' | 'south';
}

export const XSKT_SOURCES: XsktSource[] = [
  { region: 'mb', url: 'https://raw.githubusercontent.com/khiemdoan/vietnam-lottery-xsmb-analysis/main/data/xsmb.csv', sourceName: 'vietnam-lottery-xsmb-analysis (GitHub, MIT)', kind: 'mb_wide' },
  { region: 'mt', url: 'https://raw.githubusercontent.com/tuanseo5t-alt/xosomn-xosomt/main/data/xsmt/xsmt.csv', sourceName: 'xosomn-xosomt (GitHub, MIT)', kind: 'south' },
  { region: 'mn', url: 'https://raw.githubusercontent.com/tuanseo5t-alt/xosomn-xosomt/main/data/xsmn/xsmn.csv', sourceName: 'xosomn-xosomt (GitHub, MIT)', kind: 'south' },
];

/** Số dòng tối đa nhập mỗi lần chạy (lần đầu nhập dần qua nhiều lần đồng bộ). */
export const XSKT_MAX_ROWS_PER_RUN = 3000;
const TAIL_BYTES = 262_144;
export const MB_STATION = 'Miền Bắc';

export interface XsktRow {
  station: string;
  date: string;
  numbers: string[];
}

/** Parse CSV có trường đặt trong ngoặc kép (RFC 4180). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Chuyển các dòng CSV thành kỳ quay chuẩn hoá. `header` = null khi đoạn dữ liệu là phần đuôi (không có dòng tiêu đề).
 * Miền Bắc: tệp nguồn làm mất số 0 ở đầu ⇒ bổ sung theo độ dài chuẩn của từng giải.
 */
export function normalizeRows(src: XsktSource, rows: string[][]): { rows: XsktRow[]; invalid: { line: string; reason: string }[] } {
  const out: XsktRow[] = [];
  const invalid: { line: string; reason: string }[] = [];
  const digits = slotDigits(src.region);
  for (const r of rows) {
    if (!r.length || (r.length === 1 && r[0].trim() === '')) continue;
    if (r[0] === 'date') continue; // dòng tiêu đề
    const line = r.join(',').slice(0, 160);
    if (!DATE.test(r[0])) {
      invalid.push({ line, reason: 'Ngày không hợp lệ' });
      continue;
    }
    if (src.kind === 'mb_wide') {
      const vals = r.slice(1).map((s) => s.trim());
      if (vals.length !== digits.length || vals.some((v) => !/^\d+$/.test(v))) {
        invalid.push({ line, reason: `Cần ${digits.length} số` });
        continue;
      }
      const nums = vals.map((v, i) => (v.length <= digits[i] ? v.padStart(digits[i], '0') : ''));
      if (nums.some((n) => !n)) {
        invalid.push({ line, reason: 'Số dài hơn độ dài chuẩn của giải' });
        continue;
      }
      out.push({ station: MB_STATION, date: r[0], numbers: nums });
    } else {
      const station = (r[1] ?? '').trim();
      const nums = r.slice(2).flatMap((s) => s.split(',').map((x) => x.trim()).filter(Boolean));
      if (!station || station.length > 64) {
        invalid.push({ line, reason: 'Thiếu tên đài' });
        continue;
      }
      if (nums.length !== digits.length || nums.some((n) => !/^\d+$/.test(n))) {
        invalid.push({ line, reason: `Cần ${digits.length} số` });
        continue;
      }
      // Giải đặc biệt thời kỳ cũ có thể 5 chữ số; các giải khác phải đúng độ dài chuẩn.
      const okLen = nums.every((n, i) => (i === 0 ? n.length >= 5 && n.length <= 6 : n.length === digits[i]));
      if (!okLen) {
        invalid.push({ line, reason: 'Độ dài số không khớp cơ cấu giải' });
        continue;
      }
      out.push({ station, date: r[0], numbers: nums });
    }
  }
  return { rows: out, invalid };
}

/** Lấy các dòng có ngày ≥ `from`, tối đa `limit` dòng nhưng KHÔNG cắt giữa một ngày. */
export function takeBatch(rows: XsktRow[], from: string | null, limit: number): XsktRow[] {
  const sorted = rows.filter((r) => !from || r.date >= from).sort((a, b) => a.date.localeCompare(b.date) || a.station.localeCompare(b.station));
  if (sorted.length <= limit) return sorted;
  let end = limit;
  while (end < sorted.length && sorted[end].date === sorted[end - 1].date) end++;
  return sorted.slice(0, end);
}

async function fetchText(fetcher: Fetcher, url: string, range?: string): Promise<{ text: string; partial: boolean; start: number }> {
  const headers: Record<string, string> = { 'user-agent': USER_AGENT };
  if (range) headers.range = range;
  const res = await fetcher(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (res.status !== 200 && res.status !== 206) throw new Error(`Nguồn trả về HTTP ${res.status}`);
  const text = await res.text();
  const m = /bytes (\d+)-/.exec(res.headers.get('content-range') ?? '');
  return { text, partial: res.status === 206, start: m ? Number(m[1]) : 0 };
}

async function fetchSize(fetcher: Fetcher, url: string): Promise<number | null> {
  const res = await fetcher(url, { headers: { 'user-agent': USER_AGENT, range: 'bytes=0-0' }, signal: AbortSignal.timeout(20_000) });
  await res.arrayBuffer();
  const m = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '');
  return m ? Number(m[1]) : null;
}

export interface XsktRegionSync {
  region: Region;
  mode: 'tail' | 'full' | 'none';
  fetched: number;
  inserted: number;
  invalid: number;
  latestDate: string | null;
  backlog: boolean;
  error: string | null;
}

async function insertRows(actor: ActorCtx, region: Region, sourceId: number, rows: XsktRow[]): Promise<number> {
  const db = actor.db;
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += 10) {
    const chunk = rows.slice(i, i + 10);
    const vals: unknown[] = [];
    for (const r of chunk) {
      const hash = await sha256Hex(`xskt|${region}|${r.station}|${r.date}|${r.numbers.join('-')}`);
      vals.push(region, r.station, r.date, r.numbers[0], JSON.stringify(r.numbers), sourceId, hash);
    }
    stmts.push(db.prepare(`INSERT OR IGNORE INTO xskt_draws (region, station, draw_date, special, numbers_json, data_source_id, source_hash) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}`).bind(...vals));
  }
  let inserted = 0;
  for (let i = 0; i < stmts.length; i += 100) {
    const res = await db.batch(stmts.slice(i, i + 100));
    inserted += res.reduce((s, r) => s + (r.meta.changes ?? 0), 0);
  }
  return inserted;
}

const vnToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

export async function syncXsktRegion(actor: ActorCtx, src: XsktSource, fetcher: Fetcher = fetch): Promise<XsktRegionSync> {
  const db = actor.db;
  const out: XsktRegionSync = { region: src.region, mode: 'none', fetched: 0, inserted: 0, invalid: 0, latestDate: null, backlog: false, error: null };
  try {
    const ds = await db.prepare('SELECT id FROM data_sources WHERE name = ?').bind(src.sourceName).first<{ id: number }>();
    if (!ds) throw new Error('Chưa đăng ký nguồn dữ liệu XSKT');
    const max = await db.prepare('SELECT MAX(draw_date) AS d FROM xskt_draws WHERE region = ?').bind(src.region).first<{ d: string | null }>();
    const latest = max?.d ?? null;
    let parsed: ReturnType<typeof normalizeRows> | null = null;
    if (latest) {
      // Phần đuôi: bỏ dòng đầu (có thể bị cắt dở).
      const size = await fetchSize(fetcher, src.url);
      if (size != null && size > TAIL_BYTES) {
        const tail = await fetchText(fetcher, src.url, `bytes=${size - TAIL_BYTES}-${size - 1}`);
        const body = tail.partial && tail.start > 0 ? tail.text.slice(tail.text.indexOf('\n') + 1) : tail.text;
        const p = normalizeRows(src, parseCsv(body));
        const earliest = p.rows.reduce<string | null>((m, r) => (!m || r.date < m ? r.date : m), null);
        if (earliest && earliest <= latest) {
          parsed = p;
          out.mode = 'tail';
        }
      }
    }
    if (!parsed) {
      const full = await fetchText(fetcher, src.url);
      parsed = normalizeRows(src, parseCsv(full.text));
      out.mode = 'full';
    }
    const today = vnToday();
    const usable = parsed.rows.filter((r) => r.date <= today);
    out.fetched = usable.length;
    out.invalid = parsed.invalid.length;
    const batch = takeBatch(usable, latest, XSKT_MAX_ROWS_PER_RUN);
    out.backlog = batch.length < usable.filter((r) => !latest || r.date >= latest).length;
    out.inserted = batch.length ? await insertRows(actor, src.region, ds.id, batch) : 0;
    const now = await db.prepare('SELECT MAX(draw_date) AS d FROM xskt_draws WHERE region = ?').bind(src.region).first<{ d: string | null }>();
    out.latestDate = now?.d ?? null;
  } catch (e) {
    out.error = (e as Error).message;
  }
  return out;
}

export async function syncXskt(actor: ActorCtx, fetcher: Fetcher = fetch, regions?: Region[]): Promise<XsktRegionSync[]> {
  const results: XsktRegionSync[] = [];
  for (const s of XSKT_SOURCES) {
    if (regions && !regions.includes(s.region)) continue;
    results.push(await syncXsktRegion(actor, s, fetcher));
  }
  const state = await getSetting<Record<string, unknown>>(actor.db, 'xskt_sync', {});
  const next = { ...state, lastRunAt: new Date().toISOString(), results: results.map((r) => ({ region: r.region, mode: r.mode, inserted: r.inserted, latestDate: r.latestDate, backlog: r.backlog, error: r.error })) };
  await actor.db
    .prepare("INSERT INTO app_settings (key, value_json, description, updated_by, updated_at) VALUES ('xskt_sync', ?, 'Trạng thái đồng bộ XSKT 3 miền', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
    .bind(JSON.stringify(next), actor.actorId, new Date().toISOString())
    .run();
  return results;
}

