import { Hono } from 'hono';
import { z } from 'zod';
import { getGame } from '../db/games';
import { validateTicket } from '../../engine/validation';
import { vnClock } from '../../engine/decision';
import type { Game } from '../../shared/game';
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

const TicketInput = z.object({ main: z.array(z.number().int()), special: z.number().int().nullable().optional() });
const TimeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ManualBody = z.object({
  game: z.string().min(1),
  name: z.string().min(1).max(100),
  mode: z.enum(['simulated', 'real']),
  target_draw_date: DateStr,
  target_draw_time: TimeStr.nullable().optional(),
  tickets: z.array(TicketInput).min(1).max(200),
  notes: z.string().max(1000).optional(),
});

const UpdateBody = z.object({
  name: z.string().min(1).max(100).optional(),
  target_draw_date: DateStr.optional(),
  target_draw_time: TimeStr.nullable().optional(),
  tickets: z.array(TicketInput).min(1).max(200).optional(),
  notes: z.string().max(1000).nullable().optional(),
});

function normalizeTickets(game: Game, tickets: z.infer<typeof TicketInput>[]) {
  const norm = tickets.map((t) => ({ main: [...t.main].sort((a, b) => a - b), special: t.special ?? null }));
  const issues = norm.flatMap((t, i) => validateTicket(game, t).map((v) => `Vé ${i + 1}: ${v.message}`));
  if (issues.length) throw unprocessable('Vé không hợp lệ theo thể lệ', issues);
  return norm;
}

/** Game nhiều kỳ/ngày (Lotto 5/35: 13:00, 21:00) phải chọn giờ quay; game một kỳ/ngày lấy giờ theo lịch. */
function resolveTime(game: Game, time: string | null | undefined): string | null {
  const times = game.drawSchedule?.times ?? [];
  if (time) {
    if (times.length && !times.includes(time)) throw unprocessable(`Giờ quay của ${game.name} phải là một trong: ${times.join(', ')}`);
    return time;
  }
  if (times.length > 1) throw unprocessable(`${game.name} quay ${times.length} kỳ mỗi ngày (${times.join(', ')}); hãy chọn giờ quay để chấm được vé.`);
  return times[0] ?? null;
}

/** Kỳ mục tiêu đã quay (hoặc đã quá giờ) theo giờ Việt Nam. */
function drawPassed(date: string, time: string | null): boolean {
  const now = vnClock(new Date().toISOString());
  if (date < now.date) return true;
  if (date > now.date) return false;
  if (!time) return false;
  const [hh, mm] = time.split(':').map(Number);
  return now.minutes >= hh * 60 + mm;
}

function ticketStatements(db: D1Database, pid: number, tickets: { main: number[]; special: number | null }[], price: number): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [];
  tickets.forEach((t, i) => {
    stmts.push(db.prepare('INSERT INTO tickets (portfolio_id, ticket_index, special_number, cost) VALUES (?, ?, ?, ?)').bind(pid, i, t.special, price));
    stmts.push(
      db
        .prepare(`INSERT INTO ticket_numbers (ticket_id, position, number) VALUES ${t.main.map(() => '((SELECT id FROM tickets WHERE portfolio_id = ? AND ticket_index = ?), ?, ?)').join(', ')}`)
        .bind(...t.main.flatMap((n, pos) => [pid, i, pos, n])),
    );
  });
  return stmts;
}

/**
 * Nhập danh mục bằng tay: vé đã mua thật (mode real) hoặc bộ số tự chọn để mô phỏng.
 * Mô phỏng không được nhắm kỳ đã quay (chọn vé sau khi biết kết quả); vé thật được ghi nhận cả sau giờ quay, có đánh dấu.
 */
portfolioRoutes.post('/portfolios/manual', async (c) => {
  const b = await parseJson(c, ManualBody);
  const game = await getGame(c.env.DB, b.game);
  const tickets = normalizeTickets(game, b.tickets);
  const time = resolveTime(game, b.target_draw_time);
  const passed = drawPassed(b.target_draw_date, time);
  if (b.mode === 'simulated' && passed) throw unprocessable('Danh mục mô phỏng không được nhắm kỳ đã quay (tránh chọn vé sau khi biết kết quả). Vé đã mua thật hãy chọn loại "Thực tế".');
  const notes = [b.notes, passed ? 'Nhập sau giờ quay.' : null].filter(Boolean).join(' ') || null;
  const price = game.ticketPrice;
  const user = c.get('user');
  const p = await c.env.DB.prepare(
    `INSERT INTO portfolios (game_id, recommendation_id, name, mode, status, target_draw_date, target_draw_time, ticket_count, total_cost, notes, created_by)
     VALUES (?, NULL, ?, ?, 'draft', ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(game.id, b.name, b.mode, b.target_draw_date, time, tickets.length, tickets.length * price, notes, user.id)
    .first<{ id: number }>();
  const pid = p!.id;
  const stmts = ticketStatements(c.env.DB, pid, tickets, price);
  stmts.push(auditStatement(c, { action: 'portfolios.create_manual', entityType: 'portfolio', entityId: pid, after: { game: game.code, name: b.name, mode: b.mode, targetDrawDate: b.target_draw_date, targetDrawTime: time, tickets, enteredAfterDraw: passed } }));
  for (let i = 0; i < stmts.length; i += 100) await c.env.DB.batch(stmts.slice(i, i + 100));
  return c.json({ data: { id: pid, enteredAfterDraw: passed } }, 201);
});

/**
 * Sửa danh mục: tên, ghi chú, ngày/giờ quay mục tiêu (nháp hoặc đã mua, chưa chấm); vé chỉ sửa khi còn nháp
 * (đã mua thì chi phí đã ghi sổ quỹ). Đổi kỳ mục tiêu sẽ bỏ liên kết kỳ cũ để chấm lại đúng kỳ.
 */
portfolioRoutes.put('/portfolios/:id', async (c) => {
  const id = parseId(c);
  const b = await parseJson(c, UpdateBody);
  const p = await getPortfolio(c.env.DB, id);
  if (p.status === 'evaluated' || p.status === 'cancelled') throw conflict(`Danh mục đang ở trạng thái ${p.status}; không sửa được.`);
  if (b.tickets && p.status !== 'draft') throw conflict('Chỉ sửa được vé khi danh mục còn nháp (đã mua thì chi phí đã ghi sổ quỹ).');
  const game = await getGame(c.env.DB, p.game_id);
  const date = b.target_draw_date ?? p.target_draw_date;
  if (!date) throw unprocessable('Thiếu ngày quay mục tiêu');
  const timeChanged = b.target_draw_time !== undefined;
  const time = timeChanged || b.target_draw_date !== undefined ? resolveTime(game, timeChanged ? b.target_draw_time : p.target_draw_time) : p.target_draw_time;
  const targetChanged = date !== p.target_draw_date || time !== p.target_draw_time;
  if (p.mode === 'simulated' && targetChanged && drawPassed(date, time)) throw unprocessable('Danh mục mô phỏng không được chuyển sang kỳ đã quay.');
  const tickets = b.tickets ? normalizeTickets(game, b.tickets) : null;
  const ts = nowIso();
  const before = { name: p.name, targetDrawDate: p.target_draw_date, targetDrawTime: p.target_draw_time, ticketCount: p.ticket_count, tickets: tickets ? await loadPortfolioTickets(c.env.DB, id) : undefined };
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE portfolios SET name = ?, notes = ?, target_draw_date = ?, target_draw_time = ?, target_draw_id = CASE WHEN ? THEN NULL ELSE target_draw_id END,
         ticket_count = ?, total_cost = ?, updated_at = ? WHERE id = ? AND status IN ('draft', 'purchased')`,
    ).bind(
      b.name ?? p.name,
      b.notes === undefined ? ((p as PortfolioRow & { notes?: string | null }).notes ?? null) : b.notes,
      date,
      time,
      targetChanged ? 1 : 0,
      tickets ? tickets.length : p.ticket_count,
      tickets ? tickets.length * game.ticketPrice : p.total_cost,
      ts,
      id,
    ),
  ];
  if (tickets) {
    stmts.push(c.env.DB.prepare('DELETE FROM ticket_numbers WHERE ticket_id IN (SELECT id FROM tickets WHERE portfolio_id = ?)').bind(id));
    stmts.push(c.env.DB.prepare('DELETE FROM tickets WHERE portfolio_id = ?').bind(id));
    stmts.push(...ticketStatements(c.env.DB, id, tickets, game.ticketPrice));
  }
  stmts.push(auditStatement(c, { action: 'portfolios.update', entityType: 'portfolio', entityId: id, before, after: { name: b.name ?? p.name, targetDrawDate: date, targetDrawTime: time, tickets: tickets ?? undefined } }));
  for (let i = 0; i < stmts.length; i += 100) await c.env.DB.batch(stmts.slice(i, i + 100));
  return c.json({ data: { ...(await getPortfolio(c.env.DB, id)), tickets: await loadPortfolioTickets(c.env.DB, id) } });
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
