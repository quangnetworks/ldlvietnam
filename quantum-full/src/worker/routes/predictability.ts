import { Hono } from 'hono';
import { z } from 'zod';
import { predictabilityAudit } from '../../engine/predictability';
import { ODDS_MAX_TICKETS, portfolioOdds } from '../../engine/portfolioOdds';
import { validateTicket } from '../../engine/validation';
import { loadDrawRecords } from '../db/draws';
import { getGame } from '../db/games';
import { getSetting } from '../db/settings';
import { BoolQuery, badRequest, parseJson, parseQuery } from '../lib/http';
import { rateLimit } from '../lib/observability';
import type { AppEnv } from '../lib/types';

export const predictabilityRoutes = new Hono<AppEnv>();

const AuditQuery = z.object({
  game: z.string().min(1),
  include_unverified: z.enum(['true', 'false', '1', '0']).optional(),
  warmup: z.coerce.number().int().min(20).max(1000).optional(),
  window: z.coerce.number().int().min(5).max(500).optional(),
});

/** Phán quyết "có đoán được thuật toán quay số không" — chỉ đọc dữ liệu. */
predictabilityRoutes.get('/predictability', rateLimit(3), async (c) => {
  const q = parseQuery(c, AuditQuery);
  const game = await getGame(c.env.DB, q.game);
  const includeUnverified = q.include_unverified === undefined ? await getSetting<boolean>(c.env.DB, 'statistics_include_unverified', false) : BoolQuery.parse(q.include_unverified);
  const draws = await loadDrawRecords(c.env.DB, game.id, { includeUnverified });
  const result = predictabilityAudit(game, draws, { warmup: q.warmup, window: q.window });
  return c.json({
    data: { game: game.code, gameName: game.name, ...result },
    meta: { includeUnverified, dataNotice: includeUnverified ? 'Có bao gồm dữ liệu CHƯA XÁC MINH.' : 'Chỉ dùng dữ liệu đã xác minh.' },
  });
});

const OddsBody = z.object({
  game: z.string().min(1),
  tickets: z
    .array(z.object({ main: z.array(z.number().int()), special: z.number().int().nullable().optional() }))
    .min(1)
    .max(ODDS_MAX_TICKETS),
});

type JackpotStore = Record<string, { values: Record<string, number> }>;

/** Xác suất chính xác của cả danh mục vé trong một kỳ (tính toán thuần, không ghi dữ liệu). */
predictabilityRoutes.post('/portfolio/odds', rateLimit(5), async (c) => {
  const b = await parseJson(c, OddsBody);
  const game = await getGame(c.env.DB, b.game);
  const tickets = b.tickets.map((t) => ({ main: [...t.main].sort((x, y) => x - y), special: t.special ?? null }));
  const issues = tickets.flatMap((t, i) => validateTicket(game, t).map((v) => `Vé ${i + 1}: ${v.message}`));
  if (issues.length) throw badRequest('Vé không hợp lệ theo thể lệ', issues);
  const jackpots = (await getSetting<JackpotStore>(c.env.DB, 'current_jackpots', {}))[game.code]?.values ?? {};
  return c.json({ data: { game: game.code, ...portfolioOdds(game, tickets, jackpots) } });
});
