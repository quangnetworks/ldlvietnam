import { Hono } from 'hono';
import { all, get, run, batch, logActivity, notify, getSetting, setSetting, markSeen, findMentions } from '../db.js';
import { requireAdmin, userDeptIds, inDeptSql } from '../auth.js';
import { publicFileLink } from '../files.js';
import { audit } from '../platform.js';
import {
  badRequest, notFound, forbidden, toInt, idList, paginate, today, jsonBody, formBody, storeFiles, removeFile, sendFile,
} from '../util.js';

const r = new Hono();

const APP = 'wework';
export const TASK_STATUSES = ['todo', 'doing', 'review', 'done', 'failed'];
// critical = Quan trọng & khẩn cấp (ô "làm ngay" của ma trận Eisenhower)
const PRIORITIES = ['normal', 'important', 'urgent', 'critical'];
const PRIORITY_LABEL = { normal: 'Bình thường', important: 'Quan trọng', urgent: 'Khẩn cấp', critical: 'Quan trọng & khẩn cấp' };
const STATUS_LABEL = { todo: 'Cần làm', doing: 'Đang làm', review: 'Chờ đánh giá', done: 'Hoàn thành', failed: 'Thất bại' };
const RECURRING = ['daily', 'weekly', 'monthly'];

// ================================================================ access helpers
const isAdmin = (u) => u.role === 'admin';

async function projectRole(user, projectId) {
  if (!projectId) return null;
  const p = await get('SELECT owner_id FROM projects WHERE id = ?', projectId);
  if (!p) return null;
  // quản trị viên luôn quản lý được mọi dự án (kể cả khi đang là thành viên thường của dự án)
  if (p.owner_id === user.id || isAdmin(user)) return 'manager';
  const m = await get('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?', projectId, user.id);
  if (m) return m.role;
  return isAdmin(user) ? 'manager' : null;
}

function taskVisibilitySql(user) {
  if (isAdmin(user)) return { sql: '1=1', params: [] };
  return {
    sql: `(t.creator_id = ? OR t.assignee_id = ?
          OR EXISTS (SELECT 1 FROM task_followers tf WHERE tf.task_id = t.id AND tf.user_id = ?)
          OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = t.project_id AND pm.user_id = ?)
          OR EXISTS (SELECT 1 FROM projects pp WHERE pp.id = t.project_id AND pp.owner_id = ?)
          OR EXISTS (SELECT 1 FROM users su WHERE su.id = t.assignee_id AND su.manager_id = ?))`,
    params: [user.id, user.id, user.id, user.id, user.id, user.id],
  };
}

// ---------------- report permission (Cài đặt Wework → Quyền xem báo cáo)
const DEFAULT_SETTINGS = { report_users: [], report_groups: [], report_departments: [] };

async function weworkSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse((await getSetting('wework_settings')) || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
}

/** Báo cáo chỉ dành cho quản trị viên và các cá nhân / nhóm / phòng ban được cấp quyền (tài khoản khách chỉ khi được chọn đích danh). */
export async function canViewReports(user, st) {
  if (isAdmin(user)) return true;
  const s = st || (await weworkSettings());
  if (s.report_users.includes(user.id)) return true;
  if (user.role === 'guest') return false;
  if (userDeptIds(user).some((d) => s.report_departments.includes(d))) return true;
  if (s.report_groups.length) {
    return !!(await get(`SELECT 1 FROM user_group_members WHERE user_id = ? AND group_id IN (${s.report_groups.map(() => '?').join(',')})`,
      user.id, ...s.report_groups));
  }
  return false;
}

async function requireReports(c) {
  if (!(await canViewReports(c.get('user')))) throw forbidden('Chỉ quản trị viên và người được cấp quyền mới xem được báo cáo');
}

async function canViewTask(user, id) {
  // người xem báo cáo mở được công việc từ popup chi tiết của báo cáo
  if (await canViewReports(user)) return !!(await get('SELECT 1 FROM tasks WHERE id = ?', id));
  const v = taskVisibilitySql(user);
  return !!(await get(`SELECT 1 FROM tasks t WHERE t.id = ? AND ${v.sql}`, id, ...v.params));
}

async function canEditTask(user, t) {
  return isAdmin(user) || t.creator_id === user.id || t.assignee_id === user.id || (await projectRole(user, t.project_id)) === 'manager';
}

/** Người tạo, quản lý dự án, quản trị viên: toàn quyền với công việc. Người chỉ được giao việc bị giới hạn (xem OWNER_FIELDS). */
async function isTaskOwner(user, t) {
  return isAdmin(user) || t.creator_id === user.id || (await projectRole(user, t.project_id)) === 'manager';
}
/** Người được giao việc không được đổi: thời gian bắt đầu / kết thúc, mô tả, dự án, công việc cha, lặp lại. */
const OWNER_FIELDS = { start_date: 'thời gian bắt đầu', due_date: 'thời hạn', description: 'mô tả', project_id: 'dự án',
  parent_id: 'công việc cha', recurring: 'lặp lại' };
async function checkOwnerFields(user, t, data) {
  if (await isTaskOwner(user, t)) return;
  const blocked = Object.keys(OWNER_FIELDS).filter((k) => data[k] !== undefined && String(data[k] ?? '') !== String(t[k] ?? ''));
  if (blocked.length) {
    throw forbidden(`Người được giao việc không được thay đổi ${blocked.map((k) => OWNER_FIELDS[k]).join(', ')} — liên hệ người giao việc`);
  }
}

// ---------------- duyệt hoàn thành (Tài khoản → Phòng ban → "Công việc cần quản lý duyệt hoàn thành")
/** Công việc của người thuộc (một trong) các phòng ban bật duyệt hoàn thành. */
async function needsApproval(t) {
  if (!t.assignee_id) return false;
  return !!(await get(`SELECT 1 FROM departments d JOIN users u ON u.id = ?
    WHERE d.task_approval = 1 AND ${inDeptSql('u', 'd.id')}`, t.assignee_id));
}
/**
 * Cấp quản lý được duyệt hoàn thành: quản lý trực tiếp của người thực hiện, trưởng phòng ban của họ,
 * quản lý dự án, người giao việc (khác người thực hiện). Không có ai → người thực hiện tự hoàn thành.
 */
async function taskApprovers(t) {
  const ids = new Set();
  const a = t.assignee_id ? await get('SELECT id, manager_id FROM users WHERE id = ?', t.assignee_id) : null;
  if (a?.manager_id) ids.add(a.manager_id);
  if (a) for (const d of await all(`SELECT d.head_id FROM departments d JOIN users u ON u.id = ? WHERE d.head_id IS NOT NULL AND ${inDeptSql('u', 'd.id')}`, a.id)) ids.add(d.head_id);
  if (t.project_id) {
    for (const m of await all(`SELECT owner_id AS id FROM projects WHERE id = ? AND owner_id IS NOT NULL
      UNION SELECT user_id FROM project_members WHERE project_id = ? AND role = 'manager'`, t.project_id, t.project_id)) ids.add(m.id);
  }
  if (t.creator_id) ids.add(t.creator_id);
  ids.delete(t.assignee_id);
  return [...ids];
}
async function canApproveTask(user, t) {
  if (isAdmin(user)) return true;
  const list = await taskApprovers(t);
  return list.includes(user.id) || (!list.length && t.assignee_id === user.id);
}

/**
 * Quyền giao việc: quản trị viên giao cho mọi người; ai cũng tự giao cho mình;
 * quản lý trực tiếp giao cho nhân viên mình quản lý (kể cả cấp dưới gián tiếp); trưởng phòng giao cho nhân sự trong phòng ban;
 * quản lý dự án giao cho thành viên dự án.
 */
async function assignableScope(user, projectId) {
  if (isAdmin(user)) return { all: true, ids: [] };
  const ids = new Set([user.id]);
  const reports = await all(`WITH RECURSIVE sub(id, depth) AS (SELECT id, 1 FROM users WHERE manager_id = ?
      UNION ALL SELECT u.id, sub.depth + 1 FROM users u JOIN sub ON u.manager_id = sub.id WHERE sub.depth < 10)
    SELECT DISTINCT id FROM sub`, user.id);
  for (const r0 of reports) ids.add(r0.id);
  const heads = await all('SELECT id FROM departments WHERE head_id = ?', user.id);
  for (const d of heads) {
    for (const u of await all(`SELECT u.id FROM users u WHERE ${inDeptSql('u', '?')} AND u.active = 1`, d.id, d.id)) ids.add(u.id);
  }
  if (projectId && (await projectRole(user, projectId)) === 'manager') {
    for (const m of await all(`SELECT user_id AS id FROM project_members WHERE project_id = ?
      UNION SELECT owner_id FROM projects WHERE id = ? AND owner_id IS NOT NULL`, projectId, projectId)) ids.add(m.id);
  }
  return { all: false, ids: [...ids] };
}
async function checkAssign(user, assigneeId, projectId) {
  if (!assigneeId || assigneeId === user.id || isAdmin(user)) return;
  const scope = await assignableScope(user, projectId);
  if (!scope.ids.includes(assigneeId)) {
    throw forbidden('Bạn chỉ được giao việc cho bản thân, nhân viên do mình quản lý (hoặc thành viên dự án mình quản lý)');
  }
}

/**
 * Người phối hợp / theo dõi (kể cả người ngoài phòng ban hay ngoài dự án) được xem, thảo luận, đính kèm tệp và cập nhật kết quả
 * của riêng công việc đó mà không cần thêm vào dự án / phòng ban.
 */
async function canContribute(user, t) {
  if (await canEditTask(user, t)) return true;
  return !!(await get('SELECT 1 FROM task_followers WHERE task_id = ? AND user_id = ?', t.id, user.id));
}

async function canDeleteTask(user, t) {
  return isAdmin(user) || t.creator_id === user.id || (await projectRole(user, t.project_id)) === 'manager';
}

async function loadTask(id) {
  const t = await get('SELECT * FROM tasks WHERE id = ?', id);
  if (!t) throw notFound('Công việc không tồn tại');
  return t;
}

/** Load a task from the :id param and check the viewer may see it. */
async function viewableTask(c) {
  const id = toInt(c.req.param('id'));
  const t = await loadTask(id);
  if (!(await canViewTask(c.get('user'), id))) throw forbidden('Bạn không có quyền xem công việc này');
  return t;
}

// ================================================================ task queries
const TASK_SELECT = `
  SELECT t.*, p.name AS project_name, p.color AS project_color, p.kind AS project_kind,
    a.name AS assignee_name, a.color AS assignee_color, a.username AS assignee_username,
    c.name AS creator_name, c.username AS creator_username, c.color AS creator_color, l.name AS list_name,
    (SELECT pt.title FROM tasks pt WHERE pt.id = t.parent_id) AS parent_title,
    (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id) AS subtask_count,
    (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id AND s.status = 'done') AS subtask_done,
    (SELECT COUNT(*) FROM task_checklist k WHERE k.task_id = t.id) AS checklist_count,
    (SELECT COUNT(*) FROM task_checklist k WHERE k.task_id = t.id AND k.done = 1) AS checklist_done,
    (SELECT COUNT(*) FROM task_comments cm WHERE cm.task_id = t.id) AS comment_count,
    (SELECT COUNT(*) FROM task_results rs WHERE rs.task_id = t.id) AS result_count,
    EXISTS (SELECT 1 FROM task_stars st WHERE st.task_id = t.id AND st.user_id = ?) AS starred,
    EXISTS (SELECT 1 FROM task_followers tf2 WHERE tf2.task_id = t.id AND tf2.user_id = ?) AS following
  FROM tasks t
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN users a ON a.id = t.assignee_id
  LEFT JOIN users c ON c.id = t.creator_id
  LEFT JOIN task_lists l ON l.id = t.list_id`;

function decorateTask(t) {
  if (!t) return t;
  t.starred = !!t.starred;
  t.following = !!t.following;
  const open = t.status === 'todo' || t.status === 'doing';
  t.is_overdue = open && !!t.due_date && t.due_date.slice(0, 10) < today();
  t.is_late = t.status === 'done' && !!t.due_date && !!t.completed_at && t.completed_at.slice(0, 10) > t.due_date.slice(0, 10);
  return t;
}

const selectTasks = async (user, tail, ...params) => (await all(`${TASK_SELECT} ${tail}`, user.id, user.id, ...params)).map(decorateTask);

function buildTaskQuery(u, q) {
  const vis = taskVisibilitySql(u);
  const where = [vis.sql];
  const params = [...vis.params];

  switch (q.scope) {
    case 'assigned': where.push('t.assignee_id = ?'); params.push(u.id); break; // CV được giao
    case 'created': where.push('t.creator_id = ? AND IFNULL(t.assignee_id, 0) <> ?'); params.push(u.id, u.id); break; // CV giao đi
    case 'mine': where.push('(t.assignee_id = ? OR t.creator_id = ?)'); params.push(u.id, u.id); break; // Giao & được giao
    case 'following':
      where.push('EXISTS (SELECT 1 FROM task_followers f WHERE f.task_id = t.id AND f.user_id = ?)'); params.push(u.id); break;
    case 'starred':
      where.push('EXISTS (SELECT 1 FROM task_stars f WHERE f.task_id = t.id AND f.user_id = ?)'); params.push(u.id); break;
    case 'team': where.push('t.assignee_id IN (SELECT id FROM users WHERE manager_id = ?)'); params.push(u.id); break;
    case 'recurring': where.push('t.recurring IS NOT NULL'); break;
    default: break;
  }

  if (q.subtasks === 'none') where.push('t.parent_id IS NULL');
  else if (q.subtasks === 'only') where.push('t.parent_id IS NOT NULL');
  const parent = toInt(q.parent_id);
  if (parent) { where.push('t.parent_id = ?'); params.push(parent); }

  if (q.status) {
    const parts = [];
    for (const s of String(q.status).split(',')) {
      if (TASK_STATUSES.includes(s)) { parts.push('t.status = ?'); params.push(s); }
      else if (s === 'active') parts.push("t.status IN ('todo','doing')");
      else if (s === 'unreviewed') parts.push("t.status IN ('todo','doing','review')");
      else if (s === 'overdue') { parts.push("(t.status IN ('todo','doing') AND t.due_date IS NOT NULL AND date(t.due_date) < date(?))"); params.push(today()); }
      else if (s === 'late') parts.push("(t.status = 'done' AND t.due_date IS NOT NULL AND date(t.completed_at) > date(t.due_date))");
      else if (s === 'urgent') parts.push("t.priority IN ('urgent','critical')");
      else if (s === 'important') parts.push("t.priority IN ('important','critical')");
      else if (s === 'critical') parts.push("t.priority = 'critical'");
    }
    if (parts.length) where.push(`(${parts.join(' OR ')})`);
  }

  const ids = (col, key) => {
    const list = idList(q[key]);
    if (list.length) { where.push(`${col} IN (${list.map(() => '?').join(',')})`); params.push(...list); }
  };
  ids('t.project_id', 'project_id');
  ids('t.assignee_id', 'assignee_id');
  ids('t.creator_id', 'creator_id');
  ids('t.list_id', 'list_id');
  if (q.priority && PRIORITIES.includes(q.priority)) { where.push('t.priority = ?'); params.push(q.priority); }

  if (q.q) {
    const like = `%${String(q.q).trim()}%`;
    where.push("(t.title LIKE ? OR IFNULL(t.description,'') LIKE ?)");
    params.push(like, like);
  }
  if (q.due_from) { where.push('date(t.due_date) >= date(?)'); params.push(q.due_from); }
  if (q.due_to) { where.push('date(t.due_date) <= date(?)'); params.push(q.due_to); }
  if (q.from) { where.push('date(COALESCE(t.due_date, t.start_date, t.created_at)) >= date(?)'); params.push(q.from); }
  if (q.to) { where.push('date(COALESCE(t.start_date, t.due_date, t.created_at)) <= date(?)'); params.push(q.to); }
  if (q.created_from) { where.push('date(t.created_at) >= date(?)'); params.push(q.created_from); }
  if (q.created_to) { where.push('date(t.created_at) <= date(?)'); params.push(q.created_to); }

  const sorts = {
    updated: 't.updated_at DESC, t.id DESC',
    created: 't.created_at DESC, t.id DESC',
    due: 'CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date ASC, t.id DESC',
    position: 't.position ASC, t.id ASC',
    title: 't.title COLLATE NOCASE',
  };
  return { where: where.join(' AND '), params, order: sorts[q.sort] || sorts.updated };
}

r.get('/tasks', async (c) => {
  const u = c.get('user');
  const q = c.req.query();
  const { where, params, order } = buildTaskQuery(u, q);
  const { page, limit, offset } = paginate(q, 50);
  const total = (await get(`SELECT COUNT(*) AS c FROM tasks t WHERE ${where}`, ...params)).c;
  const items = await selectTasks(u, `WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, limit, offset);
  return c.json({ items, total, page, limit });
});

// ================================================================ dashboard / summary
r.get('/wework/summary', async (c) => {
  const u = c.get('user');
  const uid = u.id;
  const td = today();
  const s = await get(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status IN ('todo','doing') AND due_date IS NOT NULL AND date(due_date) < date(?) THEN 1 ELSE 0 END) AS overdue,
      SUM(CASE WHEN status IN ('todo','doing') THEN 1 ELSE 0 END) AS active
    FROM tasks WHERE assignee_id = ? AND parent_id IS NULL`, td, uid);
  return c.json({
    total: s.total || 0, done: s.done || 0, overdue: s.overdue || 0, active: s.active || 0,
    rate: s.total ? Math.round(((s.done || 0) / s.total) * 10000) / 100 : 0,
    new_assigned: await selectTasks(u, "WHERE t.assignee_id = ? AND t.status IN ('todo','doing') ORDER BY t.created_at DESC LIMIT 5", uid),
    new_created: await selectTasks(u, 'WHERE t.creator_id = ? AND IFNULL(t.assignee_id,0) <> ? ORDER BY t.created_at DESC LIMIT 5', uid, uid),
    alerts: await selectTasks(u, `WHERE t.assignee_id = ? AND t.status IN ('todo','doing')
      AND (t.priority IN ('urgent','important','critical') OR (t.due_date IS NOT NULL AND date(t.due_date) <= date(?, '+2 day')))
      ORDER BY t.due_date LIMIT 5`, uid, td),
    goals: await all(`${GOAL_SELECT} WHERE g.user_id = ? ORDER BY g.id DESC`, uid),
    team: await all(`SELECT u.id, u.name, u.color, u.title,
        (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status IN ('todo','doing')) AS active,
        (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status IN ('todo','doing') AND date(t.due_date) < date(?)) AS overdue
      FROM users u WHERE u.manager_id = ? AND u.active = 1 ORDER BY u.name`, td, uid),
  });
});

/** Nhóm trạng thái loại trừ nhau dùng cho biểu đồ: quá hạn tách khỏi cần làm / đang làm. */
const BUCKET_SQL = `CASE WHEN t.status IN ('todo','doing') AND t.due_date IS NOT NULL AND date(t.due_date) < date(?) THEN 'overdue'
  ELSE t.status END`;

r.get('/wework/reports', async (c) => {
  await requireReports(c);
  const q = c.req.query();
  const vis = { sql: '1=1', params: [] };
  const where = [vis.sql, 't.parent_id IS NULL'];
  const params = [...vis.params];
  const pid = toInt(q.project_id);
  if (pid) { where.push('t.project_id = ?'); params.push(pid); }
  const uidFilter = toInt(q.user_id);
  if (uidFilter) { where.push('t.assignee_id = ?'); params.push(uidFilter); }
  if (q.from) { where.push('date(t.created_at) >= date(?)'); params.push(q.from); }
  if (q.to) { where.push('date(t.created_at) <= date(?)'); params.push(q.to); }
  const w = where.join(' AND ');
  const td = today();
  // Xu hướng: số ngày theo bộ lọc (mặc định 30, tối đa 180)
  const days = Math.min(180, Math.max(7, toInt(q.days, 30)));
  const bucketCols = `SUM(CASE WHEN ${BUCKET_SQL} = 'done' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN ${BUCKET_SQL} = 'doing' THEN 1 ELSE 0 END) AS doing,
        SUM(CASE WHEN ${BUCKET_SQL} = 'review' THEN 1 ELSE 0 END) AS review,
        SUM(CASE WHEN ${BUCKET_SQL} = 'overdue' THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN ${BUCKET_SQL} = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN ${BUCKET_SQL} = 'todo' THEN 1 ELSE 0 END) AS todo`;
  const bucketParams = Array(6).fill(td);
  const [summary, byMember, byProject, doneTrend, createdTrend, byPriority] = await Promise.all([
    get(`SELECT COUNT(*) AS total, ${bucketCols},
        SUM(CASE WHEN t.status = 'done' AND t.due_date IS NOT NULL AND date(t.completed_at) > date(t.due_date) THEN 1 ELSE 0 END) AS late,
        SUM(CASE WHEN t.status = 'done' AND (t.due_date IS NULL OR date(t.completed_at) <= date(t.due_date)) THEN 1 ELSE 0 END) AS on_time
      FROM tasks t WHERE ${w}`, ...bucketParams, ...params),
    all(`SELECT u.id, u.name, u.color, COUNT(t.id) AS total, ${bucketCols}
      FROM tasks t JOIN users u ON u.id = t.assignee_id WHERE ${w} GROUP BY u.id ORDER BY total DESC LIMIT 30`, ...bucketParams, ...params),
    all(`SELECT p.id, p.name, p.color, p.kind, COUNT(t.id) AS total, ${bucketCols}
      FROM tasks t JOIN projects p ON p.id = t.project_id WHERE ${w} GROUP BY p.id ORDER BY total DESC LIMIT 30`, ...bucketParams, ...params),
    all(`SELECT date(t.completed_at) AS day, COUNT(*) AS c FROM tasks t
      WHERE ${w} AND t.status = 'done' AND date(t.completed_at) > date(?, ?) GROUP BY day ORDER BY day`, ...params, td, `-${days} day`),
    all(`SELECT date(t.created_at) AS day, COUNT(*) AS c FROM tasks t
      WHERE ${w} AND date(t.created_at) > date(?, ?) GROUP BY day ORDER BY day`, ...params, td, `-${days} day`),
    all(`SELECT t.priority, COUNT(*) AS c FROM tasks t WHERE ${w} AND t.status IN ('todo','doing','review') GROUP BY t.priority`, ...params),
  ]);
  const n = (x) => Number(x) || 0;
  const norm = (row) => ({ ...row, total: n(row.total), done: n(row.done), doing: n(row.doing), review: n(row.review),
    overdue: n(row.overdue), failed: n(row.failed), todo: n(row.todo) });
  const s = norm(summary);
  return c.json({
    today: td,
    days,
    summary: { ...s, late: n(summary.late), on_time: n(summary.on_time) },
    by_member: byMember.map(norm),
    by_project: byProject.map(norm),
    by_priority: byPriority,
    done_trend: doneTrend,
    created_trend: createdTrend,
    // tương thích ngược (trang dự án cũ)
    by_status: ['todo', 'doing', 'review', 'done', 'failed'].map((k) => ({ status: k, c: k === 'todo' || k === 'doing' ? s[k] + 0 : s[k] })),
    overdue: s.overdue,
    late: n(summary.late),
  });
});

/**
 * Báo cáo tổng hợp (theo bố cục Base Wework): lấy công việc một lần rồi tổng hợp trong JS
 * để giữ số truy vấn thấp (Cloudflare D1 giới hạn truy vấn / request).
 * Nhóm trạng thái: on_time (HT đúng hạn) · late (HT muộn) · doing (đang xử lý) · review (chờ đánh giá) · overdue · failed.
 */
const BASIS = { created: 't.created_at', due: 't.due_date', start: 't.start_date', completed: 't.completed_at' };
const BUCKETS = ['on_time', 'late', 'doing', 'review', 'overdue', 'failed'];

function taskBucket(t, td) {
  if (t.status === 'done') return t.due_date && t.completed_at && t.completed_at.slice(0, 10) > t.due_date.slice(0, 10) ? 'late' : 'on_time';
  if (t.status === 'failed') return 'failed';
  if (t.status === 'review') return 'review';
  return t.due_date && t.due_date.slice(0, 10) < td ? 'overdue' : 'doing';
}
const emptyCounts = () => Object.fromEntries([...BUCKETS.map((b) => [b, 0]), ['total', 0]]);

/**
 * Phạm vi dữ liệu chung của báo cáo tổng hợp và popup chi tiết: khoảng ngày theo mốc (tạo / thời hạn / bắt đầu / hoàn thành),
 * dự án, công việc con, trạng thái. Người xem báo cáo thấy toàn bộ công việc của công ty.
 */
function reportScope(q) {
  const td = today();
  const basis = BASIS[q.basis] ? q.basis : 'created';
  const col = BASIS[basis];
  const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
  const to = iso(q.to) || td;
  const from = iso(q.from) || new Date(new Date(`${to}T00:00:00Z`).getTime() - 29 * 864e5).toISOString().slice(0, 10);
  const where = [`${col} IS NOT NULL`, `date(${col}) BETWEEN date(?) AND date(?)`];
  const params = [from, to];
  const pid = toInt(q.project_id);
  if (pid) { where.push('t.project_id = ?'); params.push(pid); }
  if (q.subtasks === '0') where.push('t.parent_id IS NULL');
  if (q.status === 'active') where.push("t.status IN ('todo','doing','review')");
  if (q.status === 'done') where.push("t.status = 'done'");
  return { td, basis, col, from, to, where, params, iso };
}

/** Danh sách người mà tài khoản hiện tại được giao việc (theo dự án nếu có). */
r.get('/wework/assignable', async (c) => c.json(await assignableScope(c.get('user'), toInt(c.req.query('project_id')))));

r.get('/wework/meta', async (c) => c.json({ can_view_reports: await canViewReports(c.get('user')), is_admin: isAdmin(c.get('user')) }));

r.get('/wework/settings', requireAdmin, async (c) => c.json(await weworkSettings()));
r.put('/wework/settings', requireAdmin, async (c) => {
  const b = await jsonBody(c);
  const next = { report_users: idList(b.report_users), report_groups: idList(b.report_groups), report_departments: idList(b.report_departments) };
  await setSetting('wework_settings', JSON.stringify(next));
  await audit(c.get('user').id, 'wework.settings',
    `Cập nhật quyền xem báo cáo Wework (${next.report_users.length} người, ${next.report_groups.length} nhóm, ${next.report_departments.length} phòng ban)`);
  return c.json(next);
});

r.get('/wework/reports/overview', async (c) => {
  await requireReports(c);
  const q = c.req.query();
  const { td, basis, col, from, to, where, params } = reportScope(q);

  const [tasks, projects, people, goals, comments] = await Promise.all([
    all(`SELECT t.id, t.status, t.priority, t.due_date, t.start_date, t.completed_at, t.created_at, t.assignee_id, t.creator_id,
        t.project_id, date(${col}) AS basis_day FROM tasks t WHERE ${where.join(' AND ')} LIMIT 20000`, ...params),
    all("SELECT id, name, color, kind, status FROM projects WHERE is_template = 0"),
    all("SELECT u.id, u.name, u.color, u.role, u.department_id, d.name AS department_name FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.active = 1"),
    all(`SELECT g.id, g.title, g.progress, g.due_date, g.user_id, u.name AS user_name, u.color AS user_color, d.name AS department_name
      FROM goals g JOIN users u ON u.id = g.user_id LEFT JOIN departments d ON d.id = u.department_id ORDER BY g.progress DESC, g.id LIMIT 100`),
    get(`SELECT COUNT(*) AS n FROM task_comments tc JOIN tasks t ON t.id = tc.task_id WHERE ${where.join(' AND ')}`, ...params),
  ]);

  const byUser = Object.fromEntries(people.map((u) => [u.id, u]));
  const summary = emptyCounts();
  const assigned = {};
  const created = {};
  const unassigned = {};
  const byProject = {};
  const eisen = { important: 0, both: 0, none: 0, urgent: 0 };
  let noDue = 0;
  let reviewOverdue = 0;
  const add = (map, key, b) => { (map[key] ||= emptyCounts())[b]++; map[key].total++; };
  for (const t of tasks) {
    const b = taskBucket(t, td);
    t.bucket = b;
    summary[b]++; summary.total++;
    if (t.assignee_id) add(assigned, t.assignee_id, b);
    if (t.creator_id) add(created, t.creator_id, b);
    if (t.creator_id && !t.assignee_id) unassigned[t.creator_id] = (unassigned[t.creator_id] || 0) + 1;
    if (t.project_id) add(byProject, t.project_id, b);
    if (!t.due_date) noDue++;
    if (b === 'review' && t.due_date && t.due_date.slice(0, 10) < td) reviewOverdue++;
    eisen[{ urgent: 'urgent', important: 'important', critical: 'both' }[t.priority] || 'none']++;
  }
  const withUser = (map) => Object.entries(map).map(([id, v]) => ({ id: Number(id), name: byUser[id]?.name || 'Tài khoản đã xoá', color: byUser[id]?.color, ...v }))
    .sort((a, b) => b.total - a.total);
  const assignedRows = withUser(assigned);
  const open = (x) => x.doing + x.review + x.overdue;

  // Theo ngày: luỹ kế theo nhóm trạng thái hiện tại (tối đa 92 ngày)
  const dayList = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`) && dayList.length < 92; d = new Date(d.getTime() + 864e5)) dayList.push(d.toISOString().slice(0, 10));
  const perDay = {};
  for (const t of tasks) (perDay[t.basis_day] ||= emptyCounts())[t.bucket]++;
  const running = emptyCounts();
  const daily = dayList.map((day) => {
    for (const b of BUCKETS) running[b] += perDay[day]?.[b] || 0;
    const row = { day };
    for (const b of BUCKETS) row[b] = running[b];
    row.total = BUCKETS.reduce((s, b) => s + running[b], 0);
    return row;
  });
  // Theo tuần (thứ 2 → chủ nhật)
  const weekOf = (day) => { const d = new Date(`${day}T00:00:00Z`); const dow = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - dow * 864e5).toISOString().slice(0, 10); };
  const weeks = {};
  for (const day of dayList) weeks[weekOf(day)] ||= emptyCounts();
  for (const t of tasks) { const w = weeks[weekOf(t.basis_day)]; if (w) { w[t.bucket]++; w.total++; } }

  const projRows = projects.filter((p) => byProject[p.id]).map((p) => {
    const v = byProject[p.id];
    const ratio = open(v) ? v.overdue / open(v) : 0;
    const health = p.status === 'closed' ? 'closed' : ratio >= 0.5 && v.overdue >= 2 ? 'risk' : ratio >= 0.2 ? 'late' : 'on_track';
    return { id: p.id, name: p.name, color: p.color, kind: p.kind, status: p.status, health, ...v };
  }).sort((a, b) => b.total - a.total);
  const health = { on_track: 0, late: 0, risk: 0, closed: 0 };
  for (const p of projRows) health[p.health]++;

  const weeksCount = Math.max(1, dayList.length / 7);
  const activeAssignees = assignedRows.length || 1;
  const goalByDept = {};
  for (const g of goals) goalByDept[g.department_name || 'Chưa có phòng ban'] = (goalByDept[g.department_name || 'Chưa có phòng ban'] || 0) + 1;
  const staff = people.filter((u) => u.role !== 'guest');

  return c.json({
    from, to, basis, today: td, scanned: tasks.length,
    cards: {
      projects: { total: projects.filter((p) => p.kind === 'project').length, active: projects.filter((p) => p.kind === 'project' && p.status !== 'closed').length },
      departments: { total: projects.filter((p) => p.kind === 'department').length, active: projects.filter((p) => p.kind === 'department' && p.status !== 'closed').length },
      tasks: { total: summary.total, open: open(summary), done: summary.on_time + summary.late },
      goals: { total: goals.length, active: goals.filter((g) => g.progress < 100).length, done: goals.filter((g) => g.progress >= 100).length },
      members: { total: people.length, staff: staff.length, guests: people.length - staff.length },
    },
    summary,
    excellent: assignedRows.filter((m) => m.on_time + m.late > 0)
      .map((m) => ({ ...m, rate: Math.round(((m.on_time + m.late) / m.total) * 1000) / 10 }))
      .sort((a, b) => b.rate - a.rate || b.on_time - a.on_time).slice(0, 5),
    not_on_time: { overdue: summary.overdue, open: open(summary), late: summary.late, done: summary.on_time + summary.late, no_due: noDue },
    eisenhower: eisen,
    review: { total: summary.review, overdue: reviewOverdue,
      projects_with_review: new Set(tasks.filter((t) => t.bucket === 'review' && t.project_id).map((t) => t.project_id)).size, projects_total: projRows.length },
    daily,
    weekly: Object.entries(weeks).sort().map(([week, v]) => ({ week, ...v })),
    assigned: assignedRows,
    created: withUser(created),
    most_open: [...assignedRows].filter((m) => open(m) > 0).sort((a, b) => open(b) - open(a)).slice(0, 10).map((m) => ({ ...m, open: open(m) })),
    most_late: [...assignedRows].filter((m) => m.overdue + m.late > 0).sort((a, b) => b.overdue + b.late - (a.overdue + a.late)).slice(0, 10),
    most_created: withUser(created).slice(0, 10),
    most_unassigned: Object.entries(unassigned).map(([id, n]) => ({ id: Number(id), name: byUser[id]?.name, color: byUser[id]?.color, n })).sort((a, b) => b.n - a.n).slice(0, 10),
    projects: projRows,
    project_health: health,
    department_chart: projRows.filter((p) => p.kind === 'department').slice(0, 8),
    goals: goals.map(({ user_id, ...g }) => g),
    goals_by_department: Object.entries(goalByDept).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
    stats: {
      per_week: Math.round((summary.total / weeksCount) * 10) / 10,
      per_week_per_person: Math.round((summary.total / weeksCount / activeAssignees) * 10) / 10,
      per_project: projRows.length ? Math.round((projRows.reduce((s, p) => s + p.total, 0) / projRows.length) * 10) / 10 : 0,
      comments: comments.n,
    },
  });
});

/** Điều kiện SQL của từng nhóm trạng thái (khớp taskBucket: so sánh theo 10 ký tự ngày). */
const LATE_SQL = "(t.status = 'done' AND t.due_date IS NOT NULL AND t.completed_at IS NOT NULL AND substr(t.completed_at, 1, 10) > substr(t.due_date, 1, 10))";
const OVERDUE_SQL = "(t.status IN ('todo','doing') AND t.due_date IS NOT NULL AND substr(t.due_date, 1, 10) < ?)";
const bucketWhere = (b, td) => ({
  on_time: [`(t.status = 'done' AND NOT ${LATE_SQL})`, []],
  late: [LATE_SQL, []],
  failed: ["t.status = 'failed'", []],
  review: ["t.status = 'review'", []],
  overdue: [OVERDUE_SQL, [td]],
  doing: [`(t.status IN ('todo','doing') AND NOT ${OVERDUE_SQL})`, [td]],
  open: [`(t.status IN ('todo','doing','review'))`, []],
  done: ["t.status = 'done'", []],
}[b]);

/**
 * Popup chi tiết của báo cáo: danh sách công việc đứng sau một con số / một phần biểu đồ.
 * Dùng cùng phạm vi với báo cáo tổng hợp, cộng thêm bộ lọc chi tiết (nhóm trạng thái, người, dự án, ưu tiên, ngày, mục tiêu).
 */
r.get('/wework/reports/tasks', async (c) => {
  await requireReports(c);
  const user = c.get('user');
  const q = c.req.query();
  const scope = reportScope(q);
  const { td, iso } = scope;
  const goal = toInt(q.goal_id);
  // mục tiêu: mọi công việc gắn với mục tiêu, không giới hạn theo khoảng ngày
  const where = goal ? ['t.goal_id = ?'] : [...scope.where];
  const params = goal ? [goal] : [...scope.params];
  // nhiều nhóm (vd. "overdue,late" = làm muộn) được cộng gộp
  const buckets = String(q.bucket || '').split(',').map((b) => bucketWhere(b, td)).filter(Boolean);
  if (buckets.length) { where.push(`(${buckets.map((b) => b[0]).join(' OR ')})`); params.push(...buckets.flatMap((b) => b[1])); }
  const eq = (colName, key) => { const v = toInt(q[key]); if (v) { where.push(`${colName} = ?`); params.push(v); } };
  eq('t.assignee_id', 'assignee_id');
  eq('t.creator_id', 'creator_id');
  eq('t.project_id', 'drill_project');
  if (q.unassigned === '1') where.push('t.assignee_id IS NULL');
  if (PRIORITIES.includes(q.priority)) { where.push('t.priority = ?'); params.push(q.priority); }
  if (q.no_due === '1') where.push('t.due_date IS NULL');
  if (q.review_overdue === '1') { where.push("t.status = 'review' AND t.due_date IS NOT NULL AND substr(t.due_date, 1, 10) < ?"); params.push(td); }
  if (q.with_comments === '1') where.push('EXISTS (SELECT 1 FROM task_comments cm2 WHERE cm2.task_id = t.id)');
  if (!goal && iso(q.day_from)) { where.push(`date(${scope.col}) >= date(?)`); params.push(q.day_from); }
  if (!goal && iso(q.day_to)) { where.push(`date(${scope.col}) <= date(?)`); params.push(q.day_to); }
  if (q.q) { where.push('t.title LIKE ?'); params.push(`%${String(q.q).trim()}%`); }
  const w = where.join(' AND ');
  const { page, limit, offset } = paginate(q, 50);
  const total = (await get(`SELECT COUNT(*) AS c FROM tasks t WHERE ${w}`, ...params)).c;
  const items = (await selectTasks(user, `WHERE ${w} ORDER BY CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date DESC, t.id DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset)).map((t) => ({ ...t, bucket: taskBucket(t, td) }));
  return c.json({ items, total, page, limit });
});

// ================================================================ task detail
async function fullTask(id, user) {
  const [t] = await selectTasks(user, 'WHERE t.id = ?', id);
  t.followers = await all('SELECT u.id, u.name, u.color FROM task_followers f JOIN users u ON u.id = f.user_id WHERE f.task_id = ? ORDER BY u.name', id);
  t.checklist = await all('SELECT * FROM task_checklist WHERE task_id = ? ORDER BY position, id', id);
  t.subtasks = await selectTasks(user, 'WHERE t.parent_id = ? ORDER BY t.position, t.id', id);
  t.attachments = await all(`SELECT a.id, a.original_name, a.mime, a.size, a.created_at, u.name AS user_name FROM task_attachments a
    LEFT JOIN users u ON u.id = a.user_id WHERE a.task_id = ? AND a.result_id IS NULL ORDER BY a.id`, id);
  t.parent = t.parent_id ? await get('SELECT id, title FROM tasks WHERE id = ?', t.parent_id) : null;
  t.goal = t.goal_id ? await get('SELECT g.id, g.title, g.progress, g.user_id, u.name AS owner_name FROM goals g LEFT JOIN users u ON u.id = g.user_id WHERE g.id = ?', t.goal_id) : null;
  t.can_edit = await canEditTask(user, t);
  t.can_contribute = t.can_edit || t.following;
  // người tham gia không thuộc dự án / phòng ban của công việc (được giao hoặc mời theo dõi riêng công việc này)
  t.outside_project = !!t.project_id && !(await get('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?', t.project_id, user.id))
    && !(await get('SELECT 1 FROM projects WHERE id = ? AND owner_id = ?', t.project_id, user.id));
  // người chỉ được giao việc: không đổi thời gian, mô tả, dự án, lặp lại, không xoá
  t.can_manage = await isTaskOwner(user, t);
  t.can_delete = await canDeleteTask(user, t);
  // duyệt hoàn thành & khoá sau khi hoàn thành
  t.requires_approval = await needsApproval(t);
  t.can_approve = await canApproveTask(user, t);
  t.locked = t.status === 'done';
  t.can_reopen = t.locked && (t.requires_approval ? t.can_approve : t.can_edit);
  if (t.requires_approval) {
    const ids = await taskApprovers(t);
    t.approvers = ids.length ? await all(`SELECT id, name, color FROM users WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY name`, ...ids) : [];
  }
  if (t.locked) { t.can_edit = false; t.can_contribute = false; }
  return t;
}

r.get('/tasks/:id', async (c) => {
  const t = await viewableTask(c);
  await markSeen(c.get('user').id, `/wework/task/${t.id}`);
  return c.json(await fullTask(t.id, c.get('user')));
});

function parseTaskBody(b, partial) {
  const out = {};
  if (!partial || b.title !== undefined) {
    if (!String(b.title || '').trim()) throw badRequest('Tên công việc là bắt buộc');
    out.title = String(b.title).trim();
  }
  if (b.description !== undefined) out.description = b.description || null;
  if (b.project_id !== undefined) out.project_id = toInt(b.project_id);
  if (b.list_id !== undefined) out.list_id = toInt(b.list_id);
  if (b.parent_id !== undefined) out.parent_id = toInt(b.parent_id);
  if (b.assignee_id !== undefined) out.assignee_id = toInt(b.assignee_id);
  if (b.status !== undefined) {
    if (!TASK_STATUSES.includes(b.status)) throw badRequest('Trạng thái không hợp lệ');
    out.status = b.status;
  }
  if (b.priority !== undefined) {
    if (!PRIORITIES.includes(b.priority)) throw badRequest('Mức ưu tiên không hợp lệ');
    out.priority = b.priority;
  }
  if (b.start_date !== undefined) out.start_date = b.start_date || null;
  if (b.due_date !== undefined) out.due_date = b.due_date || null;
  if (b.recurring !== undefined) {
    if (b.recurring && !RECURRING.includes(b.recurring)) throw badRequest('Chu kỳ lặp không hợp lệ');
    out.recurring = b.recurring || null;
  }
  if (b.position !== undefined) out.position = toInt(b.position, 0);
  if (b.goal_id !== undefined) out.goal_id = toInt(b.goal_id) || null;
  if (out.start_date && out.due_date && out.start_date.slice(0, 10) > out.due_date.slice(0, 10)) {
    throw badRequest('Thời hạn phải sau ngày bắt đầu');
  }
  return out;
}

async function checkProjectAccess(user, projectId) {
  if (!projectId) return;
  if (!(await get('SELECT 1 FROM projects WHERE id = ?', projectId))) throw badRequest('Dự án không tồn tại');
  if (!(await projectRole(user, projectId))) throw forbidden('Bạn không phải thành viên dự án này');
}

export async function createTask(user, data, followers = [], { creatorId = null, skipAssignCheck = false } = {}) {
  await checkProjectAccess(user, data.project_id);
  if (!skipAssignCheck) await checkAssign(user, data.assignee_id ?? user.id, data.project_id);
  if (data.goal_id && !(await get('SELECT 1 FROM goals WHERE id = ?', data.goal_id))) data.goal_id = null;
  if (data.parent_id) {
    const parent = await get('SELECT * FROM tasks WHERE id = ?', data.parent_id);
    if (!parent) throw badRequest('Công việc cha không tồn tại');
    data.project_id ??= parent.project_id;
    data.list_id ??= parent.list_id;
  }
  if (data.list_id && data.project_id) {
    const l = await get('SELECT project_id FROM task_lists WHERE id = ?', data.list_id);
    if (!l || l.project_id !== data.project_id) data.list_id = null;
  }
  const pos = (await get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM tasks WHERE IFNULL(project_id,0) = IFNULL(?,0)', data.project_id ?? null)).p;
  const assignee = data.assignee_id ?? user.id;
  const { lastId: id } = await run(
    `INSERT INTO tasks(project_id, list_id, parent_id, title, description, creator_id, assignee_id, status, priority,
      start_date, due_date, recurring, position, goal_id, completed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    data.project_id ?? null, data.list_id ?? null, data.parent_id ?? null, data.title, data.description ?? null,
    creatorId ?? user.id, assignee, data.status ?? 'todo', data.priority ?? 'normal',
    data.start_date ?? null, data.due_date ?? null, data.recurring ?? null, data.position ?? pos, data.goal_id ?? null,
    data.status === 'done' ? new Date().toISOString() : null
  );
  await batch([...new Set(followers)].map((f) => ['INSERT OR IGNORE INTO task_followers(task_id, user_id) VALUES (?,?)', [id, f]]));
  await logActivity('task', id, user.id, 'created', 'Tạo công việc');
  if (data.goal_id) await refreshGoalProgress(data.goal_id);
  await notify(assignee, { actorId: user.id, app: APP, type: 'assigned',
    title: `${user.name} đã giao cho bạn công việc "${data.title}"`, link: `/wework/task/${id}` });
  await notify(followers, { actorId: user.id, app: APP, type: 'follow',
    title: `Bạn được thêm theo dõi công việc "${data.title}"`, link: `/wework/task/${id}` });
  return id;
}

r.post('/tasks', async (c) => {
  const b = await jsonBody(c);
  const id = await createTask(c.get('user'), parseTaskBody(b, false), idList(b.followers));
  return c.json(await fullTask(id, c.get('user')), 201);
});

function shiftDate(value, recurring) {
  if (!value) return null;
  const hasTime = value.length > 10;
  const d = new Date(hasTime ? value : `${value}T00:00:00Z`);
  if (recurring === 'daily') d.setUTCDate(d.getUTCDate() + 1);
  else if (recurring === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else if (recurring === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  return hasTime ? d.toISOString().slice(0, 16) : d.toISOString().slice(0, 10);
}

async function applyTaskUpdate(user, t, data) {
  if (!Object.keys(data).length) return;
  // Đã hoàn thành: khoá — chỉ bình luận; người có quyền duyệt / quản lý được "Mở lại" (đổi trạng thái)
  if (t.status === 'done') {
    const others = Object.keys(data).filter((k) => k !== 'status' && k !== 'position' && String(data[k] ?? '') !== String(t[k] ?? ''));
    if (others.length || data.status === undefined || data.status === 'done') {
      if (others.length) throw forbidden('Công việc đã hoàn thành — chỉ được bình luận. Cần "Mở lại" để cập nhật.');
      return;
    }
    const can = (await needsApproval(t)) ? await canApproveTask(user, t) : await canEditTask(user, t);
    if (!can) throw forbidden('Chỉ cấp quản lý mới được mở lại công việc đã hoàn thành');
  }
  // Phòng ban bật duyệt hoàn thành: nhân viên chọn "Hoàn thành" → chuyển sang "Chờ đánh giá" để quản lý duyệt
  if (data.status === 'done' && t.status !== 'done' && (await needsApproval(t)) && !(await canApproveTask(user, t))) {
    data.status = 'review';
  }
  if (data.goal_id && !(await get('SELECT 1 FROM goals WHERE id = ?', data.goal_id))) throw badRequest('Mục tiêu không tồn tại');
  await checkOwnerFields(user, t, data);
  if (data.assignee_id !== undefined && data.assignee_id !== t.assignee_id) {
    await checkAssign(user, data.assignee_id, data.project_id !== undefined ? data.project_id : t.project_id);
  }
  if (data.project_id !== undefined && data.project_id !== t.project_id) {
    await checkProjectAccess(user, data.project_id);
    if (data.list_id === undefined) data.list_id = null;
  }
  if (data.parent_id !== undefined && data.parent_id === t.id) throw badRequest('Công việc cha không hợp lệ');
  const start = data.start_date !== undefined ? data.start_date : t.start_date;
  const due = data.due_date !== undefined ? data.due_date : t.due_date;
  if (start && due && start.slice(0, 10) > due.slice(0, 10)) throw badRequest('Thời hạn phải sau ngày bắt đầu');

  const keys = Object.keys(data);
  const sets = keys.map((k) => `${k} = ?`);
  const vals = keys.map((k) => data[k]);
  const statusChanged = data.status !== undefined && data.status !== t.status;
  if (statusChanged) {
    sets.push('completed_at = ?');
    vals.push(data.status === 'done' ? new Date().toISOString() : null);
  }
  await run(`UPDATE tasks SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...vals, t.id);

  const changes = [];
  if (statusChanged && data.status === 'review' && (await needsApproval(t))) {
    await notify(await taskApprovers(t), { actorId: user.id, app: APP, type: 'approval',
      title: `${user.name} đã gửi duyệt hoàn thành công việc "${t.title}"`, link: `/wework/task/${t.id}` });
  }
  if (statusChanged) {
    changes.push(`Trạng thái: ${STATUS_LABEL[t.status]} → ${STATUS_LABEL[data.status]}`);
    const watchers = (await all('SELECT user_id FROM task_followers WHERE task_id = ?', t.id)).map((x) => x.user_id);
    await notify([t.creator_id, t.assignee_id, ...watchers], { actorId: user.id, app: APP, type: 'status',
      title: `${user.name} đã chuyển "${t.title}" sang ${STATUS_LABEL[data.status]}`, link: `/wework/task/${t.id}` });
    // Công việc lặp lại: tạo kỳ tiếp theo khi hoàn thành
    const recurring = data.recurring !== undefined ? data.recurring : t.recurring;
    if (data.status === 'done' && recurring) {
      const next = { ...t, ...data };
      const nid = await createTask(user, {
        project_id: next.project_id, list_id: next.list_id, parent_id: next.parent_id, title: next.title,
        description: next.description, assignee_id: next.assignee_id, priority: next.priority,
        start_date: shiftDate(next.start_date, recurring), due_date: shiftDate(next.due_date, recurring),
        recurring, goal_id: next.goal_id,
      }, watchers, { creatorId: t.creator_id, skipAssignCheck: true }); // kỳ tiếp theo giữ người giao việc ban đầu
      await run('UPDATE tasks SET recurring = NULL WHERE id = ?', t.id);
      await logActivity('task', t.id, user.id, 'recurring', `Tạo kỳ lặp tiếp theo #${nid}`);
    }
  }
  if (data.assignee_id !== undefined && data.assignee_id !== t.assignee_id) {
    const nu = data.assignee_id ? await get('SELECT name FROM users WHERE id = ?', data.assignee_id) : null;
    changes.push(`Người thực hiện: ${nu?.name || 'Không có'}`);
    await notify(data.assignee_id, { actorId: user.id, app: APP, type: 'assigned',
      title: `${user.name} đã giao cho bạn công việc "${data.title || t.title}"`, link: `/wework/task/${t.id}` });
  }
  if (data.due_date !== undefined && data.due_date !== t.due_date) changes.push(`Thời hạn: ${data.due_date || 'Không có'}`);
  if (data.start_date !== undefined && data.start_date !== t.start_date) changes.push(`Ngày bắt đầu: ${data.start_date || 'Không có'}`);
  if (data.priority !== undefined && data.priority !== t.priority) changes.push(`Ưu tiên: ${PRIORITY_LABEL[data.priority]}`);
  if (data.goal_id !== undefined && data.goal_id !== t.goal_id) {
    const g = data.goal_id ? await get('SELECT title FROM goals WHERE id = ?', data.goal_id) : null;
    changes.push(g ? `Gắn mục tiêu: ${g.title}` : 'Bỏ gắn mục tiêu');
  }
  if ((data.status !== undefined && data.status !== t.status) || (data.goal_id !== undefined && data.goal_id !== t.goal_id)) {
    await refreshGoalProgress(t.goal_id, data.goal_id);
  }
  if (data.title !== undefined && data.title !== t.title) changes.push(`Đổi tên: ${data.title}`);
  if (data.description !== undefined && data.description !== t.description) changes.push('Cập nhật mô tả');
  if (data.project_id !== undefined && data.project_id !== t.project_id) changes.push('Chuyển dự án');
  if (data.list_id !== undefined && data.list_id !== t.list_id) changes.push('Chuyển nhóm công việc');
  if (changes.length) await logActivity('task', t.id, user.id, 'updated', changes.join('; '));
}

r.put('/tasks/:id', async (c) => {
  const user = c.get('user');
  const t = await viewableTask(c);
  if (!(await canEditTask(user, t))) throw forbidden('Bạn không có quyền chỉnh sửa công việc này');
  const b = await jsonBody(c);
  await applyTaskUpdate(user, t, parseTaskBody(b, true));
  if (b.followers !== undefined) {
    await batch([
      ['DELETE FROM task_followers WHERE task_id = ?', [t.id]],
      ...idList(b.followers).map((f) => ['INSERT OR IGNORE INTO task_followers(task_id, user_id) VALUES (?,?)', [t.id, f]]),
    ]);
  }
  return c.json(await fullTask(t.id, user));
});

async function deleteTaskFiles(taskId) {
  // include attachments of subtasks, which cascade-delete with the parent
  return all(`WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id)
    SELECT filename FROM task_attachments WHERE task_id IN (SELECT id FROM sub)`, taskId);
}

r.delete('/tasks/:id', async (c) => {
  const t = await loadTask(toInt(c.req.param('id')));
  if (!(await canDeleteTask(c.get('user'), t))) throw forbidden('Chỉ người tạo hoặc quản lý dự án mới được xóa công việc');
  const files = await deleteTaskFiles(t.id);
  await run('DELETE FROM tasks WHERE id = ?', t.id);
  for (const f of files) await removeFile(f.filename);
  await refreshGoalProgress(t.goal_id);
  return c.json({ ok: true });
});

r.post('/tasks/bulk', async (c) => {
  const user = c.get('user');
  const b = await jsonBody(c);
  let affected = 0;
  const data = b.action === 'update' ? parseTaskBody(b.data || {}, true) : null;
  for (const id of idList(b.ids)) {
    const t = await get('SELECT * FROM tasks WHERE id = ?', id);
    if (!t || !(await canViewTask(user, id))) continue;
    if (b.action === 'delete') {
      if (!(await canDeleteTask(user, t))) continue;
      const files = await deleteTaskFiles(id);
      await run('DELETE FROM tasks WHERE id = ?', id);
      for (const f of files) await removeFile(f.filename);
    } else if (b.action === 'star') await run('INSERT OR IGNORE INTO task_stars(task_id, user_id) VALUES (?,?)', id, user.id);
    else if (b.action === 'follow') await run('INSERT OR IGNORE INTO task_followers(task_id, user_id) VALUES (?,?)', id, user.id);
    else if (b.action === 'update' && (await canEditTask(user, t))) {
      try { await applyTaskUpdate(user, t, { ...data }); } catch (e) { if (e.status === 403) continue; throw e; }
    }
    else continue;
    affected++;
  }
  return c.json({ affected });
});

const toggleTask = (table) => async (c) => {
  const t = await viewableTask(c);
  const uid = c.get('user').id;
  const exists = await get(`SELECT 1 FROM ${table} WHERE task_id = ? AND user_id = ?`, t.id, uid);
  if (exists) await run(`DELETE FROM ${table} WHERE task_id = ? AND user_id = ?`, t.id, uid);
  else await run(`INSERT INTO ${table}(task_id, user_id) VALUES (?,?)`, t.id, uid);
  return c.json({ active: !exists });
};
r.post('/tasks/:id/star', toggleTask('task_stars'));
r.post('/tasks/:id/follow', toggleTask('task_followers'));

/** Cấp quản lý duyệt hoàn thành (approve → Hoàn thành) hoặc trả lại (reject → Đang làm, kèm lý do). */
r.post('/tasks/:id/review', async (c) => {
  const user = c.get('user');
  const t = await viewableTask(c);
  if (!(await canApproveTask(user, t))) throw forbidden('Chỉ cấp quản lý mới được duyệt hoàn thành công việc này');
  if (t.status === 'done') throw badRequest('Công việc đã hoàn thành');
  const b = await jsonBody(c);
  const comment = String(b.comment || '').trim().slice(0, 2000);
  if (b.decision === 'approve') {
    await applyTaskUpdate(user, t, { status: 'done' });
    await logActivity('task', t.id, user.id, 'approved', `Duyệt hoàn thành${comment ? `: ${comment}` : ''}`);
  } else if (b.decision === 'reject') {
    if (!comment) throw badRequest('Vui lòng nhập lý do trả lại');
    await applyTaskUpdate(user, t, { status: 'doing' });
    await run('INSERT INTO task_comments(task_id, user_id, content) VALUES (?,?,?)', t.id, user.id, `↩ Trả lại, chưa duyệt hoàn thành: ${comment}`);
    await logActivity('task', t.id, user.id, 'returned', `Trả lại: ${comment}`);
    await notify(t.assignee_id, { actorId: user.id, app: APP, type: 'approval',
      title: `${user.name} trả lại công việc "${t.title}": ${comment.slice(0, 80)}`, link: `/wework/task/${t.id}` });
  } else throw badRequest('Quyết định không hợp lệ');
  return c.json(await fullTask(t.id, user));
});

/** Công việc đã hoàn thành: không thêm / sửa checklist, tệp, kết quả (chỉ bình luận). */
function assertNotLocked(t) {
  if (t.status === 'done') throw forbidden('Công việc đã hoàn thành — chỉ được bình luận. Cần "Mở lại" để cập nhật.');
}

// ---------------- checklist
const checklist = (id) => all('SELECT * FROM task_checklist WHERE task_id = ? ORDER BY position, id', id);

async function editableTask(c) {
  const t = await viewableTask(c);
  if (!(await canEditTask(c.get('user'), t))) throw forbidden();
  assertNotLocked(t);
  return t;
}

r.post('/tasks/:id/checklist', async (c) => {
  const t = await editableTask(c);
  const content = String((await jsonBody(c)).content || '').trim();
  if (!content) throw badRequest('Nội dung trống');
  const pos = (await get('SELECT COALESCE(MAX(position),0)+1 AS p FROM task_checklist WHERE task_id = ?', t.id)).p;
  await run('INSERT INTO task_checklist(task_id, content, position) VALUES (?,?,?)', t.id, content, pos);
  return c.json(await checklist(t.id), 201);
});
r.put('/tasks/:id/checklist/:cid', async (c) => {
  const t = await editableTask(c);
  const b = await jsonBody(c);
  await run('UPDATE task_checklist SET content = COALESCE(?, content), done = COALESCE(?, done) WHERE id = ? AND task_id = ?',
    b.content?.trim() || null, b.done === undefined ? null : b.done ? 1 : 0, toInt(c.req.param('cid')), t.id);
  return c.json(await checklist(t.id));
});
r.delete('/tasks/:id/checklist/:cid', async (c) => {
  const t = await editableTask(c);
  await run('DELETE FROM task_checklist WHERE id = ? AND task_id = ?', toInt(c.req.param('cid')), t.id);
  return c.json(await checklist(t.id));
});

// ---------------- comments & activity
const TASK_COMMENT_SELECT = `SELECT c.*, u.name AS user_name, u.color AS user_color FROM task_comments c
  LEFT JOIN users u ON u.id = c.user_id`;

r.get('/tasks/:id/comments', async (c) => {
  const t = await viewableTask(c);
  return c.json(await all(`${TASK_COMMENT_SELECT} WHERE c.task_id = ? ORDER BY c.id`, t.id));
});
r.post('/tasks/:id/comments', async (c) => {
  const user = c.get('user');
  const t = await viewableTask(c);
  const content = String((await jsonBody(c)).content || '').trim();
  if (!content) throw badRequest('Nội dung bình luận trống');
  const { lastId } = await run('INSERT INTO task_comments(task_id, user_id, content) VALUES (?,?,?)', t.id, user.id, content);
  const watchers = (await all('SELECT user_id FROM task_followers WHERE task_id = ?', t.id)).map((x) => x.user_id);
  // @mention: @tên_đăng_nhập (ô bình luận gợi ý người dùng khi gõ @)
  const mentioned = await findMentions(content, user.id);
  // người được nhắc tên được thêm vào người theo dõi để mở được công việc và nhận các cập nhật sau
  await batch(mentioned.map((uid) => ['INSERT OR IGNORE INTO task_followers(task_id, user_id) VALUES (?,?)', [t.id, uid]]));
  const snippet = content.replace(/\s+/g, ' ').slice(0, 80);
  await notify(mentioned, { actorId: user.id, app: APP, type: 'mention',
    title: `${user.name} đã nhắc đến bạn trong "${t.title}": ${snippet}`, link: `/wework/task/${t.id}` });
  await notify([t.creator_id, t.assignee_id, ...watchers].filter((x) => !mentioned.includes(x)), { actorId: user.id, app: APP, type: 'comment',
    title: `${user.name} đã bình luận trong "${t.title}"`, link: `/wework/task/${t.id}` });
  await run("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?", t.id);
  return c.json(await get(`${TASK_COMMENT_SELECT} WHERE c.id = ?`, lastId), 201);
});
r.delete('/tasks/:id/comments/:cid', async (c) => {
  const user = c.get('user');
  const cm = await get('SELECT * FROM task_comments WHERE id = ? AND task_id = ?', toInt(c.req.param('cid')), toInt(c.req.param('id')));
  if (!cm) throw notFound();
  if (cm.user_id !== user.id && !isAdmin(user)) throw forbidden();
  await run('DELETE FROM task_comments WHERE id = ?', cm.id);
  return c.json({ ok: true });
});
r.get('/tasks/:id/activity', async (c) => {
  const t = await viewableTask(c);
  return c.json(await all(`SELECT l.*, u.name AS user_name, u.color AS user_color FROM activity_logs l LEFT JOIN users u ON u.id = l.user_id
    WHERE l.entity_type = 'task' AND l.entity_id = ? ORDER BY l.id DESC`, t.id));
});

// ---------------- attachments
r.post('/tasks/:id/attachments', async (c) => {
  const user = c.get('user');
  const t = await viewableTask(c);
  assertNotLocked(t);
  const { files } = await formBody(c);
  const stored = await storeFiles(files);
  await batch(stored.map((f) => [
    'INSERT INTO task_attachments(task_id, filename, original_name, mime, size, user_id) VALUES (?,?,?,?,?,?)',
    [t.id, f.filename, f.original_name, f.mime, f.size, user.id],
  ]));
  if (stored.length) await logActivity('task', t.id, user.id, 'attached', `Đính kèm ${stored.length} tệp`);
  return c.json((await fullTask(t.id, user)).attachments, 201);
});
r.get('/tasks/:id/attachments/:aid', async (c) => {
  const t = await viewableTask(c);
  const a = await get('SELECT * FROM task_attachments WHERE id = ? AND task_id = ?', toInt(c.req.param('aid')), t.id);
  if (!a) throw notFound('Tệp không tồn tại');
  return sendFile(c, a, c.req.query('inline') === '1');
});
r.delete('/tasks/:id/attachments/:aid', async (c) => {
  const user = c.get('user');
  const t = await viewableTask(c);
  const a = await get('SELECT * FROM task_attachments WHERE id = ? AND task_id = ?', toInt(c.req.param('aid')), t.id);
  if (!a) throw notFound();
  if (a.user_id !== user.id && !(await canEditTask(user, t))) throw forbidden();
  assertNotLocked(t);
  await run('DELETE FROM task_attachments WHERE id = ?', a.id);
  await removeFile(a.filename);
  return c.json({ ok: true });
});

/** Liên kết tạm (15 phút) để trình xem trực tuyến (Microsoft Office / Google) tải được tệp mà không cần phiên đăng nhập. */
r.post('/tasks/:id/attachments/:aid/link', async (c) => {
  const t = await viewableTask(c);
  const a = await get('SELECT id, original_name FROM task_attachments WHERE id = ? AND task_id = ?', toInt(c.req.param('aid')), t.id);
  if (!a) throw notFound('Tệp không tồn tại');
  return c.json(await publicFileLink(c, 'ta', a));
});

// ---------------- kết quả công việc (văn bản, liên kết, tệp: office, ảnh, video...)
const RESULT_SELECT = `SELECT r.*, u.name AS user_name, u.color AS user_color FROM task_results r LEFT JOIN users u ON u.id = r.user_id`;

function parseLinks(v) {
  let list = v;
  if (typeof v === 'string') {
    try { list = JSON.parse(v); } catch { list = v.split(/\r?\n/); }
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const x of list) {
    const url = String((typeof x === 'object' && x ? x.url : x) || '').trim();
    if (!url) continue;
    if (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > 2000) throw badRequest(`Liên kết không hợp lệ: ${url.slice(0, 80)}`);
    out.push({ url, title: String((typeof x === 'object' && x?.title) || '').trim().slice(0, 200) || null });
  }
  if (out.length > 20) throw badRequest('Tối đa 20 liên kết mỗi kết quả');
  return out;
}
const blankHtml = (h) => !String(h || '').replace(/<[^>]*>|&nbsp;/g, '').trim() && !/<img|<video|<iframe/i.test(h || '');

async function taskResults(taskId) {
  const [rows, files] = await Promise.all([
    all(`${RESULT_SELECT} WHERE r.task_id = ? ORDER BY r.id DESC`, taskId),
    all(`SELECT id, result_id, original_name, mime, size, created_at FROM task_attachments WHERE task_id = ? AND result_id IS NOT NULL ORDER BY id`, taskId),
  ]);
  return rows.map((x) => {
    let links = [];
    try { links = JSON.parse(x.links || '[]'); } catch { links = []; }
    return { ...x, links, files: files.filter((f) => f.result_id === x.id) };
  });
}

async function editableResult(c) {
  const user = c.get('user');
  const t = await viewableTask(c);
  const res = await get('SELECT * FROM task_results WHERE id = ? AND task_id = ?', toInt(c.req.param('rid')), t.id);
  if (!res) throw notFound('Kết quả không tồn tại');
  if (res.user_id !== user.id && !isAdmin(user) && (await projectRole(user, t.project_id)) !== 'manager') {
    throw forbidden('Chỉ người cập nhật kết quả hoặc quản lý mới được sửa / xoá');
  }
  assertNotLocked(t);
  return { t, res };
}

r.get('/tasks/:id/results', async (c) => {
  const t = await viewableTask(c);
  return c.json(await taskResults(t.id));
});

r.post('/tasks/:id/results', async (c) => {
  const user = c.get('user');
  const t = await viewableTask(c);
  if (!(await canContribute(user, t))) throw forbidden('Chỉ người thực hiện, người phối hợp / theo dõi, người giao việc hoặc quản lý dự án mới cập nhật được kết quả');
  assertNotLocked(t);
  const { fields, files } = await formBody(c);
  const content = blankHtml(fields.content) ? null : String(fields.content);
  const links = parseLinks(fields.links);
  if (!content && !links.length && !files.length) throw badRequest('Hãy nhập nội dung, liên kết hoặc tải lên tệp kết quả');
  const { lastId } = await run('INSERT INTO task_results(task_id, user_id, content, links) VALUES (?,?,?,?)',
    t.id, user.id, content, JSON.stringify(links));
  const stored = await storeFiles(files);
  await batch(stored.map((f) => [
    'INSERT INTO task_attachments(task_id, result_id, filename, original_name, mime, size, user_id) VALUES (?,?,?,?,?,?,?)',
    [t.id, lastId, f.filename, f.original_name, f.mime, f.size, user.id],
  ]));
  const parts = [content && 'nội dung', links.length && `${links.length} liên kết`, stored.length && `${stored.length} tệp`].filter(Boolean);
  await logActivity('task', t.id, user.id, 'result', `Cập nhật kết quả công việc (${parts.join(', ')})`);
  const watchers = (await all('SELECT user_id FROM task_followers WHERE task_id = ?', t.id)).map((x) => x.user_id);
  await notify([t.creator_id, t.assignee_id, ...watchers], { actorId: user.id, app: APP, type: 'result',
    title: `${user.name} đã cập nhật kết quả công việc "${t.title}"`, link: `/wework/task/${t.id}` });
  await run("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?", t.id);
  return c.json(await taskResults(t.id), 201);
});

r.put('/tasks/:id/results/:rid', async (c) => {
  const { t, res } = await editableResult(c);
  const { fields, files } = await formBody(c);
  const content = fields.content === undefined ? res.content : blankHtml(fields.content) ? null : String(fields.content);
  const links = fields.links === undefined ? JSON.parse(res.links || '[]') : parseLinks(fields.links);
  const stored = await storeFiles(files);
  const keepFiles = (await get('SELECT COUNT(*) AS n FROM task_attachments WHERE result_id = ?', res.id)).n;
  if (!content && !links.length && !keepFiles && !stored.length) throw badRequest('Kết quả không được để trống');
  await batch([
    ["UPDATE task_results SET content = ?, links = ?, updated_at = datetime('now') WHERE id = ?", [content, JSON.stringify(links), res.id]],
    ...stored.map((f) => [
      'INSERT INTO task_attachments(task_id, result_id, filename, original_name, mime, size, user_id) VALUES (?,?,?,?,?,?,?)',
      [t.id, res.id, f.filename, f.original_name, f.mime, f.size, c.get('user').id],
    ]),
  ]);
  await logActivity('task', t.id, c.get('user').id, 'result', 'Chỉnh sửa kết quả công việc');
  return c.json(await taskResults(t.id));
});

r.delete('/tasks/:id/results/:rid', async (c) => {
  const { t, res } = await editableResult(c);
  const files = await all('SELECT filename FROM task_attachments WHERE result_id = ?', res.id);
  await batch([['DELETE FROM task_attachments WHERE result_id = ?', [res.id]], ['DELETE FROM task_results WHERE id = ?', [res.id]]]);
  for (const f of files) await removeFile(f.filename);
  await logActivity('task', t.id, c.get('user').id, 'result', 'Xoá một kết quả công việc');
  return c.json(await taskResults(t.id));
});

// ================================================================ projects
const PROJECT_SELECT = `
  SELECT p.*, o.name AS owner_name, o.color AS owner_color, dep.name AS department_name,
    (SELECT COUNT(*) FROM project_members m WHERE m.project_id = p.id) AS member_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.parent_id IS NULL) AS task_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.parent_id IS NULL AND t.status = 'done') AS done_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status IN ('todo','doing') AND date(t.due_date) < date('now')) AS overdue_count
  FROM projects p LEFT JOIN users o ON o.id = p.owner_id LEFT JOIN departments dep ON dep.id = p.department_id`;

function projectVisibility(user) {
  if (isAdmin(user)) return { sql: '1=1', params: [] };
  return {
    sql: '(p.owner_id = ? OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?))',
    params: [user.id, user.id],
  };
}

r.get('/projects', async (c) => {
  const q = c.req.query();
  // Mẫu dự án dùng chung cho toàn công ty
  const v = q.template === '1' ? { sql: '1=1', params: [] } : projectVisibility(c.get('user'));
  const where = [v.sql];
  const params = [...v.params];
  if (q.kind) { where.push('p.kind = ?'); params.push(q.kind); }
  where.push(q.template === '1' ? 'p.is_template = 1' : 'p.is_template = 0');
  if (q.status) { where.push('p.status = ?'); params.push(q.status); }
  else if (q.template !== '1') where.push("p.status = 'active'");
  if (q.q) { where.push('p.name LIKE ?'); params.push(`%${q.q}%`); }
  const order = q.sort === 'name' ? 'p.name COLLATE NOCASE' : 'p.created_at DESC';
  return c.json(await all(`${PROJECT_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order}`, ...params));
});

const projectLists = (id) => all('SELECT * FROM task_lists WHERE project_id = ? ORDER BY position, id', id);

async function fullProject(id, user) {
  const p = await get(`${PROJECT_SELECT} WHERE p.id = ?`, id);
  p.members = await all(`SELECT u.id, u.name, u.color, u.title, u.username, m.role FROM project_members m JOIN users u ON u.id = m.user_id
    WHERE m.project_id = ? ORDER BY m.role, u.name`, id);
  p.lists = await projectLists(id);
  p.departments = await all(`SELECT d.id, d.name FROM project_departments pd JOIN departments d ON d.id = pd.department_id
    WHERE pd.project_id = ? ORDER BY d.name`, id);
  p.my_role = await projectRole(user, id);
  return p;
}

async function projectOr404(c) {
  const id = toInt(c.req.param('id'));
  const p = await get('SELECT * FROM projects WHERE id = ?', id);
  if (!p) throw notFound('Dự án không tồn tại');
  return p;
}

async function memberProject(c) {
  const p = await projectOr404(c);
  if (!(await projectRole(c.get('user'), p.id))) throw forbidden('Bạn không phải thành viên dự án này');
  return p;
}

async function managedProject(c, msg) {
  const p = await projectOr404(c);
  if ((await projectRole(c.get('user'), p.id)) !== 'manager') throw forbidden(msg);
  return p;
}

r.get('/projects/:id', async (c) => {
  const p = await memberProject(c);
  return c.json(await fullProject(p.id, c.get('user')));
});

function parseProject(b, partial) {
  const out = {};
  if (!partial || b.name !== undefined) {
    if (!String(b.name || '').trim()) throw badRequest('Tên dự án là bắt buộc');
    out.name = String(b.name).trim();
  }
  for (const k of ['description', 'color', 'group_name', 'start_date', 'end_date']) if (b[k] !== undefined) out[k] = b[k] || null;
  if (b.kind !== undefined) out.kind = b.kind === 'department' ? 'department' : 'project';
  if (b.status !== undefined) out.status = b.status === 'archived' ? 'archived' : 'active';
  if (b.department_id !== undefined) out.department_id = toInt(b.department_id);
  // nhiều phòng ban phối hợp: phòng ban đầu tiên là phòng ban chính (department_id)
  if (b.department_ids !== undefined) {
    out.department_ids = idList(b.department_ids);
    out.department_id = out.department_ids[0] ?? null;
  }
  if (b.is_template !== undefined) out.is_template = b.is_template ? 1 : 0;
  return out;
}

async function copyProjectContent(fromId, toId, user) {
  const listMap = {};
  for (const l of await all('SELECT * FROM task_lists WHERE project_id = ? ORDER BY position', fromId)) {
    listMap[l.id] = (await run('INSERT INTO task_lists(project_id, name, position) VALUES (?,?,?)', toId, l.name, l.position)).lastId;
  }
  const taskMap = {};
  for (const t of await all('SELECT * FROM tasks WHERE project_id = ? ORDER BY parent_id IS NOT NULL, id', fromId)) {
    taskMap[t.id] = (await run(`INSERT INTO tasks(project_id, list_id, parent_id, title, description, creator_id, assignee_id, status, priority, position)
      VALUES (?,?,?,?,?,?,?, 'todo', ?, ?)`, toId, listMap[t.list_id] ?? null, taskMap[t.parent_id] ?? null,
    t.title, t.description, user.id, user.id, t.priority, t.position)).lastId;
    const items = await all('SELECT * FROM task_checklist WHERE task_id = ?', t.id);
    await batch(items.map((ci) => ['INSERT INTO task_checklist(task_id, content, position) VALUES (?,?,?)', [taskMap[t.id], ci.content, ci.position]]));
  }
}

r.post('/projects', async (c) => {
  const user = c.get('user');
  const b = await jsonBody(c);
  const data = parseProject(b, false);
  const depIds = data.department_ids || (data.department_id ? [data.department_id] : []);
  delete data.department_ids;
  const tpl = toInt(b.template_id);
  if (tpl && !(await get('SELECT 1 FROM projects WHERE id = ? AND is_template = 1', tpl))) throw badRequest('Mẫu không tồn tại');
  const { lastId: pid } = await run(`INSERT INTO projects(name, kind, description, color, owner_id, department_id, group_name, is_template, start_date, end_date)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, data.name, data.kind || 'project', data.description ?? null, data.color || '#2d7ff9',
  user.id, data.department_id ?? null, data.group_name ?? null, data.is_template ?? 0, data.start_date ?? null, data.end_date ?? null);
  const members = idList(b.members);
  const managers = idList(b.managers);
  // tuỳ chọn: thêm toàn bộ nhân sự của các phòng ban phối hợp
  if (b.add_department_members && depIds.length) {
    for (const u of await departmentUsers(depIds)) if (!members.includes(u) && !managers.includes(u) && u !== user.id) members.push(u);
  }
  await batch([
    ...depIds.map((d) => ['INSERT OR IGNORE INTO project_departments(project_id, department_id) VALUES (?,?)', [pid, d]]),
    ["INSERT INTO project_members(project_id, user_id, role) VALUES (?,?, 'manager')", [pid, user.id]],
    ...members.map((m) => ["INSERT OR IGNORE INTO project_members(project_id, user_id, role) VALUES (?,?, 'member')", [pid, m]]),
    ...managers.map((m) => ["INSERT INTO project_members(project_id, user_id, role) VALUES (?,?, 'manager') ON CONFLICT DO UPDATE SET role = 'manager'", [pid, m]]),
  ]);
  if (tpl) await copyProjectContent(tpl, pid, user);
  else {
    const lists = Array.isArray(b.lists) && b.lists.length ? b.lists : ['Cần làm', 'Đang làm', 'Hoàn thành'];
    await batch(lists.map((n, i) => ['INSERT INTO task_lists(project_id, name, position) VALUES (?,?,?)', [pid, String(n), i + 1]]));
  }
  await notify([...members, ...managers], { actorId: user.id, app: APP, type: 'project',
    title: `${user.name} đã thêm bạn vào ${data.kind === 'department' ? 'phòng ban' : 'dự án'} "${data.name}"`, link: `/wework/project/${pid}` });
  await logActivity('project', pid, user.id, 'created', 'Tạo dự án');
  return c.json(await fullProject(pid, user), 201);
});

r.post('/projects/:id/save-template', async (c) => {
  const user = c.get('user');
  const p = await managedProject(c);
  const { lastId: tid } = await run('INSERT INTO projects(name, kind, description, color, owner_id, is_template) VALUES (?,?,?,?,?,1)',
    (await jsonBody(c)).name || `Mẫu - ${p.name}`, p.kind, p.description, p.color, user.id);
  await run("INSERT INTO project_members(project_id, user_id, role) VALUES (?,?, 'manager')", tid, user.id);
  await copyProjectContent(p.id, tid, user);
  return c.json(await fullProject(tid, user), 201);
});

r.put('/projects/:id', async (c) => {
  const p = await managedProject(c, 'Chỉ quản lý dự án mới được chỉnh sửa');
  const b = await jsonBody(c);
  const data = parseProject(b, true);
  if (data.department_ids) {
    const ids = data.department_ids;
    await batch([['DELETE FROM project_departments WHERE project_id = ?', [p.id]],
      ...ids.map((d) => ['INSERT OR IGNORE INTO project_departments(project_id, department_id) VALUES (?,?)', [p.id, d]])]);
    if (b.add_department_members && ids.length) await addMembers(c.get('user'), p, await departmentUsers(ids), 'member');
  }
  delete data.department_ids;
  const keys = Object.keys(data);
  if (keys.length) await run(`UPDATE projects SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => data[k]), p.id);
  await logActivity('project', p.id, c.get('user').id, 'updated', 'Cập nhật dự án');
  return c.json(await fullProject(p.id, c.get('user')));
});

r.delete('/projects/:id', async (c) => {
  const user = c.get('user');
  const p = await projectOr404(c);
  if (!(isAdmin(user) || p.owner_id === user.id)) throw forbidden('Chỉ chủ dự án mới được xóa');
  const files = await all(`SELECT a.filename FROM task_attachments a JOIN tasks t ON t.id = a.task_id WHERE t.project_id = ?`, p.id);
  await run('DELETE FROM projects WHERE id = ?', p.id);
  for (const f of files) await removeFile(f.filename);
  return c.json({ ok: true });
});

r.put('/projects/:id/members', async (c) => {
  const user = c.get('user');
  const p = await managedProject(c);
  const b = await jsonBody(c);
  const members = Array.isArray(b.members) ? b.members : [];
  const before = new Set((await all('SELECT user_id FROM project_members WHERE project_id = ?', p.id)).map((x) => x.user_id));
  const stmts = [['DELETE FROM project_members WHERE project_id = ?', [p.id]]];
  for (const m of members) {
    const uid = toInt(m.user_id ?? m.id);
    if (uid) stmts.push(['INSERT OR REPLACE INTO project_members(project_id, user_id, role) VALUES (?,?,?)', [p.id, uid, m.role === 'manager' ? 'manager' : 'member']]);
  }
  if (p.owner_id) stmts.push(["INSERT OR REPLACE INTO project_members(project_id, user_id, role) VALUES (?,?, 'manager')", [p.id, p.owner_id]]);
  await batch(stmts);
  const added = members.map((m) => toInt(m.user_id ?? m.id)).filter((x) => x && !before.has(x));
  await notify(added, { actorId: user.id, app: APP, type: 'project',
    title: `${user.name} đã thêm bạn vào "${p.name}"`, link: `/wework/project/${p.id}` });
  return c.json(await fullProject(p.id, user));
});

/** Nhân sự đang làm việc thuộc các phòng ban (tính cả phòng ban kiêm nhiệm). */
async function departmentUsers(depIds) {
  if (!depIds.length) return [];
  const ph = depIds.map(() => '?').join(',');
  return (await all(`SELECT DISTINCT u.id FROM users u WHERE u.active = 1 AND u.role <> 'guest' AND (u.department_id IN (${ph})
    OR EXISTS (SELECT 1 FROM user_departments ud WHERE ud.user_id = u.id AND ud.department_id IN (${ph})))`, ...depIds, ...depIds)).map((x) => x.id);
}

async function addMembers(actor, p, userIds, role) {
  const existing = new Set((await all('SELECT user_id FROM project_members WHERE project_id = ?', p.id)).map((x) => x.user_id));
  const valid = (await all(`SELECT id FROM users WHERE active = 1 AND id IN (${userIds.map(() => '?').join(',') || 'NULL'})`, ...userIds)).map((x) => x.id);
  const added = valid.filter((u) => !existing.has(u));
  await batch(added.map((u) => ['INSERT OR IGNORE INTO project_members(project_id, user_id, role) VALUES (?,?,?)', [p.id, u, role === 'manager' ? 'manager' : 'member']]));
  if (added.length) {
    await notify(added, { actorId: actor.id, app: APP, type: 'project', title: `${actor.name} đã thêm bạn vào "${p.name}"`, link: `/wework/project/${p.id}` });
    await logActivity('project', p.id, actor.id, 'members', `Thêm ${added.length} thành viên`);
  }
  return added.length;
}

/** Thêm thành viên (theo người hoặc cả phòng ban). */
r.post('/projects/:id/members', async (c) => {
  const p = await managedProject(c, 'Chỉ quản lý dự án mới được thêm thành viên');
  const b = await jsonBody(c);
  const ids = [...idList(b.user_ids), ...(await departmentUsers(idList(b.department_ids)))];
  if (!ids.length) throw badRequest('Chưa chọn thành viên hoặc phòng ban');
  const added = await addMembers(c.get('user'), p, [...new Set(ids)], b.role);
  return c.json({ added, project: await fullProject(p.id, c.get('user')) });
});
/** Đổi vai trò thành viên (quản lý / thành viên). */
r.put('/projects/:id/members/:uid', async (c) => {
  const p = await managedProject(c, 'Chỉ quản lý dự án mới được đổi vai trò');
  const uid = toInt(c.req.param('uid'));
  if (uid === p.owner_id) throw badRequest('Không đổi được vai trò của chủ sở hữu dự án');
  const role = (await jsonBody(c)).role === 'manager' ? 'manager' : 'member';
  const { changes } = await run('UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?', role, p.id, uid);
  if (!changes) throw notFound('Thành viên không thuộc dự án');
  return c.json(await fullProject(p.id, c.get('user')));
});
/** Xoá thành viên khỏi dự án (không xoá được chủ sở hữu; công việc của họ vẫn giữ nguyên). */
r.delete('/projects/:id/members/:uid', async (c) => {
  const p = await managedProject(c, 'Chỉ quản lý dự án mới được xoá thành viên');
  const uid = toInt(c.req.param('uid'));
  if (uid === p.owner_id) throw badRequest('Không xoá được chủ sở hữu dự án');
  await run('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', p.id, uid);
  const u = await get('SELECT name FROM users WHERE id = ?', uid);
  await logActivity('project', p.id, c.get('user').id, 'members', `Xoá thành viên ${u?.name || ''}`);
  return c.json(await fullProject(p.id, c.get('user')));
});

// ---------------- task lists (nhóm công việc)
r.post('/projects/:id/lists', async (c) => {
  const p = await memberProject(c);
  const name = String((await jsonBody(c)).name || '').trim();
  if (!name) throw badRequest('Tên nhóm công việc là bắt buộc');
  const pos = (await get('SELECT COALESCE(MAX(position),0)+1 AS p FROM task_lists WHERE project_id = ?', p.id)).p;
  await run('INSERT INTO task_lists(project_id, name, position) VALUES (?,?,?)', p.id, name, pos);
  return c.json(await projectLists(p.id), 201);
});
r.put('/projects/:id/lists/:lid', async (c) => {
  const p = await memberProject(c);
  const b = await jsonBody(c);
  await run('UPDATE task_lists SET name = COALESCE(?, name), position = COALESCE(?, position) WHERE id = ? AND project_id = ?',
    b.name?.trim() || null, toInt(b.position), toInt(c.req.param('lid')), p.id);
  return c.json(await projectLists(p.id));
});
r.delete('/projects/:id/lists/:lid', async (c) => {
  const p = await managedProject(c);
  await run('DELETE FROM task_lists WHERE id = ? AND project_id = ?', toInt(c.req.param('lid')), p.id);
  return c.json(await projectLists(p.id));
});

r.get('/projects/:id/activity', async (c) => {
  const p = await memberProject(c);
  return c.json(await all(`SELECT l.*, u.name AS user_name, u.color AS user_color, t.title AS task_title FROM activity_logs l
    LEFT JOIN users u ON u.id = l.user_id JOIN tasks t ON t.id = l.entity_id
    WHERE l.entity_type = 'task' AND t.project_id = ? ORDER BY l.id DESC LIMIT 100`, p.id));
});

// ================================================================ members overview
r.get('/wework/members', async (c) => {
  const team = c.req.query('team') === '1';
  return c.json(await all(`SELECT u.id, u.name, u.username, u.color, u.title, u.email, d.name AS department_name, u.manager_id,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.parent_id IS NULL) AS total,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status IN ('todo','doing')) AS active,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status = 'done') AS done,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status IN ('todo','doing') AND date(t.due_date) < date(?)) AS overdue
    FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.active = 1
    ${team ? 'AND u.manager_id = ?' : ''}
    ORDER BY u.name COLLATE NOCASE`, today(), ...(team ? [c.get('user').id] : [])));
});

// ================================================================ goals (mục tiêu)
const clampPct = (v) => Math.min(100, Math.max(0, toInt(v, 0)));

/** Tiến độ mục tiêu tự tính = % công việc gắn kèm đã hoàn thành (nếu bật tự tính và có công việc). */
export async function refreshGoalProgress(...goalIds) {
  for (const gid of [...new Set(goalIds.filter(Boolean))]) {
    const x = await get(`SELECT g.auto_progress, (SELECT COUNT(*) FROM tasks t WHERE t.goal_id = g.id) AS n,
      (SELECT COUNT(*) FROM tasks t WHERE t.goal_id = g.id AND t.status = 'done') AS d FROM goals g WHERE g.id = ?`, gid);
    if (x?.auto_progress && x.n) await run('UPDATE goals SET progress = ? WHERE id = ?', Math.round((x.d / x.n) * 100), gid);
  }
}

const GOAL_SELECT = `SELECT g.*, (SELECT COUNT(*) FROM tasks t WHERE t.goal_id = g.id) AS task_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.goal_id = g.id AND t.status = 'done') AS task_done,
    (SELECT COUNT(*) FROM tasks t WHERE t.goal_id = g.id AND t.status IN ('todo','doing') AND t.due_date IS NOT NULL AND date(t.due_date) < date('now')) AS task_overdue
  FROM goals g`;
async function ownGoal(c) {
  const g = await get('SELECT * FROM goals WHERE id = ? AND user_id = ?', toInt(c.req.param('id')), c.get('user').id);
  if (!g) throw notFound('Mục tiêu không tồn tại');
  return g;
}

r.get('/goals', async (c) => c.json(await all(`${GOAL_SELECT} WHERE g.user_id = ? ORDER BY g.id DESC`, c.get('user').id)));
r.post('/goals', async (c) => {
  const b = await jsonBody(c);
  const title = String(b.title || '').trim();
  if (!title) throw badRequest('Tên mục tiêu là bắt buộc');
  const { lastId } = await run('INSERT INTO goals(user_id, title, progress, due_date, auto_progress, description) VALUES (?,?,?,?,?,?)',
    c.get('user').id, title, clampPct(b.progress), b.due_date || null, b.auto_progress === false ? 0 : 1, b.description || null);
  await linkGoalTasks(c.get('user'), lastId, idList(b.task_ids));
  return c.json(await get(`${GOAL_SELECT} WHERE g.id = ?`, lastId), 201);
});
r.put('/goals/:id', async (c) => {
  const g = await ownGoal(c);
  const b = await jsonBody(c);
  await run('UPDATE goals SET title = COALESCE(?, title), progress = COALESCE(?, progress), due_date = ?, auto_progress = ?, description = ? WHERE id = ?',
    b.title?.trim() || null, b.progress === undefined ? null : clampPct(b.progress),
    b.due_date === undefined ? g.due_date : b.due_date || null,
    b.auto_progress === undefined ? g.auto_progress : b.auto_progress ? 1 : 0,
    b.description === undefined ? g.description : b.description || null, g.id);
  await refreshGoalProgress(g.id);
  return c.json(await get(`${GOAL_SELECT} WHERE g.id = ?`, g.id));
});
r.delete('/goals/:id', async (c) => {
  const g = await ownGoal(c);
  await batch([['UPDATE tasks SET goal_id = NULL WHERE goal_id = ?', [g.id]], ['DELETE FROM goals WHERE id = ?', [g.id]]]);
  return c.json({ ok: true });
});

/** Gắn công việc vào mục tiêu: công việc phải xem được và (người tạo / người thực hiện / quản lý) được sửa. */
async function linkGoalTasks(user, goalId, ids) {
  let n = 0;
  const old = [];
  for (const id of ids) {
    const t = await get('SELECT * FROM tasks WHERE id = ?', id);
    if (!t || !(await canViewTask(user, id)) || !(await canEditTask(user, t))) continue;
    if (t.goal_id === goalId) continue;
    if (t.goal_id) old.push(t.goal_id);
    await run("UPDATE tasks SET goal_id = ?, updated_at = datetime('now') WHERE id = ?", goalId, id);
    await logActivity('task', id, user.id, 'updated', 'Gắn vào mục tiêu');
    n++;
  }
  await refreshGoalProgress(goalId, ...old);
  return n;
}
r.get('/goals/:id/tasks', async (c) => {
  const g = await ownGoal(c);
  return c.json(await selectTasks(c.get('user'), `WHERE t.goal_id = ? ORDER BY CASE t.status WHEN 'done' THEN 1 ELSE 0 END, t.due_date IS NULL, t.due_date, t.id`, g.id));
});
r.post('/goals/:id/tasks', async (c) => {
  const g = await ownGoal(c);
  const n = await linkGoalTasks(c.get('user'), g.id, idList((await jsonBody(c)).task_ids));
  return c.json({ linked: n, goal: await get(`${GOAL_SELECT} WHERE g.id = ?`, g.id) });
});
r.delete('/goals/:id/tasks/:tid', async (c) => {
  const g = await ownGoal(c);
  await run("UPDATE tasks SET goal_id = NULL, updated_at = datetime('now') WHERE id = ? AND goal_id = ?", toInt(c.req.param('tid')), g.id);
  await refreshGoalProgress(g.id);
  return c.json(await get(`${GOAL_SELECT} WHERE g.id = ?`, g.id));
});

// ================================================================ custom filters
r.get('/filters', async (c) => c.json(await all('SELECT * FROM custom_filters WHERE user_id = ? AND app = ? ORDER BY id',
  c.get('user').id, c.req.query('app') || 'wework')));
r.post('/filters', async (c) => {
  const b = await jsonBody(c);
  const name = String(b.name || '').trim();
  if (!name) throw badRequest('Tên bộ lọc là bắt buộc');
  const query = typeof b.query === 'string' ? b.query : JSON.stringify(b.query || {});
  const { lastId } = await run('INSERT INTO custom_filters(user_id, app, name, query) VALUES (?,?,?,?)', c.get('user').id, b.app || 'wework', name, query);
  return c.json(await get('SELECT * FROM custom_filters WHERE id = ?', lastId), 201);
});
r.delete('/filters/:id', async (c) => {
  await run('DELETE FROM custom_filters WHERE id = ? AND user_id = ?', toInt(c.req.param('id')), c.get('user').id);
  return c.json({ ok: true });
});

// ================================================================ global search
r.get('/search', async (c) => {
  const user = c.get('user');
  const q = String(c.req.query('q') || '').trim();
  if (!q) return c.json({ tasks: [], projects: [], users: [] });
  const like = `%${q}%`;
  const vis = taskVisibilitySql(user);
  const pv = projectVisibility(user);
  return c.json({
    tasks: await all(`SELECT t.id, t.title, t.status, p.name AS project_name FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
      WHERE ${vis.sql} AND t.title LIKE ? ORDER BY t.updated_at DESC LIMIT 8`, ...vis.params, like),
    projects: await all(`SELECT p.id, p.name, p.kind, p.color FROM projects p WHERE ${pv.sql} AND p.is_template = 0 AND p.name LIKE ? LIMIT 5`, ...pv.params, like),
    users: await all('SELECT id, name, color, title FROM users WHERE active = 1 AND name LIKE ? LIMIT 5', like),
  });
});

export default r;
