/**
 * Tự động hoá khi đề xuất được duyệt xong (cấu hình trên nhóm đề xuất, cột request_groups.automation).
 *   hire — "Đề xuất tuyển dụng": tạo tài khoản LDL, hồ sơ HRM (thử việc), mở thủ tục nhận việc và báo phòng Nhân sự.
 * Lỗi tự động hoá không chặn việc duyệt: kết quả (kể cả lỗi) lưu ở requests.automation_result để chạy lại.
 */
import { all, get, run, notify, getSetting } from './db.js';
import { hashPassword } from './auth.js';
import { grantApps, audit } from './platform.js';
import { procedureSteps } from './routes/asset.js';

export const AUTOMATION_TYPES = { hire: 'Tạo nhân sự mới (tài khoản + hồ sơ HRM)' };
/** Thông tin nhân sự có thể lấy từ trường của đề xuất. */
export const HIRE_TARGETS = {
  name: 'Họ tên', email: 'Email', phone: 'Điện thoại', birthday: 'Ngày sinh', gender: 'Giới tính', title: 'Chức danh',
  department: 'Phòng ban', manager: 'Quản lý trực tiếp', job_position: 'Vị trí công việc', office: 'Văn phòng',
  employee_type: 'Phân loại nhân sự', hire_date: 'Ngày nhận việc', probation_end: 'Ngày hết thử việc', note: 'Ghi chú',
};

const parseJson = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const vnToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

async function hrManagerIds() {
  const ids = parseJson((await getSetting('hrm_settings')) || '{}', {}).managers || [];
  if (ids.length) return ids;
  return (await all("SELECT id FROM users WHERE role = 'admin' AND active = 1")).map((u) => u.id);
}
export async function isHrManager(user) {
  if (user.role === 'admin') return true;
  return (parseJson((await getSetting('hrm_settings')) || '{}', {}).managers || []).includes(user.id);
}

/** Cấu hình tự động hoá đã chuẩn hoá (null = không có). */
export function parseAutomation(raw) {
  const a = typeof raw === 'string' ? parseJson(raw, null) : raw;
  if (!a || !AUTOMATION_TYPES[a.type]) return null;
  const map = {};
  for (const k of Object.keys(HIRE_TARGETS)) if (a.map?.[k]) map[k] = String(a.map[k]).slice(0, 40);
  return { type: a.type, map, onboarding: a.onboarding !== false, password_hash: a.password_hash || null };
}

/** Tên đăng nhập từ họ tên: tên + họ không dấu ("Nguyễn Văn An" → annguyen), thêm số nếu trùng. */
async function uniqueUsername(name) {
  const parts = fold(name).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const base = ((parts.length > 1 ? parts[parts.length - 1] + parts[0] : parts[0]) || 'nhanvien').slice(0, 40);
  const taken = new Set((await all("SELECT lower(username) AS u FROM users WHERE lower(username) = ? OR lower(username) LIKE ?", base, `${base}%`)).map((x) => x.u));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
}

function tempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(buf, (b) => chars[b % chars.length]).join('');
}

/** Tạo nhân sự mới từ đề xuất tuyển dụng đã duyệt. Trả về kết quả để lưu vào automation_result. */
async function runHire(cfg, q, actorId) {
  const fields = q.fields;
  const data = parseJson(q.data, {});
  const val = (k) => {
    const key = cfg.map[k];
    if (!key || !fields.some((f) => f.key === key)) return '';
    const v = data[key];
    return v === undefined || v === null ? '' : String(v).trim();
  };
  const name = val('name');
  if (!name) throw new Error('Đề xuất chưa có họ tên ứng viên (kiểm tra trường "Họ tên" trong cấu hình tự động hoá)');
  const warnings = [];
  const email = val('email').toLowerCase();
  if (email) {
    const dup = await get('SELECT username FROM users WHERE lower(email) = ?', email);
    if (dup) throw new Error(`Email ${email} đã thuộc tài khoản @${dup.username} — kiểm tra lại, có thể nhân sự đã được tạo`);
  }
  // phòng ban: theo tên (không phân biệt hoa thường); chưa có thì tạo mới
  let departmentId = null;
  const depName = val('department');
  if (depName) {
    const dep = await get('SELECT id FROM departments WHERE lower(name) = lower(?)', depName);
    departmentId = dep?.id ?? (await run('INSERT INTO departments(name) VALUES (?)', depName.slice(0, 120))).lastId;
    if (!dep) warnings.push(`Đã tạo phòng ban mới "${depName}"`);
  }
  // quản lý trực tiếp: trường người dùng của đề xuất, mặc định là người đề xuất
  const mgrId = Number(val('manager')) || null;
  const manager = mgrId ? await get('SELECT id FROM users WHERE id = ? AND active = 1', mgrId) : null;
  const managerId = manager?.id ?? q.creator_id;
  // chức danh mang quyền quản trị (thiết lập WeWork) chỉ quản trị viên được gán → để trống cho phòng Nhân sự đặt
  let title = val('title');
  const adminTitles = parseJson((await getSetting('wework_settings')) || '{}', {}).admin_titles || ['Quản trị'];
  const nt = (x) => fold(x).trim().replace(/\s+/g, ' ');
  if (title && adminTitles.some((x) => nt(x) && (nt(title) === nt(x) || nt(title).startsWith(`${nt(x)} `)))) {
    warnings.push(`Chức danh "${title}" có quyền quản trị — để trống, quản trị viên gán sau`);
    title = '';
  }
  const dateOf = (k) => {
    const v = val(k);
    if (v && !isDate(v)) warnings.push(`${HIRE_TARGETS[k]} "${v}" không hợp lệ — bỏ qua`);
    return isDate(v) ? v : null;
  };
  const birthday = dateOf('birthday');
  const hireDate = dateOf('hire_date') || vnToday();
  const probationEnd = dateOf('probation_end');

  const username = await uniqueUsername(name);
  const temp = cfg.password_hash ? null : tempPassword();
  const hash = cfg.password_hash || (await hashPassword(temp));
  const { lastId: userId } = await run(`INSERT INTO users(username, password_hash, name, email, phone, title, department_id, manager_id, role, birthday)
    VALUES (?,?,?,?,?,?,?,?, 'member', ?)`, username, hash, name.slice(0, 120), email || null, val('phone') || null, title || null,
  departmentId, managerId, birthday);
  await grantApps(userId);
  const note = [`Tạo tự động từ đề xuất #${q.id} "${q.title}"`, val('note')].filter(Boolean).join('\n').slice(0, 2000);
  await run(`INSERT INTO hr_profiles(user_id, gender, hire_date, probation_end, work_status, office, job_position, employee_type, note)
    VALUES (?,?,?,?, 'probation', ?,?,?,?)`, userId, val('gender') || null, hireDate, probationEnd, val('office') || null,
  val('job_position') || null, val('employee_type') || null, note);
  let procedureId = null;
  if (cfg.onboarding) {
    ({ lastId: procedureId } = await run(`INSERT INTO hr_procedures(kind, user_id, effective_date, steps, note, created_by) VALUES ('onboard',?,?,?,?,?)`,
      userId, hireDate, JSON.stringify(await procedureSteps('onboard')), `Mở tự động từ đề xuất tuyển dụng #${q.id}`, actorId));
  }
  return { status: 'done', user_id: userId, username, name, procedure_id: procedureId, temp_password: temp, warnings };
}

/**
 * Chạy tự động hoá của nhóm cho đề xuất đã duyệt. Không bao giờ ném lỗi — lỗi được lưu lại và báo phòng Nhân sự.
 * Chạy lại được khi lần trước lỗi; đã tạo xong thì không tạo lần nữa.
 */
export async function runRequestAutomation(requestId, actorId) {
  const q = await get(`SELECT q.id, q.title, q.data, q.status, q.creator_id, q.automation_result, g.fields, g.automation
    FROM requests q JOIN request_groups g ON g.id = q.group_id WHERE q.id = ?`, requestId);
  const cfg = q && parseAutomation(q.automation);
  if (!cfg || q.status !== 'approved') return null;
  const prev = parseJson(q.automation_result, null);
  if (prev?.status === 'done') return prev;
  q.fields = parseJson(q.fields, []);
  let result;
  try {
    result = await runHire(cfg, q, actorId);
  } catch (e) {
    result = { status: 'error', error: String(e?.message || e).slice(0, 500) };
  }
  result = { type: cfg.type, ...result, at: new Date().toISOString(), by: actorId };
  await run('UPDATE requests SET automation_result = ? WHERE id = ?', JSON.stringify(result), q.id);
  const hr = await hrManagerIds();
  if (result.status === 'done') {
    await audit(actorId, 'user.create', `Tự động tạo tài khoản @${result.username} từ đề xuất tuyển dụng #${q.id}`);
    await notify(hr, { actorId, app: 'hrm', type: 'hire',
      title: `Nhân sự mới ${result.name} (@${result.username}) đã được tạo từ đề xuất "${q.title}" — vui lòng cập nhật hồ sơ`,
      link: `/hrm/employees/${result.user_id}` });
    await notify(q.creator_id, { actorId, app: 'request', type: 'hire',
      title: `Đã tạo tài khoản @${result.username} cho ${result.name} theo đề xuất "${q.title}"`, link: `/request/${q.id}` });
  } else {
    await notify([...new Set([...hr, q.creator_id])], { actorId, app: 'request', type: 'automation_error',
      title: `Không tự tạo được nhân sự từ đề xuất "${q.title}": ${result.error}`, link: `/request/${q.id}` });
  }
  return result;
}

/** Kết quả hiển thị cho người xem: mật khẩu tạm chỉ quản trị viên / quản lý nhân sự thấy. */
export async function viewAutomation(rawResult, rawConfig, user) {
  const cfg = parseAutomation(rawConfig);
  const res = parseJson(rawResult, null);
  if (!cfg && !res) return null;
  const hr = await isHrManager(user);
  if (res && !hr) delete res.temp_password;
  if (res?.user_id) {
    const u = await get('SELECT id, name, username, active FROM users WHERE id = ?', res.user_id);
    res.user_exists = !!u;
  }
  return { type: cfg?.type || res?.type, label: AUTOMATION_TYPES[cfg?.type || res?.type], result: res, can_run: hr };
}
