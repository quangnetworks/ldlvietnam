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
import { badRequest, notFound, forbidden, toInt, idList, jsonBody, formBody, storeFiles, sendFile } from '../util.js';
import { searchClause } from '../search.js';
import { audit } from '../platform.js';
import { isSubordinate } from '../auth.js';
import { vacateUser } from './territory.js';
import { supplyHoldingsOfUser } from './supplies.js';
import { openAuditsFor } from './audits.js';

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
    { name: 'Tủ mát, tủ trưng bày', prefix: 'TM', kind: 'asset', depreciation_months: 60 },
    { name: 'Kệ, giá trưng bày', prefix: 'KE', kind: 'tool', depreciation_months: 24 },
    { name: 'Biển hiệu, POSM', prefix: 'POSM', kind: 'tool', depreciation_months: 12 },
  ],
  locations: ['Văn phòng Hà Nội', 'Văn phòng TP. Hồ Chí Minh', 'Kho'],
  suppliers: [],
  check_interval_days: 90,                     // kiểm tra tài sản tại NPP / điểm bán định kỳ
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
  return isSubordinate(viewer.id, userId);
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
  if (b.request_id !== undefined) out.request_id = toInt(b.request_id) || null;
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
  if (b.check_interval_days !== undefined) next.check_interval_days = Math.min(365, Math.max(7, toInt(b.check_interval_days) || 90));
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
  if (q.q) {
    // tài sản (mã, tên, serial, vị trí, nhà cung cấp) hoặc người đang giữ
    const [as, us] = await Promise.all([searchClause('asset', q.q, 'a.id'), searchClause('user', q.q, 'a.holder_id')]);
    where.push(`(${as ? as.sql : '0'} OR ${us ? us.sql : '0'})`);
  }
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
    await logTx(lastId, 'create', c.get('user').id, { detail: data.request_id ? `Tạo tài sản từ đề xuất #${data.request_id}` : 'Tạo tài sản' });
    ids.push(lastId);
  }
  // giao ngay cho một người (tuỳ chọn) → tạo biên bản bàn giao
  if (toInt(b.holder_id)) await createHandover(c.get('user'), { kind: 'issue', employee_id: toInt(b.holder_id), asset_ids: ids, reason: 'adhoc' });
  return c.json({ ids, items: (await all(`${ASSET_SELECT} WHERE a.id IN (SELECT value FROM json_each(?))`, JSON.stringify(ids))).map(view) }, 201);
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
  const checks = await all(`SELECT k.id, k.result, k.condition, k.lat, k.lng, k.accuracy, k.note, k.checked_at, (k.photo IS NOT NULL) AS has_photo, u.name AS checked_by_name
    FROM asset_checks k LEFT JOIN users u ON u.id = k.checked_by WHERE k.asset_id = ? ORDER BY k.id DESC LIMIT 30`, a.id);
  return c.json({ ...view(a), history, checks, can_check: await canCheck(user, a), open_audits: await openAuditsFor(a.id) });
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

// ================================================================ tài sản đặt tại NPP / điểm bán
export const CHECK_RESULTS = { ok: 'Còn đúng chỗ, sử dụng tốt', damaged: 'Hư hỏng', moved: 'Bị di chuyển / sai điểm bán', missing: 'Không tìm thấy' };
const MAX_CHECK_PHOTO = 10 * 1024 * 1024;
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max) || null;

/** Người được ghi kiểm tra: quản lý tài sản, người phụ trách (đang giữ) hoặc cấp quản lý của người đó. */
async function canCheck(user, a) {
  if (await isAssetManager(user)) return true;
  return !!a.holder_id && (a.holder_id === user.id || (await canSeePerson(user, a.holder_id)));
}

r.get('/asset/market', async (c) => {
  await requireManager(c);
  const st = await settings();
  const rows = (await all(`${ASSET_SELECT} WHERE a.placement = 'market' ORDER BY a.partner COLLATE NOCASE, a.outlet COLLATE NOCASE, a.code`)).map(view);
  const due = new Date(Date.now() + 7 * 3600e3 - (st.check_interval_days || 90) * 864e5).toISOString().slice(0, 10);
  for (const a of rows) a.check_overdue = !a.last_check_at || a.last_check_at.slice(0, 10) < due;
  return c.json({ assets: rows, check_interval_days: st.check_interval_days || 90, results: CHECK_RESULTS });
});

/** Đặt tài sản tại NPP / điểm bán; người phụ trách nhận trách nhiệm qua biên bản bàn giao (có xác nhận). */
r.post('/assets/:id/place', async (c) => {
  await requireManager(c);
  const a = await assetOr404(c.req.param('id'));
  const b = await jsonBody(c);
  if (['lost', 'disposed'].includes(a.status)) throw badRequest('Tài sản đã mất / thanh lý');
  const partner = str(b.partner, 120);
  if (!partner) throw badRequest('Nhập NPP / đại lý nhận tài sản');
  const resp = toInt(b.responsible_id) || null;
  if (resp && !(await get('SELECT 1 FROM users WHERE id = ? AND active = 1', resp))) throw badRequest('Người phụ trách không hợp lệ');
  const where = [partner, str(b.outlet, 160)].filter(Boolean).join(' — ');
  const note = `Đặt tại ${where}${b.note ? `. ${String(b.note).slice(0, 500)}` : ''}`;
  if (resp && resp !== a.holder_id) {
    if (a.holder_id) await createHandover(c.get('user'), { kind: 'return', employee_id: a.holder_id, asset_ids: [a.id], reason: 'transfer', note });
    const cur = await assetOr404(a.id);
    if (['broken', 'maintenance'].includes(cur.status)) throw badRequest('Tài sản đang hỏng / bảo trì — không đặt tại thị trường được');
    // đang đặt ở thị trường nhưng chưa có người phụ trách → về "sẵn sàng" để lập biên bản bàn giao
    if (!cur.holder_id && cur.status === 'in_use') await run("UPDATE assets SET status = 'available' WHERE id = ?", a.id);
    await createHandover(c.get('user'), { kind: 'issue', employee_id: resp, asset_ids: [a.id], reason: 'adhoc', note });
  } else if (!resp && a.holder_id && b.keep_holder !== true) {
    await createHandover(c.get('user'), { kind: 'return', employee_id: a.holder_id, asset_ids: [a.id], reason: 'transfer', note });
  }
  const placedAt = isDate(b.placed_at) ? b.placed_at : today();
  await run(`UPDATE assets SET placement = 'market', partner = ?, outlet = ?, outlet_address = ?, area = ?, placed_at = ?, agreement_until = ?,
      status = CASE WHEN status IN ('available', 'in_use') THEN 'in_use' ELSE status END, updated_at = datetime('now') WHERE id = ?`,
  partner, str(b.outlet, 160), str(b.outlet_address, 300), str(b.area, 80), placedAt, isDate(b.agreement_until) ? b.agreement_until : null, a.id);
  await logTx(a.id, 'place', c.get('user').id, { to: resp, detail: note });
  return c.json(view(await assetOr404(a.id)));
});

/** Thu hồi về công ty (một tài sản). */
async function recallAsset(user, a, note) {
  if (a.placement !== 'market') throw badRequest(`${a.code} không đặt tại thị trường`);
  const detail = `Thu hồi từ ${[a.partner, a.outlet].filter(Boolean).join(' — ')}${note ? `. ${String(note).slice(0, 500)}` : ''}`;
  if (a.holder_id) await createHandover(user, { kind: 'return', employee_id: a.holder_id, asset_ids: [a.id], reason: 'adhoc', note: detail });
  await run(`UPDATE assets SET placement = 'company', partner = NULL, outlet = NULL, outlet_address = NULL, area = NULL, placed_at = NULL, agreement_until = NULL,
      status = CASE WHEN status = 'in_use' AND holder_id IS NULL THEN 'available' ELSE status END, updated_at = datetime('now') WHERE id = ?`, a.id);
  await logTx(a.id, 'recall', user.id, { detail });
}
r.post('/assets/:id/recall', async (c) => {
  await requireManager(c);
  const a = await assetOr404(c.req.param('id'));
  await recallAsset(c.get('user'), a, (await jsonBody(c)).note);
  return c.json(view(await assetOr404(a.id)));
});
/** Thu hồi tất cả tài sản tại một NPP (VD khi thanh lý / chấm dứt hợp đồng NPP). */
r.post('/asset/market/recall-partner', async (c) => {
  await requireManager(c);
  const b = await jsonBody(c);
  const partner = str(b.partner, 120);
  if (!partner) throw badRequest('Chọn NPP');
  const list = await all(`${ASSET_SELECT} WHERE a.placement = 'market' AND a.partner = ?`, partner);
  for (const a of list) await recallAsset(c.get('user'), a, b.note || 'Thu hồi toàn bộ tài sản tại NPP');
  await audit(c.get('user').id, 'asset.recall', `Thu hồi ${list.length} tài sản tại ${partner}`);
  return c.json({ count: list.length });
});

/** Kiểm tra tại chỗ: ảnh + vị trí + kết quả (người phụ trách hoặc quản lý). */
r.post('/assets/:id/checks', async (c) => {
  const user = c.get('user');
  const a = await assetOr404(c.req.param('id'));
  if (!(await canCheck(user, a))) throw forbidden('Bạn không phụ trách tài sản này');
  const { fields, files } = await formBody(c);
  const result = CHECK_RESULTS[fields.result] ? fields.result : null;
  if (!result) throw badRequest('Chọn kết quả kiểm tra');
  const photo = files[0] || null;
  if (photo && (!/^image\//.test(photo.type || '') || photo.size > MAX_CHECK_PHOTO)) throw badRequest('Ảnh không hợp lệ (chỉ nhận ảnh, tối đa 10MB)');
  if (a.placement === 'market' && !photo && !(await isAssetManager(user))) throw badRequest('Chụp ảnh tài sản tại điểm bán để ghi nhận kiểm tra');
  const lat = Number(fields.lat); const lng = Number(fields.lng); const acc = Number(fields.accuracy);
  const geo = fields.lat !== undefined && fields.lat !== '' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const cond = CONDITIONS[fields.condition] ? fields.condition : result === 'damaged' ? 'broken' : null;
  const [stored] = photo ? await storeFiles([photo]) : [];
  await run('INSERT INTO asset_checks(asset_id, result, condition, photo, lat, lng, accuracy, note, checked_by) VALUES (?,?,?,?,?,?,?,?,?)',
    a.id, result, cond, stored?.filename ?? null, geo ? lat : null, geo ? lng : null, geo && Number.isFinite(acc) ? Math.round(acc) : null, str(fields.note, 1000), user.id);
  await run(`UPDATE assets SET last_check_at = datetime('now'), last_check_result = ?, condition = COALESCE(?, condition), updated_at = datetime('now') WHERE id = ?`, result, cond, a.id);
  await logTx(a.id, 'check', user.id, { detail: `Kiểm tra: ${CHECK_RESULTS[result]}${fields.note ? ` — ${String(fields.note).slice(0, 300)}` : ''}` });
  if (result !== 'ok') {
    const managers = (await settings()).managers.filter((m) => m !== user.id);
    for (const m of managers) {
      await notify(m, { actorId: user.id, app: APP, type: 'asset_check', title: `${a.code} — ${a.name} tại ${a.partner || 'thị trường'}: ${CHECK_RESULTS[result].toLowerCase()}`, link: `/asset/item/${a.id}` });
    }
  }
  return c.json(view(await assetOr404(a.id)), 201);
});
r.get('/asset/checks/:cid/photo', async (c) => {
  const k = await get('SELECT k.*, a.holder_id, a.placement FROM asset_checks k JOIN assets a ON a.id = k.asset_id WHERE k.id = ?', toInt(c.req.param('cid')));
  if (!k?.photo) throw notFound('Không có ảnh');
  if (!(await canCheck(c.get('user'), { holder_id: k.holder_id }))) throw forbidden();
  return sendFile(c, { filename: k.photo, original_name: `kiem-tra-tai-san-${k.id}.jpg`, mime: 'image/jpeg' }, true);
});

// ================================================================ khấu hao, thanh lý, liên kết đề xuất
export const DISPOSAL_METHODS = { sell: 'Bán thanh lý', destroy: 'Huỷ bỏ', donate: 'Tặng / cho', return_supplier: 'Trả nhà cung cấp' };
/** Số tháng đã khấu hao tính đến ngày `on` (cùng cách tính với bookValue: bắt đầu từ tháng sau tháng mua). */
function monthsUsed(a, on) {
  const [y1, m1] = a.purchase_date.split('-').map(Number);
  const [y2, m2] = on.split('-').map(Number);
  return Math.min(a.depreciation_months, Math.max(0, (y2 - y1) * 12 + (m2 - m1)));
}
const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const prevMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

/** Bảng khấu hao theo tháng (đường thẳng) cho kế toán. */
r.get('/asset/depreciation', async (c) => {
  await requireManager(c);
  const ym = /^\d{4}-\d{2}$/.test(c.req.query('month') || '') ? c.req.query('month') : today().slice(0, 7);
  const end = monthEnd(ym);
  const prevEnd = monthEnd(prevMonth(ym));
  const assets = await all(`SELECT a.id, a.code, a.name, a.type, a.kind, a.price, a.purchase_date, a.depreciation_months, a.status, a.placement, a.partner,
      a.location, d.date AS disposed_on FROM assets a LEFT JOIN asset_disposals d ON d.asset_id = a.id
    WHERE a.price > 0 AND (d.date IS NULL OR d.date >= ?)`, `${ym}-01`);
  const rows = [];
  let missing = 0;
  for (const a of assets) {
    if (!a.purchase_date) { missing++; continue; }
    if (!a.depreciation_months || a.purchase_date > end) continue;
    const used = monthsUsed(a, end);
    const accumulated = Math.round((a.price * used) / a.depreciation_months);
    const before = Math.round((a.price * monthsUsed(a, prevEnd)) / a.depreciation_months);
    rows.push({ ...a, months_used: used, monthly: Math.round(a.price / a.depreciation_months), in_month: accumulated - before, accumulated,
      book_value: a.price - accumulated, fully: used >= a.depreciation_months });
  }
  const byType = {};
  for (const x of rows) {
    const t = (byType[x.type || 'Chưa phân loại'] ||= { type: x.type || 'Chưa phân loại', count: 0, cost: 0, in_month: 0, accumulated: 0, book_value: 0 });
    t.count++; t.cost += x.price; t.in_month += x.in_month; t.accumulated += x.accumulated; t.book_value += x.book_value;
  }
  const sum = (k) => rows.reduce((s, x) => s + x[k], 0);
  return c.json({ month: ym, rows, by_type: Object.values(byType),
    totals: { count: rows.length, cost: sum('price'), in_month: sum('in_month'), accumulated: sum('accumulated'), book_value: sum('book_value') },
    missing_purchase_date: missing });
});

/** Thanh lý: chỉ khi tài sản đã về công ty (không còn người giữ, không đặt tại NPP). */
r.post('/assets/:id/dispose', async (c) => {
  await requireManager(c);
  const a = await assetOr404(c.req.param('id'));
  const b = await jsonBody(c);
  if (a.status === 'disposed') throw badRequest('Tài sản đã thanh lý');
  if (a.holder_id) throw badRequest('Tài sản đang có người giữ — lập biên bản thu hồi trước');
  if (a.placement === 'market') throw badRequest('Tài sản đang đặt tại NPP / điểm bán — thu hồi về công ty trước');
  const method = DISPOSAL_METHODS[b.method] ? b.method : null;
  if (!method) throw badRequest('Chọn hình thức thanh lý');
  const date = isDate(b.date) ? b.date : today();
  const proceeds = b.proceeds === '' || b.proceeds == null ? null : Number(String(b.proceeds).replace(/[^\d]/g, '')) || 0;
  const bv = bookValue(a, date);
  const rid = toInt(b.request_id) || null;
  await batch([
    ['INSERT INTO asset_disposals(asset_id, date, method, proceeds, cost, book_value, request_id, note, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
      [a.id, date, method, proceeds, a.price ?? null, bv ?? null, rid, b.note ? String(b.note).slice(0, 2000) : null, c.get('user').id]],
    ["UPDATE assets SET status = 'disposed', updated_at = datetime('now') WHERE id = ?", [a.id]],
  ]);
  const money = proceeds != null ? ` — thu ${proceeds.toLocaleString('vi-VN')} đ` : '';
  await logTx(a.id, 'dispose', c.get('user').id, { detail: `${DISPOSAL_METHODS[method]} ngày ${date.split('-').reverse().join('/')}${money}${rid ? ` (đề xuất #${rid})` : ''}` });
  await audit(c.get('user').id, 'asset.dispose', `Thanh lý ${a.code} — ${a.name}`);
  return c.json(view(await assetOr404(a.id)));
});

r.get('/asset/disposals', async (c) => {
  await requireManager(c);
  const y = /^\d{4}$/.test(c.req.query('year') || '') ? c.req.query('year') : today().slice(0, 4);
  const rows = await all(`SELECT d.*, a.code, a.name, a.type, u.name AS created_by_name FROM asset_disposals d JOIN assets a ON a.id = d.asset_id
    LEFT JOIN users u ON u.id = d.created_by WHERE d.date LIKE ? ORDER BY d.date DESC, d.id DESC`, `${y}-%`);
  return c.json({ year: y, rows, methods: DISPOSAL_METHODS });
});

/** Những gì đã ghi vào LDL Asset từ một đề xuất (tài sản tạo mới, phiếu cấp phát CCDC, thanh lý). */
r.get('/asset/by-request/:rid', async (c) => {
  await requireManager(c);
  const rid = toInt(c.req.param('rid'));
  return c.json({
    assets: (await all(`${ASSET_SELECT} WHERE a.request_id = ? ORDER BY a.code`, rid)).map(view),
    moves: await all(`SELECT m.id, m.kind, m.qty, m.date, i.name AS item_name, i.unit, th.name AS to_name FROM asset_supply_moves m
      JOIN asset_supply_items i ON i.id = m.item_id LEFT JOIN asset_supply_holders th ON th.id = m.to_holder_id WHERE m.request_id = ? AND m.voided = 0`, rid),
    disposals: await all('SELECT d.*, a.code, a.name FROM asset_disposals d JOIN assets a ON a.id = d.asset_id WHERE d.request_id = ?', rid),
  });
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
  const assets = await all('SELECT * FROM assets WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(ids));
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
  if (q.q) {
    const us = await searchClause('user', q.q, 'h.employee_id');
    where.push(`(h.code LIKE ? OR ${us ? us.sql : '0'})`); params.push(`%${q.q.trim()}%`);
  }
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
  const us = q.q ? await searchClause('user', q.q, 'u.id') : null;
  if (us) where.push(us.sql);
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
    supplies: await supplyHoldingsOfUser(uid),
    // đợt kiểm kê đang mở có tài sản người này đang giữ mà chưa xác nhận
    audits: await all(`SELECT x.id, x.name, COUNT(*) AS pending FROM asset_audit_lines l JOIN asset_audits x ON x.id = l.audit_id JOIN assets a ON a.id = l.asset_id
      WHERE x.status = 'open' AND l.found = 0 AND a.holder_id = ? GROUP BY x.id ORDER BY x.id DESC`, uid),
  });
});

// ================================================================ thủ tục nhận việc / nghỉ việc
const stepKey = (label, i) => (label.startsWith('[assets]') ? 'assets' : `s${i + 1}`);
const stepLabel = (label) => label.replace(/^\[assets\]\s*/, '');
/** Danh sách bước (chưa làm) của thủ tục nhận việc / nghỉ việc theo thiết lập hiện tại. */
export async function procedureSteps(kind) {
  const st = await settings();
  return (kind === 'onboard' ? st.onboard_steps : st.offboard_steps).map((label, i) => ({ key: stepKey(label, i), label: stepLabel(label), done: false }));
}
async function fullProcedure(id) {
  const p = await get(`SELECT p.*, u.name, u.color, u.title, u.active, d.name AS department_name, cb.name AS created_by_name
    FROM hr_procedures p JOIN users u ON u.id = p.user_id LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users cb ON cb.id = p.created_by
    WHERE p.id = ?`, id);
  if (!p) throw notFound('Thủ tục không tồn tại');
  p.steps = JSON.parse(p.steps || '[]');
  p.assets = (await all(`${ASSET_SELECT} WHERE a.holder_id = ? ORDER BY a.code`, p.user_id)).map(view);
  p.handovers = await all(`${HANDOVER_SELECT} WHERE h.procedure_id = ? ORDER BY h.id DESC`, p.id);
  // đồng phục, xe kéo… cấp theo số lượng: nghỉ việc phải trả hết (hoặc ghi nhận hỏng / mất, bồi thường)
  p.supplies = (await supplyHoldingsOfUser(p.user_id)).filter((x) => x.returnable);
  // bước tài sản tự tính: nghỉ việc = đã thu hồi hết; nhận việc = đã có biên bản bàn giao được xác nhận
  const assetStep = p.steps.find((s) => s.key === 'assets');
  if (assetStep && !assetStep.manual) {
    assetStep.auto = true;
    assetStep.done = p.kind === 'offboard' ? p.assets.length === 0 && p.supplies.length === 0 : p.handovers.some((h) => h.kind === 'issue' && h.status === 'confirmed');
  }
  p.progress = p.steps.length ? Math.round((p.steps.filter((s) => s.done).length / p.steps.length) * 100) : 100;
  p.can_complete = p.status === 'open' && p.steps.every((s) => s.done) && (p.kind !== 'offboard' || (p.assets.length === 0 && p.supplies.length === 0));
  return p;
}

r.get('/asset/procedures', async (c) => {
  await requireManager(c);
  const q = c.req.query();
  const where = [];
  const params = [];
  if (['onboard', 'offboard'].includes(q.kind)) { where.push('p.kind = ?'); params.push(q.kind); }
  if (['open', 'done', 'cancelled'].includes(q.status)) { where.push('p.status = ?'); params.push(q.status); }
  const us = q.q ? await searchClause('user', q.q, 'u.id') : null;
  if (us) where.push(us.sql);
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
  const steps = await procedureSteps(b.kind);
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
    await vacateUser(p.user_id);   // vị trí trong cơ cấu để trống cho đến khi có người mới
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
