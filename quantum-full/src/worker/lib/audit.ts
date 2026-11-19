import type { Context } from 'hono';
import type { AppEnv } from './types';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
}

/** Tạo câu lệnh ghi audit log (để gộp vào batch cùng thao tác chính — đảm bảo nguyên tử). */
export function auditStatement(c: Context<AppEnv>, e: AuditEntry): D1PreparedStatement {
  const user = c.get('user');
  return c.env.DB.prepare(
    'INSERT INTO audit_logs (actor, actor_role, action, entity_type, entity_id, before_json, after_json, request_id, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    user?.id ?? 'anonymous',
    user?.role ?? 'none',
    e.action,
    e.entityType,
    e.entityId == null ? null : String(e.entityId),
    e.before === undefined ? null : JSON.stringify(e.before),
    e.after === undefined ? null : JSON.stringify(e.after),
    c.get('requestId') ?? null,
    c.req.header('cf-connecting-ip') ?? null,
  );
}

export async function writeAudit(c: Context<AppEnv>, e: AuditEntry): Promise<void> {
  await auditStatement(c, e).run();
}
