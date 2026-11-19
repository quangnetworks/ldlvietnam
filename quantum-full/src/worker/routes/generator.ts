import { Hono } from 'hono';
import { z } from 'zod';
import { STRATEGIES } from '../../engine/strategies';
import { getGame } from '../db/games';
import { PaginationQuery, notFound, pageMeta, parseId, parseJson, parseQuery } from '../lib/http';
import { rateLimit } from '../lib/observability';
import type { AppEnv } from '../lib/types';
import { GenerateBody, generateAndStore, loadRecommendation } from '../services/generator';

export const generatorRoutes = new Hono<AppEnv>();

generatorRoutes.get('/generator/strategies', (c) => c.json({ data: Object.values(STRATEGIES) }));

generatorRoutes.post('/generator/generate', rateLimit(3), async (c) => {
  const body = await parseJson(c, GenerateBody);
  const game = await getGame(c.env.DB, body.game);
  const result = await generateAndStore(c, game, body, 'generate');
  return c.json({ data: result }, 201);
});

const PortfolioBody = GenerateBody.omit({ strategy: true });

generatorRoutes.post('/portfolio/optimize', rateLimit(5), async (c) => {
  const body = await parseJson(c, PortfolioBody);
  const game = await getGame(c.env.DB, body.game);
  const result = await generateAndStore(c, game, { ...body, strategy: 'portfolio_optimized' }, 'portfolio');
  return c.json({ data: result }, 201);
});

generatorRoutes.get('/recommendations', async (c) => {
  const q = parseQuery(c, PaginationQuery.extend({ game: z.string().optional(), strategy: z.string().optional() }));
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.game) {
    const g = await getGame(c.env.DB, q.game);
    where.push('r.game_id = ?');
    binds.push(g.id);
  }
  if (q.strategy) (where.push('r.strategy_code = ?'), binds.push(q.strategy));
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM recommendations r ${w}`).bind(...binds).first<{ n: number }>())!.n;
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.model_run_id, r.strategy_code, r.algorithm_version, r.target_draw_date, r.seed, r.data_cutoff_at, r.data_draw_count, r.ticket_count, r.total_cost, r.budget, r.validation_status, r.created_by, r.created_at, g.code AS game_code
     FROM recommendations r JOIN games g ON g.id = r.game_id ${w} ORDER BY r.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, q.page_size, (q.page - 1) * q.page_size)
    .all();
  return c.json({ data: results, meta: pageMeta(q.page, q.page_size, total) });
});

generatorRoutes.get('/recommendations/:id', async (c) => {
  const rec = await loadRecommendation(c.env.DB, parseId(c));
  if (!rec) throw notFound('Bộ số đã sinh');
  return c.json({ data: rec });
});
