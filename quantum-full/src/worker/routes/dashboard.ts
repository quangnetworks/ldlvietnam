import { Hono } from 'hono';
import { z } from 'zod';
import { probabilitySummary } from '../../engine/probability';
import { frequencyAnalysis, distributionAnalysis, sumSeries } from '../../engine/statistics';
import { loadDrawRecords, DRAW_SELECT, mapDraw, type DrawRow } from '../db/draws';
import { getGame } from '../db/games';
import { parseQuery } from '../lib/http';
import type { AppEnv } from '../lib/types';
import { capitalSummary } from '../services/capital';

export const dashboardRoutes = new Hono<AppEnv>();

dashboardRoutes.get('/dashboard', async (c) => {
  const q = parseQuery(c, z.object({ game: z.string().min(1) }));
  const db = c.env.DB;
  const game = await getGame(db, q.game);
  const counts = await db.prepare('SELECT verification_status AS s, COUNT(*) AS n FROM draws WHERE game_id = ? GROUP BY verification_status').bind(game.id).all<{ s: string; n: number }>();
  const verified = await loadDrawRecords(db, game.id, { includeUnverified: false });
  const recentDraws = await db.prepare(`${DRAW_SELECT} WHERE d.game_id = ? ORDER BY d.draw_at DESC LIMIT 10`).bind(game.id).all<DrawRow>();
  const recs = await db
    .prepare('SELECT id, strategy_code, algorithm_version, ticket_count, total_cost, target_draw_date, validation_status, created_at FROM recommendations WHERE game_id = ? ORDER BY id DESC LIMIT 5')
    .bind(game.id)
    .all();
  const backtests = await db.prepare('SELECT id, status, strategies_json, total_draws, created_at, completed_at FROM backtest_runs WHERE game_id = ? ORDER BY id DESC LIMIT 5').bind(game.id).all<Record<string, unknown>>();
  const portfolios = await db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'evaluated' THEN 1 ELSE 0 END) AS evaluated, SUM(CASE WHEN status IN ('draft','purchased') THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN mode = 'real' THEN 1 ELSE 0 END) AS real FROM portfolios WHERE game_id = ?`,
    )
    .bind(game.id)
    .first();
  const activity = await db
    .prepare(
      `SELECT r.id, r.run_type, r.created_at, r.created_by, mv.name AS model_name, mv.version FROM model_runs r JOIN model_versions mv ON mv.id = r.model_version_id WHERE r.game_id = ? ORDER BY r.id DESC LIMIT 8`,
    )
    .bind(game.id)
    .all();
  const freq = frequencyAnalysis(game, verified);
  const dist = distributionAnalysis(game, verified);
  return c.json({
    data: {
      game,
      drawCounts: Object.fromEntries(counts.results.map((r) => [r.s, r.n])),
      verifiedDraws: verified.length,
      lastDraw: recentDraws.results[0] ? mapDraw(recentDraws.results[0]) : null,
      recentDraws: recentDraws.results.map(mapDraw),
      probability: probabilitySummary(game),
      frequency: { numbers: freq.numbers, chiSquare: freq.chiSquare, sample: freq.sample, special: freq.special },
      oddEven: dist.oddEven,
      lowHigh: dist.lowHigh,
      sumSeries: sumSeries(verified).slice(-100),
      recommendations: recs.results,
      backtests: backtests.results.map((b) => ({ ...b, strategies: JSON.parse(String(b.strategies_json)) })),
      portfolios,
      capital: await capitalSummary(db, 'real'),
      activity: activity.results,
    },
  });
});
