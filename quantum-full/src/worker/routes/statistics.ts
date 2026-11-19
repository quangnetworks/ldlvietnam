import { Hono } from 'hono';
import { z } from 'zod';
import { comboFrequency, distributionAnalysis, frequencyAnalysis, rollingWindows, sampleInfo, sumSeries } from '../../engine/statistics';
import { loadDrawRecords } from '../db/draws';
import { getGame } from '../db/games';
import { getSetting } from '../db/settings';
import { BoolQuery, parseQuery } from '../lib/http';
import type { AppEnv } from '../lib/types';
import type { Context } from 'hono';

export const statisticsRoutes = new Hono<AppEnv>();

const StatQuery = z.object({
  game: z.string().min(1),
  include_unverified: z.enum(['true', 'false', '1', '0']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  last: z.coerce.number().int().min(1).max(100000).optional(),
});

export async function loadForStats(c: Context<AppEnv>, q: z.infer<typeof StatQuery>) {
  const game = await getGame(c.env.DB, q.game);
  const includeUnverified = q.include_unverified === undefined ? await getSetting<boolean>(c.env.DB, 'statistics_include_unverified', false) : BoolQuery.parse(q.include_unverified);
  const draws = await loadDrawRecords(c.env.DB, game.id, { includeUnverified, from: q.from, to: q.to, last: q.last });
  return { game, draws, includeUnverified };
}

function meta(includeUnverified: boolean, n: number) {
  return { includeUnverified, draws: n, dataNotice: includeUnverified ? 'Có bao gồm dữ liệu CHƯA XÁC MINH.' : 'Chỉ dùng dữ liệu đã xác minh.' };
}

statisticsRoutes.get('/statistics/frequency', async (c) => {
  const q = parseQuery(c, StatQuery);
  const { game, draws, includeUnverified } = await loadForStats(c, q);
  return c.json({ data: { game: game.code, ...frequencyAnalysis(game, draws), rolling: rollingWindows(game, draws) }, meta: meta(includeUnverified, draws.length) });
});

statisticsRoutes.get('/statistics/distribution', async (c) => {
  const q = parseQuery(c, StatQuery);
  const { game, draws, includeUnverified } = await loadForStats(c, q);
  return c.json({ data: { game: game.code, ...distributionAnalysis(game, draws), sumSeries: sumSeries(draws).slice(-300) }, meta: meta(includeUnverified, draws.length) });
});

const ComboQuery = StatQuery.extend({ top: z.coerce.number().int().min(1).max(200).default(30) });

statisticsRoutes.get('/statistics/pairs', async (c) => {
  const q = parseQuery(c, ComboQuery);
  const { game, draws, includeUnverified } = await loadForStats(c, q);
  return c.json({ data: { game: game.code, ...comboFrequency(game, draws, 2, q.top) }, meta: meta(includeUnverified, draws.length) });
});

statisticsRoutes.get('/statistics/triplets', async (c) => {
  const q = parseQuery(c, ComboQuery);
  const { game, draws, includeUnverified } = await loadForStats(c, q);
  if (game.mainPicks < 3) return c.json({ data: null, meta: { ...meta(includeUnverified, draws.length), message: 'Game có ít hơn 3 số' } });
  return c.json({ data: { game: game.code, ...comboFrequency(game, draws, 3, q.top) }, meta: meta(includeUnverified, draws.length) });
});

statisticsRoutes.get('/statistics/summary', async (c) => {
  const q = parseQuery(c, StatQuery);
  const { game, draws, includeUnverified } = await loadForStats(c, q);
  return c.json({ data: { game: game.code, sample: sampleInfo(game, draws) }, meta: meta(includeUnverified, draws.length) });
});
