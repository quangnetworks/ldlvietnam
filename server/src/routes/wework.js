import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, tx, logActivity, notify, UPLOAD_DIR } from '../db.js';
import { requireAuth } from '../auth.js';
import { badRequest, notFound, forbidden, toInt, idList, upload, fixName, paginate, today } from '../util.js';

const r = Router();
r.use(requireAuth);

const APP = 'wework';
export const TASK_STATUSES = ['todo', 'doing', 'review', 'done', 'failed'];
const PRIORITIES = ['normal', 'important', 'urgent'];
const STATUS_LABEL = { todo: 'Cần làm', doing: 'Đang làm', review: 'Chờ đánh giá', done: 'Hoàn thành', failed: 'Thất bại' };
const RECURRING = ['daily', 'weekly', 'monthly'];

// ================================================================ access helpers
const isAdmin = (u) => u.role === 'admin';

function projectRole(user, projectId) {
  if (!projectId) return null;
  const p = get('SELECT owner_id FROM projects WHERE id = ?', projectId);
  if (!p) return null;
  if (p.owner_id === user.id) return 'manager';
  const m = get('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?', projectId, user.id);
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

function canViewTask(user, id) {
  const v = taskVisibilitySql(user);
  return !!get(`SELECT 1 FROM tasks t WHERE t.id = ? AND ${v.sql}`, id, ...v.params);
}

function canEditTask(user, t) {
  return isAdmin(user) || t.creator_id === user.id || t.assignee_id === user.id || projectRole(user, t.project_id) === 'manager';
}

function loadTask(id) {
  const t = get('SELECT * FROM tasks WHERE id = ?', id);
  if (!t) throw notFound('Công việc không tồn tại');
  return t;
}

// ================================================================ task queries
const TASK_SELECT = `
  SELECT t.*, p.name AS project_name, p.color AS project_color, p.kind AS project_kind,
    a.name AS assignee_name, a.color AS assignee_color, a.username AS assignee_username,
    c.name AS creator_name, c.username AS creator_username, l.name AS list_name,
    (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id) AS subtask_count,
    (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id AND s.status = 'done') AS subtask_done,
    (SELECT COUNT(*) FROM task_checklist k WHERE k.task_id = t.id) AS checklist_count,
    (SELECT COUNT(*) FROM task_checklist k WHERE k.task_id = t.id AND k.done = 1) AS checklist_done,
    (SELECT COUNT(*) FROM task_comments cm WHERE cm.task_id = t.id) AS comment_count,
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

function buildTaskQuery(req) {
  const u = req.user;
  const q = req.query;
  const vis = taskVisibilitySql(u);
  const where = [vis.sql];
  const params = [...vis.params];

  // Phạm vi (scope)
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

  // Công việc con
  if (q.subtasks === 'none') where.push('t.parent_id IS NULL');
  else if (q.subtasks === 'only') where.push('t.parent_id IS NOT NULL');
  const parent = toInt(q.parent_id);
  if (parent) { where.push('t.parent_id = ?'); params.push(parent); }

  // Trạng thái
  if (q.status) {
    const parts = [];
    for (const s of String(q.status).split(',')) {
      if (TASK_STATUSES.includes(s)) { parts.push('t.status = ?'); params.push(s); }
      else if (s === 'active') parts.push("t.status IN ('todo','doing')");
      else if (s === 'unreviewed') parts.push("t.status IN ('todo','doing','review')");
      else if (s === 'overdue') { parts.push("(t.status IN ('todo','doing') AND t.due_date IS NOT NULL AND date(t.due_date) < date(?))"); params.push(today()); }
      else if (s === 'late') parts.push("(t.status = 'done' AND t.due_date IS NOT NULL AND date(t.completed_at) > date(t.due_date))");
      else if (s === 'urgent') parts.push("t.priority = 'urgent'");
      else if (s === 'important') parts.push("t.priority = 'important'");
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
    due: "CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date ASC, t.id DESC",
    position: 't.position ASC, t.id ASC',
    title: 't.title COLLATE NOCASE',
  };
  return { where: where.join(' AND '), params, order: sorts[q.sort] || sorts.updated };
}

r.get('/tasks', (req, res) => {
  const { where, params, order } = buildTaskQuery(req);
  const { page, limit, offset } = paginate(req, 50);
  const total = get(`SELECT COUNT(*) AS c FROM tasks t WHERE ${where}`, ...params).c;
  const items = all(`${TASK_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    req.user.id, req.user.id, ...params, limit, offset).map(decorateTask);
  res.json({ items, total, page, limit });
});

// ================================================================ dashboard / summary
r.get('/wework/summary', (req, res) => {
  const u = req.user;
  const uid = toInt(req.query.user_id) || u.id;
  const s = get(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status IN ('todo','doing') AND due_date IS NOT NULL AND date(due_date) < date(?) THEN 1 ELSE 0 END) AS overdue,
      SUM(CASE WHEN status IN ('todo','doing') THEN 1 ELSE 0 END) AS active
    FROM tasks WHERE assignee_id = ? AND parent_id IS NULL`, today(), uid);
  const newAssigned = all(`${TASK_SELECT} WHERE t.assignee_id = ? AND t.status IN ('todo','doing')
    ORDER BY t.created_at DESC LIMIT 5`, u.id, u.id, uid).map(decorateTask);
  const newCreated = all(`${TASK_SELECT} WHERE t.creator_id = ? AND IFNULL(t.assignee_id,0) <> ?
    ORDER BY t.created_at DESC LIMIT 5`, u.id, u.id, uid, uid).map(decorateTask);
  const urgent = all(`${TASK_SELECT} WHERE t.assignee_id = ? AND t.status IN ('todo','doing')
    AND (t.priority IN ('urgent','important') OR (t.due_date IS NOT NULL AND date(t.due_date) <= date(?, '+2 day')))
    ORDER BY t.due_date LIMIT 5`, u.id, u.id, uid, today()).map(decorateTask);
  res.json({
    total: s.total || 0, done: s.done || 0, overdue: s.overdue || 0, active: s.active || 0,
    rate: s.total ? Math.round(((s.done || 0) / s.total) * 10000) / 100 : 0,
    new_assigned: newAssigned, new_created: newCreated, alerts: urgent,
    goals: all('SELECT * FROM goals WHERE user_id = ? ORDER BY id DESC', uid),
    team: all(`SELECT u.id, u.name, u.color, u.title,
        (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status IN ('todo','doing')) AS active,
        (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status IN ('todo','doing') AND date(t.due_date) < date(?)) AS overdue
      FROM users u WHERE u.manager_id = ? AND u.active = 1 ORDER BY u.name`, today(), u.id),
  });
});

r.get('/wework/reports', (req, res) => {
  const vis = taskVisibilitySql(req.user);
  const where = [vis.sql, 't.parent_id IS NULL'];
  const params = [...vis.params];
  const pid = toInt(req.query.project_id);
  if (pid) { where.push('t.project_id = ?'); params.push(pid); }
  if (req.query.from) { where.push('date(t.created_at) >= date(?)'); params.push(req.query.from); }
  if (req.query.to) { where.push('date(t.created_at) <= date(?)'); params.push(req.query.to); }
  const w = where.join(' AND ');
  const td = today();
  const byStatus = all(`SELECT t.status, COUNT(*) AS c FROM tasks t WHERE ${w} GROUP BY t.status`, ...params);
  const overdue = get(`SELECT COUNT(*) AS c FROM tasks t WHERE ${w} AND t.status IN ('todo','doing') AND date(t.due_date) < date(?)`, ...params, td).c;
  const late = get(`SELECT COUNT(*) AS c FROM tasks t WHERE ${w} AND t.status = 'done' AND date(t.completed_at) > date(t.due_date)`, ...params).c;
  const byMember = all(`SELECT u.id, u.name, u.color, COUNT(t.id) AS total,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN t.status IN ('todo','doing') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN t.status IN ('todo','doing') AND date(t.due_date) < date(?) THEN 1 ELSE 0 END) AS overdue,
      SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM tasks t JOIN users u ON u.id = t.assignee_id WHERE ${w} GROUP BY u.id ORDER BY total DESC`, td, ...params);
  const byProject = all(`SELECT p.id, p.name, p.color, COUNT(t.id) AS total,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN t.status IN ('todo','doing') AND date(t.due_date) < date(?) THEN 1 ELSE 0 END) AS overdue
    FROM tasks t JOIN projects p ON p.id = t.project_id WHERE ${w} GROUP BY p.id ORDER BY total DESC`, td, ...params);
  const trend = all(`SELECT date(t.completed_at) AS day, COUNT(*) AS c FROM tasks t
    WHERE ${w} AND t.status = 'done' AND date(t.completed_at) >= date(?, '-29 day') GROUP BY day ORDER BY day`, ...params, td);
  const createdTrend = all(`SELECT date(t.created_at) AS day, COUNT(*) AS c FROM tasks t
    WHERE ${w} AND date(t.created_at) >= date(?, '-29 day') GROUP BY day ORDER BY day`, ...params, td);
  res.json({ by_status: byStatus, overdue, late, by_member: byMember, by_project: byProject, done_trend: trend, created_trend: createdTrend });
});

// ================================================================ task detail
function fullTask(id, user) {
  const t = decorateTask(get(`${TASK_SELECT} WHERE t.id = ?`, user.id, user.id, id));
  t.followers = all('SELECT u.id, u.name, u.color FROM task_followers f JOIN users u ON u.id = f.user_id WHERE f.task_id = ? ORDER BY u.name', id);
  t.checklist = all('SELECT * FROM task_checklist WHERE task_id = ? ORDER BY position, id', id);
  t.subtasks = all(`${TASK_SELECT} WHERE t.parent_id = ? ORDER BY t.position, t.id`, user.id, user.id, id).map(decorateTask);
  t.attachments = all(`SELECT a.id, a.original_name, a.mime, a.size, a.created_at, u.name AS user_name FROM task_attachments a
    LEFT JOIN users u ON u.id = a.user_id WHERE a.task_id = ? ORDER BY a.id`, id);
  t.parent = t.parent_id ? get('SELECT id, title FROM tasks WHERE id = ?', t.parent_id) : null;
  t.can_edit = canEditTask(user, t);
  return t;
}

r.get('/tasks/:id', (req, res) => {
  const id = toInt(req.params.id);
  loadTask(id);
  if (!canViewTask(req.user, id)) throw forbidden('Bạn không có quyền xem công việc này');
  res.json(fullTask(id, req.user));
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
  if (b.goal_id !== undefined) out.goal_id = toInt(b.goal_id);
  const s = out.start_date, d = out.due_date;
  if (s && d && s.slice(0, 10) > d.slice(0, 10)) throw badRequest('Thời hạn phải sau ngày bắt đầu');
  return out;
}

function checkProjectAccess(user, projectId) {
  if (!projectId) return;
  if (!get('SELECT 1 FROM projects WHERE id = ?', projectId)) throw badRequest('Dự án không tồn tại');
  if (!projectRole(user, projectId)) throw forbidden('Bạn không phải thành viên dự án này');
}

export function createTask(user, data, followers = []) {
  checkProjectAccess(user, data.project_id);
  if (data.parent_id) {
    const parent = get('SELECT * FROM tasks WHERE id = ?', data.parent_id);
    if (!parent) throw badRequest('Công việc cha không tồn tại');
    data.project_id ??= parent.project_id;
    data.list_id ??= parent.list_id;
  }
  if (data.list_id && data.project_id) {
    const l = get('SELECT project_id FROM task_lists WHERE id = ?', data.list_id);
    if (!l || l.project_id !== data.project_id) data.list_id = null;
  }
  const pos = get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM tasks WHERE IFNULL(project_id,0) = IFNULL(?,0)', data.project_id ?? null).p;
  const info = run(
    `INSERT INTO tasks(project_id, list_id, parent_id, title, description, creator_id, assignee_id, status, priority,
      start_date, due_date, recurring, position, goal_id, completed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    data.project_id ?? null, data.list_id ?? null, data.parent_id ?? null, data.title, data.description ?? null,
    user.id, data.assignee_id ?? user.id, data.status ?? 'todo', data.priority ?? 'normal',
    data.start_date ?? null, data.due_date ?? null, data.recurring ?? null, data.position ?? pos, data.goal_id ?? null,
    data.status === 'done' ? new Date().toISOString() : null
  );
  const id = Number(info.lastInsertRowid);
  for (const f of new Set(followers)) run('INSERT OR IGNORE INTO task_followers(task_id, user_id) VALUES (?,?)', id, f);
  logActivity('task', id, user.id, 'created', 'Tạo công việc');
  const assignee = data.assignee_id ?? user.id;
  notify(assignee, { actorId: user.id, app: APP, type: 'assigned',
    title: `${user.name} đã giao cho bạn công việc "${data.title}"`, link: `/wework/task/${id}` });
  notify(followers, { actorId: user.id, app: APP, type: 'follow',
    title: `Bạn được thêm theo dõi công việc "${data.title}"`, link: `/wework/task/${id}` });
  return id;
}

r.post('/tasks', (req, res) => {
  const data = parseTaskBody(req.body || {}, false);
  const id = tx(() => createTask(req.user, data, idList(req.body?.followers)));
  res.status(201).json(fullTask(id, req.user));
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

function applyTaskUpdate(user, t, data) {
  const fields = Object.keys(data);
  if (!fields.length) return;
  if (data.project_id !== undefined && data.project_id !== t.project_id) {
    checkProjectAccess(user, data.project_id);
    if (data.list_id === undefined) data.list_id = null;
  }
  if (data.parent_id !== undefined && data.parent_id === t.id) throw badRequest('Công việc cha không hợp lệ');
  const start = data.start_date !== undefined ? data.start_date : t.start_date;
  const due = data.due_date !== undefined ? data.due_date : t.due_date;
  if (start && due && start.slice(0, 10) > due.slice(0, 10)) throw badRequest('Thời hạn phải sau ngày bắt đầu');

  const sets = Object.keys(data).map((k) => `${k} = ?`);
  const vals = Object.keys(data).map((k) => data[k]);
  if (data.status !== undefined && data.status !== t.status) {
    sets.push('completed_at = ?');
    vals.push(data.status === 'done' ? new Date().toISOString() : null);
  }
  run(`UPDATE tasks SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...vals, t.id);

  const changes = [];
  if (data.status !== undefined && data.status !== t.status) {
    changes.push(`Trạng thái: ${STATUS_LABEL[t.status]} → ${STATUS_LABEL[data.status]}`);
    const watchers = all('SELECT user_id FROM task_followers WHERE task_id = ?', t.id).map((x) => x.user_id);
    notify([t.creator_id, t.assignee_id, ...watchers], { actorId: user.id, app: APP, type: 'status',
      title: `${user.name} đã chuyển "${t.title}" sang ${STATUS_LABEL[data.status]}`, link: `/wework/task/${t.id}` });
    // Công việc lặp lại: tạo kỳ tiếp theo khi hoàn thành
    const recurring = data.recurring !== undefined ? data.recurring : t.recurring;
    if (data.status === 'done' && recurring) {
      const next = { ...t, ...data };
      const nid = createTask(user, {
        project_id: next.project_id, list_id: next.list_id, parent_id: next.parent_id, title: next.title,
        description: next.description, assignee_id: next.assignee_id, priority: next.priority,
        start_date: shiftDate(next.start_date, recurring), due_date: shiftDate(next.due_date, recurring),
        recurring, goal_id: next.goal_id,
      }, all('SELECT user_id FROM task_followers WHERE task_id = ?', t.id).map((x) => x.user_id));
      run('UPDATE tasks SET recurring = NULL WHERE id = ?', t.id);
      logActivity('task', t.id, user.id, 'recurring', `Tạo kỳ lặp tiếp theo #${nid}`);
    }
  }
  if (data.assignee_id !== undefined && data.assignee_id !== t.assignee_id) {
    const nu = data.assignee_id ? get('SELECT name FROM users WHERE id = ?', data.assignee_id) : null;
    changes.push(`Người thực hiện: ${nu?.name || 'Không có'}`);
    notify(data.assignee_id, { actorId: user.id, app: APP, type: 'assigned',
      title: `${user.name} đã giao cho bạn công việc "${data.title || t.title}"`, link: `/wework/task/${t.id}` });
  }
  if (data.due_date !== undefined && data.due_date !== t.due_date) changes.push(`Thời hạn: ${data.due_date || 'Không có'}`);
  if (data.start_date !== undefined && data.start_date !== t.start_date) changes.push(`Ngày bắt đầu: ${data.start_date || 'Không có'}`);
  if (data.priority !== undefined && data.priority !== t.priority) changes.push(`Ưu tiên: ${data.priority}`);
  if (data.title !== undefined && data.title !== t.title) changes.push(`Đổi tên: ${data.title}`);
  if (data.description !== undefined && data.description !== t.description) changes.push('Cập nhật mô tả');
  if (data.project_id !== undefined && data.project_id !== t.project_id) changes.push('Chuyển dự án');
  if (data.list_id !== undefined && data.list_id !== t.list_id) changes.push('Chuyển nhóm công việc');
  if (changes.length) logActivity('task', t.id, user.id, 'updated', changes.join('; '));
}

r.put('/tasks/:id', (req, res) => {
  const id = toInt(req.params.id);
  const t = loadTask(id);
  if (!canViewTask(req.user, id)) throw forbidden();
  if (!canEditTask(req.user, t)) throw forbidden('Bạn không có quyền chỉnh sửa công việc này');
  const data = parseTaskBody(req.body || {}, true);
  tx(() => {
    applyTaskUpdate(req.user, t, data);
    if (req.body?.followers !== undefined) {
      run('DELETE FROM task_followers WHERE task_id = ?', id);
      for (const f of idList(req.body.followers)) run('INSERT OR IGNORE INTO task_followers(task_id, user_id) VALUES (?,?)', id, f);
    }
  });
  res.json(fullTask(id, req.user));
});

r.delete('/tasks/:id', (req, res) => {
  const id = toInt(req.params.id);
  const t = loadTask(id);
  if (!(isAdmin(req.user) || t.creator_id === req.user.id || projectRole(req.user, t.project_id) === 'manager')) {
    throw forbidden('Chỉ người tạo hoặc quản lý dự án mới được xóa công việc');
  }
  const files = all('SELECT filename FROM task_attachments WHERE task_id = ?', id);
  run('DELETE FROM tasks WHERE id = ?', id);
  for (const f of files) fs.rm(path.join(UPLOAD_DIR, f.filename), () => {});
  res.json({ ok: true });
});

r.post('/tasks/bulk', (req, res) => {
  const ids = idList(req.body?.ids);
  const action = req.body?.action;
  let affected = 0;
  tx(() => {
    for (const id of ids) {
      const t = get('SELECT * FROM tasks WHERE id = ?', id);
      if (!t || !canViewTask(req.user, id)) continue;
      if (action === 'delete') {
        if (!(isAdmin(req.user) || t.creator_id === req.user.id || projectRole(req.user, t.project_id) === 'manager')) continue;
        run('DELETE FROM tasks WHERE id = ?', id); affected++;
      } else if (action === 'star') {
        run('INSERT OR IGNORE INTO task_stars(task_id, user_id) VALUES (?,?)', id, req.user.id); affected++;
      } else if (action === 'follow') {
        run('INSERT OR IGNORE INTO task_followers(task_id, user_id) VALUES (?,?)', id, req.user.id); affected++;
      } else if (action === 'update' && canEditTask(req.user, t)) {
        const data = parseTaskBody(req.body.data || {}, true);
        applyTaskUpdate(req.user, t, data); affected++;
      }
    }
  });
  res.json({ affected });
});

const toggleTask = (table) => (req, res) => {
  const id = toInt(req.params.id);
  loadTask(id);
  if (!canViewTask(req.user, id)) throw forbidden();
  const exists = get(`SELECT 1 FROM ${table} WHERE task_id = ? AND user_id = ?`, id, req.user.id);
  if (exists) run(`DELETE FROM ${table} WHERE task_id = ? AND user_id = ?`, id, req.user.id);
  else run(`INSERT INTO ${table}(task_id, user_id) VALUES (?,?)`, id, req.user.id);
  res.json({ active: !exists });
};
r.post('/tasks/:id/star', toggleTask('task_stars'));
r.post('/tasks/:id/follow', toggleTask('task_followers'));

// ---------------- checklist
r.post('/tasks/:id/checklist', (req, res) => {
  const id = toInt(req.params.id);
  const t = loadTask(id);
  if (!canEditTask(req.user, t)) throw forbidden();
  const content = String(req.body?.content || '').trim();
  if (!content) throw badRequest('Nội dung trống');
  const pos = get('SELECT COALESCE(MAX(position),0)+1 AS p FROM task_checklist WHERE task_id = ?', id).p;
  run('INSERT INTO task_checklist(task_id, content, position) VALUES (?,?,?)', id, content, pos);
  res.status(201).json(all('SELECT * FROM task_checklist WHERE task_id = ? ORDER BY position, id', id));
});
r.put('/tasks/:id/checklist/:cid', (req, res) => {
  const id = toInt(req.params.id);
  const t = loadTask(id);
  if (!canEditTask(req.user, t)) throw forbidden();
  const b = req.body || {};
  run('UPDATE task_checklist SET content = COALESCE(?, content), done = COALESCE(?, done) WHERE id = ? AND task_id = ?',
    b.content?.trim() || null, b.done === undefined ? null : b.done ? 1 : 0, toInt(req.params.cid), id);
  res.json(all('SELECT * FROM task_checklist WHERE task_id = ? ORDER BY position, id', id));
});
r.delete('/tasks/:id/checklist/:cid', (req, res) => {
  const id = toInt(req.params.id);
  const t = loadTask(id);
  if (!canEditTask(req.user, t)) throw forbidden();
  run('DELETE FROM task_checklist WHERE id = ? AND task_id = ?', toInt(req.params.cid), id);
  res.json(all('SELECT * FROM task_checklist WHERE task_id = ? ORDER BY position, id', id));
});

// ---------------- comments & activity
r.get('/tasks/:id/comments', (req, res) => {
  const id = toInt(req.params.id);
  if (!canViewTask(req.user, id)) throw forbidden();
  res.json(all(`SELECT c.*, u.name AS user_name, u.color AS user_color FROM task_comments c
    LEFT JOIN users u ON u.id = c.user_id WHERE c.task_id = ? ORDER BY c.id`, id));
});
r.post('/tasks/:id/comments', (req, res) => {
  const id = toInt(req.params.id);
  const t = loadTask(id);
  if (!canViewTask(req.user, id)) throw forbidden();
  const content = String(req.body?.content || '').trim();
  if (!content) throw badRequest('Nội dung bình luận trống');
  const info = run('INSERT INTO task_comments(task_id, user_id, content) VALUES (?,?,?)', id, req.user.id, content);
  const watchers = all('SELECT user_id FROM task_followers WHERE task_id = ?', id).map((x) => x.user_id);
  // @mention: @username
  const mentioned = [...content.matchAll(/@([\w.]+)/g)].map((m) => get('SELECT id FROM users WHERE username = ?', m[1])?.id).filter(Boolean);
  notify([t.creator_id, t.assignee_id, ...watchers, ...mentioned], { actorId: req.user.id, app: APP, type: 'comment',
    title: `${req.user.name} đã bình luận trong "${t.title}"`, link: `/wework/task/${id}` });
  run("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?", id);
  res.status(201).json(get(`SELECT c.*, u.name AS user_name, u.color AS user_color FROM task_comments c
    LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?`, Number(info.lastInsertRowid)));
});
r.delete('/tasks/:id/comments/:cid', (req, res) => {
  const c = get('SELECT * FROM task_comments WHERE id = ? AND task_id = ?', toInt(req.params.cid), toInt(req.params.id));
  if (!c) throw notFound();
  if (c.user_id !== req.user.id && !isAdmin(req.user)) throw forbidden();
  run('DELETE FROM task_comments WHERE id = ?', c.id);
  res.json({ ok: true });
});
r.get('/tasks/:id/activity', (req, res) => {
  const id = toInt(req.params.id);
  if (!canViewTask(req.user, id)) throw forbidden();
  res.json(all(`SELECT l.*, u.name AS user_name, u.color AS user_color FROM activity_logs l LEFT JOIN users u ON u.id = l.user_id
    WHERE l.entity_type = 'task' AND l.entity_id = ? ORDER BY l.id DESC`, id));
});

// ---------------- attachments
r.post('/tasks/:id/attachments', upload.array('files'), (req, res) => {
  const id = toInt(req.params.id);
  loadTask(id);
  if (!canViewTask(req.user, id)) throw forbidden();
  for (const f of req.files || []) {
    run('INSERT INTO task_attachments(task_id, filename, original_name, mime, size, user_id) VALUES (?,?,?,?,?,?)',
      id, f.filename, fixName(f.originalname), f.mimetype, f.size, req.user.id);
  }
  if (req.files?.length) logActivity('task', id, req.user.id, 'attached', `Đính kèm ${req.files.length} tệp`);
  res.status(201).json(fullTask(id, req.user).attachments);
});
r.get('/tasks/:id/attachments/:aid', (req, res) => {
  const id = toInt(req.params.id);
  if (!canViewTask(req.user, id)) throw forbidden();
  const a = get('SELECT * FROM task_attachments WHERE id = ? AND task_id = ?', toInt(req.params.aid), id);
  if (!a) throw notFound('Tệp không tồn tại');
  res.download(path.join(UPLOAD_DIR, a.filename), a.original_name);
});
r.delete('/tasks/:id/attachments/:aid', (req, res) => {
  const id = toInt(req.params.id);
  const t = loadTask(id);
  const a = get('SELECT * FROM task_attachments WHERE id = ? AND task_id = ?', toInt(req.params.aid), id);
  if (!a) throw notFound();
  if (a.user_id !== req.user.id && !canEditTask(req.user, t)) throw forbidden();
  run('DELETE FROM task_attachments WHERE id = ?', a.id);
  fs.rm(path.join(UPLOAD_DIR, a.filename), () => {});
  res.json({ ok: true });
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

r.get('/projects', (req, res) => {
  // Mẫu dự án dùng chung cho toàn công ty
  const v = req.query.template === '1' ? { sql: '1=1', params: [] } : projectVisibility(req.user);
  const where = [v.sql];
  const params = [...v.params];
  if (req.query.kind) { where.push('p.kind = ?'); params.push(req.query.kind); }
  where.push(req.query.template === '1' ? 'p.is_template = 1' : 'p.is_template = 0');
  if (req.query.status) { where.push('p.status = ?'); params.push(req.query.status); }
  else if (req.query.template !== '1') where.push("p.status = 'active'");
  if (req.query.q) { where.push('p.name LIKE ?'); params.push(`%${req.query.q}%`); }
  const order = req.query.sort === 'name' ? 'p.name COLLATE NOCASE' : 'p.created_at DESC';
  res.json(all(`${PROJECT_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order}`, ...params));
});

function fullProject(id, user) {
  const p = get(`${PROJECT_SELECT} WHERE p.id = ?`, id);
  p.members = all(`SELECT u.id, u.name, u.color, u.title, u.username, m.role FROM project_members m JOIN users u ON u.id = m.user_id
    WHERE m.project_id = ? ORDER BY m.role, u.name`, id);
  p.lists = all('SELECT * FROM task_lists WHERE project_id = ? ORDER BY position, id', id);
  p.my_role = projectRole(user, id);
  return p;
}

r.get('/projects/:id', (req, res) => {
  const id = toInt(req.params.id);
  if (!get('SELECT 1 FROM projects WHERE id = ?', id)) throw notFound('Dự án không tồn tại');
  if (!projectRole(req.user, id)) throw forbidden('Bạn không phải thành viên dự án này');
  res.json(fullProject(id, req.user));
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
  if (b.owner_id !== undefined) out.owner_id = toInt(b.owner_id);
  if (b.is_template !== undefined) out.is_template = b.is_template ? 1 : 0;
  return out;
}

function copyProjectContent(fromId, toId, user) {
  const listMap = {};
  for (const l of all('SELECT * FROM task_lists WHERE project_id = ? ORDER BY position', fromId)) {
    const info = run('INSERT INTO task_lists(project_id, name, position) VALUES (?,?,?)', toId, l.name, l.position);
    listMap[l.id] = Number(info.lastInsertRowid);
  }
  const taskMap = {};
  const tasks = all('SELECT * FROM tasks WHERE project_id = ? ORDER BY parent_id IS NOT NULL, id', fromId);
  for (const t of tasks) {
    const info = run(`INSERT INTO tasks(project_id, list_id, parent_id, title, description, creator_id, assignee_id, status, priority, position)
      VALUES (?,?,?,?,?,?,?, 'todo', ?, ?)`, toId, listMap[t.list_id] ?? null, taskMap[t.parent_id] ?? null,
      t.title, t.description, user.id, user.id, t.priority, t.position);
    taskMap[t.id] = Number(info.lastInsertRowid);
    for (const c of all('SELECT * FROM task_checklist WHERE task_id = ?', t.id)) {
      run('INSERT INTO task_checklist(task_id, content, position) VALUES (?,?,?)', taskMap[t.id], c.content, c.position);
    }
  }
}

r.post('/projects', (req, res) => {
  const b = req.body || {};
  const data = parseProject(b, false);
  const id = tx(() => {
    const info = run(`INSERT INTO projects(name, kind, description, color, owner_id, department_id, group_name, is_template, start_date, end_date)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, data.name, data.kind || 'project', data.description ?? null, data.color || '#2d7ff9',
      req.user.id, data.department_id ?? null, data.group_name ?? null, data.is_template ?? 0, data.start_date ?? null, data.end_date ?? null);
    const pid = Number(info.lastInsertRowid);
    run("INSERT INTO project_members(project_id, user_id, role) VALUES (?,?, 'manager')", pid, req.user.id);
    for (const m of idList(b.members)) run("INSERT OR IGNORE INTO project_members(project_id, user_id, role) VALUES (?,?, 'member')", pid, m);
    for (const m of idList(b.managers)) {
      run("INSERT INTO project_members(project_id, user_id, role) VALUES (?,?, 'manager') ON CONFLICT DO UPDATE SET role = 'manager'", pid, m);
    }
    const tpl = toInt(b.template_id);
    if (tpl) {
      if (!get('SELECT 1 FROM projects WHERE id = ? AND is_template = 1', tpl)) throw badRequest('Mẫu không tồn tại');
      copyProjectContent(tpl, pid, req.user);
    } else {
      const lists = Array.isArray(b.lists) && b.lists.length ? b.lists : ['Cần làm', 'Đang làm', 'Hoàn thành'];
      lists.forEach((n, i) => run('INSERT INTO task_lists(project_id, name, position) VALUES (?,?,?)', pid, String(n), i + 1));
    }
    notify(idList(b.members), { actorId: req.user.id, app: APP, type: 'project',
      title: `${req.user.name} đã thêm bạn vào ${data.kind === 'department' ? 'phòng ban' : 'dự án'} "${data.name}"`, link: `/wework/project/${pid}` });
    logActivity('project', pid, req.user.id, 'created', 'Tạo dự án');
    return pid;
  });
  res.status(201).json(fullProject(id, req.user));
});

r.post('/projects/:id/save-template', (req, res) => {
  const id = toInt(req.params.id);
  const p = get('SELECT * FROM projects WHERE id = ?', id);
  if (!p) throw notFound();
  if (projectRole(req.user, id) !== 'manager') throw forbidden();
  const nid = tx(() => {
    const info = run(`INSERT INTO projects(name, kind, description, color, owner_id, is_template) VALUES (?,?,?,?,?,1)`,
      req.body?.name || `Mẫu - ${p.name}`, p.kind, p.description, p.color, req.user.id);
    const tid = Number(info.lastInsertRowid);
    run("INSERT INTO project_members(project_id, user_id, role) VALUES (?,?, 'manager')", tid, req.user.id);
    copyProjectContent(id, tid, req.user);
    return tid;
  });
  res.status(201).json(fullProject(nid, req.user));
});

r.put('/projects/:id', (req, res) => {
  const id = toInt(req.params.id);
  if (!get('SELECT 1 FROM projects WHERE id = ?', id)) throw notFound();
  if (projectRole(req.user, id) !== 'manager') throw forbidden('Chỉ quản lý dự án mới được chỉnh sửa');
  const data = parseProject(req.body || {}, true);
  const keys = Object.keys(data);
  if (keys.length) run(`UPDATE projects SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => data[k]), id);
  logActivity('project', id, req.user.id, 'updated', 'Cập nhật dự án');
  res.json(fullProject(id, req.user));
});

r.delete('/projects/:id', (req, res) => {
  const id = toInt(req.params.id);
  const p = get('SELECT * FROM projects WHERE id = ?', id);
  if (!p) throw notFound();
  if (!(isAdmin(req.user) || p.owner_id === req.user.id)) throw forbidden('Chỉ chủ dự án mới được xóa');
  run('DELETE FROM projects WHERE id = ?', id);
  res.json({ ok: true });
});

r.put('/projects/:id/members', (req, res) => {
  const id = toInt(req.params.id);
  const p = get('SELECT * FROM projects WHERE id = ?', id);
  if (!p) throw notFound();
  if (projectRole(req.user, id) !== 'manager') throw forbidden();
  const members = Array.isArray(req.body?.members) ? req.body.members : [];
  const before = new Set(all('SELECT user_id FROM project_members WHERE project_id = ?', id).map((x) => x.user_id));
  tx(() => {
    run('DELETE FROM project_members WHERE project_id = ?', id);
    for (const m of members) {
      const uid = toInt(m.user_id ?? m.id);
      if (!uid) continue;
      run('INSERT OR REPLACE INTO project_members(project_id, user_id, role) VALUES (?,?,?)', id, uid, m.role === 'manager' ? 'manager' : 'member');
    }
    if (p.owner_id) run("INSERT OR REPLACE INTO project_members(project_id, user_id, role) VALUES (?,?, 'manager')", id, p.owner_id);
  });
  const added = members.map((m) => toInt(m.user_id ?? m.id)).filter((x) => x && !before.has(x));
  notify(added, { actorId: req.user.id, app: APP, type: 'project',
    title: `${req.user.name} đã thêm bạn vào "${p.name}"`, link: `/wework/project/${id}` });
  res.json(fullProject(id, req.user));
});

// ---------------- task lists (nhóm công việc)
r.post('/projects/:id/lists', (req, res) => {
  const id = toInt(req.params.id);
  if (!projectRole(req.user, id)) throw forbidden();
  const name = String(req.body?.name || '').trim();
  if (!name) throw badRequest('Tên nhóm công việc là bắt buộc');
  const pos = get('SELECT COALESCE(MAX(position),0)+1 AS p FROM task_lists WHERE project_id = ?', id).p;
  run('INSERT INTO task_lists(project_id, name, position) VALUES (?,?,?)', id, name, pos);
  res.status(201).json(all('SELECT * FROM task_lists WHERE project_id = ? ORDER BY position, id', id));
});
r.put('/projects/:id/lists/:lid', (req, res) => {
  const id = toInt(req.params.id);
  if (!projectRole(req.user, id)) throw forbidden();
  const b = req.body || {};
  run('UPDATE task_lists SET name = COALESCE(?, name), position = COALESCE(?, position) WHERE id = ? AND project_id = ?',
    b.name?.trim() || null, toInt(b.position), toInt(req.params.lid), id);
  res.json(all('SELECT * FROM task_lists WHERE project_id = ? ORDER BY position, id', id));
});
r.delete('/projects/:id/lists/:lid', (req, res) => {
  const id = toInt(req.params.id);
  if (projectRole(req.user, id) !== 'manager') throw forbidden();
  run('DELETE FROM task_lists WHERE id = ? AND project_id = ?', toInt(req.params.lid), id);
  res.json(all('SELECT * FROM task_lists WHERE project_id = ? ORDER BY position, id', id));
});

r.get('/projects/:id/activity', (req, res) => {
  const id = toInt(req.params.id);
  if (!projectRole(req.user, id)) throw forbidden();
  res.json(all(`SELECT l.*, u.name AS user_name, u.color AS user_color, t.title AS task_title FROM activity_logs l
    LEFT JOIN users u ON u.id = l.user_id JOIN tasks t ON t.id = l.entity_id
    WHERE l.entity_type = 'task' AND t.project_id = ? ORDER BY l.id DESC LIMIT 100`, id));
});

// ================================================================ members overview
r.get('/wework/members', (req, res) => {
  const td = today();
  res.json(all(`SELECT u.id, u.name, u.username, u.color, u.title, u.email, d.name AS department_name, u.manager_id,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.parent_id IS NULL) AS total,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status IN ('todo','doing')) AS active,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status = 'done') AS done,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status IN ('todo','doing') AND date(t.due_date) < date(?)) AS overdue
    FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.active = 1
    ${req.query.team === '1' ? 'AND u.manager_id = ?' : ''}
    ORDER BY u.name COLLATE NOCASE`, td, ...(req.query.team === '1' ? [req.user.id] : [])));
});

// ================================================================ goals
r.get('/goals', (req, res) => {
  res.json(all(`SELECT g.*, (SELECT COUNT(*) FROM tasks t WHERE t.goal_id = g.id) AS task_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.goal_id = g.id AND t.status = 'done') AS task_done
    FROM goals g WHERE g.user_id = ? ORDER BY g.id DESC`, req.user.id));
});
r.post('/goals', (req, res) => {
  const title = String(req.body?.title || '').trim();
  if (!title) throw badRequest('Tên mục tiêu là bắt buộc');
  const info = run('INSERT INTO goals(user_id, title, progress, due_date) VALUES (?,?,?,?)',
    req.user.id, title, Math.min(100, Math.max(0, toInt(req.body.progress, 0))), req.body.due_date || null);
  res.status(201).json(get('SELECT * FROM goals WHERE id = ?', Number(info.lastInsertRowid)));
});
r.put('/goals/:id', (req, res) => {
  const g = get('SELECT * FROM goals WHERE id = ? AND user_id = ?', toInt(req.params.id), req.user.id);
  if (!g) throw notFound();
  const b = req.body || {};
  run('UPDATE goals SET title = COALESCE(?, title), progress = COALESCE(?, progress), due_date = ? WHERE id = ?',
    b.title?.trim() || null, b.progress === undefined ? null : Math.min(100, Math.max(0, toInt(b.progress, 0))),
    b.due_date === undefined ? g.due_date : b.due_date || null, g.id);
  res.json(get('SELECT * FROM goals WHERE id = ?', g.id));
});
r.delete('/goals/:id', (req, res) => {
  run('DELETE FROM goals WHERE id = ? AND user_id = ?', toInt(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ================================================================ custom filters
r.get('/filters', (req, res) => {
  res.json(all('SELECT * FROM custom_filters WHERE user_id = ? AND app = ? ORDER BY id', req.user.id, req.query.app || 'wework'));
});
r.post('/filters', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) throw badRequest('Tên bộ lọc là bắt buộc');
  const query = typeof req.body.query === 'string' ? req.body.query : JSON.stringify(req.body.query || {});
  const info = run('INSERT INTO custom_filters(user_id, app, name, query) VALUES (?,?,?,?)', req.user.id, req.body.app || 'wework', name, query);
  res.status(201).json(get('SELECT * FROM custom_filters WHERE id = ?', Number(info.lastInsertRowid)));
});
r.delete('/filters/:id', (req, res) => {
  run('DELETE FROM custom_filters WHERE id = ? AND user_id = ?', toInt(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ================================================================ global search
r.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ tasks: [], projects: [], users: [] });
  const like = `%${q}%`;
  const vis = taskVisibilitySql(req.user);
  const pv = projectVisibility(req.user);
  res.json({
    tasks: all(`SELECT t.id, t.title, t.status, p.name AS project_name FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
      WHERE ${vis.sql} AND t.title LIKE ? ORDER BY t.updated_at DESC LIMIT 8`, ...vis.params, like),
    projects: all(`SELECT p.id, p.name, p.kind, p.color FROM projects p WHERE ${pv.sql} AND p.is_template = 0 AND p.name LIKE ? LIMIT 5`, ...pv.params, like),
    users: all('SELECT id, name, color, title FROM users WHERE active = 1 AND name LIKE ? LIMIT 5', like),
  });
});

export default r;
