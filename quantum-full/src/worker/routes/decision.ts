import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { decideToday, vnClock, type DecisionMode, type SplitDrawInput } from '../../engine/decision';
import { LOTTO535_SPLIT_SHARES, breakEvenTickets, estimateTickets, splitDrawEV, validateShares, type SplitShares } from '../../engine/splitDraw';
import type { Game } from '../../shared/game';
import { listGames } from '../db/games';
import { insertModelRun } from '../db/models';
import { getSetting } from '../db/settings';
import { auditStatement } from '../lib/audit';
import { requireRole } from '../lib/auth';
import { badRequest, nowIso, parseJson, parseQuery } from '../lib/http';
import type { AppEnv } from '../lib/types';
import { capitalSummary, vnToday } from '../services/capital';

export const decisionRoutes = new Hono<AppEnv>();

type JackpotStore = Record<string, { values: Record<string, number>; updatedAt: string; updatedBy: string }>;

const DecisionQuery = z.object({
  mode: z.enum(['discipline', 'value', 'minimal', 'split_only']).optional(),
  threshold: z.coerce.number().min(0).max(5).optional(),
  apply_tax: z.enum(['true', 'false']).optional(),
  now: z.iso.datetime().optional(),
});

/** Cấu hình kỳ Chia giải Độc đắc do quản trị viên xác nhận (app_settings.split_draw). */
interface SplitDrawConfig {
  game: string;
  date: string;
  time: string;
  jackpot: number;
  reference_winners?: Record<string, number>;
  reference_note?: string;
  tickets_override?: number | null;
  sales_growth: number;
  shares?: SplitShares;
  updatedAt?: string;
  updatedBy?: string;
}

const DEFAULT_SHARES: Record<string, SplitShares> = { lotto535: LOTTO535_SPLIT_SHARES };

function splitView(games: Game[], cfg: SplitDrawConfig | null, now: string, applyTax: boolean) {
  if (!cfg) return { config: null, input: null, view: null };
  const game = games.find((g) => g.code === cfg.game);
  if (!game) return { config: cfg, input: null, view: null };
  const shares = cfg.shares ?? DEFAULT_SHARES[game.code] ?? null;
  const estimate = cfg.reference_winners ? estimateTickets(game, cfg.reference_winners) : null;
  const tickets = cfg.tickets_override ?? estimate?.tickets ?? null;
  if (!shares || !tickets) return { config: cfg, input: null, view: null };
  const ticketsConservative = Math.round(tickets * (1 + cfg.sales_growth));
  const est = splitDrawEV(game, cfg.jackpot, tickets, shares, applyTax);
  const cons = splitDrawEV(game, cfg.jackpot, ticketsConservative, shares, applyTax);
  const today = vnClock(now).date;
  const input: SplitDrawInput = { game: game.code, date: cfg.date, time: cfg.time, jackpot: cfg.jackpot, shares, tickets, ticketsConservative };
  const jpCode = game.prizeTiers.find((x) => x.kind === 'jackpot')?.code;
  return {
    config: cfg,
    input,
    view: {
      gameName: game.name,
      status: cfg.date > today ? 'upcoming' : cfg.date === today ? 'today' : 'past',
      shares,
      estimate,
      tickets,
      ticketsConservative,
      returnRatioEstimate: est.returnRatio,
      returnRatioConservative: cons.returnRatio,
      expectedPrizeConservative: cons.expectedPrize,
      pSplitHappens: cons.pSplitHappens,
      breakEvenTickets: breakEvenTickets(game, cfg.jackpot, shares, applyTax),
      tiers: cons.tiers.filter((t) => t.code in shares || t.code === jpCode),
    },
  };
}

async function buildDecision(c: Context<AppEnv>, q: z.infer<typeof DecisionQuery>) {
  const db = c.env.DB;
  const [games, jackpots, capital, defMode, defThreshold, defTax, splitCfg] = await Promise.all([
    listGames(db),
    getSetting<JackpotStore>(db, 'current_jackpots', {}),
    capitalSummary(db, 'real'),
    getSetting<DecisionMode>(db, 'decision_mode', 'discipline'),
    getSetting<number>(db, 'decision_value_threshold', 0.5),
    getSetting<boolean>(db, 'decision_apply_tax', true),
    getSetting<SplitDrawConfig | null>(db, 'split_draw', null),
  ]);
  const today = vnToday();
  const spent = await db.prepare("SELECT COALESCE(SUM(-amount), 0) AS v FROM bankroll_ledger WHERE mode = 'real' AND entry_type = 'purchase' AND entry_date = ?").bind(today).first<{ v: number }>();
  const settings = { mode: q.mode ?? defMode, valueThreshold: q.threshold ?? defThreshold, applyTax: q.apply_tax ? q.apply_tax === 'true' : defTax };
  const now = q.now ?? nowIso();
  const split = splitView(games, splitCfg, now, settings.applyTax);
  const decision = decideToday({
    split: split.input,
    now,
    games: games
      .filter((g) => g.isActive && g.engine === 'pick')
      .map((g) => ({ ...g, schedule: g.drawSchedule, jackpots: jackpots[g.code]?.values ?? {}, jackpotsUpdatedAt: jackpots[g.code]?.updatedAt ?? null })),
    mode: settings.mode,
    valueThreshold: settings.valueThreshold,
    budgetPerDraw: capital.budgetPerDraw,
    monthRemaining: capital.monthRemaining,
    yearRemaining: capital.yearRemaining,
    spentToday: spent?.v ?? 0,
    applyTax: settings.applyTax,
  });
  return { decision, settings, jackpots, split: { config: split.config, ...split.view }, games: games.filter((g) => g.engine === 'pick').map((g) => ({ code: g.code, name: g.name, jackpotTiers: g.prizeTiers.filter((t) => t.kind === 'jackpot').map((t) => ({ code: t.code, name: t.name, minimum: t.amount })), scheduleNote: g.scheduleNote, rulesVerificationStatus: g.rulesVerificationStatus })) };
}

decisionRoutes.get('/decision/today', async (c) => {
  const q = parseQuery(c, DecisionQuery);
  return c.json({ data: await buildDecision(c, q) });
});

/** Ghi nhận quyết định hôm nay vào lịch sử mô hình (bất biến) để kiểm toán. */
decisionRoutes.post('/decision/today', async (c) => {
  const q = parseQuery(c, DecisionQuery);
  const started = Date.now();
  const r = await buildDecision(c, q);
  const gameId = r.decision.pick ? (await c.env.DB.prepare('SELECT id FROM games WHERE code = ?').bind(r.decision.pick.game).first<{ id: number }>())!.id : 1;
  const run = await insertModelRun(c.env.DB, {
    modelCode: 'daily_decision',
    gameId,
    runType: 'analysis',
    params: { ...r.settings, jackpots: r.jackpots },
    seed: null,
    draws: [],
    output: { action: r.decision.action, headline: r.decision.headline, tickets: r.decision.tickets, cost: r.decision.cost, expectedLoss: r.decision.expectedLoss, pick: r.decision.pick, allowance: r.decision.allowance },
    durationMs: Date.now() - started,
    createdBy: c.get('user').id,
  });
  return c.json({ data: { ...r, modelRunId: run.id } }, 201);
});

const JackpotBody = z.object({
  game: z.string().min(1),
  values: z.record(z.string(), z.number().int().min(0).max(10_000_000_000_000)),
});

decisionRoutes.put('/admin/jackpots', requireRole('admin'), async (c) => {
  const b = await parseJson(c, JackpotBody);
  const db = c.env.DB;
  const game = (await listGames(db)).find((g) => g.code === b.game);
  if (!game) return c.json({ error: { code: 'not_found', message: 'Game không tồn tại' } }, 404);
  for (const [code, v] of Object.entries(b.values)) {
    const tier = game.prizeTiers.find((t) => t.code === code && t.kind === 'jackpot');
    if (!tier) return c.json({ error: { code: 'validation_error', message: `Hạng ${code} không phải Jackpot của ${game.name}` } }, 400);
    if (v < tier.amount) return c.json({ error: { code: 'validation_error', message: `${tier.name} không thể thấp hơn mức tối thiểu ${tier.amount.toLocaleString('vi-VN')}đ` } }, 400);
  }
  const store = await getSetting<JackpotStore>(db, 'current_jackpots', {});
  const before = store[b.game] ?? null;
  store[b.game] = { values: b.values, updatedAt: nowIso(), updatedBy: c.get('user').id };
  await db.batch([
    db.prepare("UPDATE app_settings SET value_json = ?, updated_by = ?, updated_at = ? WHERE key = 'current_jackpots'").bind(JSON.stringify(store), c.get('user').id, nowIso()),
    auditStatement(c, { action: 'jackpots.update', entityType: 'game', entityId: b.game, before, after: store[b.game] }),
  ]);
  return c.json({ data: store });
});

const SplitDrawBody = z.object({
  game: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/).default('21:00'),
  jackpot: z.number().int().min(1).max(10_000_000_000_000),
  reference_winners: z.record(z.string(), z.number().int().min(0).max(100_000_000)).optional(),
  reference_note: z.string().max(200).optional(),
  tickets_override: z.number().int().min(1000).max(1_000_000_000).nullable().optional(),
  sales_growth: z.number().min(0).max(5).default(0.3),
  shares: z.record(z.string(), z.number().min(0).max(1)).optional(),
});

async function saveSplit(c: Context<AppEnv>, value: SplitDrawConfig | null) {
  const db = c.env.DB;
  const before = await getSetting<SplitDrawConfig | null>(db, 'split_draw', null);
  const user = c.get('user').id;
  await db.batch([
    db
      .prepare(
        "INSERT INTO app_settings (key, value_json, description, updated_by, updated_at) VALUES ('split_draw', ?, 'Kỳ Chia giải Độc đắc đã xác nhận (ngày, giờ, giá trị, số người trúng kỳ tham chiếu)', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
      )
      .bind(JSON.stringify(value), user, nowIso()),
    auditStatement(c, { action: value ? 'split_draw.update' : 'split_draw.clear', entityType: 'app_settings', entityId: 'split_draw', before, after: value }),
  ]);
}

/** Xác nhận / cập nhật kỳ Chia giải Độc đắc (quản trị viên). */
decisionRoutes.put('/admin/split-draw', requireRole('admin'), async (c) => {
  const b = await parseJson(c, SplitDrawBody);
  const game = (await listGames(c.env.DB)).find((g) => g.code === b.game && g.engine === 'pick');
  if (!game) return c.json({ error: { code: 'not_found', message: 'Game không tồn tại' } }, 404);
  const jp = game.prizeTiers.find((t) => t.kind === 'jackpot');
  if (!jp) throw badRequest(`${game.name} không có giải Jackpot`);
  if (b.jackpot < jp.amount) throw badRequest(`Giá trị Độc đắc không thể thấp hơn mức tối thiểu ${jp.amount.toLocaleString('vi-VN')}đ`);
  if (game.drawSchedule?.times?.length && !game.drawSchedule.times.includes(b.time)) throw badRequest(`Giờ quay phải là một trong: ${game.drawSchedule.times.join(', ')}`);
  const shares = b.shares ?? DEFAULT_SHARES[game.code];
  if (!shares) throw badRequest('Cần khai báo tỷ lệ chia (shares) cho game này');
  const shareErr = validateShares(game, shares);
  if (shareErr) throw badRequest(shareErr);
  if (b.reference_winners) {
    const bad = Object.keys(b.reference_winners).filter((k) => !game.prizeTiers.some((t) => t.code === k));
    if (bad.length) throw badRequest(`Hạng không tồn tại: ${bad.join(', ')}`);
  }
  const est = b.reference_winners ? estimateTickets(game, b.reference_winners) : null;
  if (!b.tickets_override && !est) throw badRequest('Cần số người trúng từng hạng của một kỳ chia giải trước (để ước lượng số vé) hoặc nhập trực tiếp số lần dự thưởng ước lượng');
  const value: SplitDrawConfig = { ...b, shares, updatedAt: nowIso(), updatedBy: c.get('user').id };
  await saveSplit(c, value);
  return c.json({ data: await buildDecision(c, {}) });
});

decisionRoutes.delete('/admin/split-draw', requireRole('admin'), async (c) => {
  await saveSplit(c, null);
  return c.json({ data: await buildDecision(c, {}) });
});
