import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { BINGO_STAKE, betLabel, validateBet, type BingoBet, type BingoResult } from '../../engine/bingo18';
import { bingoSchedule, isBingoDrawTime, livePlan, prizeFor, type LiveConfig, type LiveRound } from '../../engine/bingoLive';
import { vnClock } from '../../engine/decision';
import { getAnyGame } from '../db/games';
import { getSetting } from '../db/settings';
import { auditStatement } from '../lib/audit';
import { ApiError, conflict, notFound, nowIso, parseId, parseJson } from '../lib/http';
import type { AppEnv } from '../lib/types';

export const bingoLiveRoutes = new Hono<AppEnv>();

interface SessionRow {
  id: number;
  status: 'open' | 'closed';
  bet_json: string;
  base_units: number;
  budget: number;
  take_profit: number | null;
  max_minutes: number;
  session_date: string;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
}

const BetSchema = z.object({ type: z.enum(['single', 'pair', 'triple', 'any_triple', 'sum', 'big', 'small', 'draw']), value: z.number().int().optional() });

async function spentToday(db: D1Database, date: string): Promise<number> {
  const game = await getAnyGame(db, 'bingo18');
  const r = await db.prepare("SELECT COALESCE(SUM(-amount), 0) AS v FROM bankroll_ledger WHERE mode = 'real' AND entry_type = 'purchase' AND game_id = ? AND entry_date = ?").bind(game.id, date).first<{ v: number }>();
  return r?.v ?? 0;
}

async function loadRounds(db: D1Database, sessionId: number): Promise<(LiveRound & { id: number; createdAt: string })[]> {
  const { results } = await db.prepare('SELECT * FROM bingo18_session_rounds WHERE session_id = ? ORDER BY draw_at').bind(sessionId).all<{ id: number; draw_at: string; stake: number; prize: number; d1: number | null; d2: number | null; d3: number | null; created_at: string }>();
  return results.map((r) => ({ id: r.id, drawAt: r.draw_at, stake: r.stake, prize: r.prize, result: r.d1 == null ? null : [r.d1, r.d2 as number, r.d3 as number], createdAt: r.created_at }));
}

const configOf = (s: SessionRow): LiveConfig => ({ bet: JSON.parse(s.bet_json) as BingoBet, baseUnits: s.base_units, budget: s.budget, takeProfit: s.take_profit, maxMinutes: s.max_minutes, startedAt: s.started_at });

async function snapshot(c: Context<AppEnv>, s: SessionRow | null) {
  const db = c.env.DB;
  const now = nowIso();
  const date = vnClock(now).date;
  const [dailyLimit, sessionMinutes, spent] = await Promise.all([getSetting<number>(db, 'bingo18_daily_limit', 50000), getSetting<number>(db, 'bingo18_session_minutes', 30), spentToday(db, date)]);
  const defaults = { dailyLimit, sessionMinutes, spentToday: spent };
  if (!s) return { session: null, plan: null, rounds: [], schedule: bingoSchedule(now), defaults, serverNow: now };
  const rounds = await loadRounds(db, s.id);
  const cfg = configOf(s);
  const plan = s.status === 'open' ? livePlan(cfg, rounds, { now, spentToday: spent, dailyLimit }) : null;
  return {
    session: { id: s.id, status: s.status, bet: cfg.bet, betLabel: betLabel(cfg.bet), baseUnits: s.base_units, budget: s.budget, takeProfit: s.take_profit, maxMinutes: s.max_minutes, sessionDate: s.session_date, startedAt: s.started_at, endedAt: s.ended_at, endReason: s.end_reason },
    plan,
    rounds,
    schedule: bingoSchedule(now),
    defaults,
    serverNow: now,
  };
}

/** Phiên đang mở (hoặc phiên gần nhất trong ngày) kèm phương án chốt cho kỳ kế tiếp. */
bingoLiveRoutes.get('/bingo18/live', async (c) => {
  const date = vnClock(nowIso()).date;
  const s =
    (await c.env.DB.prepare("SELECT * FROM bingo18_sessions WHERE status = 'open' ORDER BY id DESC LIMIT 1").first<SessionRow>()) ??
    (await c.env.DB.prepare('SELECT * FROM bingo18_sessions WHERE session_date = ? ORDER BY id DESC LIMIT 1').bind(date).first<SessionRow>());
  return c.json({ data: await snapshot(c, s ?? null) });
});

const StartBody = z.object({
  bet: BetSchema,
  base_units: z.number().int().min(1).max(100).default(1),
  budget: z.number().int().min(BINGO_STAKE).max(100_000_000).optional(),
  take_profit: z.number().int().min(1000).max(100_000_000).nullable().optional(),
  max_minutes: z.number().int().min(5).max(960).optional(),
});

bingoLiveRoutes.post('/bingo18/live/start', async (c) => {
  const b = await parseJson(c, StartBody);
  const err = validateBet(b.bet as BingoBet);
  if (err) throw new ApiError(422, 'bad_bet', err);
  const db = c.env.DB;
  const open = await db.prepare("SELECT id FROM bingo18_sessions WHERE status = 'open' LIMIT 1").first<{ id: number }>();
  if (open) throw conflict(`Đang có phiên #${open.id} mở; hãy kết thúc phiên đó trước.`);
  const now = nowIso();
  const date = vnClock(now).date;
  const [dailyLimit, sessionMinutes] = await Promise.all([getSetting<number>(db, 'bingo18_daily_limit', 50000), getSetting<number>(db, 'bingo18_session_minutes', 30)]);
  const budget = b.budget ?? dailyLimit;
  if (budget < b.base_units * BINGO_STAKE) throw new ApiError(422, 'budget', 'Lỗ tối đa phải ít nhất bằng một lượt cược gốc');
  const user = c.get('user');
  const row = await db
    .prepare('INSERT INTO bingo18_sessions (bet_json, base_units, budget, take_profit, max_minutes, session_date, started_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *')
    .bind(JSON.stringify(b.bet), b.base_units, budget, b.take_profit ?? null, b.max_minutes ?? sessionMinutes, date, now, user.id)
    .first<SessionRow>();
  await auditStatement(c, { action: 'bingo18.session_start', entityType: 'bingo18_session', entityId: row!.id, after: { ...b, budget } }).run();
  return c.json({ data: await snapshot(c, row!) }, 201);
});

const RoundBody = z.object({
  draw_at: z.string().regex(/^\d{2}:\d{2}$/),
  played: z.boolean(),
  stake: z.number().int().min(BINGO_STAKE).max(1_000_000).optional(),
  result: z.array(z.number().int().min(1).max(6)).length(3).optional(),
  prize: z.number().int().min(0).max(1_000_000_000).optional(),
});

/** Ghi một kỳ: có chơi hay không, kết quả 3 số (tự tính thưởng) hoặc tiền thưởng nhận. Ghi sổ quỹ thực tế ngay. */
bingoLiveRoutes.post('/bingo18/live/:id/round', async (c) => {
  const id = parseId(c);
  const b = await parseJson(c, RoundBody);
  const db = c.env.DB;
  const s = await db.prepare('SELECT * FROM bingo18_sessions WHERE id = ?').bind(id).first<SessionRow>();
  if (!s) throw notFound('Phiên Bingo18');
  if (s.status !== 'open') throw conflict('Phiên đã kết thúc');
  if (!isBingoDrawTime(b.draw_at)) throw new ApiError(422, 'draw_time', 'Giờ quay Bingo18 phải từ 06:00 đến 21:48, cách nhau 6 phút');
  const cfg = configOf(s);
  const stake = b.played ? (b.stake ?? cfg.baseUnits * BINGO_STAKE) : 0;
  if (stake % BINGO_STAKE !== 0) throw new ApiError(422, 'stake', 'Tiền chơi phải là bội số của 10.000đ');
  const prize = b.played ? (b.result ? prizeFor(cfg.bet, stake, b.result as BingoResult) : (b.prize ?? 0)) : 0;
  const dup = await db.prepare('SELECT id FROM bingo18_session_rounds WHERE session_id = ? AND draw_at = ?').bind(id, b.draw_at).first();
  if (dup) throw conflict(`Kỳ ${b.draw_at} đã được ghi trong phiên này`);
  const game = await getAnyGame(db, 'bingo18');
  const user = c.get('user');
  const note = `Phiên #${id}, kỳ ${b.draw_at}`;
  const stmts: D1PreparedStatement[] = [
    db.prepare('INSERT INTO bingo18_session_rounds (session_id, draw_at, stake, prize, d1, d2, d3, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, b.draw_at, stake, prize, b.result?.[0] ?? null, b.result?.[1] ?? null, b.result?.[2] ?? null, user.id),
  ];
  if (stake > 0) stmts.push(db.prepare("INSERT INTO bankroll_ledger (entry_type, mode, amount, game_id, entry_date, note, created_by) VALUES ('purchase', 'real', ?, ?, ?, ?, ?)").bind(-stake, game.id, s.session_date, note, user.id));
  if (prize > 0) stmts.push(db.prepare("INSERT INTO bankroll_ledger (entry_type, mode, amount, game_id, entry_date, note, created_by) VALUES ('prize', 'real', ?, ?, ?, ?, ?)").bind(prize, game.id, s.session_date, note, user.id));
  stmts.push(auditStatement(c, { action: 'bingo18.session_round', entityType: 'bingo18_session', entityId: id, after: { drawAt: b.draw_at, stake, prize, result: b.result ?? null } }));
  await db.batch(stmts);
  return c.json({ data: await snapshot(c, s) }, 201);
});

bingoLiveRoutes.post('/bingo18/live/:id/close', async (c) => {
  const id = parseId(c);
  const b = await parseJson(c, z.object({ reason: z.string().max(200).optional() }));
  const db = c.env.DB;
  const s = await db.prepare('SELECT * FROM bingo18_sessions WHERE id = ?').bind(id).first<SessionRow>();
  if (!s) throw notFound('Phiên Bingo18');
  if (s.status !== 'open') throw conflict('Phiên đã kết thúc');
  const now = nowIso();
  await db.batch([
    db.prepare("UPDATE bingo18_sessions SET status = 'closed', ended_at = ?, end_reason = ? WHERE id = ?").bind(now, b.reason ?? 'Người chơi kết thúc', id),
    auditStatement(c, { action: 'bingo18.session_close', entityType: 'bingo18_session', entityId: id, after: { reason: b.reason ?? null } }),
  ]);
  const row = await db.prepare('SELECT * FROM bingo18_sessions WHERE id = ?').bind(id).first<SessionRow>();
  return c.json({ data: await snapshot(c, row!) });
});
