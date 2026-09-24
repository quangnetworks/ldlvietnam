import { Hono } from 'hono';
import { all, get, run, batch, logActivity, notify } from '../db.js';
import { requireAdmin } from '../auth.js';
import {
  badRequest, notFound, forbidden, toInt, idList, paginate, jsonBody, formBody, storeFiles, removeFile, sendFile,
} from '../util.js';
import { fireRequestEvent } from './webhooks.js';
import { publicFileLink } from '../files.js';

const r = new Hono();
const APP = 'request';

export const FIELD_TYPES = ['text', 'textarea', 'number', 'money', 'date', 'select', 'checkbox', 'user'];
export const REQUEST_STATUS = {
  draft: 'Lưu nháp', pending: 'Chờ duyệt', approved: 'Đã chấp thuận', rejected: 'Đã từ chối', returned: 'Đã trả lại', cancelled: 'Đã huỷ',
};

// ================================================================ helpers
const isAdmin = (u) => u.role === 'admin';
const parseJson = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

function visibility(user) {
  if (isAdmin(user)) return { sql: '1=1', params: [] };
  return {
    sql: `(q.creator_id = ? OR EXISTS (SELECT 1 FROM request_approvers a WHERE a.request_id = q.id AND a.user_id = ?)
          OR EXISTS (SELECT 1 FROM request_followers f WHERE f.request_id = q.id AND f.user_id = ?))`,
    params: [user.id, user.id, user.id],
  };
}

/** SQL fragment: "it is this user's turn to act on q". */
const MY_TURN = `EXISTS (SELECT 1 FROM request_approvers a WHERE a.request_id = q.id AND a.user_id = ? AND a.status = 'pending'
  AND (q.flow = 'any' OR a.step = (SELECT MIN(step) FROM request_approvers x WHERE x.request_id = q.id AND x.status = 'pending')))`;

async function loadRequest(id) {
  const q = await get('SELECT * FROM requests WHERE id = ?', id);
  if (!q) throw notFound('Đề xuất không tồn tại');
  return q;
}

async function viewable(c) {
  const id = toInt(c.req.param('id'));
  const q = await loadRequest(id);
  const v = visibility(c.get('user'));
  if (!(await get(`SELECT 1 FROM requests q WHERE q.id = ? AND ${v.sql}`, id, ...v.params))) throw forbidden('Bạn không có quyền xem đề xuất này');
  return q;
}

const LIST_SELECT = `SELECT q.id, q.group_id, q.title, q.status, q.flow, q.creator_id, q.deadline_at, q.completed_at, q.created_at, q.updated_at,
    g.name AS group_name, g.category AS group_category, u.name AS creator_name, u.color AS creator_color, u.title AS creator_title,
    dep.name AS creator_department,
    (SELECT COUNT(*) FROM request_approvers a WHERE a.request_id = q.id) AS approver_count,
    (SELECT COUNT(*) FROM request_approvers a WHERE a.request_id = q.id AND a.status = 'approved') AS approved_count,
    (SELECT COUNT(*) FROM request_comments cm WHERE cm.request_id = q.id) AS comment_count,
    (SELECT COUNT(*) FROM request_attachments at WHERE at.request_id = q.id) AS attachment_count,
    EXISTS (SELECT 1 FROM request_stars s WHERE s.request_id = q.id AND s.user_id = ?) AS starred,
    ${MY_TURN} AS my_turn
  FROM requests q LEFT JOIN request_groups g ON g.id = q.group_id LEFT JOIN users u ON u.id = q.creator_id
  LEFT JOIN departments dep ON dep.id = u.department_id`;

function decorate(q) {
  q.starred = !!q.starred;
  q.my_turn = !!q.my_turn && q.status === 'pending';
  q.is_overdue = q.status === 'pending' && !!q.deadline_at && q.deadline_at < new Date().toISOString().replace('T', ' ').slice(0, 19);
  return q;
}

// ================================================================ list & counts
function buildList(user, p) {
  const v = visibility(user);
  const where = [v.sql];
  const params = [...v.params];
  switch (p.box) {
    case 'to_me': where.push('EXISTS (SELECT 1 FROM request_approvers a WHERE a.request_id = q.id AND a.user_id = ?)'); params.push(user.id); break;
    case 'mine': where.push('q.creator_id = ?'); params.push(user.id); break;
    case 'following': where.push('EXISTS (SELECT 1 FROM request_followers f WHERE f.request_id = q.id AND f.user_id = ?)'); params.push(user.id); break;
    default: break;
  }
  switch (p.tab) {
    case 'my_turn': where.push(`q.status = 'pending' AND ${MY_TURN}`); params.push(user.id); break;
    case 'overdue': where.push("q.status = 'pending' AND q.deadline_at IS NOT NULL AND q.deadline_at < datetime('now')"); break;
    case 'pending': case 'approved': case 'rejected': case 'returned': case 'cancelled':
      where.push('q.status = ?'); params.push(p.tab); break;
    case 'starred': where.push('EXISTS (SELECT 1 FROM request_stars s WHERE s.request_id = q.id AND s.user_id = ?)'); params.push(user.id); break;
    case 'draft': where.push("q.status = 'draft' AND q.creator_id = ?"); params.push(user.id); break;
    default: where.push("(q.status <> 'draft' OR q.creator_id = ?)"); params.push(user.id);
  }
  const gid = toInt(p.group_id);
  if (gid) { where.push('q.group_id = ?'); params.push(gid); }
  if (p.q) {
    const like = `%${p.q.trim()}%`;
    where.push("(q.title LIKE ? OR IFNULL(q.content,'') LIKE ? OR CAST(q.id AS TEXT) = ?)");
    params.push(like, like, p.q.trim().replace(/^#/, ''));
  }
  if (p.creator_id) { where.push('q.creator_id = ?'); params.push(toInt(p.creator_id)); }
  if (p.from) { where.push('date(q.created_at) >= date(?)'); params.push(p.from); }
  if (p.to) { where.push('date(q.created_at) <= date(?)'); params.push(p.to); }
  const order = p.sort === 'oldest' ? 'q.created_at ASC, q.id ASC' : p.sort === 'deadline'
    ? "CASE WHEN q.deadline_at IS NULL THEN 1 ELSE 0 END, q.deadline_at" : 'q.updated_at DESC, q.id DESC';
  return { where: where.join(' AND '), params, order };
}

r.get('/requests', async (c) => {
  const user = c.get('user');
  const p = c.req.query();
  const { where, params, order } = buildList(user, p);
  const { page, limit, offset } = paginate(p, 20);
  const total = (await get(`SELECT COUNT(*) AS c FROM requests q WHERE ${where}`, ...params)).c;
  const items = (await all(`${LIST_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    user.id, user.id, ...params, limit, offset)).map(decorate);
  return c.json({ items, total, page, limit });
});

r.get('/request/counts', async (c) => {
  const user = c.get('user');
  const v = visibility(user);
  const row = await get(`SELECT
      SUM(CASE WHEN q.status = 'pending' AND ${MY_TURN} THEN 1 ELSE 0 END) AS my_turn,
      SUM(CASE WHEN q.status = 'pending' AND q.deadline_at < datetime('now') THEN 1 ELSE 0 END) AS overdue,
      SUM(CASE WHEN q.status = 'draft' AND q.creator_id = ? THEN 1 ELSE 0 END) AS draft
    FROM requests q WHERE ${v.sql}`, user.id, user.id, ...v.params);
  return c.json({ my_turn: row.my_turn || 0, overdue: row.overdue || 0, draft: row.draft || 0 });
});

r.get('/request/reports', async (c) => {
  const user = c.get('user');
  const v = visibility(user);
  const q = c.req.query();
  const where = [v.sql, "q.status <> 'draft'"];
  const params = [...v.params];
  if (q.from) { where.push('date(q.created_at) >= date(?)'); params.push(q.from); }
  if (q.to) { where.push('date(q.created_at) <= date(?)'); params.push(q.to); }
  const gid = toInt(q.group_id);
  if (gid) { where.push('q.group_id = ?'); params.push(gid); }
  const w = where.join(' AND ');
  const days = Math.min(180, Math.max(7, toInt(q.days, 30)));
  const cols = `SUM(q.status = 'approved') AS approved, SUM(q.status = 'rejected') AS rejected, SUM(q.status = 'pending') AS pending,
        SUM(q.status = 'returned') AS returned, SUM(q.status = 'cancelled') AS cancelled`;
  const [summary, byGroup, byApprover, createdTrend, doneTrend] = await Promise.all([
    get(`SELECT COUNT(*) AS total, ${cols},
        SUM(q.status = 'pending' AND q.deadline_at IS NOT NULL AND q.deadline_at < datetime('now')) AS overdue,
        ROUND(AVG(CASE WHEN q.completed_at IS NOT NULL THEN (julianday(q.completed_at) - julianday(q.created_at)) * 24 END), 1) AS avg_hours,
        SUM(q.completed_at IS NOT NULL AND q.deadline_at IS NOT NULL AND q.completed_at <= q.deadline_at) AS within_sla,
        SUM(q.completed_at IS NOT NULL AND q.deadline_at IS NOT NULL) AS with_sla
      FROM requests q WHERE ${w}`, ...params),
    all(`SELECT g.id, g.name, g.category, COUNT(*) AS total, ${cols},
        ROUND(AVG(CASE WHEN q.completed_at IS NOT NULL THEN (julianday(q.completed_at) - julianday(q.created_at)) * 24 END), 1) AS avg_hours
      FROM requests q JOIN request_groups g ON g.id = q.group_id WHERE ${w} GROUP BY g.id ORDER BY total DESC LIMIT 30`, ...params),
    all(`SELECT u.id, u.name, u.color, COUNT(*) AS total, SUM(a.status = 'pending' AND q.status = 'pending') AS waiting,
        SUM(a.status IN ('approved','rejected','returned')) AS handled, SUM(a.status = 'approved') AS approved,
        SUM(a.status = 'rejected') AS rejected, SUM(a.status = 'returned') AS returned,
        ROUND(AVG(CASE WHEN a.acted_at IS NOT NULL THEN (julianday(a.acted_at) - julianday(q.created_at)) * 24 END), 1) AS avg_hours
      FROM request_approvers a JOIN requests q ON q.id = a.request_id JOIN users u ON u.id = a.user_id
      WHERE ${w} GROUP BY u.id ORDER BY waiting DESC, total DESC LIMIT 20`, ...params),
    all(`SELECT date(q.created_at) AS day, COUNT(*) AS c FROM requests q WHERE ${w} AND date(q.created_at) > date('now', ?)
      GROUP BY day ORDER BY day`, ...params, `-${days} day`),
    all(`SELECT date(q.completed_at) AS day, COUNT(*) AS c FROM requests q WHERE ${w} AND q.completed_at IS NOT NULL
      AND date(q.completed_at) > date('now', ?) GROUP BY day ORDER BY day`, ...params, `-${days} day`),
  ]);
  const n = (x) => Number(x) || 0;
  const norm = (r) => ({ ...r, total: n(r.total), approved: n(r.approved), rejected: n(r.rejected), pending: n(r.pending),
    returned: n(r.returned), cancelled: n(r.cancelled) });
  const sm = norm(summary);
  return c.json({
    days,
    summary: { ...sm, overdue: n(summary.overdue), avg_hours: summary.avg_hours, within_sla: n(summary.within_sla), with_sla: n(summary.with_sla) },
    by_group: byGroup.map(norm),
    by_approver: byApprover.map((u) => ({ ...u, total: n(u.total), waiting: n(u.waiting), handled: n(u.handled),
      approved: n(u.approved), rejected: n(u.rejected), returned: n(u.returned) })),
    created_trend: createdTrend,
    done_trend: doneTrend,
    // tương thích ngược
    by_status: ['pending', 'approved', 'rejected', 'returned', 'cancelled'].map((k) => ({ status: k, c: sm[k] })),
  });
});

// ================================================================ detail
async function fullRequest(id, user) {
  const [q] = (await all(`${LIST_SELECT} WHERE q.id = ?`, user.id, user.id, id)).map(decorate);
  const raw = await get('SELECT content, data FROM requests WHERE id = ?', id);
  q.content = raw.content;
  q.data = parseJson(raw.data, {});
  const group = q.group_id ? await get('SELECT id, name, fields, custom_approvers, sla_hours, guide FROM request_groups WHERE id = ?', q.group_id) : null;
  q.fields = group ? parseJson(group.fields, []) : [];
  // biểu mẫu / quy trình của nhóm đề xuất để người làm & người duyệt đối chiếu
  q.group_guide = group?.guide || null;
  q.group_files = group ? await groupFiles(group.id) : [];
  q.approvers = await all(`SELECT a.*, u.name, u.color, u.title FROM request_approvers a JOIN users u ON u.id = a.user_id
    WHERE a.request_id = ? ORDER BY a.step, u.name`, id);
  q.followers = await all('SELECT u.id, u.name, u.color FROM request_followers f JOIN users u ON u.id = f.user_id WHERE f.request_id = ? ORDER BY u.name', id);
  q.attachments = await all(`SELECT a.id, a.original_name, a.mime, a.size, a.created_at, u.name AS user_name FROM request_attachments a
    LEFT JOIN users u ON u.id = a.user_id WHERE a.request_id = ? ORDER BY a.id`, id);
  // user-type fields: resolve names for display
  const userIds = q.fields.filter((f) => f.type === 'user').map((f) => toInt(q.data[f.key])).filter(Boolean);
  q.users = userIds.length ? await all(`SELECT id, name FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`, ...userIds) : [];
  q.following = q.followers.some((f) => f.id === user.id);
  q.can_edit = (q.creator_id === user.id || isAdmin(user)) && ['draft', 'returned'].includes(q.status);
  q.can_cancel = q.creator_id === user.id && q.status === 'pending';
  return q;
}

r.get('/requests/:id', async (c) => {
  const q = await viewable(c);
  return c.json(await fullRequest(q.id, c.get('user')));
});

// ================================================================ create / update
function validateData(fields, data, strict) {
  const clean = {};
  for (const f of fields) {
    let v = data?.[f.key];
    if (typeof v === 'string') v = v.trim();
    const empty = v === undefined || v === null || v === '' || (f.type === 'checkbox' && !v);
    if (empty) {
      if (strict && f.required) throw badRequest(`Vui lòng nhập "${f.label}"`);
      continue;
    }
    if (f.type === 'number' || f.type === 'money') {
      // money: "5.000.000" / "5,000,000" → 5000000; number: accept "1,5" as 1.5
      const n = typeof v === 'number' ? v : f.type === 'money'
        ? Number(String(v).replace(/[^\d-]/g, ''))
        : Number(String(v).replace(/\s/g, '').replace(',', '.'));
      if (Number.isNaN(n)) throw badRequest(`"${f.label}" phải là số`);
      v = n;
    } else if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest(`"${f.label}" không đúng định dạng ngày`);
    else if (f.type === 'select' && Array.isArray(f.options) && f.options.length && !f.options.includes(v)) throw badRequest(`"${f.label}" không hợp lệ`);
    else if (f.type === 'checkbox') v = true;
    else if (f.type === 'user') v = toInt(v);
    else v = String(v).slice(0, 5000);
    clean[f.key] = v;
  }
  return clean;
}

function deadlineFrom(slaHours) {
  if (!slaHours) return null;
  return new Date(Date.now() + slaHours * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

async function approverPlan(group, extra) {
  const fixed = await all('SELECT user_id, step FROM request_group_approvers WHERE group_id = ? ORDER BY step', group.id);
  const plan = fixed.map((a) => ({ user_id: a.user_id, step: a.step }));
  if (group.custom_approvers) {
    let step = plan.reduce((m, a) => Math.max(m, a.step), 0);
    for (const uid of extra) if (!plan.some((a) => a.user_id === uid)) plan.push({ user_id: uid, step: ++step });
  }
  return plan;
}

/** Start (or restart) the approval flow and notify whoever acts first. */
async function startFlow(id, user) {
  const q = await get('SELECT * FROM requests WHERE id = ?', id);
  const group = q.group_id ? await get('SELECT sla_hours FROM request_groups WHERE id = ?', q.group_id) : null;
  await run("UPDATE request_approvers SET status = 'pending', comment = NULL, acted_at = NULL WHERE request_id = ?", id);
  await run("UPDATE requests SET status = 'pending', deadline_at = ?, completed_at = NULL, updated_at = datetime('now') WHERE id = ?",
    deadlineFrom(group?.sla_hours), id);
  await notifyCurrent(id, user, `${user.name} gửi đề xuất "${q.title}" cần bạn duyệt`);
}

async function notifyCurrent(id, actor, title) {
  const q = await get('SELECT flow FROM requests WHERE id = ?', id);
  const step = (await get("SELECT MIN(step) AS s FROM request_approvers WHERE request_id = ? AND status = 'pending'", id)).s;
  const targets = await all(`SELECT user_id FROM request_approvers WHERE request_id = ? AND status = 'pending' ${q.flow === 'any' ? '' : 'AND step = ?'}`,
    ...(q.flow === 'any' ? [id] : [id, step]));
  await notify(targets.map((t) => t.user_id), { actorId: actor.id, app: APP, type: 'approval', title, link: `/request/${id}` });
}

async function saveFiles(id, files, userId) {
  const stored = await storeFiles(files);
  await batch(stored.map((f) => ['INSERT INTO request_attachments(request_id, filename, original_name, mime, size, user_id) VALUES (?,?,?,?,?,?)',
    [id, f.filename, f.original_name, f.mime, f.size, userId]]));
}

const truthy = (v) => ['1', 'true', true, 1].includes(v);

r.post('/requests', async (c) => {
  const user = c.get('user');
  const { fields: b, files } = await formBody(c);
  const group = await get('SELECT * FROM request_groups WHERE id = ?', toInt(b.group_id));
  if (!group) throw badRequest('Vui lòng chọn nhóm đề xuất');
  if (!group.active) throw badRequest('Nhóm đề xuất đang tạm đóng');
  const draft = truthy(b.draft);
  const title = String(b.title || '').trim() || group.name;
  const data = validateData(parseJson(group.fields, []), parseJson(b.data || '{}', {}), !draft);
  const plan = await approverPlan(group, idList(b.approvers).filter((x) => x !== user.id || isAdmin(user)));
  if (!draft && !plan.length) throw badRequest('Đề xuất cần ít nhất một người duyệt');
  const { lastId: id } = await run(`INSERT INTO requests(group_id, title, content, data, flow, creator_id, status) VALUES (?,?,?,?,?,?, 'draft')`,
    group.id, title.slice(0, 300), b.content || null, JSON.stringify(data), group.flow, user.id);
  const groupFollowers = (await all('SELECT user_id FROM request_group_followers WHERE group_id = ?', group.id)).map((x) => x.user_id);
  const followers = [...new Set([...groupFollowers, ...idList(b.followers)])];
  await batch([
    ...plan.map((a) => ['INSERT INTO request_approvers(request_id, user_id, step) VALUES (?,?,?)', [id, a.user_id, a.step]]),
    ...followers.map((f) => ['INSERT OR IGNORE INTO request_followers(request_id, user_id) VALUES (?,?)', [id, f]]),
  ]);
  await saveFiles(id, files, user.id);
  await logActivity('request', id, user.id, 'created', draft ? 'Lưu nháp đề xuất' : 'Tạo đề xuất');
  if (!draft) {
    await startFlow(id, user);
    await notify(followers, { actorId: user.id, app: APP, type: 'follow', title: `${user.name} tạo đề xuất "${title}"`, link: `/request/${id}` });
    await fireRequestEvent(c, 'request.submitted', id);
  }
  return c.json(await fullRequest(id, user), 201);
});

r.put('/requests/:id', async (c) => {
  const user = c.get('user');
  const q = await viewable(c);
  if (!((q.creator_id === user.id || isAdmin(user)) && ['draft', 'returned'].includes(q.status))) {
    throw forbidden('Chỉ sửa được đề xuất đang lưu nháp hoặc bị trả lại');
  }
  const { fields: b, files } = await formBody(c);
  const group = q.group_id ? await get('SELECT * FROM request_groups WHERE id = ?', q.group_id) : null;
  const submit = truthy(b.submit);
  const data = validateData(group ? parseJson(group.fields, []) : [], parseJson(b.data || '{}', {}), submit);
  await run("UPDATE requests SET title = ?, content = ?, data = ?, updated_at = datetime('now') WHERE id = ?",
    String(b.title || '').trim().slice(0, 300) || q.title, b.content || null, JSON.stringify(data), q.id);
  if (group && b.approvers !== undefined) {
    const plan = await approverPlan(group, idList(b.approvers));
    await batch([
      ['DELETE FROM request_approvers WHERE request_id = ?', [q.id]],
      ...plan.map((a) => ['INSERT INTO request_approvers(request_id, user_id, step) VALUES (?,?,?)', [q.id, a.user_id, a.step]]),
    ]);
  }
  if (b.followers !== undefined) {
    await batch([
      ['DELETE FROM request_followers WHERE request_id = ?', [q.id]],
      ...idList(b.followers).map((f) => ['INSERT OR IGNORE INTO request_followers(request_id, user_id) VALUES (?,?)', [q.id, f]]),
    ]);
  }
  await saveFiles(q.id, files, user.id);
  await logActivity('request', q.id, user.id, 'updated', 'Cập nhật đề xuất');
  if (submit) {
    if (!(await get('SELECT 1 FROM request_approvers WHERE request_id = ?', q.id))) throw badRequest('Đề xuất cần ít nhất một người duyệt');
    await logActivity('request', q.id, user.id, 'submitted', q.status === 'returned' ? 'Gửi lại đề xuất' : 'Gửi đề xuất');
    await startFlow(q.id, user);
    await fireRequestEvent(c, 'request.submitted', q.id);
  }
  return c.json(await fullRequest(q.id, user));
});

const ACTION_LABEL = { approve: 'Đã chấp thuận', reject: 'Đã từ chối', return: 'Đã trả lại' };

r.post('/requests/:id/decide', async (c) => {
  const user = c.get('user');
  const q = await viewable(c);
  const b = await jsonBody(c);
  const action = ['approve', 'reject', 'return'].includes(b.action) ? b.action : null;
  if (!action) throw badRequest('Thao tác không hợp lệ');
  const comment = String(b.comment || '').trim() || null;
  if (action !== 'approve' && !comment) throw badRequest('Vui lòng nhập lý do');
  const turn = await get(`SELECT 1 FROM requests q WHERE q.id = ? AND q.status = 'pending' AND ${MY_TURN}`, q.id, user.id);
  if (!turn) throw forbidden('Chưa đến lượt bạn duyệt đề xuất này');
  const status = { approve: 'approved', reject: 'rejected', return: 'returned' }[action];
  const { changes } = await run("UPDATE request_approvers SET status = ?, comment = ?, acted_at = datetime('now') WHERE request_id = ? AND user_id = ? AND status = 'pending'",
    status, comment, q.id, user.id);
  if (!changes) throw badRequest('Đề xuất đã được xử lý');
  await logActivity('request', q.id, user.id, status, `${ACTION_LABEL[action]}${comment ? `: ${comment}` : ''}`);
  const watchers = (await all('SELECT user_id FROM request_followers WHERE request_id = ?', q.id)).map((x) => x.user_id);

  let finalStatus = null;
  if (action !== 'approve') finalStatus = status;
  else if (q.flow === 'any') finalStatus = 'approved';
  else if (!(await get("SELECT 1 FROM request_approvers WHERE request_id = ? AND status = 'pending'", q.id))) finalStatus = 'approved';

  if (finalStatus) {
    await run(`UPDATE requests SET status = ?, completed_at = ${finalStatus === 'returned' ? 'NULL' : "datetime('now')"}, updated_at = datetime('now') WHERE id = ?`, finalStatus, q.id);
    await run("UPDATE request_approvers SET status = 'skipped' WHERE request_id = ? AND status = 'pending'", q.id);
    await notify([q.creator_id, ...watchers], { actorId: user.id, app: APP, type: finalStatus,
      title: `${user.name}: ${ACTION_LABEL[action].toLowerCase()} đề xuất "${q.title}"`, link: `/request/${q.id}` });
    await fireRequestEvent(c, `request.${finalStatus}`, q.id, { comment });
  } else {
    await run("UPDATE requests SET updated_at = datetime('now') WHERE id = ?", q.id);
    await notify(q.creator_id, { actorId: user.id, app: APP, type: 'approved', title: `${user.name} đã duyệt đề xuất "${q.title}"`, link: `/request/${q.id}` });
    await notifyCurrent(q.id, user, `Đề xuất "${q.title}" đến lượt bạn duyệt`);
    await fireRequestEvent(c, 'request.step_approved', q.id, { comment });
  }
  return c.json(await fullRequest(q.id, user));
});

r.post('/requests/:id/submit', async (c) => {
  const user = c.get('user');
  const q = await viewable(c);
  if (!((q.creator_id === user.id || isAdmin(user)) && ['draft', 'returned'].includes(q.status))) throw badRequest('Đề xuất đã được gửi');
  const group = q.group_id ? await get('SELECT fields FROM request_groups WHERE id = ?', q.group_id) : null;
  validateData(group ? parseJson(group.fields, []) : [], parseJson(q.data, {}), true);
  if (!(await get('SELECT 1 FROM request_approvers WHERE request_id = ?', q.id))) throw badRequest('Đề xuất cần ít nhất một người duyệt');
  await logActivity('request', q.id, user.id, 'submitted', q.status === 'returned' ? 'Gửi lại đề xuất' : 'Gửi đề xuất');
  await startFlow(q.id, user);
  await fireRequestEvent(c, 'request.submitted', q.id);
  return c.json(await fullRequest(q.id, user));
});

r.post('/requests/:id/cancel', async (c) => {
  const user = c.get('user');
  const q = await viewable(c);
  if (q.creator_id !== user.id || q.status !== 'pending') throw forbidden('Chỉ người tạo được huỷ đề xuất đang chờ duyệt');
  await run("UPDATE requests SET status = 'cancelled', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", q.id);
  await run("UPDATE request_approvers SET status = 'skipped' WHERE request_id = ? AND status = 'pending'", q.id);
  await logActivity('request', q.id, user.id, 'cancelled', 'Huỷ đề xuất');
  await fireRequestEvent(c, 'request.cancelled', q.id);
  return c.json(await fullRequest(q.id, user));
});

r.delete('/requests/:id', async (c) => {
  const user = c.get('user');
  const q = await viewable(c);
  if (!(isAdmin(user) || (q.creator_id === user.id && ['draft', 'cancelled'].includes(q.status)))) {
    throw forbidden('Chỉ xoá được đề xuất nháp hoặc đã huỷ');
  }
  const files = await all('SELECT filename FROM request_attachments WHERE request_id = ?', q.id);
  await run('DELETE FROM requests WHERE id = ?', q.id);
  for (const f of files) await removeFile(f.filename);
  return c.json({ ok: true });
});

const toggle = (table) => async (c) => {
  const q = await viewable(c);
  const uid = c.get('user').id;
  const exists = await get(`SELECT 1 FROM ${table} WHERE request_id = ? AND user_id = ?`, q.id, uid);
  if (exists) await run(`DELETE FROM ${table} WHERE request_id = ? AND user_id = ?`, q.id, uid);
  else await run(`INSERT INTO ${table}(request_id, user_id) VALUES (?,?)`, q.id, uid);
  return c.json({ active: !exists });
};
r.post('/requests/:id/star', toggle('request_stars'));
r.post('/requests/:id/follow', toggle('request_followers'));

// ---------------- comments, activity, attachments
const COMMENT_SELECT = `SELECT c.*, u.name AS user_name, u.color AS user_color FROM request_comments c LEFT JOIN users u ON u.id = c.user_id`;
r.get('/requests/:id/comments', async (c) => {
  const q = await viewable(c);
  return c.json(await all(`${COMMENT_SELECT} WHERE c.request_id = ? ORDER BY c.id`, q.id));
});
r.post('/requests/:id/comments', async (c) => {
  const user = c.get('user');
  const q = await viewable(c);
  const content = String((await jsonBody(c)).content || '').trim();
  if (!content) throw badRequest('Nội dung bình luận trống');
  const { lastId } = await run('INSERT INTO request_comments(request_id, user_id, content) VALUES (?,?,?)', q.id, user.id, content.slice(0, 5000));
  const approvers = (await all('SELECT user_id FROM request_approvers WHERE request_id = ?', q.id)).map((x) => x.user_id);
  const watchers = (await all('SELECT user_id FROM request_followers WHERE request_id = ?', q.id)).map((x) => x.user_id);
  await notify([q.creator_id, ...approvers, ...watchers], { actorId: user.id, app: APP, type: 'comment',
    title: `${user.name} bình luận trong đề xuất "${q.title}"`, link: `/request/${q.id}` });
  await fireRequestEvent(c, 'request.commented', q.id, { comment: content.slice(0, 1000) });
  return c.json(await get(`${COMMENT_SELECT} WHERE c.id = ?`, lastId), 201);
});
r.get('/requests/:id/activity', async (c) => {
  const q = await viewable(c);
  return c.json(await all(`SELECT l.*, u.name AS user_name, u.color AS user_color FROM activity_logs l LEFT JOIN users u ON u.id = l.user_id
    WHERE l.entity_type = 'request' AND l.entity_id = ? ORDER BY l.id DESC`, q.id));
});
r.post('/requests/:id/attachments', async (c) => {
  const user = c.get('user');
  const q = await viewable(c);
  const { files } = await formBody(c);
  await saveFiles(q.id, files, user.id);
  if (files.length) await logActivity('request', q.id, user.id, 'attached', `Đính kèm ${files.length} tệp`);
  return c.json((await fullRequest(q.id, user)).attachments, 201);
});
r.post('/requests/:id/attachments/:aid/link', async (c) => {
  const q = await viewable(c);
  const a = await get('SELECT id, original_name FROM request_attachments WHERE id = ? AND request_id = ?', toInt(c.req.param('aid')), q.id);
  if (!a) throw notFound('Tệp không tồn tại');
  return c.json(await publicFileLink(c, 'ra', a));
});
r.get('/requests/:id/attachments/:aid', async (c) => {
  const q = await viewable(c);
  const a = await get('SELECT * FROM request_attachments WHERE id = ? AND request_id = ?', toInt(c.req.param('aid')), q.id);
  if (!a) throw notFound('Tệp không tồn tại');
  return sendFile(c, a, c.req.query('inline') === '1');
});

// ================================================================ request groups (nhóm đề xuất)
async function groupList(user, q) {
  const where = [];
  const params = [];
  const manage = q.manage === '1' && isAdmin(user);
  if (!manage) where.push('g.active = 1');
  else if (q.status === 'active') where.push('g.active = 1');
  else if (q.status === 'paused') where.push('g.active = 0');
  if (q.q) { where.push('(g.name LIKE ? OR g.category LIKE ?)'); params.push(`%${q.q}%`, `%${q.q}%`); }
  const rows = await all(`SELECT g.id, g.name, g.description, g.category, g.flow, g.sla_hours, g.active, g.custom_approvers, g.updated_at,
      (SELECT COUNT(*) FROM request_group_files gf WHERE gf.group_id = g.id) AS file_count, g.guide IS NOT NULL AND g.guide <> '' AS has_guide,
      EXISTS (SELECT 1 FROM request_group_stars s WHERE s.group_id = g.id AND s.user_id = ?) AS starred,
      (SELECT COUNT(*) FROM request_group_approvers a WHERE a.group_id = g.id) AS approver_count,
      (SELECT COUNT(*) FROM requests q WHERE q.group_id = g.id) AS request_count
    FROM request_groups g ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY g.category COLLATE NOCASE, g.name COLLATE NOCASE`,
  user.id, ...params);
  return rows.map((g) => ({ ...g, starred: !!g.starred, active: !!g.active, custom_approvers: !!g.custom_approvers, has_guide: !!g.has_guide }));
}

r.get('/request-groups', async (c) => c.json(await groupList(c.get('user'), c.req.query())));

r.get('/request-groups/history', requireAdmin, async (c) => c.json(await all(`SELECT l.*, u.name AS user_name, u.color AS user_color, g.name AS group_name
  FROM activity_logs l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN request_groups g ON g.id = l.entity_id
  WHERE l.entity_type = 'request_group' ORDER BY l.id DESC LIMIT 200`)));

r.get('/request-groups/:id', async (c) => {
  const g = await get('SELECT * FROM request_groups WHERE id = ?', toInt(c.req.param('id')));
  if (!g) throw notFound('Nhóm đề xuất không tồn tại');
  g.fields = parseJson(g.fields, []);
  g.active = !!g.active;
  g.custom_approvers = !!g.custom_approvers;
  g.approvers = await all(`SELECT a.user_id, a.step, u.name, u.color, u.title FROM request_group_approvers a JOIN users u ON u.id = a.user_id
    WHERE a.group_id = ? ORDER BY a.step`, g.id);
  g.followers = await all(`SELECT f.user_id, u.name, u.color FROM request_group_followers f JOIN users u ON u.id = f.user_id WHERE f.group_id = ?`, g.id);
  g.files = await groupFiles(g.id);
  return c.json(g);
});

// ---------------- biểu mẫu & quy trình của nhóm đề xuất (quản trị viên tải lên, mọi người xem / tải về)
const GROUP_FILE_KINDS = ['form', 'process'];
function groupFiles(groupId) {
  return all(`SELECT f.id, f.kind, f.original_name, f.mime, f.size, f.created_at, u.name AS user_name FROM request_group_files f
    LEFT JOIN users u ON u.id = f.user_id WHERE f.group_id = ? ORDER BY f.kind, f.id`, groupId);
}
async function groupFile(c) {
  const f = await get('SELECT * FROM request_group_files WHERE id = ? AND group_id = ?', toInt(c.req.param('fid')), toInt(c.req.param('id')));
  if (!f) throw notFound('Tệp không tồn tại');
  return f;
}
r.post('/request-groups/:id/files', requireAdmin, async (c) => {
  const id = toInt(c.req.param('id'));
  const g = await get('SELECT id, name FROM request_groups WHERE id = ?', id);
  if (!g) throw notFound('Nhóm đề xuất không tồn tại');
  const { fields, files } = await formBody(c);
  const kind = GROUP_FILE_KINDS.includes(fields.kind) ? fields.kind : 'form';
  const stored = await storeFiles(files);
  await batch(stored.map((f) => ['INSERT INTO request_group_files(group_id, kind, filename, original_name, mime, size, user_id) VALUES (?,?,?,?,?,?,?)',
    [id, kind, f.filename, f.original_name, f.mime, f.size, c.get('user').id]]));
  if (stored.length) {
    await logActivity('request_group', id, c.get('user').id, 'files',
      `Đính kèm ${stored.length} ${kind === 'form' ? 'biểu mẫu' : 'tài liệu quy trình'} cho "${g.name}"`);
  }
  return c.json(await groupFiles(id), 201);
});
r.delete('/request-groups/:id/files/:fid', requireAdmin, async (c) => {
  const f = await groupFile(c);
  await run('DELETE FROM request_group_files WHERE id = ?', f.id);
  await removeFile(f.filename);
  return c.json(await groupFiles(f.group_id));
});
r.get('/request-groups/:id/files/:fid', async (c) => sendFile(c, await groupFile(c), c.req.query('inline') === '1'));
r.post('/request-groups/:id/files/:fid/link', async (c) => c.json(await publicFileLink(c, 'gf', await groupFile(c))));

function parseGroup(b) {
  const name = String(b.name || '').trim();
  if (!name) throw badRequest('Tên nhóm đề xuất là bắt buộc');
  const fields = (Array.isArray(b.fields) ? b.fields : []).slice(0, 40).map((f, i) => {
    const label = String(f.label || '').trim();
    if (!label) throw badRequest(`Trường thứ ${i + 1} chưa có tên`);
    const type = FIELD_TYPES.includes(f.type) ? f.type : 'text';
    const options = type === 'select' ? (Array.isArray(f.options) ? f.options : String(f.options || '').split('\n'))
      .map((o) => String(o).trim()).filter(Boolean).slice(0, 50) : undefined;
    if (type === 'select' && !options.length) throw badRequest(`Trường "${label}" cần ít nhất một lựa chọn`);
    return { key: String(f.key || `f${i + 1}`).replace(/[^\w]/g, '').slice(0, 30) || `f${i + 1}`, label: label.slice(0, 120), type, required: !!f.required, options };
  });
  const keys = new Set();
  for (const f of fields) { while (keys.has(f.key)) f.key += '_'; keys.add(f.key); }
  const sla = toInt(b.sla_hours);
  return {
    name: name.slice(0, 200), description: b.description || null, guide: b.guide && String(b.guide).replace(/<[^>]*>|&nbsp;/g, '').trim() ? String(b.guide) : null, category: String(b.category || '').trim() || 'Chung',
    fields: JSON.stringify(fields), flow: b.flow === 'any' ? 'any' : 'sequential',
    custom_approvers: b.custom_approvers === false ? 0 : 1, sla_hours: sla && sla > 0 ? sla : null,
    active: b.active === false ? 0 : 1, approvers: idList(b.approvers), followers: idList(b.followers),
  };
}

async function saveGroupRelations(id, g) {
  await batch([
    ['DELETE FROM request_group_approvers WHERE group_id = ?', [id]],
    ...g.approvers.map((uid, i) => ['INSERT INTO request_group_approvers(group_id, user_id, step) VALUES (?,?,?)', [id, uid, i + 1]]),
    ['DELETE FROM request_group_followers WHERE group_id = ?', [id]],
    ...g.followers.map((uid) => ['INSERT OR IGNORE INTO request_group_followers(group_id, user_id) VALUES (?,?)', [id, uid]]),
  ]);
}

r.post('/request-groups', requireAdmin, async (c) => {
  const g = parseGroup(await jsonBody(c));
  const { lastId } = await run(`INSERT INTO request_groups(name, description, category, fields, flow, custom_approvers, sla_hours, active, created_by, guide)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, g.name, g.description, g.category, g.fields, g.flow, g.custom_approvers, g.sla_hours, g.active, c.get('user').id, g.guide);
  await saveGroupRelations(lastId, g);
  await logActivity('request_group', lastId, c.get('user').id, 'created', `Tạo nhóm đề xuất "${g.name}"`);
  return c.json({ id: lastId }, 201);
});

r.put('/request-groups/:id', requireAdmin, async (c) => {
  const id = toInt(c.req.param('id'));
  if (!(await get('SELECT 1 FROM request_groups WHERE id = ?', id))) throw notFound();
  const g = parseGroup(await jsonBody(c));
  await run(`UPDATE request_groups SET name = ?, description = ?, category = ?, fields = ?, flow = ?, custom_approvers = ?, sla_hours = ?,
    active = ?, guide = ?, updated_at = datetime('now') WHERE id = ?`, g.name, g.description, g.category, g.fields, g.flow, g.custom_approvers, g.sla_hours, g.active, g.guide, id);
  await saveGroupRelations(id, g);
  await logActivity('request_group', id, c.get('user').id, 'updated', `Cập nhật nhóm đề xuất "${g.name}"`);
  return c.json({ id });
});

r.post('/request-groups/bulk', requireAdmin, async (c) => {
  const b = await jsonBody(c);
  const ids = idList(b.ids);
  if (!ids.length) throw badRequest('Chưa chọn nhóm đề xuất');
  const ph = ids.map(() => '?').join(',');
  const names = await all(`SELECT id, name FROM request_groups WHERE id IN (${ph})`, ...ids);
  if (b.action === 'enable' || b.action === 'disable') {
    await run(`UPDATE request_groups SET active = ?, updated_at = datetime('now') WHERE id IN (${ph})`, b.action === 'enable' ? 1 : 0, ...ids);
  } else if (b.action === 'delete') {
    const files = await all(`SELECT filename FROM request_group_files WHERE group_id IN (${ph})`, ...ids);
    await run(`DELETE FROM request_groups WHERE id IN (${ph})`, ...ids);
    for (const f of files) await removeFile(f.filename);
  } else if (b.action === 'category') {
    const cat = String(b.category || '').trim();
    if (!cat) throw badRequest('Tên danh mục trống');
    await run(`UPDATE request_groups SET category = ? WHERE id IN (${ph})`, cat, ...ids);
  } else throw badRequest('Thao tác không hợp lệ');
  const label = { enable: 'Mở', disable: 'Tạm đóng', delete: 'Xoá', category: 'Chuyển danh mục' }[b.action];
  await batch(names.map((g) => ['INSERT INTO activity_logs(entity_type, entity_id, user_id, action, detail) VALUES (?,?,?,?,?)',
    ['request_group', g.id, c.get('user').id, b.action, `${label} nhóm đề xuất "${g.name}"`]]));
  return c.json({ affected: names.length });
});

r.post('/request-groups/:id/star', async (c) => {
  const id = toInt(c.req.param('id'));
  const uid = c.get('user').id;
  const exists = await get('SELECT 1 FROM request_group_stars WHERE group_id = ? AND user_id = ?', id, uid);
  if (exists) await run('DELETE FROM request_group_stars WHERE group_id = ? AND user_id = ?', id, uid);
  else await run('INSERT INTO request_group_stars(group_id, user_id) VALUES (?,?)', id, uid);
  return c.json({ active: !exists });
});

export default r;
