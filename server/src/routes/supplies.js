/**
 * LDL Asset — công cụ dụng cụ cấp phát theo số lượng (đồng phục, nón, xe kéo…).
 * Số đang giữ của mỗi người = tổng nhận vào − tổng chuyển đi trong sổ nhập – xuất (asset_supply_moves).
 * Kho công ty là "người giữ" NULL; chỉ được kiểm soát tồn khi mặt hàng đã có phiếu nhập kho.
 */
import { Hono } from 'hono';
import { all, get, run, batch } from '../db.js';
import { badRequest, notFound, forbidden, toInt, jsonBody } from '../util.js';
import { audit } from '../platform.js';
import { isAssetManager } from './asset.js';

const r = new Hono();

export const MOVE_KINDS = {
  opening: 'Số dư đầu kỳ', receive: 'Nhập kho', issue: 'Cấp phát', return: 'Thu hồi về kho', transfer: 'Chuyển giao', writeoff: 'Hỏng / mất / tiêu hao',
};
export const WRITEOFF_REASONS = { damaged: 'Hư hỏng', lost: 'Mất / không hoàn trả', consumed: 'Tiêu hao' };

const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const money = (v) => (v === '' || v == null ? null : Math.max(0, Number(String(v).replace(/[^\d]/g, '')) || 0));
const text = (v, max = 200) => String(v ?? '').trim().slice(0, max) || null;
const fold = (v) => String(v || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
/** Trùng tên trong danh mục (không phân biệt hoa thường, kể cả chữ có dấu — lower() của SQLite không xử lý được). */
async function nameTaken(name, exceptId = 0) {
  return (await all('SELECT id, name FROM asset_supply_items')).some((x) => x.id !== exceptId && fold(x.name) === fold(name));
}

async function requireManager(c) {
  if (!(await isAssetManager(c.get('user')))) throw forbidden('Chỉ quản lý tài sản được thao tác công cụ dụng cụ');
}

/** Số đang giữ theo (người giữ, mặt hàng) — holderIds rỗng = tất cả. */
async function balances(holderIds = null) {
  const filter = holderIds ? `AND h IN (${holderIds.map(() => '?').join(',') || 'NULL'})` : '';
  return all(`SELECT h AS holder_id, item_id, SUM(q) AS qty FROM (
      SELECT to_holder_id AS h, item_id, qty AS q FROM asset_supply_moves WHERE voided = 0 AND to_holder_id IS NOT NULL
      UNION ALL SELECT from_holder_id AS h, item_id, -qty AS q FROM asset_supply_moves WHERE voided = 0 AND from_holder_id IS NOT NULL
    ) WHERE 1 = 1 ${filter} GROUP BY h, item_id HAVING SUM(q) <> 0`, ...(holderIds || []));
}

/** Tồn kho công ty theo mặt hàng; null = mặt hàng chưa có phiếu nhập kho (không theo dõi tồn). */
async function warehouse() {
  const rows = await all(`SELECT item_id,
      SUM(CASE WHEN kind = 'receive' THEN qty WHEN kind = 'return' THEN qty WHEN kind = 'issue' THEN -qty
               WHEN kind = 'writeoff' AND from_holder_id IS NULL THEN -qty ELSE 0 END) AS qty,
      SUM(CASE WHEN kind = 'receive' THEN 1 ELSE 0 END) AS receipts
    FROM asset_supply_moves WHERE voided = 0 GROUP BY item_id`);
  return Object.fromEntries(rows.map((x) => [x.item_id, x.receipts ? x.qty : null]));
}

const HOLDER_SELECT = `SELECT h.*, u.name AS user_name, u.active AS user_active, IFNULL(p.work_status, 'working') AS work_status, p.employee_code
  FROM asset_supply_holders h LEFT JOIN users u ON u.id = h.user_id LEFT JOIN hr_profiles p ON p.user_id = h.user_id`;

/** CCDC đang giữ của một nhân sự (qua liên kết tài khoản) — dùng cho hồ sơ tài sản và thủ tục nghỉ việc. */
export async function supplyHoldingsOfUser(userId) {
  const holders = await all('SELECT id FROM asset_supply_holders WHERE user_id = ?', userId);
  if (!holders.length) return [];
  const rows = await balances(holders.map((h) => h.id));
  const items = Object.fromEntries((await all('SELECT id, name, unit, penalty, returnable FROM asset_supply_items')).map((i) => [i.id, i]));
  return rows.filter((x) => x.qty > 0).map((x) => ({ ...items[x.item_id], item_id: x.item_id, holder_id: x.holder_id, qty: x.qty }));
}

// ---------------------------------------------------------------- tổng hợp
r.get('/asset/supplies', async (c) => {
  await requireManager(c);
  const items = await all('SELECT * FROM asset_supply_items ORDER BY active DESC, position, id');
  const holders = await all(`${HOLDER_SELECT} ORDER BY h.active DESC, h.name COLLATE NOCASE`);
  const bal = await balances();
  const by = new Map(holders.map((h) => [h.id, { ...h, balances: {} }]));
  for (const b of bal) if (by.has(b.holder_id)) by.get(b.holder_id).balances[b.item_id] = b.qty;
  const issued = await all(`SELECT to_holder_id AS holder_id, item_id, SUM(qty) AS qty FROM asset_supply_moves
    WHERE voided = 0 AND kind IN ('opening', 'issue', 'transfer') AND to_holder_id IS NOT NULL GROUP BY to_holder_id, item_id`);
  for (const x of issued) if (by.has(x.holder_id)) (by.get(x.holder_id).received ||= {})[x.item_id] = x.qty;
  return c.json({ items, holders: [...by.values()], warehouse: await warehouse(), kinds: MOVE_KINDS, reasons: WRITEOFF_REASONS });
});

r.get('/asset/supply-moves', async (c) => {
  await requireManager(c);
  const q = c.req.query();
  const where = ['1 = 1'];
  const params = [];
  if (toInt(q.holder_id)) { where.push('(m.from_holder_id = ? OR m.to_holder_id = ?)'); params.push(toInt(q.holder_id), toInt(q.holder_id)); }
  if (toInt(q.item_id)) { where.push('m.item_id = ?'); params.push(toInt(q.item_id)); }
  return c.json(await all(`SELECT m.*, i.name AS item_name, i.unit, fh.name AS from_name, th.name AS to_name, u.name AS created_by_name
    FROM asset_supply_moves m JOIN asset_supply_items i ON i.id = m.item_id
    LEFT JOIN asset_supply_holders fh ON fh.id = m.from_holder_id LEFT JOIN asset_supply_holders th ON th.id = m.to_holder_id
    LEFT JOIN users u ON u.id = m.created_by
    WHERE ${where.join(' AND ')} ORDER BY m.date DESC, m.id DESC LIMIT ${Math.min(1000, toInt(q.limit) || 300)}`, ...params));
});

// ---------------------------------------------------------------- danh mục CCDC
function parseItem(b) {
  const name = text(b.name, 120);
  if (!name) throw badRequest('Tên công cụ dụng cụ là bắt buộc');
  return { name, unit: text(b.unit, 20) || 'cái', price: money(b.price), penalty: money(b.penalty), returnable: b.returnable === false ? 0 : 1,
    note: text(b.note, 500), active: b.active === false ? 0 : 1, position: toInt(b.position) || 0 };
}
r.post('/asset/supply-items', async (c) => {
  await requireManager(c);
  const i = parseItem(await jsonBody(c));
  if (await nameTaken(i.name)) throw badRequest(`"${i.name}" đã có trong danh mục`);
  const { lastId } = await run('INSERT INTO asset_supply_items(name, unit, price, penalty, returnable, note, active, position) VALUES (?,?,?,?,?,?,?,?)',
    i.name, i.unit, i.price, i.penalty, i.returnable, i.note, i.active, i.position);
  await audit(c.get('user').id, 'asset.supply_item', `Thêm công cụ dụng cụ "${i.name}"`);
  return c.json({ id: lastId }, 201);
});
r.put('/asset/supply-items/:id', async (c) => {
  await requireManager(c);
  const id = toInt(c.req.param('id'));
  if (!(await get('SELECT 1 FROM asset_supply_items WHERE id = ?', id))) throw notFound();
  const i = parseItem(await jsonBody(c));
  if (await nameTaken(i.name, id)) throw badRequest(`"${i.name}" đã có trong danh mục`);
  await run('UPDATE asset_supply_items SET name = ?, unit = ?, price = ?, penalty = ?, returnable = ?, note = ?, active = ?, position = ? WHERE id = ?',
    i.name, i.unit, i.price, i.penalty, i.returnable, i.note, i.active, i.position, id);
  return c.json({ id });
});

// ---------------------------------------------------------------- người giữ
async function parseHolder(b) {
  const name = text(b.name, 120);
  if (!name) throw badRequest('Tên người giữ là bắt buộc');
  const userId = toInt(b.user_id) || null;
  if (userId && !(await get('SELECT 1 FROM users WHERE id = ?', userId))) throw badRequest('Nhân sự liên kết không tồn tại');
  return { user_id: userId, name, kind: b.kind === 'partner' ? 'partner' : 'person', role: text(b.role, 40), area: text(b.area, 80),
    partner: text(b.partner, 120), note: text(b.note, 1000), active: b.active === false ? 0 : 1 };
}
r.post('/asset/supply-holders', async (c) => {
  await requireManager(c);
  const h = await parseHolder(await jsonBody(c));
  if (h.user_id && (await get('SELECT 1 FROM asset_supply_holders WHERE user_id = ?', h.user_id))) throw badRequest('Nhân sự này đã có trong danh sách người giữ');
  const { lastId } = await run(`INSERT INTO asset_supply_holders(user_id, name, kind, role, area, partner, note, active, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
    h.user_id, h.name, h.kind, h.role, h.area, h.partner, h.note, h.active, c.get('user').id);
  return c.json({ id: lastId }, 201);
});
r.put('/asset/supply-holders/:id', async (c) => {
  await requireManager(c);
  const id = toInt(c.req.param('id'));
  if (!(await get('SELECT 1 FROM asset_supply_holders WHERE id = ?', id))) throw notFound();
  const h = await parseHolder(await jsonBody(c));
  if (h.user_id && (await get('SELECT 1 FROM asset_supply_holders WHERE user_id = ? AND id <> ?', h.user_id, id))) throw badRequest('Nhân sự này đã gắn với người giữ khác');
  await run('UPDATE asset_supply_holders SET user_id = ?, name = ?, kind = ?, role = ?, area = ?, partner = ?, note = ?, active = ? WHERE id = ?',
    h.user_id, h.name, h.kind, h.role, h.area, h.partner, h.note, h.active, id);
  return c.json({ id });
});
r.get('/asset/supply-holders/:id', async (c) => {
  await requireManager(c);
  const id = toInt(c.req.param('id'));
  const h = await get(`${HOLDER_SELECT} WHERE h.id = ?`, id);
  if (!h) throw notFound('Người giữ không tồn tại');
  h.balances = Object.fromEntries((await balances([id])).map((b) => [b.item_id, b.qty]));
  return c.json(h);
});

// ---------------------------------------------------------------- ghi sổ: cấp phát, thu hồi, chuyển giao, hỏng / mất, nhập kho
r.post('/asset/supply-moves', async (c) => {
  await requireManager(c);
  const b = await jsonBody(c);
  const kind = b.kind;
  if (!MOVE_KINDS[kind]) throw badRequest('Loại nghiệp vụ không hợp lệ');
  const date = isDate(b.date) ? b.date : today();
  const from = ['return', 'transfer', 'writeoff'].includes(kind) ? toInt(b.from_holder_id) || null : null;
  const to = ['opening', 'issue', 'transfer'].includes(kind) ? toInt(b.to_holder_id) || null : null;
  if (['opening', 'issue', 'transfer'].includes(kind) && !to) throw badRequest('Chọn người nhận');
  if (['return', 'transfer'].includes(kind) && !from) throw badRequest('Chọn người bàn giao / trả');
  if (kind === 'transfer' && from === to) throw badRequest('Người giao và người nhận phải khác nhau');
  for (const hid of [from, to].filter(Boolean)) if (!(await get('SELECT 1 FROM asset_supply_holders WHERE id = ?', hid))) throw badRequest('Người giữ không tồn tại');
  const reason = kind === 'writeoff' ? (WRITEOFF_REASONS[b.reason] ? b.reason : 'damaged') : null;
  const lines = (Array.isArray(b.lines) ? b.lines : []).map((l) => ({ item_id: toInt(l.item_id), qty: toInt(l.qty), charge: money(l.charge) }))
    .filter((l) => l.item_id && l.qty > 0);
  if (!lines.length) throw badRequest('Nhập số lượng cho ít nhất một công cụ dụng cụ');

  // không cho chuyển đi nhiều hơn số đang giữ / tồn kho đang theo dõi
  const held = from ? Object.fromEntries((await balances([from])).map((x) => [x.item_id, x.qty])) : null;
  const stock = !from && ['issue', 'writeoff'].includes(kind) ? await warehouse() : null;
  for (const l of lines) {
    const item = await get('SELECT name, unit FROM asset_supply_items WHERE id = ?', l.item_id);
    if (!item) throw badRequest('Công cụ dụng cụ không tồn tại');
    if (held && l.qty > (held[l.item_id] || 0)) throw badRequest(`${item.name}: chỉ đang giữ ${held[l.item_id] || 0} ${item.unit}`);
    if (stock && stock[l.item_id] != null && l.qty > stock[l.item_id]) throw badRequest(`${item.name}: tồn kho chỉ còn ${stock[l.item_id]} ${item.unit}`);
  }
  const batchId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const note = text(b.note, 1000);
  const requestId = toInt(b.request_id) || null;
  await batch(lines.map((l) => [`INSERT INTO asset_supply_moves(item_id, date, kind, qty, from_holder_id, to_holder_id, reason, charge, note, request_id, batch, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [l.item_id, date, kind, l.qty, from, to, reason, kind === 'writeoff' ? l.charge : null, note, requestId, batchId, c.get('user').id]]));
  await audit(c.get('user').id, 'asset.supply_move', `${MOVE_KINDS[kind]} công cụ dụng cụ (${lines.length} dòng)`);
  return c.json({ batch: batchId, count: lines.length }, 201);
});

/** Huỷ một dòng ghi nhầm (giữ lại lịch sử). Không huỷ được nếu làm số đang giữ của ai đó âm. */
r.post('/asset/supply-moves/:id/void', async (c) => {
  await requireManager(c);
  const id = toInt(c.req.param('id'));
  const m = await get('SELECT * FROM asset_supply_moves WHERE id = ? AND voided = 0', id);
  if (!m) throw notFound('Dòng ghi sổ không tồn tại hoặc đã huỷ');
  if (m.to_holder_id) {
    const cur = (await balances([m.to_holder_id])).find((x) => x.item_id === m.item_id)?.qty || 0;
    if (cur < m.qty) throw badRequest('Người nhận đã chuyển tiếp số lượng này — huỷ các dòng sau trước');
  }
  await run('UPDATE asset_supply_moves SET voided = 1 WHERE id = ?', id);
  await audit(c.get('user').id, 'asset.supply_move', `Huỷ dòng ghi sổ công cụ dụng cụ #${id}`);
  return c.json({ ok: true });
});

export default r;
