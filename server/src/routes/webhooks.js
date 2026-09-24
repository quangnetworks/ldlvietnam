/** Outgoing webhooks for Base Request: notify external systems (ERP, Zalo OA, Slack…) about request events. */
import { Hono } from 'hono';
import { all, get, run } from '../db.js';
import { requireAdmin } from '../auth.js';
import { badRequest, notFound, toInt, jsonBody, paginate } from '../util.js';
import { randomBase32 } from '../security.js';

const r = new Hono();

export const WEBHOOK_EVENTS = {
  'request.submitted': 'Đề xuất được gửi',
  'request.step_approved': 'Một người duyệt đã chấp thuận',
  'request.approved': 'Đề xuất được chấp thuận',
  'request.rejected': 'Đề xuất bị từ chối',
  'request.returned': 'Đề xuất bị trả lại',
  'request.cancelled': 'Đề xuất bị huỷ',
  'request.commented': 'Có bình luận mới',
};

/** Only public https endpoints (blocks localhost / private ranges to avoid SSRF from the Node runtime). */
export function validateWebhookUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw badRequest('URL không hợp lệ'); }
  if (u.protocol !== 'https:') throw badRequest('Webhook phải dùng https://');
  const h = u.hostname.toLowerCase();
  const privateHost = h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === '0.0.0.0' || h.startsWith('[')
    || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  if (privateHost) throw badRequest('Không cho phép gửi webhook tới địa chỉ nội bộ');
  return u.toString();
}

async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function deliver(hook, event, payload, requestId) {
  const body = JSON.stringify(payload);
  const started = Date.now();
  let status = null;
  let error = null;
  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'LDL-Workspace-Webhook/1.0',
        'X-LDL-Event': event,
        'X-LDL-Signature': `sha256=${await hmacHex(hook.secret, body)}`,
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    status = res.status;
    if (!res.ok) error = (await res.text()).slice(0, 300);
  } catch (e) {
    error = String(e?.message || e).slice(0, 300);
  }
  await run('INSERT INTO webhook_logs(webhook_id, event, request_id, status_code, ok, error, duration_ms) VALUES (?,?,?,?,?,?,?)',
    hook.id, event, requestId ?? null, status, status && status < 300 ? 1 : 0, error, Date.now() - started);
  return { status, error };
}

/** Run a promise after the response when the runtime supports it (Cloudflare waitUntil). */
export function defer(c, promise) {
  const p = promise.catch((e) => console.error('webhook', e));
  try {
    c.executionCtx.waitUntil(p);
  } catch {
    /* Node: fire and forget */
  }
  return p;
}

/** Fire every active webhook subscribed to `event` for this request. */
export async function fireRequestEvent(c, event, requestId, extra = {}) {
  const q = await get(`SELECT q.id, q.title, q.status, q.group_id, q.data, q.created_at, q.updated_at, g.name AS group_name,
      u.name AS creator_name, u.username AS creator_username, u.email AS creator_email
    FROM requests q LEFT JOIN request_groups g ON g.id = q.group_id LEFT JOIN users u ON u.id = q.creator_id WHERE q.id = ?`, requestId);
  if (!q) return;
  const hooks = (await all('SELECT * FROM webhooks WHERE active = 1 AND (group_id IS NULL OR group_id = ?)', q.group_id))
    .filter((h) => { try { return JSON.parse(h.events).includes(event); } catch { return false; } });
  if (!hooks.length) return;
  const actor = c.get('user');
  let data = {};
  try { data = JSON.parse(q.data || '{}'); } catch { data = {}; }
  const payload = {
    event, sent_at: new Date().toISOString(),
    actor: actor ? { id: actor.id, name: actor.name, username: actor.username } : null,
    request: {
      id: q.id, title: q.title, status: q.status, group: { id: q.group_id, name: q.group_name }, data,
      creator: { name: q.creator_name, username: q.creator_username, email: q.creator_email },
      created_at: q.created_at, updated_at: q.updated_at, url: `${new URL(c.req.url).origin}/request/${q.id}`,
    },
    ...extra,
  };
  defer(c, Promise.all(hooks.map((h) => deliver(h, event, payload, q.id))));
}

// ---------------------------------------------------------------- admin API
const view = (h) => ({ ...h, events: JSON.parse(h.events || '[]'), active: !!h.active });

r.get('/webhooks', requireAdmin, async (c) => {
  const rows = await all(`SELECT w.*, g.name AS group_name,
      (SELECT COUNT(*) FROM webhook_logs l WHERE l.webhook_id = w.id) AS sent,
      (SELECT COUNT(*) FROM webhook_logs l WHERE l.webhook_id = w.id AND l.ok = 0) AS failed
    FROM webhooks w LEFT JOIN request_groups g ON g.id = w.group_id ORDER BY w.id DESC`);
  return c.json({ items: rows.map(view), events: WEBHOOK_EVENTS });
});

function parseHook(b) {
  const name = String(b.name || '').trim();
  if (!name) throw badRequest('Tên webhook là bắt buộc');
  const events = (Array.isArray(b.events) ? b.events : []).filter((e) => WEBHOOK_EVENTS[e]);
  if (!events.length) throw badRequest('Chọn ít nhất một sự kiện');
  return { name: name.slice(0, 120), url: validateWebhookUrl(b.url), events: JSON.stringify(events), group_id: toInt(b.group_id), active: b.active === false ? 0 : 1 };
}

r.post('/webhooks', requireAdmin, async (c) => {
  const h = parseHook(await jsonBody(c));
  const secret = randomBase32(24);
  const { lastId } = await run('INSERT INTO webhooks(name, url, secret, events, group_id, active, created_by) VALUES (?,?,?,?,?,?,?)',
    h.name, h.url, secret, h.events, h.group_id, h.active, c.get('user').id);
  return c.json(view(await get('SELECT * FROM webhooks WHERE id = ?', lastId)), 201);
});
r.put('/webhooks/:id', requireAdmin, async (c) => {
  const id = toInt(c.req.param('id'));
  if (!(await get('SELECT 1 FROM webhooks WHERE id = ?', id))) throw notFound();
  const h = parseHook(await jsonBody(c));
  await run('UPDATE webhooks SET name = ?, url = ?, events = ?, group_id = ?, active = ? WHERE id = ?', h.name, h.url, h.events, h.group_id, h.active, id);
  return c.json(view(await get('SELECT * FROM webhooks WHERE id = ?', id)));
});
r.delete('/webhooks/:id', requireAdmin, async (c) => {
  await run('DELETE FROM webhooks WHERE id = ?', toInt(c.req.param('id')));
  return c.json({ ok: true });
});
r.post('/webhooks/:id/test', requireAdmin, async (c) => {
  const h = await get('SELECT * FROM webhooks WHERE id = ?', toInt(c.req.param('id')));
  if (!h) throw notFound();
  const result = await deliver(h, 'ping', { event: 'ping', sent_at: new Date().toISOString(), message: 'Webhook thử từ LDL Workspace' }, null);
  return c.json(result);
});
r.get('/webhooks/logs', requireAdmin, async (c) => {
  const q = c.req.query();
  const { page, limit, offset } = paginate(q, 50);
  const wid = toInt(q.webhook_id);
  const where = wid ? 'WHERE l.webhook_id = ?' : '';
  const params = wid ? [wid] : [];
  const items = await all(`SELECT l.*, w.name AS webhook_name, w.url FROM webhook_logs l LEFT JOIN webhooks w ON w.id = l.webhook_id
    ${where} ORDER BY l.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  const total = (await get(`SELECT COUNT(*) AS c FROM webhook_logs l ${where}`, ...params)).c;
  return c.json({ items, total, page, limit });
});

export default r;
