import type { DrawRecord } from '../../engine/types';
import { sha256Hex } from '../lib/hash';

export interface DrawRow {
  id: number;
  game_id: number;
  draw_code: string;
  draw_date: string;
  draw_time: string | null;
  draw_at: string;
  special_number: number | null;
  data_source_id: number;
  import_job_id: number | null;
  verification_status: 'unverified' | 'verified' | 'rejected';
  source_hash: string;
  imported_at: string;
  verified_at: string | null;
  verified_by: string | null;
  verification_note: string | null;
  numbers: string | null;
  source_name?: string;
  source_kind?: string;
}

export interface DrawDto {
  id: number;
  gameId: number;
  drawCode: string;
  drawDate: string;
  drawTime: string | null;
  drawAt: string;
  main: number[];
  special: number | null;
  dataSourceId: number;
  sourceName: string | null;
  sourceKind: string | null;
  importJobId: number | null;
  verificationStatus: DrawRow['verification_status'];
  sourceHash: string;
  importedAt: string;
  verifiedAt: string | null;
  verifiedBy: string | null;
  verificationNote: string | null;
}

export const DRAW_SELECT = `SELECT d.*, s.name AS source_name, s.kind AS source_kind,
  (SELECT group_concat(number, ',') FROM (SELECT number FROM draw_numbers dn WHERE dn.draw_id = d.id ORDER BY position)) AS numbers
  FROM draws d JOIN data_sources s ON s.id = d.data_source_id`;

export function mapDraw(r: DrawRow): DrawDto {
  return {
    id: r.id,
    gameId: r.game_id,
    drawCode: r.draw_code,
    drawDate: r.draw_date,
    drawTime: r.draw_time,
    drawAt: r.draw_at,
    main: r.numbers ? r.numbers.split(',').map(Number) : [],
    special: r.special_number,
    dataSourceId: r.data_source_id,
    sourceName: r.source_name ?? null,
    sourceKind: r.source_kind ?? null,
    importJobId: r.import_job_id,
    verificationStatus: r.verification_status,
    sourceHash: r.source_hash,
    importedAt: r.imported_at,
    verifiedAt: r.verified_at,
    verifiedBy: r.verified_by,
    verificationNote: r.verification_note,
  };
}

export async function getDraw(db: D1Database, id: number): Promise<DrawDto | null> {
  const r = await db.prepare(`${DRAW_SELECT} WHERE d.id = ?`).bind(id).first<DrawRow>();
  return r ? mapDraw(r) : null;
}

export interface LoadOptions {
  includeUnverified?: boolean;
  /** Chỉ lấy các kỳ có thời điểm < before (chống look-ahead). */
  before?: string;
  from?: string;
  to?: string;
  /** Giới hạn N kỳ gần nhất. */
  last?: number;
}

/** Tải lịch sử kỳ quay cho engine (đã sắp xếp tăng dần theo thời gian). Luôn loại trừ dữ liệu bị từ chối. */
export async function loadDrawRecords(db: D1Database, gameId: number, opts: LoadOptions = {}): Promise<DrawRecord[]> {
  const where = ['d.game_id = ?'];
  const binds: unknown[] = [gameId];
  where.push(opts.includeUnverified ? "d.verification_status IN ('verified','unverified')" : "d.verification_status = 'verified'");
  if (opts.before) {
    where.push('d.draw_at < ?');
    binds.push(opts.before);
  }
  if (opts.from) {
    where.push('d.draw_date >= ?');
    binds.push(opts.from);
  }
  if (opts.to) {
    where.push('d.draw_date <= ?');
    binds.push(opts.to);
  }
  let sql = `SELECT d.id, d.draw_code, d.draw_at, d.special_number,
    (SELECT group_concat(number, ',') FROM (SELECT number FROM draw_numbers dn WHERE dn.draw_id = d.id ORDER BY position)) AS numbers
    FROM draws d WHERE ${where.join(' AND ')} ORDER BY d.draw_at DESC, d.draw_code DESC`;
  if (opts.last) {
    sql += ' LIMIT ?';
    binds.push(opts.last);
  }
  const { results } = await db.prepare(sql).bind(...binds).all<{ id: number; draw_code: string; draw_at: string; special_number: number | null; numbers: string | null }>();
  return results
    .reverse()
    .map((r) => ({ id: r.id, drawCode: r.draw_code, drawAt: r.draw_at, main: (r.numbers ?? '').split(',').filter(Boolean).map(Number).sort((a, b) => a - b), special: r.special_number }));
}

/** Hash tập dữ liệu dùng cho một lần chạy (kiểm toán khả năng tái lập). */
export async function datasetHash(draws: DrawRecord[]): Promise<string> {
  return sha256Hex(draws.map((d) => `${d.id}:${d.drawCode}:${d.drawAt}:${d.main.join('-')}:${d.special ?? ''}`).join('\n'));
}

/** Hash chuẩn hoá của một kết quả quay (nguồn gốc dữ liệu). */
export async function drawSourceHash(gameCode: string, drawCode: string, drawDate: string, drawTime: string | null, main: number[], special: number | null): Promise<string> {
  return sha256Hex(`${gameCode}|${drawCode}|${drawDate}|${drawTime ?? ''}|${[...main].sort((a, b) => a - b).join('-')}|${special ?? ''}`);
}

export function composeDrawAt(drawDate: string, drawTime: string | null): string {
  // Giờ Việt Nam (UTC+7). Không có giờ ⇒ 00:00 giờ VN.
  const t = drawTime ?? '00:00';
  return new Date(`${drawDate}T${t}:00+07:00`).toISOString();
}
