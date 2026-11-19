import { Hono } from 'hono';
import { z } from 'zod';
import { bayesianAnalysis } from '../../engine/bayesian';
import { behaviorScore } from '../../engine/behavior';
import { markovAnalysis } from '../../engine/markov';
import { runMlResearch, type MlModelCode } from '../../engine/ml';
import { MONTE_CARLO_MAX_WORK, runMonteCarlo } from '../../engine/montecarlo';
import { createRng, randomSeed } from '../../engine/rng';
import { distributionAnalysis, frequencyAnalysis } from '../../engine/statistics';
import { generateTickets, type StrategyCode } from '../../engine/strategies';
import { validateTicket } from '../../engine/validation';
import type { Ticket } from '../../engine/types';
import { loadDrawRecords } from '../db/draws';
import { getGame } from '../db/games';
import { insertModelRun, strategyValidationStatus } from '../db/models';
import { ApiError, PaginationQuery, notFound, pageMeta, parseId, parseJson, parseQuery, unprocessable } from '../lib/http';
import { rateLimit } from '../lib/observability';
import type { AppEnv } from '../lib/types';
import { loadRecommendation } from '../services/generator';

export const modelRoutes = new Hono<AppEnv>();

modelRoutes.get('/models', async (c) => {
  const game = c.req.query('game') ? await getGame(c.env.DB, c.req.query('game')!) : null;
  const { results } = await c.env.DB.prepare(
    `SELECT mv.*, (SELECT COUNT(*) FROM model_runs r WHERE r.model_version_id = mv.id) AS run_count,
      (SELECT MAX(created_at) FROM model_runs r WHERE r.model_version_id = mv.id) AS last_run_at
     FROM model_versions mv ORDER BY mv.kind, mv.id`,
  ).all<Record<string, unknown> & { code: string; kind: string }>();
  const data = [];
  for (const r of results) {
    data.push({ ...r, validation: game && r.kind === 'strategy' ? await strategyValidationStatus(c.env.DB, game.id, r.code) : null });
  }
  return c.json({ data });
});

modelRoutes.get('/models/runs', async (c) => {
  const q = parseQuery(c, PaginationQuery.extend({ game: z.string().optional(), run_type: z.string().optional() }));
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.game) {
    const g = await getGame(c.env.DB, q.game);
    where.push('r.game_id = ?');
    binds.push(g.id);
  }
  if (q.run_type) (where.push('r.run_type = ?'), binds.push(q.run_type));
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM model_runs r ${w}`).bind(...binds).first<{ n: number }>())!.n;
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, mv.code AS model_code, mv.version AS model_version, mv.name AS model_name, g.code AS game_code
     FROM model_runs r JOIN model_versions mv ON mv.id = r.model_version_id JOIN games g ON g.id = r.game_id ${w} ORDER BY r.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, q.page_size, (q.page - 1) * q.page_size)
    .all<Record<string, unknown>>();
  return c.json({ data: results.map((r) => ({ ...r, params: JSON.parse(String(r.params_json)), output: JSON.parse(String(r.output_summary_json)) })), meta: pageMeta(q.page, q.page_size, total) });
});

modelRoutes.get('/models/runs/:id', async (c) => {
  const r = await c.env.DB.prepare(
    'SELECT r.*, mv.code AS model_code, mv.version AS model_version, mv.name AS model_name FROM model_runs r JOIN model_versions mv ON mv.id = r.model_version_id WHERE r.id = ?',
  )
    .bind(parseId(c))
    .first<Record<string, unknown>>();
  if (!r) throw notFound('Lần chạy mô hình');
  return c.json({ data: { ...r, params: JSON.parse(String(r.params_json)), output: JSON.parse(String(r.output_summary_json)) } });
});

const RunBody = z.object({
  game: z.string().min(1),
  model: z.enum(['statistics', 'bayesian_analysis', 'markov', 'monte_carlo', 'ml_research', 'behavior']),
  include_unverified: z.boolean().optional(),
  seed: z.string().min(1).max(64).regex(/^[\w.\-:]+$/).nullable().optional(),
  params: z
    .object({
      priorStrength: z.number().min(0.1).max(100000).optional(),
      credibleLevel: z.number().min(0.5).max(0.999).optional(),
      maxLag: z.number().int().min(1).max(30).optional(),
      draws: z.number().int().min(1).max(MONTE_CARLO_MAX_WORK).optional(),
      recommendationId: z.number().int().positive().optional(),
      strategy: z.enum(['random_uniform', 'balanced', 'statistical', 'bayesian', 'portfolio_optimized']).optional(),
      ticketCount: z.number().int().min(1).max(200).optional(),
      models: z.array(z.enum(['logistic_regression', 'random_forest', 'gradient_boosting'])).min(1).optional(),
      trainFraction: z.number().min(0.5).max(0.9).optional(),
      maxDraws: z.number().int().min(70).max(600).optional(),
      numbers: z.array(z.number().int()).optional(),
    })
    .default({}),
});

modelRoutes.post('/models/run', rateLimit(5), async (c) => {
  const b = await parseJson(c, RunBody);
  const game = await getGame(c.env.DB, b.game);
  const draws = await loadDrawRecords(c.env.DB, game.id, { includeUnverified: b.include_unverified ?? false });
  const seed = b.seed ?? randomSeed();
  const started = Date.now();
  let result: unknown;
  let summary: unknown;
  let runType: 'analysis' | 'montecarlo' | 'ml' = 'analysis';
  const p = b.params;
  try {
    switch (b.model) {
      case 'statistics': {
        const f = frequencyAnalysis(game, draws);
        const d = distributionAnalysis(game, draws);
        result = { frequency: f, distribution: d };
        summary = { draws: draws.length, chiSquareP: f.chiSquare.pValue, oddEvenP: d.oddEven.chiSquare.pValue, sumMeanP: d.sum.pValueMean };
        break;
      }
      case 'bayesian_analysis': {
        const r = bayesianAnalysis(game, draws, p.priorStrength ?? 100, p.credibleLevel ?? 0.95);
        result = r;
        summary = { draws: r.draws, excludingUniform: r.excludingUniform, expectedByChance: r.expectedExcludingByChance, interpretation: r.interpretation };
        break;
      }
      case 'markov': {
        const r = markovAnalysis(game, draws, p.maxLag ?? 10);
        result = r;
        summary = { draws: r.draws, pooledP: r.pooled.pValue, overlapP: r.overlap.pValue, significantAfterFdr: r.significantAfterFdr, conclusion: r.conclusion };
        break;
      }
      case 'monte_carlo': {
        runType = 'montecarlo';
        let tickets: Ticket[];
        if (p.recommendationId) {
          const rec = await loadRecommendation(c.env.DB, p.recommendationId);
          if (!rec || Number(rec.game_id) !== game.id) throw notFound('Bộ số đã sinh của game này');
          tickets = rec.tickets;
        } else {
          tickets = generateTickets((p.strategy ?? 'random_uniform') as StrategyCode, { rules: game, history: draws, rng: createRng(`${seed}:tickets`), params: {} }, p.ticketCount ?? 10);
        }
        const r = runMonteCarlo(game, tickets, p.draws ?? 10000, seed);
        result = { ...r, tickets };
        summary = { draws: r.draws, tickets: tickets.length, anyPrizeDrawRate: r.anyPrize.drawRate, roiFixedOnly: r.finance.roiFixedOnly, allTiersConsistent: r.tiers.every((t) => t.consistent) };
        break;
      }
      case 'ml_research': {
        runType = 'ml';
        const r = runMlResearch(game, draws, { models: p.models as MlModelCode[] | undefined, trainFraction: p.trainFraction, maxDraws: p.maxDraws, seed });
        result = r;
        summary = { draws: r.draws, verdict: r.verdict, models: r.models.map((m) => ({ model: m.model, brierSkill: m.brierSkill, beatsBaseline: m.beatsBaseline })) };
        break;
      }
      case 'behavior': {
        if (!p.numbers) throw unprocessable('Cần params.numbers (bộ số chính) để phân tích hành vi');
        const issues = validateTicket(game, { main: p.numbers, special: game.specialMode === 'separate_pool' ? game.specialMin : null });
        if (issues.length) throw unprocessable('Bộ số không hợp lệ', issues);
        const r = behaviorScore(game, p.numbers);
        result = r;
        summary = { numbers: p.numbers, score: r.score, percentile: r.percentile };
        break;
      }
    }
  } catch (e) {
    if (e instanceof RangeError) throw new ApiError(422, 'model_input', e.message);
    throw e;
  }
  const modelCode = b.model;
  const run = await insertModelRun(c.env.DB, { modelCode, gameId: game.id, runType, params: { ...b, seed }, seed, draws, output: summary, durationMs: Date.now() - started, createdBy: c.get('user').id });
  return c.json({ data: { modelRunId: run.id, modelVersion: run.version, datasetHash: run.datasetHash, seed, dataDrawCount: draws.length, result } }, 201);
});
