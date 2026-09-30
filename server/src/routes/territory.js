/**
 * Cơ cấu kinh doanh theo địa bàn:
 *   NSM (Toàn quốc) → RSM (Miền Bắc / Trung / Nam) → ASM (Khu vực) → SS (Tỉnh; 1 SS có thể phụ trách 1–2 tỉnh) → PG / SREP / SREP KA
 *  - chia theo ngành hàng (mặc định Hóa mỹ phẩm, Thực phẩm): cây địa bàn dùng chung, mỗi phân công gắn một ngành hàng
 *    hoặc "chung" (VD NSM chung cả hai ngành, ASM / SS / SREP riêng từng ngành); cấp trên được chọn cùng ngành hàng
 *  - cây địa bàn: toàn quốc → miền → khu vực → tỉnh (thêm / sửa / xoá, thêm nhiều tỉnh một lần)
 *  - người phụ trách theo vị trí, cho phép kiêm nhiệm (một người phụ trách thêm địa bàn khác)
 *  - đồng bộ "quản lý trực tiếp" theo cơ cấu: mỗi người báo cáo cho cấp cao hơn gần nhất trên cây địa bàn;
 *    quản lý trực tiếp dùng chung cho duyệt đề xuất, quyền xem Wework / HRM / Asset (cấp trên xem được toàn bộ cấp dưới).
 * Quyền: mọi nhân sự xem sơ đồ; quản trị viên và quản lý nhân sự chỉnh sửa.
 */
import { Hono } from 'hono';
import { all, get, run, batch, getSetting, setSetting } from '../db.js';
import { badRequest, notFound, forbidden, toInt, jsonBody } from '../util.js';
import { audit } from '../platform.js';

const r = new Hono();

export const SALES_ROLES = {
  NSM: { label: 'NSM – Giám đốc kinh doanh toàn quốc', short: 'NSM', rank: 1, levels: ['national'] },
  RSM: { label: 'RSM – Giám đốc kinh doanh miền', short: 'RSM', rank: 2, levels: ['region'] },
  ASM: { label: 'ASM – Quản lý khu vực', short: 'ASM', rank: 3, levels: ['area'] },
  SS: { label: 'SS – Giám sát bán hàng', short: 'SS', rank: 4, levels: ['province', 'area'] },
  PG: { label: 'PG – Nhân viên tư vấn bán hàng', short: 'PG', rank: 5, levels: ['province', 'area'] },
  SREP: { label: 'SREP – Nhân viên bán hàng', short: 'SREP', rank: 5, levels: ['province', 'area'] },
  SREP_KA: { label: 'SREP KA – Nhân viên kênh siêu thị / khách hàng lớn', short: 'SREP KA', rank: 5, levels: ['province', 'area'] },
};
export const LEVELS = { national: 'Toàn quốc', region: 'Miền', area: 'Khu vực', province: 'Tỉnh / thành' };
const LEVEL_ORDER = ['national', 'region', 'area', 'province'];
export const SALES_SETTINGS_DEFAULTS = { industries: [{ code: 'HMP', name: 'Hóa mỹ phẩm' }, { code: 'TP', name: 'Thực phẩm' }] };

export async function salesSettings() {
  try { return { ...SALES_SETTINGS_DEFAULTS, ...JSON.parse((await getSetting('sales_settings')) || '{}') }; } catch { return { ...SALES_SETTINGS_DEFAULTS }; }
}
/** Mã ngành hàng hợp lệ (theo mã hoặc tên, không phân biệt hoa thường); '' / 'chung' → null. */
export async function industryCode(v) {
  return industryOf((await salesSettings()).industries, v);
}
/** Như industryCode nhưng với danh mục đã đọc sẵn (dùng khi nhập hàng loạt). */
export function industryOf(industries, v) {
  const t = String(v ?? '').trim().toLowerCase();
  if (!t || t === 'chung' || t === 'all') return null;
  const hit = industries.find((x) => x.code.toLowerCase() === t || x.name.toLowerCase() === t);
  if (!hit) throw badRequest(`Ngành hàng "${v}" không có trong danh mục`);
  return hit.code;
}

async function canManage(user) {
  if (user.role === 'admin') return true;
  if (user.role === 'guest') return false;
  try { return (JSON.parse((await getSetting('hrm_settings')) || '{}').managers || []).includes(user.id); } catch { return false; }
}
async function requireManage(c) {
  if (!(await canManage(c.get('user')))) throw forbidden('Chỉ quản trị viên hoặc quản lý nhân sự mới chỉnh sửa được cơ cấu kinh doanh');
}
function requireStaff(c) {
  if (c.get('user').role === 'guest') throw forbidden();
}
async function territoryOr404(id) {
  const t = await get('SELECT * FROM territories WHERE id = ?', toInt(id));
  if (!t) throw notFound('Không tìm thấy địa bàn');
  return t;
}

/** Vị trí chính của nhân sự = vị trí cấp cao nhất trong các phân công chính (không kiêm nhiệm), nếu không có thì lấy mọi phân công. */
const RANK_SQL = `CASE role ${Object.entries(SALES_ROLES).map(([k, v]) => `WHEN '${k}' THEN ${v.rank}`).join(' ')} ELSE 9 END`;
const MAIN_POST = (col) => `(SELECT ${col} FROM territory_members WHERE user_id = users.id ORDER BY is_concurrent, ${RANK_SQL}, created_at, territory_id LIMIT 1)`;
/** Một câu lệnh: vị trí / ngành hàng chính = phân công chính (không kiêm nhiệm) cấp cao nhất. */
export const refreshSalesRoleStmt = (userId) => [`UPDATE users SET sales_role = ${MAIN_POST('role')}, sales_industry = ${MAIN_POST('industry')} WHERE id = ?`, [userId]];
async function refreshSalesRole(userId) {
  const [sql, params] = refreshSalesRoleStmt(userId);
  await run(sql, ...params);
}

const MEMBER_SELECT = `SELECT m.territory_id, m.user_id, m.role, m.is_concurrent, m.since, m.industry, u.name, u.username, u.color, u.title, u.avatar_version,
    u.manager_id, u.active, mg.name AS manager_name
  FROM territory_members m JOIN users u ON u.id = m.user_id LEFT JOIN users mg ON mg.id = u.manager_id`;

r.get('/sales/structure', async (c) => {
  requireStaff(c);
  const territories = await all('SELECT id, name, code, level, parent_id, sort FROM territories ORDER BY sort, name COLLATE NOCASE');
  const members = await all(`${MEMBER_SELECT} ORDER BY u.name COLLATE NOCASE`);
  return c.json({ territories, members, roles: SALES_ROLES, levels: LEVELS, industries: (await salesSettings()).industries,
    can_manage: await canManage(c.get('user')) });
});

/** Danh mục ngành hàng (mã ngắn + tên), VD HMP – Hóa mỹ phẩm, TP – Thực phẩm. */
r.put('/sales/settings', async (c) => {
  await requireManage(c);
  const b = await jsonBody(c);
  const seen = new Set();
  const industries = (Array.isArray(b.industries) ? b.industries : []).map((x) => ({
    code: String(x.code || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 12), name: String(x.name || '').trim().slice(0, 60),
  })).filter((x) => x.code && x.name && !seen.has(x.code) && seen.add(x.code)).slice(0, 12);
  const used = (await all('SELECT DISTINCT industry FROM territory_members WHERE industry IS NOT NULL')).map((x) => x.industry);
  const missing = used.filter((u) => !industries.some((x) => x.code === u));
  if (missing.length) throw badRequest(`Ngành hàng ${missing.join(', ')} đang có người phụ trách, gỡ phân công trước khi xoá`);
  await setSetting('sales_settings', JSON.stringify({ industries }));
  await audit(c.get('user').id, 'sales.settings', `Cập nhật ngành hàng: ${industries.map((x) => x.name).join(', ')}`);
  return c.json({ industries });
});

/** Địa bàn & vị trí của một nhân sự (hiển thị trên hồ sơ). */
r.get('/sales/users/:id', async (c) => {
  requireStaff(c);
  const rows = await all(`SELECT m.role, m.is_concurrent, m.since, m.industry, t.id AS territory_id, t.name AS territory_name, t.level
    FROM territory_members m JOIN territories t ON t.id = m.territory_id WHERE m.user_id = ?`, toInt(c.req.param('id')));
  rows.sort((a, b) => a.is_concurrent - b.is_concurrent || SALES_ROLES[a.role].rank - SALES_ROLES[b.role].rank);
  return c.json(rows);
});

function parseTerritory(b, parent) {
  const name = String(b.name || '').trim().slice(0, 120);
  if (!name) throw badRequest('Nhập tên địa bàn');
  return { name, code: String(b.code || '').trim().slice(0, 20) || null, sort: toInt(b.sort, 0) };
}
function childLevel(parent) {
  const next = LEVEL_ORDER[LEVEL_ORDER.indexOf(parent.level) + 1];
  if (!next) throw badRequest('Tỉnh / thành là cấp thấp nhất, không thêm địa bàn con được');
  return next;
}

/** Thêm địa bàn con; `names` (mỗi dòng một tên) để thêm nhiều tỉnh / khu vực một lần. */
r.post('/sales/territories', async (c) => {
  await requireManage(c);
  const b = await jsonBody(c);
  const parent = await territoryOr404(b.parent_id);
  const level = childLevel(parent);
  const max = (await get('SELECT MAX(sort) AS s FROM territories WHERE parent_id = ?', parent.id))?.s ?? 0;
  const names = b.names != null
    ? [...new Set(String(b.names).split(/[\n,;]/).map((x) => x.trim()).filter(Boolean))].slice(0, 100)
    : [parseTerritory(b).name];
  if (!names.length) throw badRequest('Nhập tên địa bàn');
  const exist = new Set((await all('SELECT name FROM territories WHERE parent_id = ?', parent.id)).map((x) => x.name.toLowerCase()));
  const fresh = names.filter((n) => !exist.has(n.toLowerCase()));
  if (!fresh.length) throw badRequest('Các địa bàn này đã có trong danh sách');
  const code = names.length === 1 ? parseTerritory(b).code : null;
  await batch(fresh.map((n, i) => ['INSERT INTO territories(name, code, level, parent_id, sort) VALUES (?,?,?,?,?)',
    [n.slice(0, 120), code, level, parent.id, max + i + 1]]));
  await audit(c.get('user').id, 'sales.territory', `Thêm ${LEVELS[level].toLowerCase()} ${fresh.join(', ')} thuộc ${parent.name}`);
  return c.json({ ok: true, added: fresh.length }, 201);
});

/** Đổi tên / mã / thứ tự; chuyển sang địa bàn cha khác cùng cấp (VD tỉnh từ khu vực này sang khu vực khác). */
r.put('/sales/territories/:id', async (c) => {
  await requireManage(c);
  const t = await territoryOr404(c.req.param('id'));
  const b = await jsonBody(c);
  const v = parseTerritory({ name: t.name, code: t.code, sort: t.sort, ...b });
  let parentId = t.parent_id;
  if (b.parent_id !== undefined && toInt(b.parent_id) !== t.parent_id) {
    if (t.level === 'national') throw badRequest('Không chuyển được địa bàn toàn quốc');
    const p = await territoryOr404(b.parent_id);
    if (childLevel(p) !== t.level) throw badRequest(`${LEVELS[t.level]} phải thuộc một ${LEVELS[LEVEL_ORDER[LEVEL_ORDER.indexOf(t.level) - 1]].toLowerCase()}`);
    parentId = p.id;
  }
  await run('UPDATE territories SET name = ?, code = ?, sort = ?, parent_id = ? WHERE id = ?', v.name, v.code, v.sort, parentId, t.id);
  return c.json({ ok: true });
});

r.delete('/sales/territories/:id', async (c) => {
  await requireManage(c);
  const t = await territoryOr404(c.req.param('id'));
  if (t.level === 'national') throw badRequest('Không xoá được địa bàn toàn quốc');
  const affected = (await all(`WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT x.id FROM territories x JOIN sub ON x.parent_id = sub.id)
    SELECT DISTINCT user_id FROM territory_members WHERE territory_id IN (SELECT id FROM sub)`, t.id)).map((x) => x.user_id);
  await run(`DELETE FROM territory_members WHERE territory_id IN (WITH RECURSIVE sub(id) AS (SELECT ?
    UNION ALL SELECT x.id FROM territories x JOIN sub ON x.parent_id = sub.id) SELECT id FROM sub)`, t.id);
  await run(`DELETE FROM territories WHERE id IN (WITH RECURSIVE sub(id) AS (SELECT ?
    UNION ALL SELECT x.id FROM territories x JOIN sub ON x.parent_id = sub.id) SELECT id FROM sub)`, t.id);
  for (const uid of affected) await refreshSalesRole(uid);
  await audit(c.get('user').id, 'sales.territory', `Xoá địa bàn ${t.name}`);
  return c.json({ ok: true });
});

/**
 * Phân công người phụ trách (dùng chung cho màn hình và nhập Excel): vị trí phải khớp cấp địa bàn;
 * is_concurrent = kiêm nhiệm; industry = mã ngành hàng (null = chung).
 */
export function assignStmt(t, userId, role, { industry = null, concurrent = false, since = null } = {}) {
  if (!SALES_ROLES[role]) throw badRequest('Chọn vị trí kinh doanh');
  if (!SALES_ROLES[role].levels.includes(t.level)) {
    throw badRequest(`${SALES_ROLES[role].short} chỉ phụ trách cấp ${SALES_ROLES[role].levels.map((l) => LEVELS[l].toLowerCase()).join(' / ')}`);
  }
  return [`INSERT INTO territory_members(territory_id, user_id, role, is_concurrent, since, industry) VALUES (?,?,?,?,?,?)
    ON CONFLICT(territory_id, user_id, role) DO UPDATE SET is_concurrent = excluded.is_concurrent, since = excluded.since, industry = excluded.industry`,
  [t.id, userId, role, concurrent ? 1 : 0, /^\d{4}-\d{2}-\d{2}$/.test(since || '') ? since : null, industry]];
}
export async function assignMember(t, userId, role, opts = {}) {
  await batch([assignStmt(t, userId, role, opts), refreshSalesRoleStmt(userId)]);
}

r.post('/sales/territories/:id/members', async (c) => {
  await requireManage(c);
  const t = await territoryOr404(c.req.param('id'));
  const b = await jsonBody(c);
  const u = await get("SELECT id, name FROM users WHERE id = ? AND role <> 'guest'", toInt(b.user_id));
  if (!u) throw badRequest('Chọn nhân sự');
  const industry = await industryCode(b.industry);
  await assignMember(t, u.id, String(b.role || ''), { industry, concurrent: !!b.is_concurrent, since: b.since });
  await audit(c.get('user').id, 'sales.member', `${u.name}: ${SALES_ROLES[b.role].short} ${t.name}${industry ? ` (${industry})` : ''}${b.is_concurrent ? ' (kiêm nhiệm)' : ''}`);
  return c.json({ ok: true }, 201);
});

r.delete('/sales/territories/:id/members/:userId', async (c) => {
  await requireManage(c);
  const t = await territoryOr404(c.req.param('id'));
  const uid = toInt(c.req.param('userId'));
  const role = c.req.query('role');
  const res = role
    ? await run('DELETE FROM territory_members WHERE territory_id = ? AND user_id = ? AND role = ?', t.id, uid, role)
    : await run('DELETE FROM territory_members WHERE territory_id = ? AND user_id = ?', t.id, uid);
  if (!res.changes) throw notFound('Không tìm thấy phân công');
  await refreshSalesRole(uid);
  await audit(c.get('user').id, 'sales.member', `Gỡ phân công #${uid} khỏi ${t.name}`);
  return c.json({ ok: true });
});

/**
 * Quản lý trực tiếp theo cơ cấu: từ địa bàn chính của mỗi người, tìm người có vị trí cao hơn gần nhất
 * — trước hết ngay trên địa bàn đó (VD SREP → SS cùng tỉnh), rồi lần lượt lên khu vực, miền, toàn quốc.
 * Người kiêm nhiệm được tính là cấp trên ở địa bàn kiêm nhiệm.
 */
export async function planManagers() {
  const territories = new Map((await all('SELECT id, name, parent_id FROM territories')).map((t) => [t.id, t]));
  const members = await all(`${MEMBER_SELECT} WHERE u.active = 1`);
  const byTerritory = new Map();
  for (const m of members) (byTerritory.get(m.territory_id) || byTerritory.set(m.territory_id, []).get(m.territory_id)).push(m);
  const users = new Map();
  for (const m of members) {
    const cur = users.get(m.user_id);
    const better = !cur || (cur.is_concurrent && !m.is_concurrent)
      || (cur.is_concurrent === m.is_concurrent && SALES_ROLES[m.role].rank < SALES_ROLES[cur.role].rank);
    if (better) users.set(m.user_id, m);
  }
  const plan = [];
  for (const m of users.values()) {
    const rank = SALES_ROLES[m.role].rank;
    let leader = null;
    for (let t = territories.get(m.territory_id), guard = 0; t && !leader && guard < 10; t = territories.get(t.parent_id), guard++) {
      // cấp trên phải cùng ngành hàng hoặc phụ trách chung; ưu tiên cấp gần nhất, rồi đúng ngành, rồi phân công chính
      const cands = (byTerritory.get(t.id) || []).filter((x) => x.user_id !== m.user_id && SALES_ROLES[x.role].rank < rank
          && (!x.industry || !m.industry || x.industry === m.industry))
        .sort((a, b) => SALES_ROLES[b.role].rank - SALES_ROLES[a.role].rank
          || (a.industry === m.industry ? 0 : 1) - (b.industry === m.industry ? 0 : 1) || a.is_concurrent - b.is_concurrent || a.user_id - b.user_id);
      leader = cands[0] || null;
    }
    if (!leader) continue;
    plan.push({ user_id: m.user_id, name: m.name, color: m.color, role: m.role, industry: m.industry, manager_industry: leader.industry, territory: territories.get(m.territory_id)?.name,
      current_manager_id: m.manager_id, current_manager_name: m.manager_name,
      manager_id: leader.user_id, manager_name: leader.name, manager_role: leader.role, changed: m.manager_id !== leader.user_id });
  }
  return plan.sort((a, b) => SALES_ROLES[a.role].rank - SALES_ROLES[b.role].rank || a.name.localeCompare(b.name));
}

r.get('/sales/sync-managers', async (c) => {
  await requireManage(c);
  return c.json(await planManagers());
});

/** Áp dụng: cập nhật quản lý trực tiếp cho những người được chọn (mặc định mọi thay đổi). */
r.post('/sales/sync-managers', async (c) => {
  await requireManage(c);
  const b = await jsonBody(c);
  const only = Array.isArray(b.user_ids) ? new Set(b.user_ids.map(Number)) : null;
  const changes = (await planManagers()).filter((p) => p.changed && (!only || only.has(p.user_id)));
  await batch(changes.map((p) => ['UPDATE users SET manager_id = ? WHERE id = ?', [p.manager_id, p.user_id]]));
  if (changes.length) await audit(c.get('user').id, 'sales.sync', `Cập nhật quản lý trực tiếp theo cơ cấu kinh doanh cho ${changes.length} nhân sự`);
  return c.json({ ok: true, updated: changes.length });
});

export default r;
