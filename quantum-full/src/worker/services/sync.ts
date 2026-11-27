/**
 * Đồng bộ tự động kết quả quay từ nguồn dữ liệu MỞ (bên thứ ba).
 *
 * Bối cảnh: vietlott.vn đặt lớp chống bot (Cloudflare challenge, HTTP 403) cho mọi truy cập tự động, kể cả robots.txt.
 * Hệ thống KHÔNG giả mạo trình duyệt hay vượt cơ chế bảo vệ đó. Thay vào đó đọc kho dữ liệu mở
 * github.com/vietvudanh/vietlott-data (giấy phép MIT, cập nhật hằng ngày) — 1 request/file/lần chạy,
 * User-Agent định danh trung thực. Dữ liệu nhập ở trạng thái CHƯA XÁC MINH.
 */
import type { Game } from '../../shared/game';
import { composeDrawAt } from '../db/draws';
import { getGame } from '../db/games';
import { getSetting } from '../db/settings';
import { auditStatement, type ActorCtx } from '../lib/audit';
import { importDraws, type ImportError, type ImportResult, type RawDraw } from './importer';
import { syncBingo, type BingoSyncResult } from './bingoSync';
import { syncXskt, type XsktRegionSync } from './xsktSync';

export const OPEN_SOURCE_NAME = 'vietlott-data (GitHub, MIT)';
export const USER_AGENT = 'QuantumFull/1.0 (+https://quantum.vanquang.xyz; open-data sync)';
const RAW_BASE = 'https://raw.githubusercontent.com/vietvudanh/vietlott-data/master/data';
const MAX_BYTES = 8 * 1024 * 1024;

export interface SyncSource {
  gameCode: string;
  file: string;
  url: string;
  /** Giờ quay theo thứ tự trong cùng ngày (Lotto 5/35 quay 13:00 và 21:00). */
  timesPerDay: string[];
}

export const SYNC_SOURCES: SyncSource[] = [
  { gameCode: 'power655', file: 'power655.jsonl', url: `${RAW_BASE}/power655.jsonl`, timesPerDay: ['18:00'] },
  { gameCode: 'lotto535', file: 'power535.jsonl', url: `${RAW_BASE}/power535.jsonl`, timesPerDay: ['13:00', '21:00'] },
];

/**
 * Parse JSONL: {"date":"YYYY-MM-DD","id":"01426","result":[...K số chính, số đặc biệt]}.
 * Dòng hỏng không bị bỏ qua âm thầm — được trả về như lỗi để ghi vào import job.
 */
export function parseOpenDataJsonl(text: string, game: Pick<Game, 'mainPicks' | 'specialMode'>, timesPerDay: string[]): { rows: RawDraw[]; errors: ImportError[] } {
  const rows: (RawDraw & { line: number })[] = [];
  const errors: ImportError[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    let o: { date?: unknown; id?: unknown; result?: unknown };
    try {
      o = JSON.parse(line);
    } catch {
      errors.push({ row: i + 1, code: 'parse_error', message: 'Dòng JSON không hợp lệ' });
      return;
    }
    const res = Array.isArray(o.result) ? (o.result as unknown[]) : [];
    const nums = res.map((v) => (typeof v === 'number' && Number.isInteger(v) ? v : Number.NaN));
    const hasSpecial = game.specialMode !== 'none';
    rows.push({
      line: i + 1,
      draw_code: String(o.id ?? ''),
      draw_date: String(o.date ?? ''),
      draw_time: null,
      main: nums.slice(0, game.mainPicks),
      // Thiếu số đặc biệt ⇒ để undefined/null để bộ kiểm tra hợp lệ từ chối (không tự bịa).
      special: hasSpecial ? (nums.length > game.mainPicks ? nums[game.mainPicks] : null) : null,
    });
    if (nums.length !== game.mainPicks + (hasSpecial ? 1 : 0)) {
      errors.push({ row: i + 1, drawCode: String(o.id ?? ''), code: 'shape', message: `Kỳ ${String(o.id)} có ${nums.length} số, kỳ vọng ${game.mainPicks + (hasSpecial ? 1 : 0)}` });
      rows.pop();
    }
  });
  assignDrawTimes(rows, timesPerDay);
  return { rows: rows.map(({ line: _line, ...r }) => r), errors };
}

/**
 * Gán giờ quay theo mã kỳ (mã kỳ Vietlott tăng liên tiếp 1 đơn vị mỗi kỳ).
 * - Ngày đủ số kỳ theo lịch: gán theo thứ tự.
 * - Ngày CHƯA đủ kỳ (vd đồng bộ lúc 15:00 mới có kỳ 13:00, hoặc nguồn thiếu một kỳ): suy ra vị trí trong ngày từ kỳ cuối
 *   đã biết giờ của ngày trước: kỳ ngay sau kỳ 21:00 hôm trước là kỳ 13:00 hôm nay. Không suy ra được ⇒ để null (không đoán).
 */
export function assignDrawTimes(rows: RawDraw[], timesPerDay: string[]): void {
  const n = timesPerDay.length;
  const byDate = new Map<string, RawDraw[]>();
  for (const r of rows) byDate.set(r.draw_date, [...(byDate.get(r.draw_date) ?? []), r]);
  let prev: { code: number; slot: number } | null = null;
  for (const date of [...byDate.keys()].sort()) {
    const list = byDate.get(date)!.sort((a, b) => a.draw_code.localeCompare(b.draw_code, 'en', { numeric: true }));
    const codes = list.map((r) => Number(r.draw_code));
    const numeric = codes.every((c) => Number.isInteger(c));
    const consecutive = numeric && codes.every((c, i) => i === 0 || c === codes[i - 1] + 1);
    if (list.length === n) list.forEach((r, i) => (r.draw_time = timesPerDay[i]));
    else if (list.length < n && consecutive && prev) {
      // Mã kỳ đầu tiên của ngày nếu không thiếu kỳ nào = kỳ cuối đã biết + số kỳ còn lại của ngày đó + 1.
      const firstOfDay = prev.code + (n - 1 - prev.slot) + 1;
      const offset = codes[0] - firstOfDay;
      if (offset >= 0 && offset + list.length <= n) list.forEach((r, i) => (r.draw_time = timesPerDay[offset + i]));
    }
    const last = list[list.length - 1];
    const slot = last.draw_time ? timesPerDay.indexOf(last.draw_time) : -1;
    prev = numeric && slot >= 0 ? { code: codes[codes.length - 1], slot } : null;
  }
}

/**
 * Bổ sung giờ quay cho các kỳ đã lưu mà còn thiếu (draw_time NULL), khi nguồn nay suy ra được giờ.
 * Chỉ ĐIỀN giờ đang trống: không đổi số, ngày hay mã kỳ (trigger 0008 cho phép đúng thao tác này với kỳ đã xác minh).
 */
export async function fillMissingDrawTimes(actor: ActorCtx, gameId: number, rows: RawDraw[]): Promise<number> {
  const db = actor.db;
  const { results } = await db.prepare('SELECT id, draw_code, draw_date FROM draws WHERE game_id = ? AND draw_time IS NULL').bind(gameId).all<{ id: number; draw_code: string; draw_date: string }>();
  if (!results.length) return 0;
  const known = new Map(rows.filter((r) => r.draw_time).map((r) => [r.draw_code, r]));
  const fills = results.flatMap((d) => {
    const r = known.get(d.draw_code);
    return r && r.draw_date === d.draw_date ? [{ id: d.id, code: d.draw_code, date: d.draw_date, time: r.draw_time as string }] : [];
  });
  if (!fills.length) return 0;
  const ts = new Date().toISOString();
  await db.batch([
    ...fills.map((f) => db.prepare('UPDATE draws SET draw_time = ?, draw_at = ?, updated_at = ? WHERE id = ? AND draw_time IS NULL').bind(f.time, composeDrawAt(f.date, f.time), ts, f.id)),
    auditStatement(actor, { action: 'draws.fill_time', entityType: 'draw', after: fills.map((f) => ({ id: f.id, drawCode: f.code, drawDate: f.date, drawTime: f.time })) }),
  ]);
  return fills.length;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface SyncResult {
  game: string;
  sourceUrl: string;
  fetched: number;
  newRows: number;
  skippedExisting: number;
  import: ImportResult | null;
  error: string | null;
  /** Số kỳ đã lưu trước đó còn thiếu giờ quay, nay được bổ sung từ nguồn. */
  timesFilled?: number;
}

export async function syncGame(actor: ActorCtx, source: SyncSource, fetcher: Fetcher = fetch): Promise<SyncResult> {
  const db = actor.db;
  const game = await getGame(db, source.gameCode);
  const ds = await db.prepare('SELECT id FROM data_sources WHERE name = ?').bind(OPEN_SOURCE_NAME).first<{ id: number }>();
  if (!ds) throw new Error('Chưa đăng ký nguồn dữ liệu mở (migration 0003)');
  const base: SyncResult = { game: game.code, sourceUrl: source.url, fetched: 0, newRows: 0, skippedExisting: 0, import: null, error: null };
  let text: string;
  try {
    const res = await fetcher(source.url, { headers: { 'user-agent': USER_AGENT, accept: 'text/plain, application/x-ndjson, */*' }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { ...base, error: `Nguồn trả về HTTP ${res.status}` };
    text = await res.text();
    if (text.length > MAX_BYTES) return { ...base, error: 'Tệp nguồn vượt giới hạn kích thước' };
  } catch (e) {
    return { ...base, error: `Không tải được nguồn: ${(e as Error).message}` };
  }
  const parsed = parseOpenDataJsonl(text, game, source.timesPerDay);
  const { results } = await db.prepare('SELECT draw_code FROM draws WHERE game_id = ?').bind(game.id).all<{ draw_code: string }>();
  const existing = new Set(results.map((r) => r.draw_code));
  const timesFilled = await fillMissingDrawTimes(actor, game.id, parsed.rows);
  const fresh = parsed.rows.filter((r) => !existing.has(r.draw_code));
  const freshErrors = parsed.errors.filter((e) => !e.drawCode || !existing.has(e.drawCode));
  const out: SyncResult = { ...base, fetched: parsed.rows.length + parsed.errors.length, newRows: fresh.length, skippedExisting: parsed.rows.length - fresh.length, timesFilled };
  if (!fresh.length && !freshErrors.length) return out; // không có gì mới — không tạo import job rác
  // Chỉ ghi lỗi định dạng một lần: những kỳ lỗi đã báo ở lần đồng bộ trước sẽ không lặp lại.
  const reported = await db.prepare('SELECT errors_json FROM import_jobs WHERE data_source_id = ? AND game_id = ?').bind(ds.id, game.id).all<{ errors_json: string }>();
  // Khoá lỗi: mã kỳ nếu có, nếu không dùng số dòng (tệp nguồn chỉ ghi thêm vào cuối nên số dòng ổn định).
  const errKey = (e: ImportError) => (e.drawCode ? `code:${e.drawCode}` : `line:${e.row}:${e.code}`);
  const prev = new Set(reported.results.flatMap((j) => (JSON.parse(j.errors_json) as ImportError[]).map(errKey)));
  const newErrors = freshErrors.filter((e) => !prev.has(errKey(e)));
  const freshNotReported = fresh.filter((r) => !prev.has(`code:${r.draw_code}`));
  if (!freshNotReported.length && !newErrors.length) return { ...out, newRows: 0 };
  const imp = await importDraws(actor, {
    game,
    dataSourceId: ds.id,
    format: 'api',
    payload: text,
    rows: freshNotReported,
    parseErrors: newErrors,
    sourceUrl: source.url,
    retrievedAt: new Date().toISOString(),
  });
  return { ...out, newRows: freshNotReported.length, import: imp };
}

export async function syncAll(actor: ActorCtx, opts: { force?: boolean; games?: string[]; fetcher?: Fetcher } = {}): Promise<{ enabled: boolean; results: SyncResult[]; bingo18: BingoSyncResult | null; xskt: XsktRegionSync[] | null }> {
  const enabled = await getSetting<boolean>(actor.db, 'auto_sync_enabled', true);
  if (!enabled && !opts.force) return { enabled, results: [], bingo18: null, xskt: null };
  const results: SyncResult[] = [];
  for (const s of SYNC_SOURCES) {
    if (opts.games && !opts.games.includes(s.gameCode)) continue;
    try {
      results.push(await syncGame(actor, s, opts.fetcher));
    } catch (e) {
      results.push({ game: s.gameCode, sourceUrl: s.url, fetched: 0, newRows: 0, skippedExisting: 0, import: null, error: (e as Error).message });
    }
  }
  let bingo18: BingoSyncResult | null = null;
  if (!opts.games || opts.games.includes('bingo18')) bingo18 = await syncBingo(actor, opts.fetcher);
  let xskt: XsktRegionSync[] | null = null;
  if (!opts.games || opts.games.includes('xskt')) xskt = await syncXskt(actor, opts.fetcher);
  const summary: Record<string, unknown>[] = results.map((r) => ({ game: r.game, fetched: r.fetched, newRows: r.newRows, inserted: r.import?.inserted ?? 0, invalid: r.import?.invalid ?? 0, conflicts: r.import?.conflicts ?? 0, error: r.error }));
  if (bingo18) summary.push({ game: 'bingo18', fetched: bingo18.tail.fetched + bingo18.backfill.fetched, newRows: bingo18.tail.inserted + bingo18.backfill.inserted, inserted: bingo18.tail.inserted + bingo18.backfill.inserted, invalid: 0, conflicts: 0, error: bingo18.error, backfillDone: bingo18.backfill.done });
  for (const x of xskt ?? []) summary.push({ game: `xskt_${x.region}`, fetched: x.fetched, newRows: x.inserted, inserted: x.inserted, invalid: x.invalid, conflicts: 0, error: x.error, backfillDone: !x.backlog });
  await auditStatement(actor, { action: 'draws.sync', entityType: 'data_source', after: summary }).run();
  console.log(JSON.stringify({ level: 'info', msg: 'sync', actor: actor.actorId, results: results.map((r) => ({ game: r.game, newRows: r.newRows, inserted: r.import?.inserted ?? 0, error: r.error })) }));
  return { enabled, results, bingo18, xskt };
}
