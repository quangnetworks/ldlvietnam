import { Hono } from 'hono';
import { z } from 'zod';
import { GameRulesSchema } from '../../shared/game';
import { probabilitySummary } from '../../engine/probability';
import { getGame, listGames } from '../db/games';
import { getAllSettings } from '../db/settings';
import { auditStatement } from '../lib/audit';
import { requireRole } from '../lib/auth';
import { parseJson, parseId, nowIso } from '../lib/http';
import type { AppEnv } from '../lib/types';

export const systemRoutes = new Hono<AppEnv>();

systemRoutes.get('/me', (c) => c.json({ data: c.get('user') }));

systemRoutes.get('/games', async (c) => {
  const games = await listGames(c.env.DB);
  return c.json({ data: games });
});

systemRoutes.get('/games/:code/probability', async (c) => {
  const game = await getGame(c.env.DB, c.req.param('code'));
  return c.json({ data: { game: game.code, rulesVerificationStatus: game.rulesVerificationStatus, ...probabilitySummary(game) } });
});

const GameUpdate = z.object({
  name: z.string().min(1).max(64).optional(),
  ticketPrice: z.number().int().min(1).max(10_000_000).optional(),
  prizeTiers: GameRulesSchema.shape.prizeTiers.optional(),
  scheduleNote: z.string().max(500).nullable().optional(),
  rulesNote: z.string().max(2000).nullable().optional(),
  rulesSourceUrl: z.url().max(500).nullable().optional(),
  rulesVerificationStatus: z.enum(['unverified', 'verified']).optional(),
  isActive: z.boolean().optional(),
});

systemRoutes.put('/admin/games/:id', requireRole('admin'), async (c) => {
  const id = parseId(c);
  const before = await getGame(c.env.DB, id);
  const body = await parseJson(c, GameUpdate);
  const next = { ...before, ...body };
  const check = GameRulesSchema.safeParse(next);
  if (!check.success) return c.json({ error: { code: 'validation_error', message: 'Cấu hình game không hợp lệ', details: z.treeifyError(check.error) } }, 400);
  const verifiedAt = body.rulesVerificationStatus === 'verified' && before.rulesVerificationStatus !== 'verified' ? nowIso() : body.rulesVerificationStatus === 'unverified' ? null : before.rulesVerifiedAt;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE games SET name = ?, ticket_price = ?, prize_tiers_json = ?, schedule_note = ?, rules_note = ?, rules_source_url = ?,
       rules_verification_status = ?, rules_verified_at = ?, is_active = ?, updated_at = ? WHERE id = ?`,
    ).bind(next.name, next.ticketPrice, JSON.stringify(next.prizeTiers), next.scheduleNote, next.rulesNote, next.rulesSourceUrl, next.rulesVerificationStatus, verifiedAt, next.isActive ? 1 : 0, nowIso(), id),
    auditStatement(c, { action: 'games.update', entityType: 'game', entityId: id, before, after: body }),
  ]);
  return c.json({ data: await getGame(c.env.DB, id) });
});

systemRoutes.get('/settings', async (c) => c.json({ data: await getAllSettings(c.env.DB) }));

const SettingsUpdate = z.object({
  budget_per_draw: z.number().int().min(0).max(100_000_000).optional(),
  monthly_budget: z.number().int().min(0).max(1_000_000_000).optional(),
  annual_budget: z.number().int().min(0).max(10_000_000_000).optional(),
  statistics_include_unverified: z.boolean().optional(),
});

systemRoutes.put('/admin/settings', requireRole('admin'), async (c) => {
  const body = await parseJson(c, SettingsUpdate);
  const before = await getAllSettings(c.env.DB);
  const next = { budget: Number(before.budget_per_draw?.value), monthly: Number(before.monthly_budget?.value), annual: Number(before.annual_budget?.value) };
  if (body.budget_per_draw !== undefined) next.budget = body.budget_per_draw;
  if (body.monthly_budget !== undefined) next.monthly = body.monthly_budget;
  if (body.annual_budget !== undefined) next.annual = body.annual_budget;
  if (next.budget > next.monthly || next.monthly > next.annual) {
    return c.json({ error: { code: 'validation_error', message: 'Yêu cầu: ngân sách/kỳ ≤ hạn mức tháng ≤ hạn mức năm' } }, 400);
  }
  const user = c.get('user');
  const stmts = Object.entries(body).map(([k, v]) =>
    c.env.DB.prepare('UPDATE app_settings SET value_json = ?, updated_by = ?, updated_at = ? WHERE key = ?').bind(JSON.stringify(v), user.id, nowIso(), k),
  );
  stmts.push(auditStatement(c, { action: 'settings.update', entityType: 'app_settings', before: Object.fromEntries(Object.keys(body).map((k) => [k, before[k]?.value])), after: body }));
  await c.env.DB.batch(stmts);
  return c.json({ data: await getAllSettings(c.env.DB) });
});
