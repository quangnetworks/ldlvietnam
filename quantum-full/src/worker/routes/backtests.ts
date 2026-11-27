/**
 * Backtesting Center — walk-forward, chạy theo từng đoạn (chunk) để không vượt giới hạn CPU mỗi request.
 * POST /backtests/run tạo phiên & chạy đoạn đầu; POST /backtests/:id/continue chạy tiếp tới khi hoàn tất.
 * Mỗi đoạn kiểm tra dataset hash để bảo đảm dữ liệu không thay đổi giữa chừng.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { runBacktestSteps, summarizeBacktest, type BacktestConfig, type StepResult } from '../../engine/backtest';
import type { StrategyCode } from '../../engine/strategies';
import { randomSeed } from '../../engine/rng';
import { datasetHash, loadDrawRecords } from '../db/draws';
import { getGame } from '../db/games';
import { insertModelRun } from '../db/models';
import { auditStatement } from '../lib/audit';
import { ApiError, PaginationQuery, conflict, notFound, nowIso, pageMeta, parseId, parseJson, parseQuery, unprocessable } from '../lib/http';
import { rateLimit } from '../lib/observability';
import type { AppEnv } from '../lib/types';

export const backtestRoutes = new Hono<AppEnv>();

/** Khối lượng tối đa (số lần sinh vé) cho một request. */
export const BACKTEST_WORK_PER_REQUEST = 3000;

const RunBody = z.object({
  game: z.string().min(1),
  strategies: z.array(z.enum(['balanced', 'statistical', 'bayesian', 'portfolio_optimized', 'random_uniform'])).min(1).max(5),
  tickets_per_draw: z.number().int().min(1).max(50).default(10),
  min_history: z.number().int().min(10).max(2000).default(50),
  max_draws: z.number().int().min(20).max(5000).optional(),
  seed: z.string().min(1).max(64).regex(/^[\w.\-:]+$/).nullable().optional(),
  include_unverified: z.boolean().default(false),
  params: z.object({ window: z.number().int().min(5).max(1000).optional(), priorStrength: z.number().min(0.1).max(100000).optional(), dirichletAlpha: z.number().min(0.01).max(1000).optional(), maxOverlap: z.number().int().min(0).max(10).optional(), avoidPopular: z.boolean().optional(), candidates: z.number().int().min(20).max(300).optional() }).default({}),
});

interface RunRow {
  id: number;
  game_id: number;
  status: 'running' | 'completed' | 'failed';
  strategies_json: string;
  tickets_per_draw: number;
  min_history: number;
  seed: string;
  params_json: string;
  include_unverified: number;
  data_cutoff_at: string | null;
  dataset_hash: string;
  total_draws: number;
  start_index: number;
  next_index: number;
  end_index: number;
  error: string | null;
  created_by: string;
  created_at: string;
  completed_at: string | null;
}

function configOf(r: RunRow): BacktestConfig {
  return { strategies: JSON.parse(r.strategies_json), ticketsPerDraw: r.tickets_per_draw, minHistory: r.min_history, seed: r.seed, params: JSON.parse(r.params_json) };
}

async function loadRunDraws(c: Context<AppEnv>, r: RunRow) {
  const all = await loadDrawRecords(c.env.DB, r.game_id, { includeUnverified: r.include_unverified === 1 });
  const upto = r.data_cutoff_at ? all.filter((d) => d.drawAt <= r.data_cutoff_at!) : all;
  return upto.slice(Math.max(0, upto.length - r.total_draws));
}

async function processChunk(c: Context<AppEnv>, r: RunRow): Promise<RunRow> {
  const db = c.env.DB;
  const game = await getGame(db, r.game_id);
  const draws = await loadRunDraws(c, r);
  if ((await datasetHash(draws)) !== r.dataset_hash) {
    await db.prepare("UPDATE backtest_runs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind('Dữ liệu lịch sử đã thay đổi trong khi chạy, kết quả bị huỷ để tránh sai lệch.', nowIso(), r.id).run();
    throw conflict('Dữ liệu lịch sử đã thay đổi trong khi backtest đang chạy; phiên đã bị đánh dấu thất bại.');
  }
  const cfg = configOf(r);
  const perDraw = cfg.strategies.length * cfg.ticketsPerDraw;
  const span = Math.max(1, Math.floor(BACKTEST_WORK_PER_REQUEST / perDraw));
  const from = r.next_index;
  const to = Math.min(r.end_index, from + span);
  const steps = runBacktestSteps(game, draws, cfg, from, to);
  const stmts: D1PreparedStatement[] = steps.map((s) =>
    db.prepare("INSERT INTO backtest_metrics (backtest_run_id, strategy_code, scope, draw_id, metrics_json) VALUES (?, ?, 'step', ?, ?) ON CONFLICT DO NOTHING").bind(r.id, s.strategy, s.drawId, JSON.stringify(s)),
  );
  const done = to >= r.end_index;
  const ts = nowIso();
  stmts.push(db.prepare('UPDATE backtest_runs SET next_index = ?, updated_at = ? WHERE id = ?').bind(to, ts, r.id));
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  if (done) {
    const all = await loadSteps(db, r.id);
    const summary = summarizeBacktest(game, all);
    const run = await insertModelRun(db, {
      modelCode: 'walk_forward_backtest',
      gameId: r.game_id,
      runType: 'backtest',
      params: { backtestRunId: r.id, ...cfg },
      seed: r.seed,
      draws,
      output: { verdict: summary.verdict, edgeProven: summary.edgeProven, strategies: summary.strategies.map((s) => ({ strategy: s.strategy, meanMatches: s.meanMatches.mean, hitRate: s.hitRate.rate, roi: s.roi })) },
      durationMs: 0,
      createdBy: r.created_by,
    });
    const fin: D1PreparedStatement[] = summary.strategies.map((s) =>
      db.prepare("INSERT INTO backtest_metrics (backtest_run_id, strategy_code, scope, draw_id, metrics_json) VALUES (?, ?, 'summary', NULL, ?)").bind(r.id, s.strategy, JSON.stringify(s)),
    );
    fin.push(db.prepare("UPDATE backtest_runs SET status = 'completed', model_run_id = ?, completed_at = ?, updated_at = ? WHERE id = ?").bind(run.id, ts, ts, r.id));
    await db.batch(fin);
  }
  return (await db.prepare('SELECT * FROM backtest_runs WHERE id = ?').bind(r.id).first<RunRow>())!;
}

async function loadSteps(db: D1Database, runId: number): Promise<StepResult[]> {
  const { results } = await db.prepare("SELECT metrics_json FROM backtest_metrics WHERE backtest_run_id = ? AND scope = 'step' ORDER BY id").bind(runId).all<{ metrics_json: string }>();
  return results.map((r) => JSON.parse(r.metrics_json) as StepResult);
}

function runView(r: RunRow) {
  const totalSteps = Math.max(0, r.end_index - r.start_index);
  return {
    id: r.id,
    gameId: r.game_id,
    status: r.status,
    strategies: JSON.parse(r.strategies_json) as StrategyCode[],
    ticketsPerDraw: r.tickets_per_draw,
    minHistory: r.min_history,
    seed: r.seed,
    params: JSON.parse(r.params_json),
    includeUnverified: r.include_unverified === 1,
    dataCutoffAt: r.data_cutoff_at,
    datasetHash: r.dataset_hash,
    totalDraws: r.total_draws,
    progress: { done: r.next_index - r.start_index, total: totalSteps, ratio: totalSteps ? (r.next_index - r.start_index) / totalSteps : 1 },
    error: r.error,
    createdBy: r.created_by,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  };
}

backtestRoutes.post('/backtests/run', rateLimit(5), async (c) => {
  const b = await parseJson(c, RunBody);
  const game = await getGame(c.env.DB, b.game);
  const strategies = Array.from(new Set<StrategyCode>(['random_uniform', ...b.strategies]));
  let draws = await loadDrawRecords(c.env.DB, game.id, { includeUnverified: b.include_unverified });
  if (b.max_draws) draws = draws.slice(Math.max(0, draws.length - b.max_draws));
  if (draws.length < b.min_history + 10) throw unprocessable(`Cần ít nhất ${b.min_history + 10} kỳ quay ${b.include_unverified ? '' : 'ĐÃ XÁC MINH '}(hiện có ${draws.length}). Hãy nhập & xác minh dữ liệu tại Data Center.`);
  const seed = b.seed ?? randomSeed();
  const hash = await datasetHash(draws);
  const row = await c.env.DB.prepare(
    `INSERT INTO backtest_runs (game_id, status, strategies_json, tickets_per_draw, min_history, seed, params_json, include_unverified, data_cutoff_at, dataset_hash, total_draws, start_index, next_index, end_index, created_by)
     VALUES (?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(game.id, JSON.stringify(strategies), b.tickets_per_draw, b.min_history, seed, JSON.stringify(b.params), b.include_unverified ? 1 : 0, draws[draws.length - 1].drawAt, hash, draws.length, b.min_history, b.min_history, draws.length, c.get('user').id)
    .first<RunRow>();
  await auditStatement(c, { action: 'backtests.create', entityType: 'backtest_run', entityId: row!.id, after: { ...b, strategies, seed, datasetHash: hash } }).run();
  const updated = await processChunk(c, row!);
  return c.json({ data: runView(updated) }, 201);
});

backtestRoutes.post('/backtests/:id/continue', rateLimit(1), async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM backtest_runs WHERE id = ?').bind(parseId(c)).first<RunRow>();
  if (!r) throw notFound('Phiên backtest');
  if (r.status !== 'running') return c.json({ data: runView(r) });
  try {
    return c.json({ data: runView(await processChunk(c, r)) });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    await c.env.DB.prepare("UPDATE backtest_runs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(String((e as Error).message).slice(0, 500), nowIso(), r.id).run();
    throw e;
  }
});

backtestRoutes.get('/backtests', async (c) => {
  const q = parseQuery(c, PaginationQuery.extend({ game: z.string().optional() }));
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.game) {
    const g = await getGame(c.env.DB, q.game);
    where.push('game_id = ?');
    binds.push(g.id);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM backtest_runs ${w}`).bind(...binds).first<{ n: number }>())!.n;
  const { results } = await c.env.DB.prepare(`SELECT * FROM backtest_runs ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).bind(...binds, q.page_size, (q.page - 1) * q.page_size).all<RunRow>();
  const data = [];
  for (const r of results) {
    const v = r.status === 'completed' ? await c.env.DB.prepare("SELECT metrics_json FROM backtest_metrics WHERE backtest_run_id = ? AND scope = 'summary'").bind(r.id).all<{ metrics_json: string }>() : null;
    const edge = v ? v.results.some((x) => (JSON.parse(x.metrics_json) as { vsBaseline?: { significant?: boolean } }).vsBaseline?.significant) : null;
    data.push({ ...runView(r), edgeProven: edge });
  }
  return c.json({ data, meta: pageMeta(q.page, q.page_size, total) });
});

backtestRoutes.get('/backtests/:id', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM backtest_runs WHERE id = ?').bind(parseId(c)).first<RunRow>();
  if (!r) throw notFound('Phiên backtest');
  const game = await getGame(c.env.DB, r.game_id);
  const steps = await loadSteps(c.env.DB, r.id);
  const summary = steps.length ? summarizeBacktest(game, steps) : null;
  const perDraw = steps
    .filter((s) => s.strategy === 'random_uniform')
    .map((s) => s.drawId)
    .slice(-200);
  const series = perDraw.map((id) => {
    const row: Record<string, number | string> = {};
    for (const s of steps.filter((x) => x.drawId === id)) {
      row.drawCode = s.drawCode;
      row.drawAt = s.drawAt;
      row[s.strategy] = s.matchHistogram.reduce((a, cnt, k) => a + cnt * k, 0) / Math.max(1, s.tickets.length);
    }
    return row;
  });
  return c.json({ data: { run: { ...runView(r), game: game.code }, summary, partial: r.status !== 'completed', series } });
});
