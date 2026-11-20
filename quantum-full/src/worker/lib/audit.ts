import type { Context } from 'hono';
import type { AppEnv } from './types';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
}

/** Ngữ cảnh người thực hiện — dùng chung cho request HTTP và tác vụ nền (cron). */
export interface ActorCtx {
  db: D1Database;
  actorId: string;
  actorRole: string;
  requestId: string | null;
  ip: string | null;
}

export function actorFromContext(c: Context<AppEnv>): ActorCtx {
  const user = c.get('user');
  return { db: c.env.DB, actorId: user?.id ?? 'anonymous', actorRole: user?.role ?? 'none', requestId: c.get('requestId') ?? null, ip: c.req.header('cf-connecting-ip') ?? null };
}

/** Tạo câu lệnh ghi audit log (để gộp vào batch cùng thao tác chính — đảm bảo nguyên tử). */
export function auditStatement(c: Context<AppEnv> | ActorCtx, e: AuditEntry): D1PreparedStatement {
  const a = 'req' in c ? actorFromContext(c) : c;
  return a.db.prepare(
    'INSERT INTO audit_logs (actor, actor_role, action, entity_type, entity_id, before_json, after_json, request_id, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    a.actorId,
    a.actorRole,
    e.action,
    e.entityType,
    e.entityId == null ? null : String(e.entityId),
    e.before === undefined ? null : JSON.stringify(e.before),
    e.after === undefined ? null : JSON.stringify(e.after),
    a.requestId,
    a.ip,
  );
}

export async function writeAudit(c: Context<AppEnv>, e: AuditEntry): Promise<void> {
  await auditStatement(c, e).run();
}
