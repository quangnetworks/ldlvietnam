import { Hono } from 'hono';
import { z } from 'zod';
import { requireRole } from '../lib/auth';
import { PaginationQuery, pageMeta, parseQuery } from '../lib/http';
import type { AppEnv } from '../lib/types';

export const auditRoutes = new Hono<AppEnv>();

auditRoutes.get('/audit', requireRole('admin'), async (c) => {
  const q = parseQuery(c, PaginationQuery.extend({ action: z.string().max(64).optional(), entity_type: z.string().max(64).optional(), actor: z.string().max(200).optional() }));
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.action) (where.push('action LIKE ?'), binds.push(`${q.action}%`));
  if (q.entity_type) (where.push('entity_type = ?'), binds.push(q.entity_type));
  if (q.actor) (where.push('actor = ?'), binds.push(q.actor));
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_logs ${w}`).bind(...binds).first<{ n: number }>())!.n;
  const { results } = await c.env.DB.prepare(`SELECT * FROM audit_logs ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).bind(...binds, q.page_size, (q.page - 1) * q.page_size).all<Record<string, unknown>>();
  return c.json({
    data: results.map((r) => ({ ...r, before: r.before_json ? JSON.parse(String(r.before_json)) : null, after: r.after_json ? JSON.parse(String(r.after_json)) : null })),
    meta: pageMeta(q.page, q.page_size, total),
  });
});
