import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { decideToday, type DecisionMode } from '../../engine/decision';
import { listGames } from '../db/games';
import { insertModelRun } from '../db/models';
import { getSetting } from '../db/settings';
import { auditStatement } from '../lib/audit';
import { requireRole } from '../lib/auth';
import { nowIso, parseJson, parseQuery } from '../lib/http';
import type { AppEnv } from '../lib/types';
import { capitalSummary, vnToday } from '../services/capital';

export const decisionRoutes = new Hono<AppEnv>();

type JackpotStore = Record<string, { values: Record<string, number>; updatedAt: string; updatedBy: string }>;

const DecisionQuery = z.object({
  mode: z.enum(['discipline', 'value', 'minimal']).optional(),
  threshold: z.coerce.number().min(0).max(5).optional(),
  apply_tax: z.enum(['true', 'false']).optional(),
  now: z.iso.datetime().optional(),
});

async function buildDecision(c: Context<AppEnv>, q: z.infer<typeof DecisionQuery>) {
  const db = c.env.DB;
  const [games, jackpots, capital, defMode, defThreshold, defTax] = await Promise.all([
    listGames(db),
    getSetting<JackpotStore>(db, 'current_jackpots', {}),
    capitalSummary(db, 'real'),
    getSetting<DecisionMode>(db, 'decision_mode', 'discipline'),
    getSetting<number>(db, 'decision_value_threshold', 0.5),
    getSetting<boolean>(db, 'decision_apply_tax', true),
  ]);
  const today = vnToday();
  const spent = await db.prepare("SELECT COALESCE(SUM(-amount), 0) AS v FROM bankroll_ledger WHERE mode = 'real' AND entry_type = 'purchase' AND entry_date = ?").bind(today).first<{ v: number }>();
  const settings = { mode: q.mode ?? defMode, valueThreshold: q.threshold ?? defThreshold, applyTax: q.apply_tax ? q.apply_tax === 'true' : defTax };
  const decision = decideToday({
    now: q.now ?? nowIso(),
    games: games
      .filter((g) => g.isActive)
      .map((g) => ({ ...g, schedule: g.drawSchedule, jackpots: jackpots[g.code]?.values ?? {}, jackpotsUpdatedAt: jackpots[g.code]?.updatedAt ?? null })),
    mode: settings.mode,
    valueThreshold: settings.valueThreshold,
    budgetPerDraw: capital.budgetPerDraw,
    monthRemaining: capital.monthRemaining,
    yearRemaining: capital.yearRemaining,
    spentToday: spent?.v ?? 0,
    applyTax: settings.applyTax,
  });
  return { decision, settings, jackpots, games: games.map((g) => ({ code: g.code, name: g.name, jackpotTiers: g.prizeTiers.filter((t) => t.kind === 'jackpot').map((t) => ({ code: t.code, name: t.name, minimum: t.amount })), scheduleNote: g.scheduleNote, rulesVerificationStatus: g.rulesVerificationStatus })) };
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
