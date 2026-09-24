/** HRM+ modules: Base HRM (hồ sơ nhân sự), Base Checkin (chấm công), Base Timeoff (nghỉ phép). */
import { Hono } from 'hono';
import { all, get, run, getSetting, setSetting } from '../db.js';
import { requireAdmin } from '../auth.js';
import { badRequest, notFound, forbidden, toInt, idList, jsonBody } from '../util.js';
import { audit } from '../platform.js';
import { clientIp, ipMatches, validIpRule } from '../security.js';

const r = new Hono();

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
  return !!(await get('SELECT 1 FROM users WHERE id = ? AND manager_id = ?', userId, viewer.id));
}

// ================================================================ HRM
const HR_FIELDS = ['employee_code', 'gender', 'id_number', 'id_issue_date', 'id_issue_place', 'hire_date', 'probation_end', 'contract_type',
  'contract_end', 'work_status', 'insurance_number', 'tax_code', 'bank_account', 'emergency_contact', 'note'];
const WORK_STATUS = ['working', 'probation', 'leave', 'resigned'];

const EMP_SELECT = `SELECT u.id, u.name, u.username, u.email, u.phone, u.title, u.color, u.birthday, u.address, u.department_id, u.manager_id,
    u.active, d.name AS department_name, m.name AS manager_name, h.*
  FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users m ON m.id = u.manager_id
  LEFT JOIN hr_profiles h ON h.user_id = u.id`;
const empView = (e) => ({ ...e, id: e.id ?? e.user_id, work_status: e.work_status || 'working' });

r.get('/hrm/meta', async (c) => c.json({ is_manager: await isHrManager(c.get('user')), settings: await hrmSettings() }));

r.get('/hrm/employees', async (c) => {
  await requireHr(c);
  const q = c.req.query();
  const where = ["u.role <> 'guest'"];
  const params = [];
  if (q.status === 'resigned') where.push("(h.work_status = 'resigned' OR u.active = 0)");
  else if (q.status) { where.push("IFNULL(h.work_status, 'working') = ? AND u.active = 1"); params.push(q.status); }
  else where.push("u.active = 1 AND IFNULL(h.work_status, 'working') <> 'resigned'");
  if (toInt(q.department_id)) { where.push('u.department_id = ?'); params.push(toInt(q.department_id)); }
  if (q.q) { const like = `%${q.q}%`; where.push("(u.name LIKE ? OR IFNULL(h.employee_code,'') LIKE ? OR IFNULL(u.phone,'') LIKE ?)"); params.push(like, like, like); }
  if (q.contract === 'expiring') { where.push("h.contract_end IS NOT NULL AND h.contract_end BETWEEN date('now') AND date('now', '+30 day')"); }
  const rows = await all(`${EMP_SELECT} WHERE ${where.join(' AND ')} ORDER BY u.name COLLATE NOCASE`, ...params);
  return c.json(rows.map(empView));
});

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
  const u = await get('SELECT id, username FROM users WHERE id = ?', id);
  if (!u) throw notFound();
  const b = await jsonBody(c);
  if (b.work_status && !WORK_STATUS.includes(b.work_status)) throw badRequest('Trạng thái không hợp lệ');
  for (const k of ['id_issue_date', 'hire_date', 'probation_end', 'contract_end']) {
    if (b[k] && !/^\d{4}-\d{2}-\d{2}$/.test(b[k])) throw badRequest('Ngày không hợp lệ');
  }
  const vals = HR_FIELDS.map((k) => (b[k] === undefined || b[k] === '' ? null : String(b[k]).slice(0, 500)));
  vals[HR_FIELDS.indexOf('work_status')] ||= 'working';
  await run(`INSERT INTO hr_profiles(user_id, ${HR_FIELDS.join(', ')}, updated_at) VALUES (?, ${HR_FIELDS.map(() => '?').join(', ')}, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET ${HR_FIELDS.map((k) => `${k} = excluded.${k}`).join(', ')}, updated_at = datetime('now')`, id, ...vals);
  await audit(c.get('user').id, 'hrm.update', `Cập nhật hồ sơ nhân sự @${u.username}`);
  return c.json(empView(await get(`${EMP_SELECT} WHERE u.id = ?`, id)));
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

/** Leave requests (Base Request, group configured in Timeoff settings) as flat records. */
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
  await audit(c.get('user').id, 'timeoff.settings', 'Cập nhật cài đặt Base Timeoff');
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
    WHERE u.active = 1 AND u.role <> 'guest' ${hr ? '' : 'AND u.manager_id = ?'} ORDER BY u.name COLLATE NOCASE`, ...(hr ? [] : [user.id]));
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
  await audit(c.get('user').id, 'checkin.settings', 'Cập nhật cài đặt Base Checkin');
  return c.json(next);
});

export default r;
