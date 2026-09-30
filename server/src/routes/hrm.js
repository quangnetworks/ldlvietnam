/** HRM+ modules: LDL HRM (hồ sơ nhân sự), LDL Checkin (chấm công), LDL Timeoff (nghỉ phép). */
import { Hono } from 'hono';
import { all, get, run, batch, getSetting, setSetting } from '../db.js';
import { requireAdmin, underSql, isSubordinate, hashPassword } from '../auth.js';
import { badRequest, notFound, forbidden, toInt, idList, jsonBody, formBody, storeFiles, removeFile, sendFile } from '../util.js';
import { publicFileLink } from '../files.js';
import { audit } from '../platform.js';
import { assignStmt, fillVacancyStmts, industryOf, refreshSalesRoleStmt, salesSettings, vacateStmts, vacateUser } from './territory.js';
import { clientIp, ipMatches, validIpRule } from '../security.js';

const r = new Hono();
const SALES_ORDER = ['NSM', 'RSM', 'ASM', 'SS', 'PG', 'SREP', 'SREP_KA'];

// ---------------------------------------------------------------- time (Asia/Ho_Chi_Minh, UTC+7, no DST)
const VN_OFFSET = 7 * 3600 * 1000;
const vnDate = (d = new Date()) => new Date(d.getTime() + VN_OFFSET).toISOString().slice(0, 10);
const vnMinutes = (utcStamp) => {
  const d = new Date(`${utcStamp.replace(' ', 'T')}Z`);
  const v = new Date(d.getTime() + VN_OFFSET);
  return v.getUTCHours() * 60 + v.getUTCMinutes();
};
const utcStamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const hm = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };

async function jsonSetting(key, defaults) {
  try { return { ...defaults, ...JSON.parse((await getSetting(key)) || '{}') }; } catch { return { ...defaults }; }
}
const hrmSettings = () => jsonSetting('hrm_settings', { managers: [] });
const checkinSettings = () => jsonSetting('checkin_settings', { start: '08:30', end: '17:30', grace: 10, ip_only: false, ip_rules: [], work_saturday: true });
const timeoffSettings = async () => {
  const st = await jsonSetting('timeoff_settings', { group_id: null, annual_days: 12, count_saturday: false });
  if (!st.group_id) st.group_id = (await get("SELECT id FROM request_groups WHERE name = 'Đề xuất nghỉ phép'"))?.id ?? null;
  return st;
};

async function isHrManager(user) {
  if (user.role === 'admin') return true;
  return (await hrmSettings()).managers.includes(user.id);
}
async function requireHr(c) {
  if (!(await isHrManager(c.get('user')))) throw forbidden('Chỉ quản lý nhân sự mới xem được thông tin này');
}
/** Admin / HR manager see everyone; a line manager sees direct reports; everyone sees themselves. */
async function canSeeUser(viewer, userId) {
  if (viewer.id === userId || (await isHrManager(viewer))) return true;
  return isSubordinate(viewer.id, userId);
}

// ================================================================ HRM
const HR_FIELDS = ['employee_code', 'gender', 'id_number', 'id_issue_date', 'id_issue_place', 'hire_date', 'probation_end', 'contract_type',
  'contract_end', 'work_status', 'insurance_number', 'tax_code', 'bank_account', 'emergency_contact', 'note',
  'official_date', 'office', 'job_position', 'employee_type', 'resign_date', 'resign_reason'];
const DATE_FIELDS = ['id_issue_date', 'hire_date', 'probation_end', 'contract_end', 'official_date', 'resign_date'];
const WORK_STATUS = ['working', 'probation', 'leave', 'resigned'];

const EMP_SELECT = `SELECT u.id, u.name, u.username, u.email, u.phone, u.title, u.color, u.birthday, u.address, u.department_id, u.manager_id,
    u.active, u.sales_role, u.sales_industry, d.name AS department_name, m.name AS manager_name, h.*,
    (SELECT c.to_value || ' (' || c.effective_date || ')' FROM hr_careers c WHERE c.user_id = u.id AND c.type = 'promotion'
      ORDER BY c.effective_date DESC, c.id DESC LIMIT 1) AS last_promotion,
    COALESCE((SELECT GROUP_CONCAT(t.name || IFNULL(' · ' || tm.industry, '') || CASE WHEN tm.is_concurrent THEN ' (KN)' ELSE '' END, ', ') FROM territory_members tm
      JOIN territories t ON t.id = tm.territory_id WHERE tm.user_id = u.id),
      (SELECT 'Đã rời: ' || GROUP_CONCAT(t.name || IFNULL(' · ' || th.industry, ''), ', ') FROM territory_history th
        JOIN territories t ON t.id = th.territory_id WHERE th.user_id = u.id AND IFNULL(h.work_status, 'working') = 'resigned')) AS territory_names
  FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users m ON m.id = u.manager_id
  LEFT JOIN hr_profiles h ON h.user_id = u.id`;
const empView = (e) => ({ ...e, id: e.id ?? e.user_id, work_status: e.work_status || 'working' });

r.get('/hrm/meta', async (c) => c.json({ is_manager: await isHrManager(c.get('user')), settings: await hrmSettings() }));

r.get('/hrm/employees', async (c) => {
  await requireHr(c);
  const q = c.req.query();
  const { where, params } = employeeFilter(c.get('user'), q);
  if (toInt(q.department_id)) { where.push('u.department_id = ?'); params.push(toInt(q.department_id)); }
  if (q.q) { const like = `%${q.q}%`; where.push("(u.name LIKE ? OR IFNULL(h.employee_code,'') LIKE ? OR IFNULL(u.phone,'') LIKE ?)"); params.push(like, like, like); }
  if (q.contract === 'expiring') { where.push("h.contract_end IS NOT NULL AND h.contract_end BETWEEN date('now') AND date('now', '+30 day')"); }
  const rows = await all(`${EMP_SELECT} WHERE ${where.join(' AND ')} ORDER BY u.name COLLATE NOCASE`, ...params);
  return c.json(rows.map(empView));
});

/**
 * Bộ lọc danh sách nhân sự theo view (giống Base HRM): đang làm việc (mặc định), tất cả, tôi quản lý, thử việc, tạm nghỉ, nghỉ việc.
 * Tham số cũ status=… vẫn dùng được.
 */
function employeeFilter(user, q) {
  const where = ["u.role <> 'guest'"];
  const params = [];
  const view = q.view || q.status || 'working_all';
  if (view === 'all') { /* mọi nhân sự */ } else if (view === 'resigned') where.push("(h.work_status = 'resigned' OR u.active = 0)");
  else if (view === 'mine') { where.push(`${underSql('u.id')} AND u.active = 1 AND IFNULL(h.work_status, 'working') <> 'resigned'`); params.push(user.id); }
  else if (['working', 'probation', 'leave'].includes(view)) { where.push("IFNULL(h.work_status, 'working') = ? AND u.active = 1"); params.push(view); }
  else where.push("u.active = 1 AND IFNULL(h.work_status, 'working') <> 'resigned'");
  if (toInt(q.department_id)) { where.push('u.department_id = ?'); params.push(toInt(q.department_id)); }
  for (const k of ['office', 'employee_type', 'job_position', 'gender']) if (q[k]) { where.push(`h.${k} = ?`); params.push(q[k]); }
  if (q.sales_role === 'none') where.push('u.sales_role IS NULL');
  else if (q.sales_role) { where.push('u.sales_role = ?'); params.push(q.sales_role); }
  // địa bàn: người phụ trách địa bàn đó và mọi địa bàn con (VD chọn "Miền Bắc" → RSM, ASM, SS, SREP… của miền)
  // người đã nghỉ việc: tính theo vị trí đã từng phụ trách (lịch sử)
  if (toInt(q.territory_id)) {
    const sub = `(WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT x.id FROM territories x JOIN sub ON x.parent_id = sub.id) SELECT id FROM sub)`;
    where.push(`(u.id IN (SELECT tm.user_id FROM territory_members tm WHERE tm.territory_id IN ${sub})
      OR (IFNULL(h.work_status, 'working') = 'resigned' AND u.id IN (SELECT th.user_id FROM territory_history th WHERE th.territory_id IN ${sub})))`);
    params.push(toInt(q.territory_id), toInt(q.territory_id));
  }
  // ngành hàng: người phụ trách ngành đó (tính cả người phụ trách chung khi chọn kèm địa bàn / vị trí thì vẫn lọc đúng ngành)
  if (q.industry) { where.push('(u.id IN (SELECT user_id FROM territory_members WHERE industry = ?) OR u.sales_industry = ?)'); params.push(String(q.industry), String(q.industry)); }
  if (q.q) { const like = `%${q.q}%`; where.push("(u.name LIKE ? OR IFNULL(h.employee_code,'') LIKE ? OR IFNULL(u.phone,'') LIKE ? OR IFNULL(u.email,'') LIKE ?)"); params.push(like, like, like, like); }
  if (q.contract === 'expiring') { where.push("h.contract_end IS NOT NULL AND h.contract_end BETWEEN date('now') AND date('now', '+30 day')"); }
  return { where, params };
}

const csvCell = (v) => { const t = v == null ? '' : String(v); return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const EXPORT_COLS = [
  ['employee_code', 'Mã NV'], ['name', 'Họ tên'], ['username', 'Tài khoản'], ['work_status', 'Trạng thái'], ['title', 'Chức danh'],
  ['department_name', 'Phòng ban'], ['manager_name', 'Quản lý trực tiếp'], ['sales_role', 'Vị trí kinh doanh'], ['sales_industry', 'Ngành hàng'], ['territory_names', 'Địa bàn phụ trách'], ['job_position', 'Vị trí công việc'], ['employee_type', 'Phân loại nhân sự'],
  ['office', 'Văn phòng'], ['gender', 'Giới tính'], ['birthday', 'Ngày sinh'], ['phone', 'Điện thoại'], ['email', 'Email'],
  ['hire_date', 'Ngày bắt đầu'], ['official_date', 'Ngày chính thức'], ['contract_type', 'Hợp đồng'], ['contract_end', 'Hết hạn HĐ'],
  ['id_number', 'Số CCCD'], ['insurance_number', 'Số sổ BHXH'], ['tax_code', 'MST TNCN'], ['bank_account', 'Tài khoản ngân hàng'],
  ['last_promotion', 'Thăng tiến gần nhất'], ['resign_date', 'Ngày nghỉ việc'], ['resign_reason', 'Lý do nghỉ việc'],
];
const STATUS_TEXT = { working: 'Chính thức', probation: 'Thử việc', leave: 'Tạm nghỉ', resigned: 'Đã nghỉ việc' };

/** Trích xuất danh sách nhân sự (CSV mở bằng Excel), theo view & bộ lọc đang chọn. */
r.get('/hrm/employees/export', async (c) => {
  await requireHr(c);
  const { where, params } = employeeFilter(c.get('user'), c.req.query());
  const rows = (await all(`${EMP_SELECT} WHERE ${where.join(' AND ')} ORDER BY u.name COLLATE NOCASE`, ...params)).map(empView);
  const lines = [EXPORT_COLS.map(([, l]) => l).join(','),
    ...rows.map((e) => EXPORT_COLS.map(([k]) => csvCell(k === 'work_status' ? STATUS_TEXT[e.work_status] : e[k])).join(','))];
  await audit(c.get('user').id, 'hrm.export', `Trích xuất ${rows.length} hồ sơ nhân sự`);
  return new Response(`\uFEFF${lines.join('\r\n')}`, { headers: {
    'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="nhan-su-${vnDate()}.csv"` } });
});

/**
 * Nhập hồ sơ nhân sự từ Excel (client đọc tệp, gửi các dòng theo từng sheet):
 *  - rows (sheet "Nhân sự"): xác định bằng tài khoản hoặc mã NV; chưa có thì **tạo tài khoản mới** (mật khẩu mặc định,
 *    thiếu tài khoản thì dùng mã NV); cập nhật thông tin tài khoản, hồ sơ HRM, quản lý trực tiếp, vị trí kinh doanh – địa bàn – ngành hàng
 *  - careers (sheet "Lịch sử công tác"): thăng tiến, điều chỉnh lương, điều chuyển, khen thưởng, kỷ luật (bỏ qua dòng trùng)
 *  - contracts (sheet "Hợp đồng"): các hợp đồng lao động đã ký (bỏ qua dòng trùng)
 * Chỉ các ô có giá trị được cập nhật. Lịch sử nhập vào chỉ ghi nhận, không đổi chức danh / phòng ban hiện tại.
 */
r.post('/hrm/employees/import', async (c) => {
  await requireHr(c);
  return c.json(await importProfiles(c, await jsonBody(c)));
});

const STATUS_BY_TEXT = Object.fromEntries(Object.entries(STATUS_TEXT).map(([k, v]) => [v.toLowerCase(), k]));
const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());
/** dd/mm/yyyy | yyyy-mm-dd → yyyy-mm-dd; '' → null; sai định dạng → false */
function isoDate(v) {
  const t = clean(v);
  if (!t) return null;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  const d = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : t.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : false;
}
const AVATAR_COLORS = ['#2d7ff9', '#20c997', '#f59f00', '#e8590c', '#7048e8', '#d6336c', '#0ca678', '#1098ad', '#ae3ec9', '#5c940d'];
const SALES_ROLE_BY_TEXT = { nsm: 'NSM', rsm: 'RSM', asm: 'ASM', ss: 'SS', pg: 'PG', srep: 'SREP', 'srep ka': 'SREP_KA', srep_ka: 'SREP_KA', srepka: 'SREP_KA' };

/**
 * Quy mô lớn (hàng trăm nhân sự / lần): đọc trước mọi dữ liệu cần tra cứu, kiểm tra từng dòng trong bộ nhớ,
 * rồi ghi theo lô — số truy vấn không tăng theo số dòng (Cloudflare D1 giới hạn số truy vấn mỗi lần gọi API).
 * id tài khoản / phòng ban mới được cấp trước để các câu lệnh sau (hồ sơ, quản lý, phân công) tham chiếu được.
 */
async function importProfiles(c, body) {
  const actor = c.get('user');
  const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 1000);
  const careerRows = (Array.isArray(body.careers) ? body.careers : []).slice(0, 5000);
  const contractRows = (Array.isArray(body.contracts) ? body.contracts : []).slice(0, 3000);
  const createAccounts = !!body.create_accounts;
  const res = { created: 0, updated: 0, assignments: 0, careers: 0, contracts: 0, skipped: 0, errors: [], new_accounts: [] };
  const err = (sheet, i, msg) => res.errors.push(`${sheet} – dòng ${i + 2}: ${msg}`);

  const users = await all('SELECT u.id, u.username, u.role, u.is_owner, h.employee_code FROM users u LEFT JOIN hr_profiles h ON h.user_id = u.id');
  const byUser = new Map(users.map((u) => [u.username.toLowerCase(), u]));
  const byCode = new Map(users.filter((u) => u.employee_code).map((u) => [u.employee_code.toLowerCase(), u]));
  const find = (row) => byUser.get(clean(row.username).replace(/^@/, '').toLowerCase()) || byCode.get(clean(row.employee_code).toLowerCase());
  const newUsername = (row) => (clean(row.username).replace(/^@/, '') || clean(row.employee_code)).toLowerCase();

  // tài khoản mới cần mật khẩu mặc định — kiểm tra trước khi ghi bất cứ dòng nào
  const needNew = createAccounts && rows.some((row) => !find(row) && newUsername(row));
  let hash = null;
  if (needNew) {
    if (String(body.password || '').length < 6) throw badRequest('Nhập mật khẩu mặc định (ít nhất 6 ký tự) cho các tài khoản mới');
    hash = await hashPassword(String(body.password));
  }
  const [deps, territories, industries, adminTitles, maxIds] = await Promise.all([
    all('SELECT id, name FROM departments'), all('SELECT id, name, level FROM territories'), salesSettings().then((x) => x.industries),
    getSetting('wework_settings').then((v) => { try { return JSON.parse(v || '{}').admin_titles || ['Quản trị']; } catch { return ['Quản trị']; } }),
    get('SELECT (SELECT IFNULL(MAX(id), 0) FROM users) AS u, (SELECT IFNULL(MAX(id), 0) FROM departments) AS d'),
  ]);
  let nextUser = maxIds.u; let nextDep = maxIds.d;
  const S = [];                      // câu lệnh ghi, chạy theo thứ tự
  const depId = (name) => {
    if (!name) return null;
    let d = deps.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!d) { d = { id: ++nextDep, name }; deps.push(d); S.push(['INSERT INTO departments(id, name) VALUES (?,?)', [d.id, name.slice(0, 120)]]); }
    return d.id;
  };
  const nt = (x) => String(x || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
  const isAdminTitle = (t) => !!nt(t) && adminTitles.some((x) => nt(x) && (nt(t) === nt(x) || nt(t).startsWith(`${nt(x)} `)));
  const salesTouched = new Set();
  const managerLinks = [];

  for (const [i, row] of rows.entries()) {
    const SH = 'Nhân sự';
    let u = find(row);
    const name = clean(row.name);
    let title = clean(row.title);
    if (title && actor.role !== 'admin' && isAdminTitle(title)) { err(SH, i, `chức danh "${title}" có quyền quản trị — chỉ quản trị viên được đặt`); title = ''; }
    const birthday = isoDate(row.birthday);
    if (birthday === false) err(SH, i, `ngày sinh "${row.birthday}" không hợp lệ`);
    let changed = false;
    if (!u) {
      const username = newUsername(row);
      if (!username) { err(SH, i, 'thiếu Tài khoản / Mã NV'); continue; }
      if (!createAccounts) { err(SH, i, `không tìm thấy nhân sự ${username} (bật "Tạo tài khoản mới" để thêm)`); continue; }
      if (!/^[\w.@-]{2,64}$/.test(username)) { err(SH, i, `tài khoản "${username}" chỉ gồm chữ không dấu, số, . _ - @`); continue; }
      if (!name) { err(SH, i, `tài khoản mới ${username} cần Họ tên`); continue; }
      const resigned = /nghỉ việc|resigned/i.test(clean(row.work_status));
      u = { id: ++nextUser, username, role: 'member' };
      S.push([`INSERT INTO users(id, username, password_hash, name, email, phone, title, department_id, role, birthday, active, color)
        VALUES (?,?,?,?,?,?,?,?, 'member', ?, ?, ?)`, [u.id, username, hash, name.slice(0, 120), clean(row.email) || null, clean(row.phone) || null,
        title.slice(0, 120) || null, depId(clean(row.department)), birthday || null, resigned ? 0 : 1, AVATAR_COLORS[u.id % AVATAR_COLORS.length]]]);
      S.push(['INSERT OR IGNORE INTO app_access(app_key, user_id) SELECT key, ? FROM apps WHERE enabled = 1', [u.id]]);
      byUser.set(username, u);
      res.created++;
      res.new_accounts.push(username);
    } else if (name || title || row.email || row.phone || birthday || row.department) {
      if ((u.role === 'admin' || u.is_owner) && actor.role !== 'admin') err(SH, i, `@${u.username} là quản trị viên — chỉ cập nhật hồ sơ HRM, không đổi thông tin tài khoản`);
      else {
        S.push([`UPDATE users SET name = COALESCE(NULLIF(?, ''), name), email = COALESCE(NULLIF(?, ''), email), phone = COALESCE(NULLIF(?, ''), phone),
          title = COALESCE(NULLIF(?, ''), title), birthday = COALESCE(?, birthday), department_id = COALESCE(?, department_id) WHERE id = ?`,
        [name.slice(0, 120), clean(row.email), clean(row.phone), title.slice(0, 120), birthday || null, depId(clean(row.department)), u.id]]);
        changed = true;
      }
    }
    if (clean(row.employee_code)) byCode.set(clean(row.employee_code).toLowerCase(), u);
    // hồ sơ HRM
    const set = {};
    for (const k of HR_FIELDS) {
      let v = clean(row[k]);
      if (!v) continue;
      if (DATE_FIELDS.includes(k)) { const d = isoDate(v); if (!d) { err(SH, i, `ngày "${v}" không hợp lệ`); continue; } v = d; }
      if (k === 'work_status') v = WORK_STATUS.includes(v) ? v : STATUS_BY_TEXT[v.toLowerCase()] || null;
      if (v) set[k] = v.slice(0, 500);
    }
    if (Object.keys(set).length) {
      const keys = Object.keys(set);
      S.push([`INSERT INTO hr_profiles(user_id, ${keys.join(', ')}, updated_at) VALUES (?, ${keys.map(() => '?').join(', ')}, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET ${keys.map((k) => `${k} = excluded.${k}`).join(', ')}, updated_at = datetime('now')`, [u.id, ...keys.map((k) => set[k])]]);
      changed = true;
    }
    if (clean(row.manager_username)) managerLinks.push([i, u, clean(row.manager_username).replace(/^@/, '')]);
    // nghỉ việc: rời mọi vị trí đang giữ trong cơ cấu (các vị trí đó để trống chờ người mới)
    const resigned = set.work_status === 'resigned';
    if (resigned) S.push(...vacateStmts(u.id));
    // vị trí kinh doanh – địa bàn – ngành hàng (phân công chính)
    if (clean(row.sales_role)) {
      const role = SALES_ROLE_BY_TEXT[clean(row.sales_role).toLowerCase().replace(/\s+/g, ' ')];
      const tname = clean(row.territory).toLowerCase();
      const cands = territories.filter((t) => t.name.toLowerCase() === tname);
      const lv = { NSM: ['national'], RSM: ['region'], ASM: ['area'] }[role] || ['province', 'area'];
      const t = cands.sort((a, b) => lv.indexOf(a.level) - lv.indexOf(b.level)).find((x) => lv.includes(x.level)) || cands[0];
      if (!role) err(SH, i, `vị trí kinh doanh "${row.sales_role}" không hợp lệ (NSM, RSM, ASM, SS, PG, SREP, SREP KA)`);
      else if (!tname) {
        // chưa rõ địa bàn: chỉ ghi vị trí / ngành hàng lên hồ sơ, phân công trên sơ đồ sau
        try {
          S.push(['UPDATE users SET sales_role = ?, sales_industry = ? WHERE id = ?', [role, industryOf(industries, row.industry), u.id]]);
          res.no_territory = (res.no_territory || 0) + 1;
        } catch (e) { err(SH, i, e.message); }
      } else if (!t) err(SH, i, `không tìm thấy địa bàn "${row.territory || ''}" trong Cơ cấu kinh doanh`);
      else {
        try {
          const industry = industryOf(industries, row.industry);
          if (resigned) {
            // nhân sự đã nghỉ: chỉ lưu là vị trí ĐÃ TỪNG phụ trách (không chiếm chỗ, không tạo vị trí trống)
            assignStmt(t, u.id, role, { industry });   // kiểm tra vị trí khớp cấp địa bàn
            S.push([`INSERT INTO territory_history(territory_id, user_id, role, industry, since, ended_at, reason, closed)
              VALUES (?,?,?,?,?,?, 'resigned', 1)`, [t.id, u.id, role, industry, isoDate(row.hire_date) || null, set.resign_date || isoDate(row.resign_date) || vnDate()]]);
            S.push(['UPDATE users SET sales_role = ?, sales_industry = ? WHERE id = ?', [role, industry, u.id]]);
            res.past_posts = (res.past_posts || 0) + 1;
          } else {
            S.push(assignStmt(t, u.id, role, { industry, since: isoDate(row.hire_date) || null }), ...fillVacancyStmts(t, u.id, role, { industry }));
            salesTouched.add(u.id);
            res.assignments++;
          }
        } catch (e) { err(SH, i, e.message); }
      }
    }
    if (changed && !res.new_accounts.includes(u.username)) res.updated++;
  }
  for (const [i, u, m] of managerLinks) {
    const mgr = byUser.get(m.toLowerCase()) || byCode.get(m.toLowerCase());
    if (!mgr || mgr.id === u.id) { err('Nhân sự', i, `không tìm thấy quản lý "${m}"`); continue; }
    S.push(['UPDATE users SET manager_id = ? WHERE id = ?', [mgr.id, u.id]]);
  }
  for (const id of salesTouched) S.push(refreshSalesRoleStmt(id));

  // lịch sử công tác & hợp đồng: đọc sẵn bản ghi đã có của những người trong tệp để bỏ qua dòng trùng
  const known = JSON.stringify(users.map((x) => x.id));
  const [oldCareers, oldContracts] = await Promise.all([
    careerRows.length ? all("SELECT user_id, type, effective_date, IFNULL(to_value, '') AS v FROM hr_careers WHERE user_id IN (SELECT value FROM json_each(?))", known) : [],
    contractRows.length ? all('SELECT user_id, code, contract_type, start_date FROM hr_contracts WHERE user_id IN (SELECT value FROM json_each(?))', known) : [],
  ]);
  const careerKeys = new Set(oldCareers.map((x) => `${x.user_id}|${x.type}|${x.effective_date}|${x.v}`));
  const contractKeys = new Set(oldContracts.flatMap((x) => [x.code ? `${x.user_id}|#${x.code}` : null, `${x.user_id}|${x.contract_type}|${x.start_date}`].filter(Boolean)));
  const careerType = Object.fromEntries([...Object.entries(CAREER_TYPES).map(([k, v]) => [v.toLowerCase(), k]), ...Object.keys(CAREER_TYPES).map((k) => [k, k]),
    ['bổ nhiệm', 'promotion'], ['tăng lương', 'raise'], ['luân chuyển', 'transfer']]);
  for (const [i, row] of careerRows.entries()) {
    const SH = 'Lịch sử công tác';
    const u = find(row);
    if (!u) { err(SH, i, `không tìm thấy nhân sự ${row.username || row.employee_code || ''}`); continue; }
    const type = careerType[clean(row.type).toLowerCase()];
    const date = isoDate(row.effective_date);
    if (!type) { err(SH, i, `loại "${row.type || ''}" không hợp lệ (Thăng tiến, Điều chỉnh lương, Điều chuyển, Khen thưởng, Kỷ luật)`); continue; }
    if (!date) { err(SH, i, 'ngày hiệu lực không hợp lệ'); continue; }
    const to = clean(row.to_value).slice(0, 300) || null;
    const key = `${u.id}|${type}|${date}|${to || ''}`;
    if (careerKeys.has(key)) { res.skipped++; continue; }
    careerKeys.add(key);
    S.push(['INSERT INTO hr_careers(user_id, type, effective_date, from_value, to_value, decision_no, note, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [u.id, type, date, clean(row.from_value).slice(0, 300) || null, to, clean(row.decision_no).slice(0, 60) || null, clean(row.note).slice(0, 2000) || null, actor.id]]);
    res.careers++;
  }
  const contractStatus = { ...Object.fromEntries(Object.entries(CONTRACT_STATUS).map(([k, v]) => [v.toLowerCase(), k])), 'hết hạn': 'ended', 'chấm dứt': 'terminated', 'hiệu lực': 'active' };
  const touched = new Set();
  for (const [i, row] of contractRows.entries()) {
    const SH = 'Hợp đồng';
    const u = find(row);
    if (!u) { err(SH, i, `không tìm thấy nhân sự ${row.username || row.employee_code || ''}`); continue; }
    let k;
    try {
      const start = isoDate(row.start_date); const end = isoDate(row.end_date);
      if (start === false || end === false) throw badRequest('ngày không hợp lệ');
      k = parseContract({ ...row, start_date: start, end_date: end, status: contractStatus[clean(row.status).toLowerCase()] || clean(row.status) || 'active' });
    } catch (e) { err(SH, i, e.message); continue; }
    const key = k.code ? `${u.id}|#${k.code}` : `${u.id}|${k.contract_type}|${k.start_date}`;
    if (contractKeys.has(key)) { res.skipped++; continue; }
    contractKeys.add(key);
    S.push([`INSERT INTO hr_contracts(user_id, code, contract_type, start_date, end_date, salary, status, note, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
      [u.id, k.code, k.contract_type, k.start_date, k.end_date, k.salary, k.status, k.note, actor.id]]);
    touched.add(u.id);
    res.contracts++;
  }
  for (const id of touched) S.push(syncContractStmt(id));
  for (let i = 0; i < S.length; i += 100) await batch(S.slice(i, i + 100));
  await audit(actor.id, 'hrm.import', `Nhập hồ sơ nhân sự: ${res.created} tài khoản mới, ${res.updated} cập nhật, ${res.careers} lịch sử, ${res.contracts} hợp đồng`);
  return res;
}

r.get('/hrm/employees/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  if (!(await canSeeUser(c.get('user'), id))) throw forbidden();
  const e = await get(`${EMP_SELECT} WHERE u.id = ?`, id);
  if (!e) throw notFound('Nhân sự không tồn tại');
  return c.json(empView(e));
});

r.put('/hrm/employees/:id', async (c) => {
  await requireHr(c);
  const id = toInt(c.req.param('id'));
  const u = await get("SELECT u.id, u.username, IFNULL(h.work_status, 'working') AS work_status FROM users u LEFT JOIN hr_profiles h ON h.user_id = u.id WHERE u.id = ?", id);
  if (!u) throw notFound();
  const b = await jsonBody(c);
  if (b.work_status && !WORK_STATUS.includes(b.work_status)) throw badRequest('Trạng thái không hợp lệ');
  for (const k of DATE_FIELDS) {
    if (b[k] && !/^\d{4}-\d{2}-\d{2}$/.test(b[k])) throw badRequest('Ngày không hợp lệ');
  }
  const vals = HR_FIELDS.map((k) => (b[k] === undefined || b[k] === '' ? null : String(b[k]).slice(0, 500)));
  vals[HR_FIELDS.indexOf('work_status')] ||= 'working';
  await run(`INSERT INTO hr_profiles(user_id, ${HR_FIELDS.join(', ')}, updated_at) VALUES (?, ${HR_FIELDS.map(() => '?').join(', ')}, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET ${HR_FIELDS.map((k) => `${k} = excluded.${k}`).join(', ')}, updated_at = datetime('now')`, id, ...vals);
  // chuyển sang "Đã nghỉ việc": vị trí trong cơ cấu kinh doanh / trưởng phòng để trống cho đến khi có người mới
  const vacated = b.work_status === 'resigned' && u.work_status !== 'resigned' ? await vacateUser(id) : 0;
  await audit(c.get('user').id, 'hrm.update', `Cập nhật hồ sơ nhân sự @${u.username}${vacated ? ` (nghỉ việc, để trống ${vacated} vị trí)` : ''}`);
  return c.json({ ...empView(await get(`${EMP_SELECT} WHERE u.id = ?`, id)), vacated });
});

r.get('/hrm/stats', async (c) => {
  await requireHr(c);
  const active = "u.active = 1 AND u.role <> 'guest' AND IFNULL(h.work_status, 'working') <> 'resigned'";
  const base = 'FROM users u LEFT JOIN hr_profiles h ON h.user_id = u.id';
  return c.json({
    total: (await get(`SELECT COUNT(*) AS c ${base} WHERE ${active}`)).c,
    by_department: await all(`SELECT IFNULL(d.name, 'Chưa phân phòng') AS name, COUNT(*) AS c ${base} LEFT JOIN departments d ON d.id = u.department_id
      WHERE ${active} GROUP BY d.id ORDER BY c DESC`),
    by_status: await all(`SELECT IFNULL(h.work_status, 'working') AS status, COUNT(*) AS c ${base} WHERE u.active = 1 AND u.role <> 'guest' GROUP BY 1`),
    contracts_expiring: await all(`SELECT u.id, u.name, u.color, h.contract_type, h.contract_end ${base}
      WHERE ${active} AND h.contract_end BETWEEN date('now') AND date('now', '+30 day') ORDER BY h.contract_end`),
    probation_ending: await all(`SELECT u.id, u.name, u.color, h.probation_end ${base}
      WHERE ${active} AND h.probation_end BETWEEN date('now') AND date('now', '+30 day') ORDER BY h.probation_end`),
    birthdays: await all(`SELECT u.id, u.name, u.color, u.birthday ${base}
      WHERE ${active} AND u.birthday IS NOT NULL AND substr(u.birthday, 6, 2) = strftime('%m', 'now') ORDER BY substr(u.birthday, 9, 2)`),
    new_hires: await all(`SELECT u.id, u.name, u.color, h.hire_date ${base}
      WHERE ${active} AND h.hire_date >= date('now', 'start of month') ORDER BY h.hire_date DESC`),
  });
});

r.put('/hrm/settings', requireAdmin, async (c) => {
  const next = { managers: idList((await jsonBody(c)).managers) };
  await setSetting('hrm_settings', JSON.stringify(next));
  await audit(c.get('user').id, 'hrm.settings', `Cập nhật quản lý nhân sự (${next.managers.length} người)`);
  return c.json(next);
});

// ---------------------------------------------------------------- danh mục HRM (Cài đặt → Tổ chức / Nhân sự / Chính sách)
export const CATALOG_DEFAULTS = {
  offices: ['Văn phòng Hà Nội', 'Văn phòng TP. Hồ Chí Minh'],
  positions: ['Giám đốc', 'Trưởng phòng', 'Trưởng nhóm', 'Chuyên viên', 'Nhân viên', 'Thực tập sinh'],
  employee_types: ['Toàn thời gian', 'Bán thời gian', 'Cộng tác viên', 'Thực tập'],
  contract_types: ['Thử việc', 'Xác định thời hạn 12 tháng', 'Xác định thời hạn 24 tháng', 'Xác định thời hạn 36 tháng', 'Không xác định thời hạn', 'Cộng tác viên'],
  doc_types: ['CCCD / Hộ chiếu', 'Sơ yếu lý lịch', 'Bằng cấp / Chứng chỉ', 'Giấy khám sức khoẻ', 'Sổ hộ khẩu / Xác nhận cư trú', 'Quyết định', 'Khác'],
  resign_reasons: ['Nghỉ theo nguyện vọng cá nhân', 'Hết hạn hợp đồng', 'Chuyển công tác', 'Không đạt thử việc', 'Kỷ luật', 'Nghỉ hưu', 'Khác'],
  holidays: [],
};
const catalog = () => jsonSetting('hrm_catalog', CATALOG_DEFAULTS);
const cleanList = (v, max = 60) => [...new Set((Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => String(x).trim()).filter(Boolean))].slice(0, max);

r.get('/hrm/catalog', async (c) => c.json(await catalog()));
r.put('/hrm/catalog', async (c) => {
  await requireHr(c);
  const b = await jsonBody(c);
  const cur = await catalog();
  const next = { ...cur };
  for (const k of Object.keys(CATALOG_DEFAULTS)) {
    if (b[k] === undefined) continue;
    next[k] = k === 'holidays'
      ? (Array.isArray(b.holidays) ? b.holidays : []).filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h?.date || '') && String(h?.name || '').trim())
        .map((h) => ({ date: h.date, name: String(h.name).trim().slice(0, 100) })).sort((a, z) => a.date.localeCompare(z.date)).slice(0, 100)
      : cleanList(b[k]);
  }
  await setSetting('hrm_catalog', JSON.stringify(next));
  await audit(c.get('user').id, 'hrm.catalog', 'Cập nhật danh mục LDL HRM');
  return c.json(next);
});

// ---------------------------------------------------------------- hợp đồng lao động
export const CONTRACT_STATUS = { active: 'Đang hiệu lực', ended: 'Đã hết hạn', terminated: 'Đã chấm dứt' };
const CONTRACT_SELECT = `SELECT k.id, k.user_id, k.code, k.contract_type, k.start_date, k.end_date, k.salary, k.status, k.note, k.original_name, k.mime, k.size,
    k.created_at, u.name, u.color, u.title, d.name AS department_name, h.employee_code
  FROM hr_contracts k JOIN users u ON u.id = k.user_id LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN hr_profiles h ON h.user_id = u.id`;
const contractView = (k) => ({ ...k, status: k.status === 'active' && k.end_date && k.end_date < vnDate() ? 'ended' : k.status });

/** Hợp đồng đang hiệu lực mới nhất → "Loại hợp đồng / Hết hạn HĐ" trên hồ sơ nhân sự. */
const syncContractStmt = (userId) => [`INSERT INTO hr_profiles(user_id, contract_type, contract_end, updated_at)
    SELECT user_id, contract_type, end_date, datetime('now') FROM hr_contracts WHERE user_id = ? AND status = 'active' ORDER BY start_date DESC, id DESC LIMIT 1
    ON CONFLICT(user_id) DO UPDATE SET contract_type = excluded.contract_type, contract_end = excluded.contract_end, updated_at = datetime('now')`, [userId]];
async function syncProfileContract(userId) {
  const [sql, params] = syncContractStmt(userId);
  await run(sql, ...params);
}
/** Người xem hồ sơ nhạy cảm (lương, giấy tờ): chính nhân viên hoặc quản lý nhân sự. */
async function canSeePrivate(viewer, userId) {
  return viewer.id === userId || isHrManager(viewer);
}
function parseContract(b) {
  const type = String(b.contract_type || '').trim();
  if (!type) throw badRequest('Chọn loại hợp đồng');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.start_date || '')) throw badRequest('Ngày bắt đầu không hợp lệ');
  if (b.end_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.end_date)) throw badRequest('Ngày kết thúc không hợp lệ');
  if (b.end_date && b.end_date < b.start_date) throw badRequest('Ngày kết thúc phải sau ngày bắt đầu');
  const salary = b.salary === '' || b.salary == null ? null : Number(String(b.salary).replace(/[^\d]/g, ''));
  return {
    code: String(b.code || '').trim().slice(0, 60) || null, contract_type: type.slice(0, 120), start_date: b.start_date, end_date: b.end_date || null,
    salary: Number.isFinite(salary) ? salary : null, status: CONTRACT_STATUS[b.status] ? b.status : 'active', note: String(b.note || '').trim().slice(0, 2000) || null,
  };
}

r.get('/hrm/contracts', async (c) => {
  await requireHr(c);
  const q = c.req.query();
  const where = ['1=1'];
  const params = [];
  if (q.q) { const like = `%${q.q}%`; where.push("(u.name LIKE ? OR IFNULL(k.code,'') LIKE ? OR IFNULL(h.employee_code,'') LIKE ?)"); params.push(like, like, like); }
  if (q.type) { where.push('k.contract_type = ?'); params.push(q.type); }
  if (q.status === 'expiring') where.push("k.status = 'active' AND k.end_date BETWEEN date('now') AND date('now', '+30 day')");
  else if (q.status === 'active') where.push("k.status = 'active' AND (k.end_date IS NULL OR k.end_date >= date('now'))");
  else if (q.status === 'ended') where.push("(k.status = 'ended' OR (k.status = 'active' AND k.end_date < date('now')))");
  else if (q.status === 'terminated') where.push("k.status = 'terminated'");
  const rows = await all(`${CONTRACT_SELECT} WHERE ${where.join(' AND ')} ORDER BY k.start_date DESC, k.id DESC LIMIT 1000`, ...params);
  return c.json(rows.map(contractView));
});
r.get('/hrm/employees/:id/contracts', async (c) => {
  const id = toInt(c.req.param('id'));
  if (!(await canSeePrivate(c.get('user'), id))) throw forbidden();
  return c.json((await all(`${CONTRACT_SELECT} WHERE k.user_id = ? ORDER BY k.start_date DESC, k.id DESC`, id)).map(contractView));
});
r.post('/hrm/employees/:id/contracts', async (c) => {
  await requireHr(c);
  const id = toInt(c.req.param('id'));
  const u = await get('SELECT id, name FROM users WHERE id = ?', id);
  if (!u) throw notFound('Nhân sự không tồn tại');
  const { fields, files } = await formBody(c);
  const k = parseContract(fields);
  const [f] = await storeFiles(files.slice(0, 1));
  const { lastId } = await run(`INSERT INTO hr_contracts(user_id, code, contract_type, start_date, end_date, salary, status, note, filename, original_name, mime, size, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, k.code, k.contract_type, k.start_date, k.end_date, k.salary, k.status, k.note,
  f?.filename || null, f?.original_name || null, f?.mime || null, f?.size || null, c.get('user').id);
  if (fields.close_previous === '1' || fields.close_previous === true) {
    await run("UPDATE hr_contracts SET status = 'ended', updated_at = datetime('now') WHERE user_id = ? AND id <> ? AND status = 'active'", id, lastId);
  }
  await syncProfileContract(id);
  await audit(c.get('user').id, 'hrm.contract', `Thêm hợp đồng "${k.contract_type}" cho ${u.name}`);
  return c.json(contractView(await get(`${CONTRACT_SELECT} WHERE k.id = ?`, lastId)), 201);
});
async function contractOr404(c) {
  const k = await get('SELECT * FROM hr_contracts WHERE id = ?', toInt(c.req.param('cid')));
  if (!k) throw notFound('Hợp đồng không tồn tại');
  return k;
}
r.put('/hrm/contracts/:cid', async (c) => {
  await requireHr(c);
  const old = await contractOr404(c);
  const { fields, files } = await formBody(c);
  const k = parseContract(fields);
  const [f] = await storeFiles(files.slice(0, 1));
  await run(`UPDATE hr_contracts SET code = ?, contract_type = ?, start_date = ?, end_date = ?, salary = ?, status = ?, note = ?,
    filename = COALESCE(?, filename), original_name = COALESCE(?, original_name), mime = COALESCE(?, mime), size = COALESCE(?, size), updated_at = datetime('now') WHERE id = ?`,
  k.code, k.contract_type, k.start_date, k.end_date, k.salary, k.status, k.note, f?.filename || null, f?.original_name || null, f?.mime || null, f?.size || null, old.id);
  if (f && old.filename) await removeFile(old.filename);
  await syncProfileContract(old.user_id);
  return c.json(contractView(await get(`${CONTRACT_SELECT} WHERE k.id = ?`, old.id)));
});
r.delete('/hrm/contracts/:cid', async (c) => {
  await requireHr(c);
  const k = await contractOr404(c);
  await run('DELETE FROM hr_contracts WHERE id = ?', k.id);
  if (k.filename) await removeFile(k.filename);
  await syncProfileContract(k.user_id);
  return c.json({ ok: true });
});
async function contractFile(c) {
  const k = await contractOr404(c);
  if (!(await canSeePrivate(c.get('user'), k.user_id))) throw forbidden();
  if (!k.filename) throw notFound('Hợp đồng chưa có tệp đính kèm');
  return k;
}
r.get('/hrm/contracts/:cid/file', async (c) => sendFile(c, await contractFile(c), c.req.query('inline') === '1'));
r.post('/hrm/contracts/:cid/file/link', async (c) => c.json(await publicFileLink(c, 'hc', await contractFile(c))));

// ---------------------------------------------------------------- phát triển sự nghiệp
export const CAREER_TYPES = { promotion: 'Thăng tiến', raise: 'Điều chỉnh lương', transfer: 'Điều chuyển', reward: 'Khen thưởng', discipline: 'Kỷ luật' };
const CAREER_SELECT = `SELECT k.*, u.name, u.color, u.title, d.name AS department_name, cb.name AS created_by_name
  FROM hr_careers k JOIN users u ON u.id = k.user_id LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users cb ON cb.id = k.created_by`;

r.get('/hrm/careers', async (c) => {
  await requireHr(c);
  const q = c.req.query();
  const where = ['1=1'];
  const params = [];
  if (CAREER_TYPES[q.type]) { where.push('k.type = ?'); params.push(q.type); }
  if (q.q) { where.push('u.name LIKE ?'); params.push(`%${q.q}%`); }
  if (q.year) { where.push("substr(k.effective_date, 1, 4) = ?"); params.push(String(q.year)); }
  return c.json(await all(`${CAREER_SELECT} WHERE ${where.join(' AND ')} ORDER BY k.effective_date DESC, k.id DESC LIMIT 1000`, ...params));
});
r.get('/hrm/employees/:id/careers', async (c) => {
  const id = toInt(c.req.param('id'));
  if (!(await canSeeUser(c.get('user'), id))) throw forbidden();
  const rows = await all(`${CAREER_SELECT} WHERE k.user_id = ? ORDER BY k.effective_date DESC, k.id DESC`, id);
  // mức lương chỉ nhân viên & quản lý nhân sự xem
  if (!(await canSeePrivate(c.get('user'), id))) for (const x of rows) if (x.type === 'raise') { x.from_value = null; x.to_value = null; }
  return c.json(rows);
});
/**
 * Ghi nhận sự kiện sự nghiệp. apply=true áp dụng ngay vào tài khoản:
 * thăng tiến → đổi chức danh; điều chuyển → đổi phòng ban (to_department_id).
 */
r.post('/hrm/employees/:id/careers', async (c) => {
  await requireHr(c);
  const id = toInt(c.req.param('id'));
  const u = await get('SELECT u.id, u.name, u.title, u.department_id, d.name AS department_name FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?', id);
  if (!u) throw notFound('Nhân sự không tồn tại');
  const b = await jsonBody(c);
  if (!CAREER_TYPES[b.type]) throw badRequest('Loại sự kiện không hợp lệ');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.effective_date || '')) throw badRequest('Ngày hiệu lực không hợp lệ');
  let from = String(b.from_value ?? '').trim() || null;
  let to = String(b.to_value ?? '').trim() || null;
  const dep = b.type === 'transfer' && toInt(b.to_department_id) ? await get('SELECT id, name FROM departments WHERE id = ?', toInt(b.to_department_id)) : null;
  if (b.type === 'promotion') from ||= u.title || null;
  if (b.type === 'transfer') { from ||= u.department_name || null; if (dep) to = dep.name; }
  if (['promotion', 'raise', 'transfer'].includes(b.type) && !to) throw badRequest(b.type === 'raise' ? 'Nhập mức lương mới' : b.type === 'promotion' ? 'Nhập chức danh mới' : 'Chọn phòng ban mới');
  if (['reward', 'discipline'].includes(b.type) && !to && !String(b.note || '').trim()) throw badRequest('Nhập nội dung khen thưởng / kỷ luật');
  const { lastId } = await run(`INSERT INTO hr_careers(user_id, type, effective_date, from_value, to_value, decision_no, note, created_by) VALUES (?,?,?,?,?,?,?,?)`,
    id, b.type, b.effective_date, from?.slice(0, 300) || null, to?.slice(0, 300) || null, String(b.decision_no || '').trim().slice(0, 60) || null,
    String(b.note || '').trim().slice(0, 2000) || null, c.get('user').id);
  if (b.apply) {
    if (b.type === 'promotion') await run('UPDATE users SET title = ? WHERE id = ?', to.slice(0, 120), id);
    if (b.type === 'transfer' && dep) await run('UPDATE users SET department_id = ? WHERE id = ?', dep.id, id);
  }
  await audit(c.get('user').id, 'hrm.career', `${CAREER_TYPES[b.type]}: ${u.name}${to ? ` → ${b.type === 'raise' ? '***' : to}` : ''}`);
  return c.json(await get(`${CAREER_SELECT} WHERE k.id = ?`, lastId), 201);
});
r.delete('/hrm/careers/:kid', async (c) => {
  await requireHr(c);
  const { changes } = await run('DELETE FROM hr_careers WHERE id = ?', toInt(c.req.param('kid')));
  if (!changes) throw notFound();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- hồ sơ giấy tờ nhân viên
const DOC_SELECT = `SELECT g.id, g.user_id, g.doc_type, g.note, g.expires_on, g.original_name, g.mime, g.size, g.created_at, cb.name AS created_by_name
  FROM hr_documents g LEFT JOIN users cb ON cb.id = g.created_by`;
r.get('/hrm/employees/:id/documents', async (c) => {
  const id = toInt(c.req.param('id'));
  if (!(await canSeePrivate(c.get('user'), id))) throw forbidden();
  return c.json(await all(`${DOC_SELECT} WHERE g.user_id = ? ORDER BY g.doc_type, g.id DESC`, id));
});
/** Quản lý nhân sự tải giấy tờ cho mọi người; nhân viên tự bổ sung giấy tờ của chính mình. */
r.post('/hrm/employees/:id/documents', async (c) => {
  const id = toInt(c.req.param('id'));
  const user = c.get('user');
  if (!(await canSeePrivate(user, id))) throw forbidden();
  const { fields, files } = await formBody(c);
  if (!files.length) throw badRequest('Chọn tệp giấy tờ');
  const type = String(fields.doc_type || '').trim() || 'Khác';
  if (fields.expires_on && !/^\d{4}-\d{2}-\d{2}$/.test(fields.expires_on)) throw badRequest('Ngày hết hạn không hợp lệ');
  const stored = await storeFiles(files);
  for (const f of stored) {
    await run(`INSERT INTO hr_documents(user_id, doc_type, note, expires_on, filename, original_name, mime, size, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
      id, type.slice(0, 120), String(fields.note || '').trim().slice(0, 500) || null, fields.expires_on || null, f.filename, f.original_name, f.mime, f.size, user.id);
  }
  await audit(user.id, 'hrm.document', `Tải ${stored.length} giấy tờ "${type}" (nhân sự #${id})`);
  return c.json(await all(`${DOC_SELECT} WHERE g.user_id = ? ORDER BY g.doc_type, g.id DESC`, id), 201);
});
async function docOr404(c) {
  const g = await get('SELECT * FROM hr_documents WHERE id = ?', toInt(c.req.param('did')));
  if (!g || !(await canSeePrivate(c.get('user'), g.user_id))) throw notFound('Giấy tờ không tồn tại');
  return g;
}
r.delete('/hrm/documents/:did', async (c) => {
  const g = await docOr404(c);
  const user = c.get('user');
  if (!(await isHrManager(user)) && g.created_by !== user.id) throw forbidden('Chỉ quản lý nhân sự hoặc người tải lên được xoá');
  await run('DELETE FROM hr_documents WHERE id = ?', g.id);
  await removeFile(g.filename);
  return c.json({ ok: true });
});
r.get('/hrm/documents/:did', async (c) => sendFile(c, await docOr404(c), c.req.query('inline') === '1'));
r.post('/hrm/documents/:did/link', async (c) => c.json(await publicFileLink(c, 'hd', await docOr404(c))));

// ---------------------------------------------------------------- báo cáo nhân sự
r.get('/hrm/report', async (c) => {
  await requireHr(c);
  const active = "u.active = 1 AND u.role <> 'guest' AND IFNULL(h.work_status, 'working') <> 'resigned'";
  const base = 'FROM users u LEFT JOIN hr_profiles h ON h.user_id = u.id';
  const group = (col, label) => all(`SELECT IFNULL(NULLIF(${col}, ''), '${label}') AS name, COUNT(*) AS c ${base} WHERE ${active} GROUP BY 1 ORDER BY c DESC`);
  const today = vnDate();
  const year = today.slice(0, 4);
  const [byType, byOffice, byGender, byContract, byPosition, people, hires, resigns, careers, bySales, byRegion, byIndustry] = await Promise.all([
    group('h.employee_type', 'Chưa phân loại'), group('h.office', 'Chưa có văn phòng'), group('h.gender', 'Chưa rõ'),
    group('h.contract_type', 'Chưa có hợp đồng'), group('h.job_position', 'Chưa có vị trí'),
    all(`SELECT u.birthday, h.hire_date ${base} WHERE ${active}`),
    all(`SELECT substr(h.hire_date, 1, 7) AS month, COUNT(*) AS c ${base} WHERE u.role <> 'guest' AND h.hire_date >= date('now', 'start of month', '-11 month') GROUP BY 1`),
    all(`SELECT substr(h.resign_date, 1, 7) AS month, COUNT(*) AS c ${base} WHERE u.role <> 'guest' AND h.resign_date >= date('now', 'start of month', '-11 month') GROUP BY 1`),
    all("SELECT type, COUNT(*) AS c FROM hr_careers WHERE substr(effective_date, 1, 4) = ? GROUP BY type", year),
    all(`SELECT u.sales_role AS role, COUNT(*) AS c ${base} WHERE ${active} AND u.sales_role IS NOT NULL GROUP BY 1`),
    // nhân sự kinh doanh theo miền (tính cả người phụ trách khu vực, tỉnh thuộc miền; mỗi người một lần)
    all(`WITH RECURSIVE tree(id, region_id) AS (SELECT id, id FROM territories WHERE level = 'region'
        UNION ALL SELECT x.id, tree.region_id FROM territories x JOIN tree ON x.parent_id = tree.id)
      SELECT r.name, COUNT(DISTINCT tm.user_id) AS c FROM territories r JOIN tree ON tree.region_id = r.id
        JOIN territory_members tm ON tm.territory_id = tree.id JOIN users u ON u.id = tm.user_id LEFT JOIN hr_profiles h ON h.user_id = u.id
      WHERE ${active} GROUP BY r.id ORDER BY r.sort`),
    all(`SELECT tm.industry, COUNT(DISTINCT tm.user_id) AS c FROM territory_members tm JOIN users u ON u.id = tm.user_id
      LEFT JOIN hr_profiles h ON h.user_id = u.id WHERE ${active} GROUP BY 1`),
  ]);
  const industries = (await salesSettings()).industries;
  const years = (from) => (from ? (Date.parse(today) - Date.parse(from)) / (365.25 * 864e5) : null);
  const bucket = (list, edges) => {
    const out = edges.map(([label, lo, hi]) => ({ name: label, c: list.filter((y) => y != null && y >= lo && y < hi).length }));
    const unknown = list.filter((y) => y == null || y < 0).length;
    return unknown ? [...out, { name: 'Chưa cập nhật', c: unknown }] : out;
  };
  const seniority = people.map((p) => years(p.hire_date));
  const ages = people.map((p) => years(p.birthday));
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - i);
    const m = d.toISOString().slice(0, 7);
    months.push({ month: m, hires: hires.find((x) => x.month === m)?.c || 0, resigns: resigns.find((x) => x.month === m)?.c || 0 });
  }
  const total = people.length;
  const resigned12 = months.reduce((s, m) => s + m.resigns, 0);
  return c.json({
    total, year,
    by_sales: SALES_ORDER.map((k) => ({ name: k.replace('_', ' '), c: bySales.find((x) => x.role === k)?.c || 0 })).filter((x) => x.c),
    by_region: byRegion,
    by_industry: [...industries.map((x) => ({ name: x.name, c: byIndustry.find((y) => y.industry === x.code)?.c || 0 })),
      { name: 'Phụ trách chung', c: byIndustry.find((y) => !y.industry)?.c || 0 }].filter((x) => x.c),
    by_type: byType, by_office: byOffice, by_gender: byGender, by_contract: byContract, by_position: byPosition,
    seniority: bucket(seniority, [['Dưới 1 năm', 0, 1], ['1 – 3 năm', 1, 3], ['3 – 5 năm', 3, 5], ['5 – 10 năm', 5, 10], ['Trên 10 năm', 10, 99]]),
    ages: bucket(ages, [['Dưới 25', 0, 25], ['25 – 34', 25, 35], ['35 – 44', 35, 45], ['45 – 54', 45, 55], ['Từ 55', 55, 120]]),
    avg_seniority: seniority.filter((x) => x != null).length ? Math.round((seniority.filter((x) => x != null).reduce((a, z) => a + z, 0) / seniority.filter((x) => x != null).length) * 10) / 10 : null,
    turnover: months,
    turnover_rate: total ? Math.round((resigned12 / (total + resigned12)) * 1000) / 10 : 0,
    careers: Object.entries(CAREER_TYPES).map(([k, name]) => ({ type: k, name, c: careers.find((x) => x.type === k)?.c || 0 })),
  });
});

// ================================================================ Timeoff
function leaveDays(from, to, countSaturday) {
  if (!from || !to || to < from) return 0;
  let n = 0;
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`) && n < 400; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow === 0 || (dow === 6 && !countSaturday)) continue;
    n++;
  }
  return n;
}

/** Leave requests (LDL Request, group configured in Timeoff settings) as flat records. */
async function leaveRecords(st, { userId = null, statuses = ['approved', 'pending'], from = null, to = null } = {}) {
  if (!st.group_id) return [];
  const where = ['q.group_id = ?', `q.status IN (${statuses.map(() => '?').join(',')})`];
  const params = [st.group_id, ...statuses];
  if (userId) { where.push('q.creator_id = ?'); params.push(userId); }
  const rows = await all(`SELECT q.id, q.title, q.status, q.data, q.creator_id, q.created_at, u.name, u.color, d.name AS department_name
    FROM requests q JOIN users u ON u.id = q.creator_id LEFT JOIN departments d ON d.id = u.department_id WHERE ${where.join(' AND ')}
    ORDER BY q.created_at DESC`, ...params);
  return rows.map((q) => {
    let data = {};
    try { data = JSON.parse(q.data || '{}'); } catch { data = {}; }
    const f = data.from || null;
    const t = data.to || data.from || null;
    return { id: q.id, title: q.title, status: q.status, user_id: q.creator_id, name: q.name, color: q.color, department_name: q.department_name,
      from: f, to: t, kind: data.kind || 'Nghỉ phép năm', reason: data.reason || '', days: leaveDays(f, t, st.count_saturday), created_at: q.created_at };
  }).filter((x) => x.from && (!from || x.to >= from) && (!to || x.from <= to));
}

async function quotaFor(userId, year, st) {
  const row = await get('SELECT days FROM leave_quotas WHERE user_id = ? AND year = ?', userId, year);
  return row ? row.days : st.annual_days;
}

r.get('/timeoff/summary', async (c) => {
  const user = c.get('user');
  const st = await timeoffSettings();
  const year = toInt(c.req.query('year')) || Number(vnDate().slice(0, 4));
  const uid = toInt(c.req.query('user_id')) || user.id;
  if (!(await canSeeUser(user, uid))) throw forbidden();
  const records = (await leaveRecords(st, { userId: uid, statuses: ['approved', 'pending', 'rejected', 'returned', 'cancelled'] }))
    .filter((x) => x.from.startsWith(String(year)));
  const annual = records.filter((x) => x.kind === 'Nghỉ phép năm');
  const used = annual.filter((x) => x.status === 'approved').reduce((s, x) => s + x.days, 0);
  const pending = annual.filter((x) => x.status === 'pending').reduce((s, x) => s + x.days, 0);
  const quota = await quotaFor(uid, year, st);
  return c.json({ year, quota, used, pending, remaining: quota - used, records, group_id: st.group_id, count_saturday: st.count_saturday });
});

r.get('/timeoff/calendar', async (c) => {
  const st = await timeoffSettings();
  const month = /^\d{4}-\d{2}$/.test(c.req.query('month') || '') ? c.req.query('month') : vnDate().slice(0, 7);
  const recs = await leaveRecords(st, { from: `${month}-01`, to: `${month}-31` });
  return c.json({ month, items: recs.map(({ reason, ...x }) => x) });
});

r.get('/timeoff/balances', async (c) => {
  await requireHr(c);
  const st = await timeoffSettings();
  const year = toInt(c.req.query('year')) || Number(vnDate().slice(0, 4));
  const users = await all(`SELECT u.id, u.name, u.color, d.name AS department_name, lq.days AS quota FROM users u
    LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN leave_quotas lq ON lq.user_id = u.id AND lq.year = ?
    WHERE u.active = 1 AND u.role <> 'guest' ORDER BY u.name COLLATE NOCASE`, year);
  const recs = (await leaveRecords(st, { statuses: ['approved'] })).filter((x) => x.from.startsWith(String(year)) && x.kind === 'Nghỉ phép năm');
  const used = {};
  for (const x of recs) used[x.user_id] = (used[x.user_id] || 0) + x.days;
  return c.json({ year, annual_days: st.annual_days, items: users.map((u) => {
    const quota = u.quota ?? st.annual_days;
    return { ...u, quota, used: used[u.id] || 0, remaining: quota - (used[u.id] || 0) };
  }) });
});

r.put('/timeoff/quota', async (c) => {
  await requireHr(c);
  const b = await jsonBody(c);
  const uid = toInt(b.user_id);
  const year = toInt(b.year);
  const days = Number(b.days);
  if (!uid || !year || !(days >= 0 && days <= 365)) throw badRequest('Dữ liệu không hợp lệ');
  await run('INSERT INTO leave_quotas(user_id, year, days) VALUES (?,?,?) ON CONFLICT DO UPDATE SET days = excluded.days', uid, year, days);
  return c.json({ ok: true });
});

r.get('/timeoff/settings', async (c) => c.json(await timeoffSettings()));
r.put('/timeoff/settings', requireAdmin, async (c) => {
  const b = await jsonBody(c);
  const gid = toInt(b.group_id);
  if (gid && !(await get('SELECT 1 FROM request_groups WHERE id = ?', gid))) throw badRequest('Nhóm đề xuất không tồn tại');
  const days = Number(b.annual_days);
  const next = { group_id: gid, annual_days: days >= 0 && days <= 365 ? days : 12, count_saturday: !!b.count_saturday };
  await setSetting('timeoff_settings', JSON.stringify(next));
  await audit(c.get('user').id, 'timeoff.settings', 'Cập nhật cài đặt LDL Timeoff');
  return c.json(next);
});

// ================================================================ Checkin
function evaluate(rec, st) {
  const inMin = rec.check_in_at ? vnMinutes(rec.check_in_at) : null;
  const outMin = rec.check_out_at ? vnMinutes(rec.check_out_at) : null;
  return {
    ...rec,
    in_time: inMin === null ? null : `${String(Math.floor(inMin / 60)).padStart(2, '0')}:${String(inMin % 60).padStart(2, '0')}`,
    out_time: outMin === null ? null : `${String(Math.floor(outMin / 60)).padStart(2, '0')}:${String(outMin % 60).padStart(2, '0')}`,
    late_minutes: inMin !== null ? Math.max(0, inMin - hm(st.start) - st.grace) : 0,
    early_minutes: outMin !== null ? Math.max(0, hm(st.end) - outMin) : 0,
    hours: inMin !== null && outMin !== null ? Math.round(((outMin - inMin) / 60) * 100) / 100 : null,
  };
}

async function checkIpForCheckin(c, st) {
  if (!st.ip_only || !st.ip_rules.length) return;
  const ip = clientIp(c);
  if (!st.ip_rules.some((x) => ipMatches(ip, x))) throw forbidden(`Chỉ chấm công được từ mạng công ty (IP hiện tại: ${ip || 'không xác định'})`);
}

r.get('/checkin/today', async (c) => {
  const user = c.get('user');
  const st = await checkinSettings();
  const date = vnDate();
  const rec = await get('SELECT * FROM checkins WHERE user_id = ? AND date = ?', user.id, date);
  return c.json({ date, now: utcStamp(), settings: { start: st.start, end: st.end, grace: st.grace, ip_only: st.ip_only },
    record: rec ? evaluate(rec, st) : null, ip: clientIp(c) });
});

r.post('/checkin/in', async (c) => {
  const user = c.get('user');
  const st = await checkinSettings();
  await checkIpForCheckin(c, st);
  const date = vnDate();
  const note = String((await jsonBody(c)).note || '').slice(0, 300) || null;
  const existing = await get('SELECT * FROM checkins WHERE user_id = ? AND date = ?', user.id, date);
  if (existing?.check_in_at) throw badRequest('Hôm nay bạn đã chấm công vào');
  await run(`INSERT INTO checkins(user_id, date, check_in_at, ip, note) VALUES (?,?,?,?,?)
    ON CONFLICT(user_id, date) DO UPDATE SET check_in_at = excluded.check_in_at, ip = excluded.ip`, user.id, date, utcStamp(), clientIp(c), note);
  return c.json(evaluate(await get('SELECT * FROM checkins WHERE user_id = ? AND date = ?', user.id, date), st));
});

r.post('/checkin/out', async (c) => {
  const user = c.get('user');
  const st = await checkinSettings();
  await checkIpForCheckin(c, st);
  const date = vnDate();
  const rec = await get('SELECT * FROM checkins WHERE user_id = ? AND date = ?', user.id, date);
  if (!rec?.check_in_at) throw badRequest('Bạn chưa chấm công vào hôm nay');
  await run('UPDATE checkins SET check_out_at = ? WHERE id = ?', utcStamp(), rec.id);
  return c.json(evaluate(await get('SELECT * FROM checkins WHERE id = ?', rec.id), st));
});

async function monthData(uid, month, st) {
  const tst = await timeoffSettings();
  const recs = await all('SELECT * FROM checkins WHERE user_id = ? AND date LIKE ? ORDER BY date', uid, `${month}-%`);
  const leaves = (await leaveRecords(tst, { userId: uid, statuses: ['approved'], from: `${month}-01`, to: `${month}-31` }));
  const map = Object.fromEntries(recs.map((x) => [x.date, evaluate(x, st)]));
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = vnDate();
  const days = [];
  let late = 0; let worked = 0; let hours = 0; let absent = 0; let leaveCount = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const workday = dow !== 0 && (dow !== 6 || st.work_saturday);
    const rec = map[date] || null;
    const leave = leaves.find((l) => l.from <= date && l.to >= date) || null;
    let status = 'off';
    if (rec?.check_in_at) { status = rec.late_minutes > 0 ? 'late' : 'ok'; worked++; hours += rec.hours || 0; if (rec.late_minutes > 0) late++; }
    else if (leave && workday) { status = 'leave'; leaveCount++; }
    else if (workday && date < today) { status = 'absent'; absent++; }
    else if (workday) status = 'upcoming';
    days.push({ date, dow, workday, status, record: rec, leave: leave ? { kind: leave.kind, id: leave.id } : null });
  }
  return { month, days, summary: { worked, late, absent, leave: leaveCount, hours: Math.round(hours * 100) / 100 } };
}

r.get('/checkin/month', async (c) => {
  const user = c.get('user');
  const uid = toInt(c.req.query('user_id')) || user.id;
  if (!(await canSeeUser(user, uid))) throw forbidden();
  const month = /^\d{4}-\d{2}$/.test(c.req.query('month') || '') ? c.req.query('month') : vnDate().slice(0, 7);
  return c.json(await monthData(uid, month, await checkinSettings()));
});

r.get('/checkin/team', async (c) => {
  const user = c.get('user');
  const st = await checkinSettings();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query('date') || '') ? c.req.query('date') : vnDate();
  const hr = await isHrManager(user);
  const users = await all(`SELECT u.id, u.name, u.color, u.title, d.name AS department_name FROM users u LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.active = 1 AND u.role <> 'guest' ${hr ? '' : `AND ${underSql('u.id')}`} ORDER BY u.name COLLATE NOCASE`, ...(hr ? [] : [user.id]));
  const recs = await all('SELECT * FROM checkins WHERE date = ?', date);
  const leaves = await leaveRecords(await timeoffSettings(), { statuses: ['approved'], from: date, to: date });
  const byUser = Object.fromEntries(recs.map((x) => [x.user_id, evaluate(x, st)]));
  return c.json({ date, is_hr: hr, items: users.map((u) => ({ ...u, record: byUser[u.id] || null, leave: leaves.find((l) => l.user_id === u.id)?.kind || null })) });
});

r.get('/checkin/export', async (c) => {
  await requireHr(c);
  const st = await checkinSettings();
  const month = /^\d{4}-\d{2}$/.test(c.req.query('month') || '') ? c.req.query('month') : vnDate().slice(0, 7);
  const users = await all("SELECT u.id, u.name, u.username, d.name AS department_name FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.active = 1 AND u.role <> 'guest' ORDER BY u.name");
  const esc = (v) => `"${String(v ?? '').replace(/^[=+\-@]/, "'$&").replace(/"/g, '""')}"`;
  const lines = [['Nhân viên', 'Tài khoản', 'Phòng ban', 'Ngày công', 'Đi muộn', 'Vắng', 'Nghỉ phép', 'Tổng giờ'].map(esc).join(',')];
  for (const u of users) {
    const { summary: s } = await monthData(u.id, month, st);
    lines.push([u.name, u.username, u.department_name, s.worked, s.late, s.absent, s.leave, s.hours].map(esc).join(','));
  }
  return new Response(`﻿${lines.join('\r\n')}`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="cham-cong-${month}.csv"` } });
});

r.get('/checkin/settings', async (c) => c.json(await checkinSettings()));
r.put('/checkin/settings', requireAdmin, async (c) => {
  const b = await jsonBody(c);
  const time = (v, d) => (/^\d{2}:\d{2}$/.test(v || '') ? v : d);
  const rules = (Array.isArray(b.ip_rules) ? b.ip_rules : String(b.ip_rules || '').split(/[\n,]/)).map((x) => x.trim()).filter(Boolean);
  const bad = rules.filter((x) => !validIpRule(x));
  if (bad.length) throw badRequest(`Dải IP không hợp lệ: ${bad.join(', ')}`);
  const next = { start: time(b.start, '08:30'), end: time(b.end, '17:30'), grace: Math.min(120, Math.max(0, toInt(b.grace, 10))),
    ip_only: !!b.ip_only && rules.length > 0, ip_rules: rules, work_saturday: b.work_saturday !== false };
  await setSetting('checkin_settings', JSON.stringify(next));
  await audit(c.get('user').id, 'checkin.settings', 'Cập nhật cài đặt LDL Checkin');
  return c.json(next);
});

export default r;
