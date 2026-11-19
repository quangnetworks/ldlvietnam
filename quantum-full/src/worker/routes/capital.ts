import { Hono } from 'hono';
import { z } from 'zod';
import { auditStatement } from '../lib/audit';
import { requireRole } from '../lib/auth';
import { PaginationQuery, notFound, pageMeta, parseJson, parseQuery } from '../lib/http';
import type { AppEnv } from '../lib/types';
import { capitalSummary } from '../services/capital';

export const capitalRoutes = new Hono<AppEnv>();

capitalRoutes.get('/capital/summary', async (c) => {
  const q = parseQuery(c, z.object({ mode: z.enum(['real', 'simulated']).default('real') }));
  return c.json({ data: await capitalSummary(c.env.DB, q.mode) });
});

capitalRoutes.get('/capital/ledger', async (c) => {
  const q = parseQuery(c, PaginationQuery.extend({ mode: z.enum(['real', 'simulated']).optional() }));
  const w = q.mode ? 'WHERE l.mode = ?' : '';
  const binds = q.mode ? [q.mode] : [];
  const total = (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM bankroll_ledger l ${w}`).bind(...binds).first<{ n: number }>())!.n;
  const { results } = await c.env.DB.prepare(
    `SELECT l.*, p.name AS portfolio_name, d.draw_code FROM bankroll_ledger l LEFT JOIN portfolios p ON p.id = l.portfolio_id LEFT JOIN draws d ON d.id = l.draw_id ${w} ORDER BY l.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, q.page_size, (q.page - 1) * q.page_size)
    .all();
  return c.json({ data: results, meta: pageMeta(q.page, q.page_size, total) });
});

const EntryBody = z
  .object({
    entry_type: z.enum(['prize', 'adjustment']),
    mode: z.enum(['real', 'simulated']),
    amount: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000),
    portfolio_id: z.number().int().positive().nullable().optional(),
    draw_id: z.number().int().positive().nullable().optional(),
    entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().min(5).max(500),
  })
  .refine((b) => b.entry_type !== 'prize' || b.amount >= 0, { message: 'Tiền thưởng phải ≥ 0' });

/** Bút toán thủ công: giải Jackpot thực nhận (giá trị biến động) hoặc điều chỉnh. Sổ quỹ bất biến — sai thì lập bút toán điều chỉnh. */
capitalRoutes.post('/capital/ledger', requireRole('admin'), async (c) => {
  const b = await parseJson(c, EntryBody);
  if (b.portfolio_id) {
    const p = await c.env.DB.prepare('SELECT id FROM portfolios WHERE id = ?').bind(b.portfolio_id).first();
    if (!p) throw notFound('Danh mục');
  }
  const row = await c.env.DB.prepare(
    'INSERT INTO bankroll_ledger (entry_type, mode, amount, portfolio_id, draw_id, entry_date, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(b.entry_type, b.mode, b.amount, b.portfolio_id ?? null, b.draw_id ?? null, b.entry_date, b.note, c.get('user').id)
    .first<{ id: number }>();
  await auditStatement(c, { action: 'ledger.create', entityType: 'bankroll_ledger', entityId: row!.id, after: b }).run();
  return c.json({ data: { id: row!.id } }, 201);
});
