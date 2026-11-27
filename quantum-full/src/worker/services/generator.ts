/**
 * Dịch vụ sinh bộ số + lưu lịch sử bất biến (model_runs, recommendations, recommendation_numbers).
 */
import type { Context } from 'hono';
import { z } from 'zod';
import type { Game } from '../../shared/game';
import { mainPoolSize, specialPoolSize } from '../../shared/game';
import { combinationBig, rToNumber, rOneIn } from '../../engine/combinatorics';
import { anyPrizeAtLeastOneApprox, expectedValue, jackpotProbabilityForDistinctTickets } from '../../engine/probability';
import { createRng, randomSeed } from '../../engine/rng';
import { generateTickets, optimizePortfolio, portfolioMetrics, STRATEGIES, type StrategyCode } from '../../engine/strategies';
import { checkBudget, validateTicket } from '../../engine/validation';
import { behaviorScore } from '../../engine/behavior';
import type { Ticket } from '../../engine/types';
import { composeDrawAt, loadDrawRecords } from '../db/draws';
import { insertModelRun, strategyValidationStatus } from '../db/models';
import { getCapitalSettings } from '../db/settings';
import { ApiError, unprocessable } from '../lib/http';
import type { AppEnv } from '../lib/types';

export const GenerateBody = z.object({
  game: z.string().min(1),
  strategy: z.enum(['random_uniform', 'balanced', 'statistical', 'bayesian', 'portfolio_optimized']),
  budget: z.number().int().min(0).max(100_000_000),
  ticket_count: z.number().int().min(1).max(200),
  target_draw_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  seed: z.string().min(1).max(64).regex(/^[\w.\-:]+$/).nullable().optional(),
  include_unverified: z.boolean().optional(),
  params: z
    .object({
      window: z.number().int().min(5).max(1000).optional(),
      priorStrength: z.number().min(0.1).max(100000).optional(),
      dirichletAlpha: z.number().min(0.01).max(1000).optional(),
      maxOverlap: z.number().int().min(0).max(10).optional(),
      avoidPopular: z.boolean().optional(),
      candidates: z.number().int().min(20).max(1000).optional(),
    })
    .optional(),
});
export type GenerateInput = z.infer<typeof GenerateBody>;

function todayVn(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

export async function generateAndStore(c: Context<AppEnv>, game: Game, input: GenerateInput, runType: 'generate' | 'portfolio') {
  const started = Date.now();
  const db = c.env.DB;
  const capital = await getCapitalSettings(db);
  const budgetCheck = checkBudget(game.ticketPrice, input.ticket_count, input.budget, capital.budgetPerDraw);
  if (!budgetCheck.ok) throw new ApiError(422, 'budget_violation', budgetCheck.issues.map((i) => i.message).join('; '), budgetCheck);
  if (input.target_draw_date && input.target_draw_date < todayVn()) throw unprocessable('Ngày quay mục tiêu đã qua, dự báo chỉ được lập TRƯỚC kỳ quay (dùng Backtesting cho kỳ quá khứ).');
  const cutoff = input.target_draw_date ? composeDrawAt(input.target_draw_date, '00:00') : undefined;
  const history = await loadDrawRecords(db, game.id, { includeUnverified: input.include_unverified ?? false, before: cutoff });
  const seed = input.seed ?? randomSeed();
  const params = input.params ?? {};
  const rng = createRng(seed);
  const code = input.strategy as StrategyCode;
  let tickets: Ticket[];
  let relaxed = false;
  if (code === 'portfolio_optimized') {
    const r = optimizePortfolio({ rules: game, history, rng, params }, input.ticket_count);
    tickets = r.tickets;
    relaxed = r.relaxedConstraints;
  } else tickets = generateTickets(code, { rules: game, history, rng, params }, input.ticket_count);
  // Kiểm tra cứng: không bao giờ trả về số sai miền / vé trùng.
  for (const t of tickets) {
    const issues = validateTicket(game, t);
    if (issues.length) throw new ApiError(500, 'generator_invariant', 'Bộ sinh tạo vé không hợp lệ', issues);
  }
  const metrics = portfolioMetrics(game, tickets);
  if (metrics.duplicateTickets > 0) throw new ApiError(500, 'generator_invariant', 'Bộ sinh tạo vé trùng');
  const jp = jackpotProbabilityForDistinctTickets(game, tickets.length);
  const info = STRATEGIES[code];
  const validation = await strategyValidationStatus(db, game.id, code);
  const totalCombos = combinationBig(mainPoolSize(game), game.mainPicks) * BigInt(Math.max(1, specialPoolSize(game)));
  const output = {
    tickets: tickets.map((t) => ({ ...t, popularity: behaviorScore(game, t.main).percentile })),
    totalCost: budgetCheck.totalCost,
    probability: {
      jackpot: rToNumber(jp),
      jackpotOneIn: rOneIn(jp),
      jackpotExact: `${jp.num}/${jp.den}`,
      totalCombinations: totalCombos.toString(),
      anyPrizeAtLeastOneApprox: anyPrizeAtLeastOneApprox(game, tickets.length),
      expectedValuePerTicket: expectedValue(game),
    },
    coverage: metrics,
    explanation: info.explanation,
    relaxedConstraints: relaxed,
    algorithm: { code, name: info.name, version: info.version, baseline: info.baseline },
    dataCutoff: { before: cutoff ?? null, lastDrawAt: history.length ? history[history.length - 1].drawAt : null, drawCount: history.length, includeUnverified: input.include_unverified ?? false },
    validationStatus: validation.status,
    rulesVerificationStatus: game.rulesVerificationStatus,
    seed,
    disclaimer:
      'Mọi tổ hợp có cùng xác suất trúng. Chiến lược chỉ thay đổi cách chọn bộ số, không làm tăng xác suất trúng của một tổ hợp. Không có bảo đảm trúng thưởng.',
  };
  const run = await insertModelRun(db, {
    modelCode: code,
    gameId: game.id,
    runType,
    params: { ...input, seed },
    seed,
    draws: history,
    output: { totalCost: output.totalCost, ticketCount: tickets.length, coverage: metrics, validationStatus: validation.status },
    durationMs: Date.now() - started,
    createdBy: c.get('user').id,
  });
  const recRow = await db
    .prepare(
      `INSERT INTO recommendations (model_run_id, game_id, strategy_code, algorithm_version, target_draw_date, seed, data_cutoff_at, data_draw_count, ticket_count, ticket_price, total_cost, budget, params_json, metrics_json, validation_status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, created_at`,
    )
    .bind(run.id, game.id, code, info.version, input.target_draw_date ?? null, seed, output.dataCutoff.lastDrawAt, history.length, tickets.length, game.ticketPrice, budgetCheck.totalCost, input.budget, JSON.stringify(params), JSON.stringify({ coverage: metrics, probability: output.probability, datasetHash: run.datasetHash }), validation.status, c.get('user').id)
    .first<{ id: number; created_at: string }>();
  const rows: [number, number, number, number][] = [];
  tickets.forEach((t, ti) => {
    t.main.forEach((n, p) => rows.push([ti, p, n, 0]));
    if (t.special != null) rows.push([ti, t.main.length, t.special, 1]);
  });
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    stmts.push(
      db.prepare(`INSERT INTO recommendation_numbers (recommendation_id, ticket_index, position, number, is_special) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?)').join(', ')}`).bind(...chunk.flatMap((r) => [recRow!.id, ...r])),
    );
  }
  await db.batch(stmts);
  return { recommendationId: recRow!.id, modelRunId: run.id, createdAt: recRow!.created_at, datasetHash: run.datasetHash, ...output };
}

export interface RecommendationRow {
  id: number;
  model_run_id: number;
  game_id: number;
  game_code: string;
  strategy_code: string;
  algorithm_version: string;
  target_draw_date: string | null;
  seed: string;
  data_cutoff_at: string | null;
  data_draw_count: number;
  ticket_count: number;
  ticket_price: number;
  total_cost: number;
  budget: number;
  params_json: string;
  metrics_json: string;
  validation_status: string;
  created_by: string;
  created_at: string;
}

export async function loadRecommendation(db: D1Database, id: number) {
  const rec = await db.prepare('SELECT r.*, g.code AS game_code FROM recommendations r JOIN games g ON g.id = r.game_id WHERE r.id = ?').bind(id).first<RecommendationRow>();
  if (!rec) return null;
  const { results } = await db.prepare('SELECT ticket_index, position, number, is_special FROM recommendation_numbers WHERE recommendation_id = ? ORDER BY ticket_index, position').bind(id).all<{ ticket_index: number; position: number; number: number; is_special: number }>();
  const tickets: Ticket[] = [];
  for (const r of results) {
    tickets[r.ticket_index] ??= { main: [], special: null };
    if (r.is_special) tickets[r.ticket_index].special = r.number;
    else tickets[r.ticket_index].main.push(r.number);
  }
  return { ...rec, params: JSON.parse(rec.params_json) as unknown, metrics: JSON.parse(rec.metrics_json) as unknown, tickets };
}
