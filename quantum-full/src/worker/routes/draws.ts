import { Hono } from 'hono';
import { z } from 'zod';
import { validateDrawResult } from '../../engine/validation';
import { DRAW_SELECT, composeDrawAt, drawSourceHash, getDraw, mapDraw, type DrawRow } from '../db/draws';
import { getGame } from '../db/games';
import { actorFromContext, auditStatement } from '../lib/audit';
import { requireRole } from '../lib/auth';
import { ApiError, PaginationQuery, conflict, notFound, nowIso, pageMeta, parseId, parseJson, parseQuery, unprocessable } from '../lib/http';
import type { AppEnv } from '../lib/types';
import { importDraws, parseCsv, parseJsonPayload } from '../services/importer';
import { OPEN_SOURCE_NAME, SYNC_SOURCES, syncAll } from '../services/sync';
import { getSetting } from '../db/settings';

export const drawRoutes = new Hono<AppEnv>();

const ListQuery = PaginationQuery.extend({
  game: z.string().min(1),
  status: z.enum(['unverified', 'verified', 'rejected']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().max(32).optional(),
  import_job_id: z.coerce.number().int().positive().optional(),
});

drawRoutes.get('/draws', async (c) => {
  const q = parseQuery(c, ListQuery);
  const game = await getGame(c.env.DB, q.game);
  const where = ['d.game_id = ?'];
  const binds: unknown[] = [game.id];
  if (q.status) (where.push('d.verification_status = ?'), binds.push(q.status));
  if (q.from) (where.push('d.draw_date >= ?'), binds.push(q.from));
  if (q.to) (where.push('d.draw_date <= ?'), binds.push(q.to));
  if (q.q) (where.push('d.draw_code LIKE ?'), binds.push(`%${q.q}%`));
  if (q.import_job_id) (where.push('d.import_job_id = ?'), binds.push(q.import_job_id));
  const w = where.join(' AND ');
  const total = (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM draws d WHERE ${w}`).bind(...binds).first<{ n: number }>())!.n;
  const counts = await c.env.DB.prepare('SELECT verification_status AS s, COUNT(*) AS n FROM draws WHERE game_id = ? GROUP BY verification_status').bind(game.id).all<{ s: string; n: number }>();
  const { results } = await c.env.DB.prepare(`${DRAW_SELECT} WHERE ${w} ORDER BY d.draw_at DESC, d.draw_code DESC LIMIT ? OFFSET ?`)
    .bind(...binds, q.page_size, (q.page - 1) * q.page_size)
    .all<DrawRow>();
  return c.json({ data: results.map(mapDraw), meta: { ...pageMeta(q.page, q.page_size, total), statusCounts: Object.fromEntries(counts.results.map((r) => [r.s, r.n])) } });
});

drawRoutes.get('/draws/:id', async (c) => {
  const d = await getDraw(c.env.DB, parseId(c));
  if (!d) throw notFound('Kỳ quay');
  return c.json({ data: d });
});

drawRoutes.get('/data-sources', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM data_sources ORDER BY id').all();
  return c.json({ data: results });
});

const SourceCreate = z.object({
  name: z.string().min(2).max(100),
  kind: z.enum(['official', 'third_party', 'manual']),
  url: z.url().max(500).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

drawRoutes.post('/admin/data-sources', requireRole('admin'), async (c) => {
  const b = await parseJson(c, SourceCreate);
  const dup = await c.env.DB.prepare('SELECT id FROM data_sources WHERE name = ?').bind(b.name).first();
  if (dup) throw conflict('Tên nguồn dữ liệu đã tồn tại');
  const row = await c.env.DB.prepare('INSERT INTO data_sources (name, kind, url, notes) VALUES (?, ?, ?, ?) RETURNING *').bind(b.name, b.kind, b.url ?? null, b.notes ?? null).first<{ id: number }>();
  await auditStatement(c, { action: 'data_sources.create', entityType: 'data_source', entityId: row!.id, after: b }).run();
  return c.json({ data: row }, 201);
});

drawRoutes.get('/import-jobs', async (c) => {
  const q = parseQuery(c, PaginationQuery.extend({ game: z.string().optional() }));
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.game) {
    const g = await getGame(c.env.DB, q.game);
    where.push('j.game_id = ?');
    binds.push(g.id);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM import_jobs j ${w}`).bind(...binds).first<{ n: number }>())!.n;
  const { results } = await c.env.DB.prepare(
    `SELECT j.*, s.name AS source_name, s.kind AS source_kind, g.code AS game_code FROM import_jobs j JOIN data_sources s ON s.id = j.data_source_id JOIN games g ON g.id = j.game_id ${w} ORDER BY j.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, q.page_size, (q.page - 1) * q.page_size)
    .all<Record<string, unknown>>();
  return c.json({ data: results.map((r) => ({ ...r, errors: JSON.parse(String(r.errors_json)) })), meta: pageMeta(q.page, q.page_size, total) });
});

const ImportBody = z.object({
  game: z.string().min(1),
  format: z.enum(['csv', 'json']),
  content: z.string().min(1).max(2_000_000),
  data_source_id: z.number().int().positive(),
  source_url: z.url().max(500).nullable().optional(),
  retrieved_at: z.iso.datetime({ offset: true }).nullable().optional(),
});

drawRoutes.post('/admin/draws/import', requireRole('admin'), async (c) => {
  const b = await parseJson(c, ImportBody);
  const game = await getGame(c.env.DB, b.game);
  const src = await c.env.DB.prepare('SELECT id FROM data_sources WHERE id = ?').bind(b.data_source_id).first();
  if (!src) throw notFound('Nguồn dữ liệu');
  const parsed = b.format === 'csv' ? parseCsv(b.content) : { rows: parseJsonPayload(b.content), errors: [] };
  const result = await importDraws(actorFromContext(c), {
    game,
    dataSourceId: b.data_source_id,
    format: b.format,
    payload: b.content,
    rows: parsed.rows,
    parseErrors: parsed.errors,
    sourceUrl: b.source_url ?? null,
    retrievedAt: b.retrieved_at ?? nowIso(),
  });
  return c.json({ data: result }, result.inserted > 0 ? 201 : 200);
});

const ManualBody = z.object({
  game: z.string().min(1),
  draw_code: z.string().min(1).max(32),
  draw_date: z.string(),
  draw_time: z.string().nullable().optional(),
  main: z.array(z.number().int()),
  special: z.number().int().nullable().optional(),
  data_source_id: z.number().int().positive().optional(),
  source_url: z.url().max(500).nullable().optional(),
});

drawRoutes.post('/admin/draws', requireRole('admin'), async (c) => {
  const b = await parseJson(c, ManualBody);
  const game = await getGame(c.env.DB, b.game);
  const manual = await c.env.DB.prepare("SELECT id FROM data_sources WHERE kind = 'manual' ORDER BY id LIMIT 1").first<{ id: number }>();
  const sourceId = b.data_source_id ?? manual!.id;
  const result = await importDraws(actorFromContext(c), {
    game,
    dataSourceId: sourceId,
    format: 'manual',
    payload: JSON.stringify(b),
    rows: [{ draw_code: b.draw_code, draw_date: b.draw_date, draw_time: b.draw_time ?? null, main: b.main, special: b.special ?? null }],
    parseErrors: [],
    sourceUrl: b.source_url ?? null,
    retrievedAt: nowIso(),
  });
  if (result.inserted === 0) throw unprocessable(result.errors[0]?.message ?? 'Kỳ quay đã tồn tại', result);
  return c.json({ data: result }, 201);
});

const VerifyBody = z.object({ status: z.enum(['verified', 'rejected', 'unverified']), note: z.string().max(1000).optional() });

drawRoutes.post('/admin/draws/:id/verify', requireRole('admin'), async (c) => {
  const id = parseId(c);
  const b = await parseJson(c, VerifyBody);
  const before = await getDraw(c.env.DB, id);
  if (!before) throw notFound('Kỳ quay');
  if (before.verificationStatus === 'verified' && b.status !== 'verified' && !b.note) throw new ApiError(400, 'reason_required', 'Bỏ xác minh một kỳ đã xác minh cần ghi rõ lý do');
  const user = c.get('user');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE draws SET verification_status = ?, verified_at = ?, verified_by = ?, verification_note = ?, updated_at = ? WHERE id = ?').bind(
      b.status,
      b.status === 'verified' ? nowIso() : null,
      b.status === 'verified' ? user.id : null,
      b.note ?? null,
      nowIso(),
      id,
    ),
    auditStatement(c, { action: 'draws.verify', entityType: 'draw', entityId: id, before: { status: before.verificationStatus }, after: { status: b.status, note: b.note ?? null } }),
  ]);
  return c.json({ data: await getDraw(c.env.DB, id) });
});

const VerifyBatchBody = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500), note: z.string().max(1000).optional() });

drawRoutes.post('/admin/draws/verify-batch', requireRole('admin'), async (c) => {
  const b = await parseJson(c, VerifyBatchBody);
  const user = c.get('user');
  const ts = nowIso();
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < b.ids.length; i += 90) {
    const chunk = b.ids.slice(i, i + 90);
    stmts.push(
      c.env.DB.prepare(
        `UPDATE draws SET verification_status = 'verified', verified_at = ?, verified_by = ?, verification_note = ?, updated_at = ? WHERE verification_status = 'unverified' AND id IN (${chunk.map(() => '?').join(',')})`,
      ).bind(ts, user.id, b.note ?? null, ts, ...chunk),
    );
  }
  stmts.push(auditStatement(c, { action: 'draws.verify_batch', entityType: 'draw', after: { ids: b.ids, note: b.note ?? null } }));
  const res = await c.env.DB.batch(stmts);
  const updated = res.slice(0, -1).reduce((s, r) => s + (r.meta.changes ?? 0), 0);
  return c.json({ data: { requested: b.ids.length, verified: updated } });
});

const CorrectBody = z.object({
  main: z.array(z.number().int()),
  special: z.number().int().nullable().optional(),
  draw_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  draw_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  reason: z.string().min(10).max(2000),
});

/**
 * Quy trình điều chỉnh có kiểm soát: mở lại trạng thái (unverified), cập nhật nội dung, xoá kết quả chấm vé phát sinh
 * từ dữ liệu cũ, ghi audit trước/sau. Dự báo (recommendations) đã lưu KHÔNG bị thay đổi.
 */
drawRoutes.post('/admin/draws/:id/correct', requireRole('admin'), async (c) => {
  const id = parseId(c);
  const b = await parseJson(c, CorrectBody);
  const before = await getDraw(c.env.DB, id);
  if (!before) throw notFound('Kỳ quay');
  const game = await getGame(c.env.DB, before.gameId);
  const issues = validateDrawResult(game, { main: b.main, special: b.special ?? null });
  if (issues.length) throw unprocessable('Kết quả điều chỉnh không hợp lệ', issues);
  const main = [...b.main].sort((a, x) => a - x);
  const date = b.draw_date ?? before.drawDate;
  const time = b.draw_time === undefined ? before.drawTime : b.draw_time;
  const hash = await drawSourceHash(game.code, before.drawCode, date, time, main, b.special ?? null);
  const ts = nowIso();
  const affected = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM bankroll_ledger WHERE draw_id = ?').bind(id).first<{ n: number }>();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE draws SET verification_status = 'unverified', verified_at = NULL, verified_by = NULL, verification_note = ?, updated_at = ? WHERE id = ?").bind(`Điều chỉnh: ${b.reason}`, ts, id),
    c.env.DB.prepare('UPDATE draws SET draw_date = ?, draw_time = ?, draw_at = ?, special_number = ?, source_hash = ?, updated_at = ? WHERE id = ?').bind(date, time, composeDrawAt(date, time), b.special ?? null, hash, ts, id),
    c.env.DB.prepare('DELETE FROM draw_numbers WHERE draw_id = ?').bind(id),
    c.env.DB.prepare(`INSERT INTO draw_numbers (draw_id, position, number) VALUES ${main.map(() => '(?, ?, ?)').join(', ')}`).bind(...main.flatMap((n, i) => [id, i + 1, n])),
    c.env.DB.prepare('DELETE FROM ticket_results WHERE draw_id = ?').bind(id),
    c.env.DB.prepare("UPDATE portfolios SET status = CASE WHEN purchased_at IS NOT NULL THEN 'purchased' ELSE 'draft' END, updated_at = ? WHERE target_draw_id = ? AND status = 'evaluated'").bind(ts, id),
    auditStatement(c, { action: 'draws.correct', entityType: 'draw', entityId: id, before, after: { main, special: b.special ?? null, drawDate: date, drawTime: time, reason: b.reason, sourceHash: hash } }),
  ]);
  return c.json({ data: { draw: await getDraw(c.env.DB, id), ledgerEntriesAffected: affected?.n ?? 0, note: (affected?.n ?? 0) > 0 ? 'Sổ quỹ đã có bút toán liên quan kỳ này — cần lập bút toán điều chỉnh.' : null } });
});

// ───────────── Đồng bộ tự động từ nguồn dữ liệu mở ─────────────

drawRoutes.get('/sync/status', async (c) => {
  const ds = await c.env.DB.prepare('SELECT * FROM data_sources WHERE name = ?').bind(OPEN_SOURCE_NAME).first<{ id: number }>();
  const enabled = await getSetting<boolean>(c.env.DB, 'auto_sync_enabled', true);
  const jobs = ds
    ? (
        await c.env.DB.prepare(
          `SELECT j.id, j.status, j.inserted, j.duplicates, j.conflicts, j.invalid, j.created_at, j.created_by, g.code AS game_code,
            (SELECT COUNT(*) FROM draws d WHERE d.import_job_id = j.id AND d.verification_status = 'unverified') AS unverified
           FROM import_jobs j JOIN games g ON g.id = j.game_id WHERE j.data_source_id = ? ORDER BY j.id DESC LIMIT 20`,
        )
          .bind(ds.id)
          .all()
      ).results
    : [];
  const lastRun = await c.env.DB.prepare("SELECT created_at, actor, after_json FROM audit_logs WHERE action = 'draws.sync' ORDER BY id DESC LIMIT 1").first<{ created_at: string; actor: string; after_json: string }>();
  return c.json({
    data: {
      enabled,
      source: ds,
      sources: SYNC_SOURCES.map((s) => ({ game: s.gameCode, url: s.url })),
      schedule: 'Mỗi giờ (phút 05). Nguồn mở cập nhật khoảng 07:00 và 19:00 giờ Việt Nam',
      lastRun: lastRun ? { at: lastRun.created_at, actor: lastRun.actor, results: JSON.parse(lastRun.after_json) } : null,
      jobs,
      officialSourceNote: 'vietlott.vn chặn truy cập tự động (lớp chống bot). Hệ thống không vượt cơ chế này; dữ liệu đồng bộ là nguồn bên thứ ba và cần xác minh.',
    },
  });
});

drawRoutes.post('/admin/sync', requireRole('admin'), async (c) => {
  const b = await parseJson(c, z.object({ games: z.array(z.string()).optional() }));
  const r = await syncAll(actorFromContext(c), { force: true, games: b.games });
  return c.json({ data: r });
});

/** Xác minh toàn bộ kỳ CHƯA XÁC MINH của một lần nhập — quyết định có chủ đích của quản trị viên, có audit. */
drawRoutes.post('/admin/import-jobs/:id/verify', requireRole('admin'), async (c) => {
  const id = parseId(c);
  const b = await parseJson(c, z.object({ note: z.string().min(10).max(1000) }));
  const job = await c.env.DB.prepare('SELECT id FROM import_jobs WHERE id = ?').bind(id).first();
  if (!job) throw notFound('Lần nhập');
  const ts = nowIso();
  const res = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE draws SET verification_status = 'verified', verified_at = ?, verified_by = ?, verification_note = ?, updated_at = ? WHERE import_job_id = ? AND verification_status = 'unverified'").bind(
      ts,
      c.get('user').id,
      b.note,
      ts,
      id,
    ),
    auditStatement(c, { action: 'draws.verify_import_job', entityType: 'import_job', entityId: id, after: { note: b.note } }),
  ]);
  return c.json({ data: { importJobId: id, verified: res[0].meta.changes ?? 0 } });
});
