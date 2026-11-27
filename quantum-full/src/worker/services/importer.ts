/**
 * Nhập dữ liệu kết quả quay (CSV / JSON / nhập tay) có kiểm soát:
 * - Kiểm tra định dạng, miền số, trùng số, số đặc biệt theo cấu hình game.
 * - Mỗi kỳ có source_hash; kỳ đã tồn tại với nội dung khác ⇒ XUNG ĐỘT, không ghi đè.
 * - Ghi import_job (payload hash, nguồn, thời điểm truy xuất) + audit log.
 */
import type { Game } from '../../shared/game';
import { validateDrawResult } from '../../engine/validation';
import { auditStatement, type ActorCtx } from '../lib/audit';
import { sha256Hex } from '../lib/hash';
import { badRequest } from '../lib/http';
import { composeDrawAt, drawSourceHash } from '../db/draws';

export interface RawDraw {
  draw_code: string;
  draw_date: string;
  draw_time?: string | null;
  main: number[];
  special?: number | null;
}

export interface ImportError {
  row: number;
  drawCode?: string;
  code: string;
  message: string;
}

export const MAX_IMPORT_ROWS = 5000;

function parseNumberList(s: string): number[] {
  return s
    .split(/[\s,;\-|]+/)
    .filter(Boolean)
    .map((x) => (/^\d+$/.test(x) ? Number(x) : NaN));
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * CSV có header. Hỗ trợ 2 dạng:
 *  (a) draw_code,draw_date,draw_time,numbers,special  — numbers phân tách bằng khoảng trắng/gạch/chấm phẩy
 *  (b) draw_code,draw_date,draw_time,n1,n2,...,nK,special
 * draw_time và special là tuỳ chọn tuỳ game.
 */
export function parseCsv(text: string): { rows: RawDraw[]; errors: ImportError[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) throw badRequest('CSV cần dòng tiêu đề và ít nhất 1 dòng dữ liệu');
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (n: string) => header.indexOf(n);
  if (idx('draw_code') < 0 || idx('draw_date') < 0) throw badRequest('CSV thiếu cột draw_code hoặc draw_date');
  const nCols = header.map((h, i) => ({ h, i })).filter((x) => /^n\d+$/.test(x.h)).sort((a, b) => Number(a.h.slice(1)) - Number(b.h.slice(1)));
  if (idx('numbers') < 0 && nCols.length === 0) throw badRequest('CSV cần cột numbers hoặc các cột n1..nK');
  const rows: RawDraw[] = [];
  const errors: ImportError[] = [];
  lines.slice(1).forEach((line, li) => {
    const cells = splitCsvLine(line);
    const get = (n: string) => (idx(n) >= 0 ? cells[idx(n)] ?? '' : '');
    const main = idx('numbers') >= 0 ? parseNumberList(get('numbers')) : nCols.map((c) => (/^\d+$/.test(cells[c.i] ?? '') ? Number(cells[c.i]) : NaN));
    const sp = get('special');
    if (main.some((x) => Number.isNaN(x)) || (sp !== '' && !/^\d+$/.test(sp))) {
      errors.push({ row: li + 2, drawCode: get('draw_code'), code: 'parse_error', message: 'Giá trị số không hợp lệ' });
      return;
    }
    rows.push({ draw_code: get('draw_code'), draw_date: get('draw_date'), draw_time: get('draw_time') || null, main, special: sp === '' ? null : Number(sp) });
  });
  return { rows, errors };
}

export function parseJsonPayload(text: string): RawDraw[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw badRequest('JSON không hợp lệ');
  }
  const arr = Array.isArray(data) ? data : (data as { draws?: unknown }).draws;
  if (!Array.isArray(arr)) throw badRequest('JSON phải là mảng kết quả hoặc { "draws": [...] }');
  return arr.map((x) => {
    const o = x as Record<string, unknown>;
    return {
      draw_code: String(o.draw_code ?? o.drawCode ?? ''),
      draw_date: String(o.draw_date ?? o.drawDate ?? ''),
      draw_time: (o.draw_time ?? o.drawTime ?? null) as string | null,
      main: Array.isArray(o.main ?? o.numbers) ? ((o.main ?? o.numbers) as unknown[]).map((v) => (typeof v === 'number' ? v : Number.NaN)) : [],
      special: o.special === undefined || o.special === null ? null : typeof o.special === 'number' ? o.special : Number.NaN,
    };
  });
}

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export interface ImportRequest {
  game: Game;
  dataSourceId: number;
  format: 'csv' | 'json' | 'manual' | 'api';
  payload: string;
  rows: RawDraw[];
  parseErrors: ImportError[];
  sourceUrl: string | null;
  retrievedAt: string | null;
}

export interface ImportResult {
  jobId: number;
  status: 'completed' | 'partial' | 'failed';
  totalRows: number;
  inserted: number;
  duplicates: number;
  conflicts: number;
  invalid: number;
  errors: ImportError[];
  payloadHash: string;
}

export async function importDraws(actor: ActorCtx, req: ImportRequest): Promise<ImportResult> {
  const db = actor.db;
  const { game } = req;
  if (req.rows.length + req.parseErrors.length > MAX_IMPORT_ROWS) throw badRequest(`Tối đa ${MAX_IMPORT_ROWS} dòng mỗi lần nhập`);
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const errors: ImportError[] = [...req.parseErrors];
  const valid: (RawDraw & { hash: string; drawAt: string; row: number })[] = [];
  const seenCodes = new Set<string>();
  for (let i = 0; i < req.rows.length; i++) {
    const r = req.rows[i];
    const row = req.format === 'csv' ? i + 2 : i + 1;
    const code = (r.draw_code ?? '').trim();
    const issues: ImportError[] = [];
    if (!code || code.length > 32 || !/^[\w.\-/]+$/.test(code)) issues.push({ row, drawCode: code, code: 'draw_code', message: 'Mã kỳ quay không hợp lệ' });
    if (!validDate(r.draw_date)) issues.push({ row, drawCode: code, code: 'draw_date', message: `Ngày quay "${r.draw_date}" không hợp lệ (YYYY-MM-DD)` });
    else if (r.draw_date > today) issues.push({ row, drawCode: code, code: 'future_date', message: 'Ngày quay ở tương lai, không nhận kết quả chưa diễn ra' });
    if (r.draw_time != null && r.draw_time !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.draw_time)) issues.push({ row, drawCode: code, code: 'draw_time', message: 'Giờ quay phải dạng HH:MM' });
    for (const v of validateDrawResult(game, { main: r.main, special: r.special ?? null })) issues.push({ row, drawCode: code, code: v.code, message: v.message });
    if (seenCodes.has(code)) issues.push({ row, drawCode: code, code: 'duplicate_in_payload', message: 'Mã kỳ bị lặp trong dữ liệu nhập' });
    seenCodes.add(code);
    if (issues.length) {
      errors.push(...issues);
      continue;
    }
    const main = [...r.main].sort((a, b) => a - b);
    const time = r.draw_time || null;
    valid.push({ ...r, draw_code: code, draw_time: time, main, row, hash: await drawSourceHash(game.code, code, r.draw_date, time, main, r.special ?? null), drawAt: composeDrawAt(r.draw_date, time) });
  }
  // So khớp với dữ liệu đã có.
  const existing = new Map<string, { id: number; source_hash: string; verification_status: string }>();
  for (let i = 0; i < valid.length; i += 90) {
    const chunk = valid.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT id, draw_code, source_hash, verification_status FROM draws WHERE game_id = ? AND draw_code IN (${chunk.map(() => '?').join(',')})`)
      .bind(game.id, ...chunk.map((v) => v.draw_code))
      .all<{ id: number; draw_code: string; source_hash: string; verification_status: string }>();
    for (const r of results) existing.set(r.draw_code, r);
  }
  let duplicates = 0;
  let conflicts = 0;
  const toInsert = valid.filter((v) => {
    const ex = existing.get(v.draw_code);
    if (!ex) return true;
    if (ex.source_hash === v.hash) duplicates++;
    else {
      conflicts++;
      errors.push({ row: v.row, drawCode: v.draw_code, code: 'conflict', message: `Kỳ ${v.draw_code} đã tồn tại (trạng thái ${ex.verification_status}) với nội dung khác, không ghi đè. Dùng quy trình điều chỉnh có audit nếu cần sửa.` });
    }
    return false;
  });
  const invalid = errors.filter((e) => e.code !== 'conflict').length;
  const totalRows = req.rows.length + req.parseErrors.length;
  const status: ImportResult['status'] = toInsert.length === 0 && (invalid > 0 || conflicts > 0) ? 'failed' : invalid > 0 || conflicts > 0 ? 'partial' : 'completed';
  const payloadHash = await sha256Hex(req.payload);
  const job = await db
    .prepare(
      `INSERT INTO import_jobs (game_id, data_source_id, format, status, source_url, retrieved_at, payload_hash, total_rows, inserted, duplicates, conflicts, invalid, errors_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(game.id, req.dataSourceId, req.format, status, req.sourceUrl, req.retrievedAt, payloadHash, totalRows, toInsert.length, duplicates, conflicts, invalid, JSON.stringify(errors.slice(0, 500)), actor.actorId)
    .first<{ id: number }>();
  const jobId = job!.id;
  const stmts: D1PreparedStatement[] = [];
  for (const v of toInsert) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO draws (game_id, draw_code, draw_date, draw_time, draw_at, special_number, data_source_id, import_job_id, verification_status, source_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unverified', ?)`,
        )
        .bind(game.id, v.draw_code, v.draw_date, v.draw_time, v.drawAt, v.special ?? null, req.dataSourceId, jobId, v.hash),
    );
    stmts.push(
      db
        .prepare(`INSERT INTO draw_numbers (draw_id, position, number) VALUES ${v.main.map(() => '((SELECT id FROM draws WHERE game_id = ? AND draw_code = ?), ?, ?)').join(', ')}`)
        .bind(...v.main.flatMap((n, i) => [game.id, v.draw_code, i + 1, n])),
    );
  }
  stmts.push(
    auditStatement(actor, {
      action: 'draws.import',
      entityType: 'import_job',
      entityId: jobId,
      after: { game: game.code, format: req.format, dataSourceId: req.dataSourceId, totalRows, inserted: toInsert.length, duplicates, conflicts, invalid, payloadHash },
    }),
  );
  // Lô chẵn để cặp (draws, draw_numbers) của mỗi kỳ luôn nằm cùng một batch (nguyên tử).
  for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400));
  return { jobId, status, totalRows, inserted: toInsert.length, duplicates, conflicts, invalid, errors, payloadHash };
}
