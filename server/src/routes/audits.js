/**
 * LDL Asset — kiểm kê định kỳ.
 * Mở đợt: chụp lại danh sách tài sản theo phạm vi (loại, địa điểm, NPP…) cùng người giữ / vị trí theo sổ.
 * Xác nhận có mặt: quét tem QR (mở trang tài sản) hoặc nhập mã; quản lý tài sản xác nhận mọi tài sản,
 * nhân viên tự xác nhận tài sản mình đang giữ. Chốt đợt → biên bản: đủ / thiếu / hỏng / sai vị trí.
 */
import { Hono } from 'hono';
import { all, get, run, batch } from '../db.js';
import { badRequest, notFound, forbidden, toInt, jsonBody } from '../util.js';
import { audit } from '../platform.js';
import { isAssetManager, CONDITIONS } from './asset.js';

const r = new Hono();
const str = (v, max = 300) => String(v ?? '').trim().slice(0, max) || null;
const placeOf = (a) => (a.placement === 'market' ? [a.partner, a.outlet].filter(Boolean).join(' — ') : a.location) || null;

async function requireManager(c) {
  if (!(await isAssetManager(c.get('user')))) throw forbidden('Chỉ quản lý tài sản được mở / chốt đợt kiểm kê');
}
async function auditOr404(id) {
  const a = await get(`SELECT x.*, u.name AS created_by_name, cu.name AS closed_by_name FROM asset_audits x
    LEFT JOIN users u ON u.id = x.created_by LEFT JOIN users cu ON cu.id = x.closed_by WHERE x.id = ?`, toInt(id));
  if (!a) throw notFound('Đợt kiểm kê không tồn tại');
  return a;
}
const SUMMARY = `SELECT audit_id, COUNT(*) AS total, SUM(found) AS found,
    SUM(CASE WHEN found = 1 AND condition IN ('poor', 'broken') THEN 1 ELSE 0 END) AS bad,
    SUM(CASE WHEN found = 1 AND actual_place IS NOT NULL THEN 1 ELSE 0 END) AS moved
  FROM asset_audit_lines`;

/** Các đợt đang mở có chứa tài sản này (cho trang tài sản sau khi quét QR). */
export async function openAuditsFor(assetId) {
  return all(`SELECT x.id, x.name, l.found FROM asset_audit_lines l JOIN asset_audits x ON x.id = l.audit_id
    WHERE l.asset_id = ? AND x.status = 'open' ORDER BY x.id DESC`, assetId);
}

r.get('/asset/audits', async (c) => {
  await requireManager(c);
  const rows = await all(`SELECT x.*, u.name AS created_by_name, s.total, s.found, s.bad, s.moved FROM asset_audits x
    LEFT JOIN users u ON u.id = x.created_by LEFT JOIN (${SUMMARY} GROUP BY audit_id) s ON s.audit_id = x.id ORDER BY x.id DESC`);
  return c.json(rows);
});

/** Mở đợt kiểm kê theo phạm vi; mỗi lúc chỉ một đợt đang mở cho cùng một tài sản. */
r.post('/asset/audits', async (c) => {
  await requireManager(c);
  const b = await jsonBody(c);
  const name = str(b.name, 160);
  if (!name) throw badRequest('Đặt tên đợt kiểm kê');
  const where = ["a.status NOT IN ('disposed', 'lost')", "NOT EXISTS (SELECT 1 FROM asset_audit_lines l JOIN asset_audits x ON x.id = l.audit_id WHERE l.asset_id = a.id AND x.status = 'open')"];
  const params = [];
  const scope = {};
  for (const [k, col] of [['type', 'a.type'], ['location', 'a.location'], ['partner', 'a.partner'], ['kind', 'a.kind'], ['placement', 'a.placement']]) {
    const v = str(b[k], 160);
    if (v) { where.push(`${col} = ?`); params.push(v); scope[k] = v; }
  }
  if (toInt(b.department_id)) { where.push('a.holder_id IN (SELECT id FROM users WHERE department_id = ?)'); params.push(toInt(b.department_id)); scope.department_id = toInt(b.department_id); }
  const assets = await all(`SELECT a.id, a.holder_id, a.placement, a.partner, a.outlet, a.location FROM assets a WHERE ${where.join(' AND ')}`, ...params);
  if (!assets.length) throw badRequest('Không có tài sản nào trong phạm vi này (hoặc đều đang nằm trong một đợt kiểm kê khác)');
  const { lastId } = await run('INSERT INTO asset_audits(name, scope, note, created_by) VALUES (?,?,?,?)', name, JSON.stringify(scope), str(b.note, 1000), c.get('user').id);
  const stmts = assets.map((a) => ['INSERT INTO asset_audit_lines(audit_id, asset_id, expected_holder_id, expected_place) VALUES (?,?,?,?)', [lastId, a.id, a.holder_id, placeOf(a)]]);
  for (let i = 0; i < stmts.length; i += 200) await batch(stmts.slice(i, i + 200));
  await audit(c.get('user').id, 'asset.audit', `Mở đợt kiểm kê "${name}" (${assets.length} tài sản)`);
  return c.json({ id: lastId, total: assets.length }, 201);
});

r.get('/asset/audits/:id', async (c) => {
  const user = c.get('user');
  const x = await auditOr404(c.req.param('id'));
  const manager = await isAssetManager(user);
  const lines = await all(`SELECT l.*, a.code, a.name, a.type, a.status AS asset_status, a.holder_id, eu.name AS expected_holder_name,
      hu.name AS holder_name, fu.name AS found_by_name
    FROM asset_audit_lines l JOIN assets a ON a.id = l.asset_id
    LEFT JOIN users eu ON eu.id = l.expected_holder_id LEFT JOIN users hu ON hu.id = a.holder_id LEFT JOIN users fu ON fu.id = l.found_by
    WHERE l.audit_id = ? ${manager ? '' : 'AND (a.holder_id = ? OR l.expected_holder_id = ?)'} ORDER BY l.found, a.code`, x.id, ...(manager ? [] : [user.id, user.id]));
  if (!manager && !lines.length) throw forbidden();
  return c.json({ ...x, scope: JSON.parse(x.scope || '{}'), lines, can_manage: manager });
});

/** Xác nhận có mặt: theo id tài sản hoặc mã (quét QR / máy quét mã vạch / gõ tay). */
r.post('/asset/audits/:id/scan', async (c) => {
  const user = c.get('user');
  const x = await auditOr404(c.req.param('id'));
  if (x.status !== 'open') throw badRequest('Đợt kiểm kê đã chốt');
  const b = await jsonBody(c);
  const code = str(b.code, 200);
  const byUrl = code && /\/asset\/item\/(\d+)/.exec(code); // nội dung tem QR là đường dẫn trang tài sản
  const a = toInt(b.asset_id) ? await get('SELECT * FROM assets WHERE id = ?', toInt(b.asset_id))
    : byUrl ? await get('SELECT * FROM assets WHERE id = ?', toInt(byUrl[1]))
      : code ? await get('SELECT * FROM assets WHERE upper(code) = upper(?)', code) : null;
  if (!a) throw badRequest(`Không tìm thấy tài sản "${code || b.asset_id}"`);
  const line = await get('SELECT * FROM asset_audit_lines WHERE audit_id = ? AND asset_id = ?', x.id, a.id);
  if (!line) throw badRequest(`${a.code} — ${a.name} không nằm trong đợt kiểm kê này`);
  if (!(await isAssetManager(user)) && a.holder_id !== user.id) throw forbidden('Bạn chỉ xác nhận được tài sản mình đang giữ');
  const cond = CONDITIONS[b.condition] ? b.condition : a.condition;
  await run(`UPDATE asset_audit_lines SET found = 1, found_at = datetime('now'), found_by = ?, condition = ?, actual_place = ?, note = ? WHERE audit_id = ? AND asset_id = ?`,
    user.id, cond, str(b.actual_place, 200), str(b.note, 500), x.id, a.id);
  if (cond !== a.condition) await run("UPDATE assets SET condition = ?, updated_at = datetime('now') WHERE id = ?", cond, a.id);
  return c.json({ asset_id: a.id, code: a.code, name: a.name, already: !!line.found });
});

r.post('/asset/audits/:id/lines/:assetId/reset', async (c) => {
  await requireManager(c);
  const x = await auditOr404(c.req.param('id'));
  if (x.status !== 'open') throw badRequest('Đợt kiểm kê đã chốt');
  await run('UPDATE asset_audit_lines SET found = 0, found_at = NULL, found_by = NULL, actual_place = NULL, note = NULL WHERE audit_id = ? AND asset_id = ?',
    x.id, toInt(c.req.param('assetId')));
  return c.json({ ok: true });
});

/** Chốt đợt. Tuỳ chọn: chuyển các tài sản không tìm thấy sang trạng thái "Mất" (có ghi lịch sử). */
r.post('/asset/audits/:id/close', async (c) => {
  await requireManager(c);
  const x = await auditOr404(c.req.param('id'));
  if (x.status !== 'open') throw badRequest('Đợt kiểm kê đã chốt');
  const b = await jsonBody(c);
  const missing = await all('SELECT l.asset_id, a.code, a.holder_id FROM asset_audit_lines l JOIN assets a ON a.id = l.asset_id WHERE l.audit_id = ? AND l.found = 0', x.id);
  const stmts = [];
  if (b.mark_missing_lost) {
    for (const m of missing) {
      stmts.push(["UPDATE assets SET status = 'lost', holder_id = NULL, assigned_at = NULL, updated_at = datetime('now') WHERE id = ?", [m.asset_id]]);
      stmts.push(['INSERT INTO asset_transactions(asset_id, type, from_user_id, detail, user_id) VALUES (?,?,?,?,?)',
        [m.asset_id, 'status', m.holder_id, `Mất — không tìm thấy khi kiểm kê "${x.name}"`, c.get('user').id]]);
    }
  }
  stmts.push(["UPDATE asset_audits SET status = 'closed', closed_by = ?, closed_at = datetime('now'), note = COALESCE(?, note) WHERE id = ?", [c.get('user').id, str(b.note, 1000), x.id]]);
  await batch(stmts);
  await audit(c.get('user').id, 'asset.audit', `Chốt đợt kiểm kê "${x.name}" — thiếu ${missing.length}${b.mark_missing_lost ? ' (ghi nhận mất)' : ''}`);
  return c.json({ missing: missing.length });
});

export default r;
