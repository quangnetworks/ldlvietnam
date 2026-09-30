/**
 * LDL Asset — tài sản, công cụ dụng cụ gắn với từng cá nhân:
 *  - danh mục tài sản (mã, loại, địa điểm, nhà cung cấp, giá, khấu hao, tình trạng) và người đang giữ
 *  - biên bản bàn giao (cấp phát) / thu hồi: tài sản chuyển ngay, nhân viên xác nhận đã nhận / đã trả trên hệ thống
 *  - thủ tục nhận việc / nghỉ việc: checklist, bước "Bàn giao / Thu hồi tài sản" gắn với biên bản; nghỉ việc chỉ hoàn tất khi đã thu hồi hết
 * Quyền: quản trị viên, người quản lý tài sản (Cài đặt) và quản lý nhân sự quản lý; nhân viên xem & xác nhận tài sản của mình;
 * quản lý trực tiếp xem tài sản của nhân viên cấp dưới.
 */
import { Hono } from 'hono';
import { all, get, run, batch, notify, getSetting, setSetting } from '../db.js';
import { badRequest, notFound, forbidden, toInt, idList, jsonBody } from '../util.js';
import { audit } from '../platform.js';

const r = new Hono();
const APP = 'asset';

export const ASSET_STATUS = {
  available: 'Sẵn sàng', in_use: 'Đang sử dụng', maintenance: 'Bảo trì / sửa chữa', broken: 'Hỏng', lost: 'Mất', disposed: 'Đã thanh lý',
};
export const CONDITIONS = { new: 'Mới', good: 'Tốt', fair: 'Trung bình', poor: 'Kém', broken: 'Hỏng' };
const REASONS = { onboard: 'Nhận việc', offboard: 'Nghỉ việc', transfer: 'Điều chuyển', adhoc: 'Cấp phát / thu hồi thường xuyên' };

export const SETTINGS_DEFAULTS = {
  managers: [],
  types: [
    { name: 'Máy tính xách tay', prefix: 'LAP', kind: 'asset', depreciation_months: 36 },
    { name: 'Máy tính để bàn', prefix: 'PC', kind: 'asset', depreciation_months: 48 },
    { name: 'Màn hình', prefix: 'MH', kind: 'asset', depreciation_months: 36 },
    { name: 'Điện thoại', prefix: 'DT', kind: 'asset', depreciation_months: 24 },
    { name: 'Máy in / máy chiếu', prefix: 'TB', kind: 'asset', depreciation_months: 60 },
    { name: 'Bàn ghế, tủ', prefix: 'NT', kind: 'asset', depreciation_months: 60 },
    { name: 'Công cụ dụng cụ', prefix: 'CC', kind: 'tool', depreciation_months: 12 },
    { name: 'Đồng phục, thẻ nhân viên', prefix: 'DP', kind: 'tool', depreciation_months: null },
    { name: 'Xe, phương tiện', prefix: 'XE', kind: 'asset', depreciation_months: 72 },
  ],
  locations: ['Văn phòng Hà Nội', 'Văn phòng TP. Hồ Chí Minh', 'Kho'],
  suppliers: [],
  onboard_steps: ['Ký hợp đồng / thư mời nhận việc', 'Cập nhật hồ sơ nhân sự', 'Cấp tài khoản LDL, email', '[assets] Bàn giao tài sản, công cụ làm việc',
    'Hướng dẫn nội quy, quy trình làm việc', 'Giới thiệu với phòng ban'],
  offboard_steps: ['Đơn / quyết định nghỉ việc', 'Bàn giao công việc, hồ sơ đang xử lý', '[assets] Thu hồi tài sản, công cụ', 'Quyết toán lương, BHXH, thuế',
    'Khoá tài khoản LDL, email'],
};

// ================================================================ helpers
async function settings() {
  try { return { ...SETTINGS_DEFAULTS, ...JSON.parse((await getSetting('asset_settings')) || '{}') }; } catch { return { ...SETTINGS_DEFAULTS }; }
}
async function hrManagers() {
  try { return JSON.parse((await getSetting('hrm_settings')) || '{}').managers || []; } catch { return []; }
}
export async function isAssetManager(user) {
  if (user.role === 'admin') return true;
  if (user.role === 'guest') return false;
  return (await settings()).managers.includes(user.id) || (await hrManagers()).includes(user.id);
}
async function requireManager(c) {
  if (!(await isAssetManager(c.get('user')))) throw forbidden('Chỉ quản lý tài sản / nhân sự mới thực hiện được thao tác này');
}
/** Nhân viên xem của mình; quản lý tài sản xem tất cả; quản lý trực tiếp xem nhân viên cấp dưới. */
async function canSeePerson(viewer, userId) {
  if (viewer.id === userId || (await isAssetManager(viewer))) return true;
  return !!(await get('SELECT 1 FROM users WHERE id = ? AND manager_id = ?', userId, viewer.id));
}

const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
/** Giá trị còn lại theo khấu hao đường thẳng. */
export function bookValue(a, on = today()) {
  if (!a.price) return a.price ?? null;
  if (!a.depreciation_months || !a.purchase_date) return a.price;
  const [y1, m1] = a.purchase_date.split('-').map(Number);
  const [y2, m2] = on.split('-').map(Number);
  const months = Math.max(0, (y2 - y1) * 12 + (m2 - m1));
  return Math.max(0, Math.round(a.price * (1 - months / a.depreciation_months)));
}

const ASSET_SELECT = `SELECT a.*, u.name AS holder_name, u.color AS holder_color, u.title AS holder_title, d.name AS holder_department
  FROM assets a LEFT JOIN users u ON u.id = a.holder_id LEFT JOIN departments d ON d.id = u.department_id`;
const view = (a) => a && ({ ...a, book_value: bookValue(a) });

async function logTx(assetId, type, actorId, { from = null, to = null, handoverId = null, detail = null } = {}) {
  await run('INSERT INTO asset_transactions(asset_id, type, from_user_id, to_user_id, handover_id, detail, user_id) VALUES (?,?,?,?,?,?,?)',
    assetId, type, from, to, handoverId, detail, actorId);
}

async function nextCode(prefix) {
  const p = String(prefix || 'TS').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'TS';
  const rows = await all('SELECT code FROM assets WHERE code LIKE ?', `${p}-%`);
  let n = rows.reduce((m, x) => Math.max(m, Number(x.code.slice(p.length + 1)) || 0), 0);
  let code;
  do { n++; code = `${p}-${String(n).padStart(4, '0')}`; } while (await get('SELECT 1 FROM assets WHERE code = ?', code));
  return code;
}

async function assetOr404(id) {
  const a = await get(`${ASSET_SELECT} WHERE a.id = ?`, toInt(id));
  if (!a) throw notFound('Tài sản không tồn tại');
  return a;
}

function parseAsset(b, st, partial = false) {
  const out = {};
  const str = (k, max = 200) => { if (b[k] !== undefined) out[k] = String(b[k] ?? '').trim().slice(0, max) || null; };
  if (!partial || b.name !== undefined) {
    const name = String(b.name || '').trim();
    if (!name) throw badRequest('Tên tài sản là bắt buộc');
    out.name = name.slice(0, 200);
  }
  str('type', 120); str('serial', 120); str('location', 120); str('supplier', 160); str('note', 2000);
  if (b.kind !== undefined) out.kind = b.kind === 'tool' ? 'tool' : 'asset';
  else if (!partial) out.kind = st.types.find((t) => t.name === out.type)?.kind || 'asset';
  for (const k of ['purchase_date', 'warranty_until']) {
    if (b[k] !== undefined) {
      if (b[k] && !isDate(b[k])) throw badRequest('Ngày không hợp lệ');
      out[k] = b[k] || null;
    }
  }
  if (b.price !== undefined) {
    const v = b.price === '' || b.price == null ? null : Number(String(b.price).replace(/[^\d]/g, ''));
    out.price = Number.isFinite(v) ? v : null;
  }
  if (b.depreciation_months !== undefined) out.depreciation_months = toInt(b.depreciation_months) || null;
  else if (!partial) out.depreciation_months = st.types.find((t) => t.name === out.type)?.depreciation_months || null;
  if (b.condition !== undefined) out.condition = CONDITIONS[b.condition] ? b.condition : 'good';
  return out;
}

// ================================================================ meta & settings
r.get('/asset/meta', async (c) => {
  const st = await settings();
  return c.json({ is_manager: await isAssetManager(c.get('user')), is_admin: c.get('user').role === 'admin', settings: st,
    statuses: ASSET_STATUS, conditions: CONDITIONS, reasons: REASONS });
});
r.put('/asset/settings', async (c) => {
  await requireManager(c);
  const b = await jsonBody(c);
  const cur = await settings();
  const list = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => String(x).trim()).filter(Boolean))].slice(0, 60);
  const next = { ...cur };
  if (b.types !== undefined) {
    next.types = (Array.isArray(b.types) ? b.types : []).map((t) => ({
      name: String(t?.name || '').trim().slice(0, 120), prefix: String(t?.prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'TS',
      kind: t?.kind === 'tool' ? 'tool' : 'asset', depreciation_months: toInt(t?.depreciation_months) || null,
    })).filter((t) => t.name).slice(0, 60);
  }
  for (const k of ['locations', 'suppliers', 'onboard_steps', 'offboard_steps']) if (b[k] !== undefined) next[k] = list(b[k]);
  if (b.managers !== undefined) {
    if (c.get('user').role !== 'admin') throw forbidden('Chỉ quản trị viên được phân quyền quản lý tài sản');
    next.managers = idList(b.managers);
  }
  await setSetting('asset_settings', JSON.stringify(next));
  await audit(c.get('user').id, 'asset.settings', 'Cập nhật cài đặt LDL Asset');
  return c.json(next);
});

// ================================================================ assets
r.get('/assets', async (c) => {
  const user = c.get('user');
  const q = c.req.query();
  const manager = await isAssetManager(user);
  const where = [];
  const params = [];
  if (!manager) { where.push('a.holder_id = ?'); params.push(user.id); }
  if (q.q) { const like = `%${q.q.trim()}%`; where.push('(a.name LIKE ? OR a.code LIKE ? OR IFNULL(a.serial, \'\') LIKE ? OR IFNULL(u.name, \'\') LIKE ?)'); params.push(like, like, like, like); }
  for (const k of ['type', 'location', 'kind']) if (q[k]) { where.push(`a.${k} = ?`); params.push(q[k]); }
  if (q.status === 'active') where.push("a.status NOT IN ('disposed', 'lost')");
  else if (ASSET_STATUS[q.status]) { where.push('a.status = ?'); params.push(q.status); }
  if (toInt(q.holder_id)) { where.push('a.holder_id = ?'); params.push(toInt(q.holder_id)); }
  if (toInt(q.department_id)) { where.push('u.department_id = ?'); params.push(toInt(q.department_id)); }
  const order = { price: 'a.price DESC', oldest: 'a.id ASC', name: 'a.name COLLATE NOCASE' }[q.sort] || 'a.id DESC';
  const rows = await all(`${ASSET_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT 2000`, ...params);
  return c.json(rows.map(view));
});

/** Tổng quan: số lượng theo trạng thái, giá trị, theo loại, địa điểm, người giữ nhiều nhất, biên bản chờ xác nhận. */
r.get('/asset/summary', async (c) => {
  await requireManager(c);
  const rows = (await all(`${ASSET_SELECT}`)).map(view);
  const live = rows.filter((a) => a.status !== 'disposed');
  const group = (key, label) => Object.entries(live.reduce((m, a) => { const k = a[key] || label; m[k] = (m[k] || 0) + 1; return m; }, {}))
    .map(([name, n]) => ({ name, c: n })).sort((a, b) => b.c - a.c);
  const holders = Object.values(live.filter((a) => a.holder_id).reduce((m, a) => {
    m[a.holder_id] ||= { id: a.holder_id, name: a.holder_name, color: a.holder_color, department: a.holder_department, c: 0, value: 0 };
    m[a.holder_id].c++; m[a.holder_id].value += a.price || 0; return m;
  }, {})).sort((a, b) => b.c - a.c);
  const warranty = live.filter((a) => a.warranty_until && a.warranty_until >= today() && a.warranty_until <= new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10));
  return c.json({
    total: live.length,
    by_status: Object.keys(ASSET_STATUS).map((k) => ({ status: k, c: rows.filter((a) => a.status === k).length })),
    value: live.reduce((s, a) => s + (a.price || 0), 0),
    book_value: live.reduce((s, a) => s + (a.book_value || 0), 0),
    by_type: group('type', 'Chưa phân loại'),
    by_location: group('location', 'Chưa có địa điểm'),
    by_kind: [{ name: 'Tài sản', c: live.filter((a) => a.kind === 'asset').length }, { name: 'Công cụ dụng cụ', c: live.filter((a) => a.kind === 'tool').length }],
    holders: holders.slice(0, 10),
    holder_count: holders.length,
    pending_handovers: (await get("SELECT COUNT(*) AS n FROM asset_handovers WHERE status = 'pending'")).n,
    open_procedures: await all(`SELECT p.id, p.kind, p.effective_date, u.name, u.color, p.user_id,
        (SELECT COUNT(*) FROM assets x WHERE x.holder_id = p.user_id) AS holding
      FROM hr_procedures p JOIN users u ON u.id = p.user_id WHERE p.status = 'open' ORDER BY p.effective_date LIMIT 20`),
    warranty_expiring: warranty.slice(0, 10),
    recent: await all(`SELECT t.*, a.code, a.name AS asset_name, fu.name AS from_name, tu.name AS to_name, au.name AS actor_name
      FROM asset_transactions t JOIN assets a ON a.id = t.asset_id LEFT JOIN users fu ON fu.id = t.from_user_id LEFT JOIN users tu ON tu.id = t.to_user_id
      LEFT JOIN users au ON au.id = t.user_id ORDER BY t.id DESC LIMIT 12`),
  });
});

r.post('/assets', async (c) => {
  await requireManager(c);
  const b = await jsonBody(c);
  const st = await settings();
  const data = parseAsset(b, st);
  const qty = Math.min(200, Math.max(1, toInt(b.quantity, 1)));
  const prefix = st.types.find((t) => t.name === data.type)?.prefix || 'TS';
  const ids = [];
  for (let i = 0; i < qty; i++) {
    const code = qty === 1 && b.code && String(b.code).trim() ? String(b.code).trim().slice(0, 40) : await nextCode(prefix);
    if (await get('SELECT 1 FROM assets WHERE code = ?', code)) throw badRequest(`Mã tài sản "${code}" đã tồn tại`);
    const keys = Object.keys(data);
    const { lastId } = await run(`INSERT INTO assets(code, ${keys.join(', ')}, created_by) VALUES (?, ${keys.map(() => '?').join(', ')}, ?)`,
      code, ...keys.map((k) => data[k]), c.get('user').id);
    await logTx(lastId, 'create', c.get('user').id, { detail: 'Tạo tài sản' });
    ids.push(lastId);
  }
  // giao ngay cho một người (tuỳ chọn) → tạo biên bản bàn giao
  if (toInt(b.holder_id)) await createHandover(c.get('user'), { kind: 'issue', employee_id: toInt(b.holder_id), asset_ids: ids, reason: 'adhoc' });
  return c.json({ ids, items: (await all(`${ASSET_SELECT} WHERE a.id IN (${ids.map(() => '?').join(',')})`, ...ids)).map(view) }, 201);
});

/** Nhập nhiều tài sản từ Excel (client đọc tệp, gửi các dòng). Người giữ ghi theo tên đăng nhập. */
r.post('/assets/import', async (c) => {
  await requireManager(c);
  const st = await settings();
  const { rows } = await jsonBody(c);
  return c.json(await importAssets(c.get('user'), st, Array.isArray(rows) ? rows : []));
});
async function importAssets(user, st, rows) {
  const users = await all('SELECT id, username FROM users');
  const byUser = Object.fromEntries(users.map((u) => [u.username.toLowerCase(), u.id]));
  let created = 0;
  const errors = [];
  const assign = {};
  for (const [i, raw] of rows.slice(0, 1000).entries()) {
    try {
      const data = parseAsset({ ...raw, purchase_date: normDate(raw.purchase_date), warranty_until: normDate(raw.warranty_until) }, st);
      const code = String(raw.code || '').trim() || await nextCode(st.types.find((t) => t.name === data.type)?.prefix || 'TS');
      if (await get('SELECT 1 FROM assets WHERE code = ?', code)) throw new Error(`mã "${code}" đã tồn tại`);
      const keys = Object.keys(data);
      const { lastId } = await run(`INSERT INTO assets(code, ${keys.join(', ')}, created_by) VALUES (?, ${keys.map(() => '?').join(', ')}, ?)`,
        code.slice(0, 40), ...keys.map((k) => data[k]), user.id);
      await logTx(lastId, 'create', user.id, { detail: 'Nhập từ Excel' });
      const holder = byUser[String(raw.holder || '').trim().replace(/^@/, '').toLowerCase()];
      if (holder) (assign[holder] ||= []).push(lastId);
      created++;
    } catch (e) { errors.push(`Dòng ${i + 2}: ${e.message}`); }
  }
  for (const [uid, ids] of Object.entries(assign)) await createHandover(user, { kind: 'issue', employee_id: Number(uid), asset_ids: ids, reason: 'adhoc', note: 'Nhập từ Excel', autoConfirm: true });
  await audit(user.id, 'asset.import', `Nhập ${created} tài sản từ Excel`);
  return { created, errors };
}
function normDate(v) {
  const s = String(v || '').trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s;
}

r.get('/assets/:id', async (c) => {
  const user = c.get('user');
  const a = await assetOr404(c.req.param('id'));
  if (!(await isAssetManager(user)) && !(a.holder_id && (await canSeePerson(user, a.holder_id)))) throw forbidden('Bạn không có quyền xem tài sản này');
  const history = await all(`SELECT t.*, fu.name AS from_name, tu.name AS to_name, au.name AS actor_name, au.color AS actor_color, h.code AS handover_code
    FROM asset_transactions t LEFT JOIN users fu ON fu.id = t.from_user_id LEFT JOIN users tu ON tu.id = t.to_user_id
    LEFT JOIN users au ON au.id = t.user_id LEFT JOIN asset_handovers h ON h.id = t.handover_id WHERE t.asset_id = ? ORDER BY t.id DESC`, a.id);
  return c.json({ ...view(a), history });
});

r.put('/assets/:id', async (c) => {
  await requireManager(c);
  const a = await assetOr404(c.req.param('id'));
  const b = await jsonBody(c);
  const data = parseAsset(b, await settings(), true);
  if (b.code !== undefined && String(b.code).trim() && String(b.code).trim() !== a.code) {
    if (await get('SELECT 1 FROM assets WHERE code = ? AND id <> ?', String(b.code).trim(), a.id)) throw badRequest('Mã tài sản đã tồn tại');
    data.code = String(b.code).trim().slice(0, 40);
  }
  const keys = Object.keys(data);
  if (keys.length) {
    await run(`UPDATE assets SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...keys.map((k) => data[k]), a.id);
    await logTx(a.id, 'update', c.get('user').id, { detail: 'Cập nhật thông tin' });
  }
  return c.json(view(await assetOr404(a.id)));
});

r.delete('/assets/:id', async (c) => {
  await requireManager(c);
  const a = await assetOr404(c.req.param('id'));
  if (a.holder_id) throw badRequest('Tài sản đang được giao cho nhân viên — hãy thu hồi trước khi xoá');
  await run('DELETE FROM assets WHERE id = ?', a.id);
  await audit(c.get('user').id, 'asset.delete', `Xoá tài sản ${a.code} — ${a.name}`);
  return c.json({ ok: true });
});

/** Đổi trạng thái: bảo trì, sẵn sàng, hỏng, mất, thanh lý. Mất / thanh lý: bỏ người giữ. */
r.post('/assets/:id/status', async (c) => {
  await requireManager(c);
  const a = await assetOr404(c.req.param('id'));
  const b = await jsonBody(c);
  if (!ASSET_STATUS[b.status] || b.status === 'in_use') throw badRequest('Trạng thái không hợp lệ');
  if (b.status === 'available' && a.holder_id) throw badRequest('Tài sản đang được giao — hãy lập biên bản thu hồi');
  const clear = ['lost', 'disposed'].includes(b.status);
  await run(`UPDATE assets SET status = ?, ${clear ? 'holder_id = NULL, assigned_at = NULL,' : ''} condition = COALESCE(?, condition), updated_at = datetime('now') WHERE id = ?`,
    b.status === 'maintenance' && a.holder_id ? 'maintenance' : b.status, b.status === 'broken' ? 'broken' : null, a.id);
  await logTx(a.id, 'status', c.get('user').id, { from: clear ? a.holder_id : null,
    detail: `${ASSET_STATUS[b.status]}${b.note ? ` — ${String(b.note).slice(0, 500)}` : ''}` });
  return c.json(view(await assetOr404(a.id)));
});

/** Điều chuyển trực tiếp từ người đang giữ sang người khác (tạo biên bản thu hồi + bàn giao). */
r.post('/assets/:id/transfer', async (c) => {
  await requireManager(c);
  const a = await assetOr404(c.req.param('id'));
  const b = await jsonBody(c);
  const to = toInt(b.to_user_id);
  if (!to || !(await get('SELECT 1 FROM users WHERE id = ? AND active = 1', to))) throw badRequest('Chọn người nhận');
  if (to === a.holder_id) throw badRequest('Người nhận đang giữ tài sản này');
  if (a.holder_id) await createHandover(c.get('user'), { kind: 'return', employee_id: a.holder_id, asset_ids: [a.id], reason: 'transfer', note: b.note });
  const h = await createHandover(c.get('user'), { kind: 'issue', employee_id: to, asset_ids: [a.id], reason: 'transfer', note: b.note });
  return c.json({ asset: view(await assetOr404(a.id)), handover_id: h });
});

// ================================================================ bàn giao / thu hồi
async function handoverCode(kind) {
  const prefix = `${kind === 'issue' ? 'BG' : 'TH'}-${today().slice(0, 7).replace('-', '')}`;
  const n = (await get('SELECT COUNT(*) AS n FROM asset_handovers WHERE code LIKE ?', `${prefix}-%`)).n + 1;
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

/**
 * Lập biên bản và chuyển tài sản ngay:
 *  - bàn giao (issue): tài sản phải đang sẵn sàng → giao cho nhân viên (đang sử dụng)
 *  - thu hồi (return): tài sản phải đang do nhân viên giữ → về kho (sẵn sàng / hỏng / mất theo tình trạng)
 * Nhân viên nhận thông báo và xác nhận trên hệ thống (autoConfirm: biên bản đã ký giấy / nhập dữ liệu cũ).
 */
async function createHandover(user, { kind, employee_id, asset_ids, items = {}, reason = 'adhoc', note = null, procedure_id = null, autoConfirm = false }) {
  if (!['issue', 'return'].includes(kind)) throw badRequest('Loại biên bản không hợp lệ');
  const emp = await get('SELECT id, name, active FROM users WHERE id = ?', toInt(employee_id));
  if (!emp) throw badRequest('Chọn nhân viên');
  const ids = [...new Set(idList(asset_ids))];
  if (!ids.length) throw badRequest('Chọn ít nhất một tài sản');
  const assets = await all(`SELECT * FROM assets WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  if (assets.length !== ids.length) throw badRequest('Có tài sản không tồn tại');
  for (const a of assets) {
    if (kind === 'issue' && (a.holder_id || !['available'].includes(a.status))) throw badRequest(`${a.code} — ${a.name} không sẵn sàng để bàn giao (${ASSET_STATUS[a.status]}${a.holder_id ? ', đang có người giữ' : ''})`);
    if (kind === 'return' && a.holder_id !== emp.id) throw badRequest(`${a.code} — ${a.name} không do ${emp.name} giữ`);
  }
  const code = await handoverCode(kind);
  const { lastId: hid } = await run(`INSERT INTO asset_handovers(code, kind, reason, employee_id, procedure_id, status, note, created_by, confirmed_at, confirmed_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, code, kind, REASONS[reason] ? reason : 'adhoc', emp.id, toInt(procedure_id) || null, autoConfirm ? 'confirmed' : 'pending',
  note ? String(note).slice(0, 2000) : null, user.id, autoConfirm ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null, autoConfirm ? user.id : null);
  const stmts = [];
  for (const a of assets) {
    const it = items[a.id] || {};
    const cond = CONDITIONS[it.condition] ? it.condition : a.condition;
    stmts.push(['INSERT INTO asset_handover_items(handover_id, asset_id, condition, note) VALUES (?,?,?,?)', [hid, a.id, cond, it.note ? String(it.note).slice(0, 500) : null]]);
    if (kind === 'issue') {
      stmts.push(["UPDATE assets SET holder_id = ?, status = 'in_use', assigned_at = datetime('now'), condition = ?, updated_at = datetime('now') WHERE id = ?", [emp.id, cond, a.id]]);
    } else {
      const status = cond === 'broken' ? 'broken' : it.lost ? 'lost' : 'available';
      stmts.push(["UPDATE assets SET holder_id = NULL, status = ?, assigned_at = NULL, condition = ?, updated_at = datetime('now') WHERE id = ?", [status, cond, a.id]]);
    }
    stmts.push(['INSERT INTO asset_transactions(asset_id, type, from_user_id, to_user_id, handover_id, detail, user_id) VALUES (?,?,?,?,?,?,?)',
      [a.id, kind === 'issue' ? 'assign' : 'return', kind === 'return' ? emp.id : null, kind === 'issue' ? emp.id : null, hid,
        `${kind === 'issue' ? 'Bàn giao cho' : 'Thu hồi từ'} ${emp.name} (${REASONS[reason] || REASONS.adhoc}) — tình trạng: ${CONDITIONS[cond]}`, user.id]]);
  }
  await batch(stmts);
  if (!autoConfirm && emp.id !== user.id) {
    await notify(emp.id, { actorId: user.id, app: APP, type: 'handover',
      title: `${user.name} ${kind === 'issue' ? 'bàn giao cho bạn' : 'đã thu hồi'} ${assets.length} tài sản (${code}) — vui lòng xác nhận`, link: `/asset/handovers/${hid}` });
  }
  return hid;
}

const HANDOVER_SELECT = `SELECT h.*, e.name AS employee_name, e.color AS employee_color, e.title AS employee_title, d.name AS employee_department,
    cb.name AS created_by_name, cf.name AS confirmed_by_name,
    (SELECT COUNT(*) FROM asset_handover_items i WHERE i.handover_id = h.id) AS item_count,
    (SELECT SUM(a.price) FROM asset_handover_items i JOIN assets a ON a.id = i.asset_id WHERE i.handover_id = h.id) AS total_value
  FROM asset_handovers h JOIN users e ON e.id = h.employee_id LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN users cb ON cb.id = h.created_by LEFT JOIN users cf ON cf.id = h.confirmed_by`;

async function fullHandover(id) {
  const h = await get(`${HANDOVER_SELECT} WHERE h.id = ?`, id);
  if (!h) throw notFound('Biên bản không tồn tại');
  h.items = await all(`SELECT i.condition AS handover_condition, i.note AS item_note, a.* FROM asset_handover_items i JOIN assets a ON a.id = i.asset_id
    WHERE i.handover_id = ? ORDER BY a.code`, id);
  return h;
}

r.get('/asset/handovers', async (c) => {
  const user = c.get('user');
  const q = c.req.query();
  const where = [];
  const params = [];
  if (!(await isAssetManager(user))) { where.push('h.employee_id = ?'); params.push(user.id); }
  if (['issue', 'return'].includes(q.kind)) { where.push('h.kind = ?'); params.push(q.kind); }
  if (['pending', 'confirmed', 'cancelled'].includes(q.status)) { where.push('h.status = ?'); params.push(q.status); }
  if (toInt(q.employee_id)) { where.push('h.employee_id = ?'); params.push(toInt(q.employee_id)); }
  if (q.q) { const like = `%${q.q}%`; where.push('(h.code LIKE ? OR e.name LIKE ?)'); params.push(like, like); }
  return c.json(await all(`${HANDOVER_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY h.id DESC LIMIT 500`, ...params));
});
r.post('/asset/handovers', async (c) => {
  await requireManager(c);
  const b = await jsonBody(c);
  const id = await createHandover(c.get('user'), { ...b, autoConfirm: !!b.auto_confirm });
  return c.json(await fullHandover(id), 201);
});
r.get('/asset/handovers/:id', async (c) => {
  const h = await fullHandover(toInt(c.req.param('id')));
  if (!(await canSeePerson(c.get('user'), h.employee_id))) throw forbidden('Bạn không có quyền xem biên bản này');
  h.can_confirm = h.status === 'pending' && (h.employee_id === c.get('user').id || (await isAssetManager(c.get('user'))));
  return c.json(h);
});
/** Nhân viên xác nhận đã nhận / đã trả đủ; quản lý có thể xác nhận thay khi đã ký biên bản giấy. */
r.post('/asset/handovers/:id/confirm', async (c) => {
  const user = c.get('user');
  const h = await fullHandover(toInt(c.req.param('id')));
  const manager = await isAssetManager(user);
  if (h.employee_id !== user.id && !manager) throw forbidden('Chỉ nhân viên nhận / trả tài sản mới xác nhận được');
  if (h.status !== 'pending') throw badRequest('Biên bản đã được xử lý');
  const b = await jsonBody(c);
  await run("UPDATE asset_handovers SET status = 'confirmed', confirmed_at = datetime('now'), confirmed_by = ?, confirm_note = ? WHERE id = ?",
    user.id, String(b.note || '').trim().slice(0, 1000) || (h.employee_id !== user.id ? 'Xác nhận thay (đã ký biên bản giấy)' : null), h.id);
  if (h.created_by && h.created_by !== user.id) {
    await notify(h.created_by, { actorId: user.id, app: APP, type: 'handover',
      title: `${user.name} đã xác nhận biên bản ${h.code} (${h.item_count} tài sản)`, link: `/asset/handovers/${h.id}` });
  }
  return c.json(await fullHandover(h.id));
});
/** Huỷ biên bản đang chờ xác nhận: hoàn tác việc chuyển tài sản. */
r.post('/asset/handovers/:id/cancel', async (c) => {
  await requireManager(c);
  const h = await fullHandover(toInt(c.req.param('id')));
  if (h.status !== 'pending') throw badRequest('Chỉ huỷ được biên bản đang chờ xác nhận');
  const stmts = [["UPDATE asset_handovers SET status = 'cancelled' WHERE id = ?", [h.id]]];
  for (const a of h.items) {
    if (h.kind === 'issue' && a.holder_id === h.employee_id) {
      stmts.push(["UPDATE assets SET holder_id = NULL, status = 'available', assigned_at = NULL WHERE id = ?", [a.id]]);
    } else if (h.kind === 'return' && !a.holder_id) {
      stmts.push(["UPDATE assets SET holder_id = ?, status = 'in_use', assigned_at = datetime('now') WHERE id = ?", [h.employee_id, a.id]]);
    }
    stmts.push(['INSERT INTO asset_transactions(asset_id, type, handover_id, detail, user_id) VALUES (?,?,?,?,?)',
      [a.id, 'status', h.id, `Huỷ biên bản ${h.code}`, c.get('user').id]]);
  }
  await batch(stmts);
  return c.json(await fullHandover(h.id));
});

// ================================================================ theo người sử dụng
r.get('/asset/people', async (c) => {
  await requireManager(c);
  const q = c.req.query();
  const where = ["u.role <> 'guest'"];
  const params = [];
  if (q.q) { where.push('u.name LIKE ?'); params.push(`%${q.q}%`); }
  if (toInt(q.department_id)) { where.push('u.department_id = ?'); params.push(toInt(q.department_id)); }
  if (q.holding === '1') where.push('EXISTS (SELECT 1 FROM assets a WHERE a.holder_id = u.id)');
  if (q.inactive !== '1') where.push("(u.active = 1 OR EXISTS (SELECT 1 FROM assets a WHERE a.holder_id = u.id))");
  return c.json(await all(`SELECT u.id, u.name, u.color, u.title, u.active, d.name AS department_name, IFNULL(h.work_status, 'working') AS work_status,
      (SELECT COUNT(*) FROM assets a WHERE a.holder_id = u.id) AS asset_count,
      (SELECT IFNULL(SUM(a.price), 0) FROM assets a WHERE a.holder_id = u.id) AS asset_value,
      (SELECT COUNT(*) FROM asset_handovers x WHERE x.employee_id = u.id AND x.status = 'pending') AS pending_count
    FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN hr_profiles h ON h.user_id = u.id
    WHERE ${where.join(' AND ')} ORDER BY asset_count DESC, u.name COLLATE NOCASE`, ...params));
});

/** Tài sản đang giữ, biên bản và thủ tục của một người (dùng cho "Tài sản của tôi" và hồ sơ nhân sự). */
r.get('/asset/people/:uid', async (c) => {
  const uid = toInt(c.req.param('uid'));
  if (!(await canSeePerson(c.get('user'), uid))) throw forbidden();
  const u = await get(`SELECT u.id, u.name, u.color, u.title, d.name AS department_name, IFNULL(h.work_status, 'working') AS work_status
    FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN hr_profiles h ON h.user_id = u.id WHERE u.id = ?`, uid);
  if (!u) throw notFound('Nhân sự không tồn tại');
  return c.json({
    user: u,
    assets: (await all(`${ASSET_SELECT} WHERE a.holder_id = ? ORDER BY a.assigned_at DESC`, uid)).map(view),
    handovers: await all(`${HANDOVER_SELECT} WHERE h.employee_id = ? ORDER BY h.id DESC`, uid),
    procedures: await all('SELECT * FROM hr_procedures WHERE user_id = ? ORDER BY id DESC', uid),
  });
});

// ================================================================ thủ tục nhận việc / nghỉ việc
const stepKey = (label, i) => (label.startsWith('[assets]') ? 'assets' : `s${i + 1}`);
const stepLabel = (label) => label.replace(/^\[assets\]\s*/, '');
async function fullProcedure(id) {
  const p = await get(`SELECT p.*, u.name, u.color, u.title, u.active, d.name AS department_name, cb.name AS created_by_name
    FROM hr_procedures p JOIN users u ON u.id = p.user_id LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users cb ON cb.id = p.created_by
    WHERE p.id = ?`, id);
  if (!p) throw notFound('Thủ tục không tồn tại');
  p.steps = JSON.parse(p.steps || '[]');
  p.assets = (await all(`${ASSET_SELECT} WHERE a.holder_id = ? ORDER BY a.code`, p.user_id)).map(view);
  p.handovers = await all(`${HANDOVER_SELECT} WHERE h.procedure_id = ? ORDER BY h.id DESC`, p.id);
  // bước tài sản tự tính: nghỉ việc = đã thu hồi hết; nhận việc = đã có biên bản bàn giao được xác nhận
  const assetStep = p.steps.find((s) => s.key === 'assets');
  if (assetStep && !assetStep.manual) {
    assetStep.auto = true;
    assetStep.done = p.kind === 'offboard' ? p.assets.length === 0 : p.handovers.some((h) => h.kind === 'issue' && h.status === 'confirmed');
  }
  p.progress = p.steps.length ? Math.round((p.steps.filter((s) => s.done).length / p.steps.length) * 100) : 100;
  p.can_complete = p.status === 'open' && p.steps.every((s) => s.done) && (p.kind !== 'offboard' || p.assets.length === 0);
  return p;
}

r.get('/asset/procedures', async (c) => {
  await requireManager(c);
  const q = c.req.query();
  const where = [];
  const params = [];
  if (['onboard', 'offboard'].includes(q.kind)) { where.push('p.kind = ?'); params.push(q.kind); }
  if (['open', 'done', 'cancelled'].includes(q.status)) { where.push('p.status = ?'); params.push(q.status); }
  if (q.q) { where.push('u.name LIKE ?'); params.push(`%${q.q}%`); }
  const rows = await all(`SELECT p.*, u.name, u.color, u.title, d.name AS department_name,
      (SELECT COUNT(*) FROM assets a WHERE a.holder_id = p.user_id) AS holding
    FROM hr_procedures p JOIN users u ON u.id = p.user_id LEFT JOIN departments d ON d.id = u.department_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.status = 'open' DESC, p.effective_date DESC, p.id DESC LIMIT 500`, ...params);
  return c.json(rows.map((p) => {
    const steps = JSON.parse(p.steps || '[]');
    const a = steps.find((s) => s.key === 'assets');
    if (a && !a.manual && p.kind === 'offboard') a.done = p.holding === 0;
    return { ...p, steps: undefined, step_count: steps.length, step_done: steps.filter((s) => s.done).length };
  }));
});

r.post('/asset/procedures', async (c) => {
  await requireManager(c);
  const b = await jsonBody(c);
  if (!['onboard', 'offboard'].includes(b.kind)) throw badRequest('Loại thủ tục không hợp lệ');
  const u = await get('SELECT id, name FROM users WHERE id = ?', toInt(b.user_id));
  if (!u) throw badRequest('Chọn nhân sự');
  if (!isDate(b.effective_date)) throw badRequest(b.kind === 'onboard' ? 'Chọn ngày nhận việc' : 'Chọn ngày nghỉ việc');
  if (await get("SELECT 1 FROM hr_procedures WHERE user_id = ? AND kind = ? AND status = 'open'", u.id, b.kind)) {
    throw badRequest(`${u.name} đang có thủ tục ${b.kind === 'onboard' ? 'nhận việc' : 'nghỉ việc'} chưa hoàn tất`);
  }
  const st = await settings();
  const steps = (b.kind === 'onboard' ? st.onboard_steps : st.offboard_steps).map((label, i) => ({ key: stepKey(label, i), label: stepLabel(label), done: false }));
  const { lastId } = await run(`INSERT INTO hr_procedures(kind, user_id, effective_date, steps, resign_reason, note, created_by) VALUES (?,?,?,?,?,?,?)`,
    b.kind, u.id, b.effective_date, JSON.stringify(steps), String(b.resign_reason || '').trim().slice(0, 200) || null,
    String(b.note || '').trim().slice(0, 2000) || null, c.get('user').id);
  await audit(c.get('user').id, 'hr.procedure', `Mở thủ tục ${b.kind === 'onboard' ? 'nhận việc' : 'nghỉ việc'}: ${u.name}`);
  if (u.id !== c.get('user').id) {
    await notify(u.id, { actorId: c.get('user').id, app: APP, type: 'procedure',
      title: b.kind === 'onboard' ? `Chào mừng ${u.name}! Thủ tục nhận việc của bạn đã được mở (ngày ${b.effective_date.split('-').reverse().join('/')})`
        : `Thủ tục nghỉ việc của bạn đã được mở — vui lòng hoàn tất bàn giao trước ngày ${b.effective_date.split('-').reverse().join('/')}`, link: '/asset' });
  }
  return c.json(await fullProcedure(lastId), 201);
});

r.get('/asset/procedures/:id', async (c) => {
  const p = await fullProcedure(toInt(c.req.param('id')));
  if (!(await isAssetManager(c.get('user'))) && p.user_id !== c.get('user').id) throw forbidden();
  return c.json(p);
});

r.put('/asset/procedures/:id/steps', async (c) => {
  await requireManager(c);
  const p = await fullProcedure(toInt(c.req.param('id')));
  if (p.status !== 'open') throw badRequest('Thủ tục đã đóng');
  const b = await jsonBody(c);
  const raw = JSON.parse((await get('SELECT steps FROM hr_procedures WHERE id = ?', p.id)).steps);
  const s = raw.find((x) => x.key === b.key);
  if (!s) throw notFound('Bước không tồn tại');
  if (s.key === 'assets' && p.kind === 'offboard' && b.done && p.assets.length) throw badRequest(`Còn ${p.assets.length} tài sản chưa thu hồi`);
  s.done = !!b.done;
  s.manual = s.key === 'assets' ? !!b.done : undefined;
  s.done_at = s.done ? new Date().toISOString() : null;
  s.done_by = s.done ? c.get('user').name : null;
  if (b.note !== undefined) s.note = String(b.note || '').slice(0, 500) || undefined;
  await run('UPDATE hr_procedures SET steps = ? WHERE id = ?', JSON.stringify(raw), p.id);
  return c.json(await fullProcedure(p.id));
});

/**
 * Hoàn tất thủ tục:
 *  - nhận việc: ghi ngày bắt đầu vào hồ sơ nhân sự (nếu chưa có)
 *  - nghỉ việc: bắt buộc đã thu hồi hết tài sản; hồ sơ → "Đã nghỉ việc", ngày & lý do nghỉ; tuỳ chọn khoá tài khoản (quản trị viên)
 */
r.post('/asset/procedures/:id/complete', async (c) => {
  await requireManager(c);
  const user = c.get('user');
  const p = await fullProcedure(toInt(c.req.param('id')));
  if (p.status !== 'open') throw badRequest('Thủ tục đã đóng');
  if (p.kind === 'offboard' && p.assets.length) throw badRequest(`Chưa thể hoàn tất: ${p.name} còn giữ ${p.assets.length} tài sản chưa thu hồi`);
  if (!p.steps.every((s) => s.done)) throw badRequest('Còn bước chưa hoàn thành');
  const b = await jsonBody(c);
  if (p.kind === 'offboard') {
    await run(`INSERT INTO hr_profiles(user_id, work_status, resign_date, resign_reason, updated_at) VALUES (?, 'resigned', ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET work_status = 'resigned', resign_date = excluded.resign_date,
        resign_reason = COALESCE(excluded.resign_reason, hr_profiles.resign_reason), updated_at = datetime('now')`, p.user_id, p.effective_date, p.resign_reason);
    if (b.lock_account && user.role === 'admin' && p.user_id !== user.id) {
      const target = await get('SELECT is_owner FROM users WHERE id = ?', p.user_id);
      if (!target?.is_owner) await run('UPDATE users SET active = 0 WHERE id = ?', p.user_id);
    }
  } else {
    await run(`INSERT INTO hr_profiles(user_id, hire_date, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET hire_date = COALESCE(hr_profiles.hire_date, excluded.hire_date), updated_at = datetime('now')`, p.user_id, p.effective_date);
  }
  await run("UPDATE hr_procedures SET status = 'done', completed_at = datetime('now') WHERE id = ?", p.id);
  await audit(user.id, 'hr.procedure', `Hoàn tất thủ tục ${p.kind === 'onboard' ? 'nhận việc' : 'nghỉ việc'}: ${p.name}`);
  return c.json(await fullProcedure(p.id));
});

r.post('/asset/procedures/:id/cancel', async (c) => {
  await requireManager(c);
  const p = await fullProcedure(toInt(c.req.param('id')));
  if (p.status !== 'open') throw badRequest('Thủ tục đã đóng');
  await run("UPDATE hr_procedures SET status = 'cancelled', completed_at = datetime('now') WHERE id = ?", p.id);
  return c.json(await fullProcedure(p.id));
});

export default r;
