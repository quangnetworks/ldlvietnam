import { Hono } from 'hono';
import { z } from 'zod';
import { getGame } from '../db/games';
import { auditStatement } from '../lib/audit';
import { requireRole } from '../lib/auth';
import { ApiError, PaginationQuery, conflict, notFound, nowIso, pageMeta, parseId, parseJson, parseQuery, unprocessable } from '../lib/http';
import type { AppEnv } from '../lib/types';
import { checkRealPurchaseLimits, vnToday } from '../services/capital';
import { loadRecommendation } from '../services/generator';
import { evaluatePortfolio, loadPortfolioTickets, type PortfolioRow } from '../services/tracking';

export const portfolioRoutes = new Hono<AppEnv>();

const CreateBody = z.object({
  recommendation_id: z.number().int().positive(),
  name: z.string().min(1).max(100),
  mode: z.enum(['simulated', 'real']),
  target_draw_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  target_draw_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  notes: z.string().max(1000).optional(),
});

portfolioRoutes.post('/portfolios', async (c) => {
  const b = await parseJson(c, CreateBody);
  const rec = await loadRecommendation(c.env.DB, b.recommendation_id);
  if (!rec) throw notFound('Bộ số đã sinh');
  if (rec.target_draw_date && rec.target_draw_date !== b.target_draw_date) throw unprocessable('Ngày quay mục tiêu phải trùng với ngày đã dùng khi sinh bộ số');
  if (b.target_draw_date < vnToday()) throw unprocessable('Không thể lưu danh mục cho kỳ quay đã qua (tránh chọn vé sau khi biết kết quả).');
  const ticketCount = rec.tickets.length;
  const price = Number(rec.ticket_price);
  const user = c.get('user');
  const p = await c.env.DB.prepare(
    `INSERT INTO portfolios (game_id, recommendation_id, name, mode, status, target_draw_date, target_draw_time, ticket_count, total_cost, notes, created_by)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(rec.game_id, rec.id, b.name, b.mode, b.target_draw_date, b.target_draw_time ?? null, ticketCount, ticketCount * price, b.notes ?? null, user.id)
    .first<{ id: number }>();
  const pid = p!.id;
  const stmts: D1PreparedStatement[] = [];
  rec.tickets.forEach((t, i) => {
    stmts.push(c.env.DB.prepare('INSERT INTO tickets (portfolio_id, ticket_index, special_number, cost) VALUES (?, ?, ?, ?)').bind(pid, i, t.special, price));
    stmts.push(
      c.env.DB.prepare(`INSERT INTO ticket_numbers (ticket_id, position, number) VALUES ${t.main.map(() => '((SELECT id FROM tickets WHERE portfolio_id = ? AND ticket_index = ?), ?, ?)').join(', ')}`).bind(
        ...t.main.flatMap((n, pos) => [pid, i, pos, n]),
      ),
    );
  });
  stmts.push(auditStatement(c, { action: 'portfolios.create', entityType: 'portfolio', entityId: pid, after: { ...b, ticketCount, totalCost: ticketCount * price } }));
  for (let i = 0; i < stmts.length; i += 100) await c.env.DB.batch(stmts.slice(i, i + 100));
  return c.json({ data: { id: pid } }, 201);
});

portfolioRoutes.get('/portfolios', async (c) => {
  const q = parseQuery(c, PaginationQuery.extend({ game: z.string().optional(), mode: z.enum(['simulated', 'real']).optional(), status: z.string().optional() }));
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.game) {
    const g = await getGame(c.env.DB, q.game);
    where.push('p.game_id = ?');
    binds.push(g.id);
  }
  if (q.mode) (where.push('p.mode = ?'), binds.push(q.mode));
  if (q.status) (where.push('p.status = ?'), binds.push(q.status));
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM portfolios p ${w}`).bind(...binds).first<{ n: number }>())!.n;
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, g.code AS game_code, g.name AS game_name,
      (SELECT COALESCE(SUM(r.prize_amount), 0) FROM ticket_results r JOIN tickets t ON t.id = r.ticket_id WHERE t.portfolio_id = p.id) AS fixed_prizes,
      (SELECT COUNT(*) FROM ticket_results r JOIN tickets t ON t.id = r.ticket_id WHERE t.portfolio_id = p.id AND r.prize_tier_code IS NOT NULL) AS winning_tickets
     FROM portfolios p JOIN games g ON g.id = p.game_id ${w} ORDER BY p.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, q.page_size, (q.page - 1) * q.page_size)
    .all();
  return c.json({ data: results, meta: pageMeta(q.page, q.page_size, total) });
});

async function getPortfolio(db: D1Database, id: number): Promise<PortfolioRow> {
  const p = await db.prepare('SELECT * FROM portfolios WHERE id = ?').bind(id).first<PortfolioRow>();
  if (!p) throw notFound('Danh mục');
  return p;
}

portfolioRoutes.get('/portfolios/:id', async (c) => {
  const p = await getPortfolio(c.env.DB, parseId(c));
  const game = await getGame(c.env.DB, p.game_id);
  return c.json({ data: { ...p, game: { code: game.code, name: game.name }, tickets: await loadPortfolioTickets(c.env.DB, p.id) } });
});

const PurchaseBody = z.object({ purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), note: z.string().max(500).optional() });

/** Ghi nhận MUA VÉ THỰC TẾ (người dùng tự mua bên ngoài). Kiểm tra hạn mức vốn; không vượt giới hạn. */
portfolioRoutes.post('/portfolios/:id/purchase', requireRole('admin'), async (c) => {
  const p = await getPortfolio(c.env.DB, parseId(c));
  const b = await parseJson(c, PurchaseBody);
  if (p.mode !== 'real') throw unprocessable('Chỉ danh mục THỰC TẾ mới được ghi nhận mua vé; danh mục mô phỏng không phát sinh chi phí thật.');
  if (p.status !== 'draft') throw conflict(`Danh mục đang ở trạng thái ${p.status}`);
  const purchaseDate = b.purchase_date ?? vnToday();
  if (p.target_draw_date && purchaseDate > p.target_draw_date) throw unprocessable('Ngày mua phải trước hoặc trong ngày quay');
  const issues = await checkRealPurchaseLimits(c.env.DB, p.game_id, p.total_cost, p.target_draw_date ?? purchaseDate, purchaseDate);
  if (issues.length) throw new ApiError(422, 'capital_limit', issues.join('; '), issues);
  const user = c.get('user');
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE portfolios SET status = 'purchased', purchased_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'").bind(nowIso(), nowIso(), p.id),
    c.env.DB.prepare("INSERT INTO bankroll_ledger (entry_type, mode, amount, game_id, portfolio_id, entry_date, note, created_by) VALUES ('purchase', 'real', ?, ?, ?, ?, ?, ?)").bind(
      -p.total_cost, p.game_id, p.id, purchaseDate, b.note ?? `Mua vé: ${p.name}`, user.id,
    ),
    auditStatement(c, { action: 'portfolios.purchase', entityType: 'portfolio', entityId: p.id, after: { cost: p.total_cost, purchaseDate } }),
  ]);
  return c.json({ data: await getPortfolio(c.env.DB, p.id) });
});

portfolioRoutes.post('/portfolios/:id/cancel', async (c) => {
  const p = await getPortfolio(c.env.DB, parseId(c));
  if (p.status !== 'draft') throw conflict('Chỉ huỷ được danh mục nháp (chưa mua/chưa chấm)');
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE portfolios SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(nowIso(), p.id),
    auditStatement(c, { action: 'portfolios.cancel', entityType: 'portfolio', entityId: p.id }),
  ]);
  return c.json({ data: await getPortfolio(c.env.DB, p.id) });
});

portfolioRoutes.post('/portfolios/:id/evaluate', async (c) => {
  const p = await getPortfolio(c.env.DB, parseId(c));
  return c.json({ data: await evaluatePortfolio(c, p) });
});

/** Chấm tất cả danh mục đang chờ có kết quả đã xác minh. */
portfolioRoutes.post('/tracking/evaluate', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM portfolios WHERE status IN ('draft', 'purchased') AND target_draw_date IS NOT NULL AND target_draw_date <= ? ORDER BY id LIMIT 50",
  )
    .bind(vnToday())
    .all<PortfolioRow>();
  const out = [];
  for (const p of results) {
    if (p.mode === 'real' && p.status === 'draft') continue;
    out.push({ portfolioId: p.id, name: p.name, ...(await evaluatePortfolio(c, p)) });
  }
  return c.json({ data: { checked: out.length, results: out } });
});
