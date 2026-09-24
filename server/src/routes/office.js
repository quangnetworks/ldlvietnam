import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, tx, logActivity, notify, UPLOAD_DIR } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { badRequest, notFound, forbidden, toInt, idList, upload, fixName, paginate, today } from '../util.js';

const r = Router();
r.use(requireAuth);

export const DOC_KINDS = ['notice', 'incoming', 'outgoing', 'internal'];
export const DOC_STATUSES = ['draft', 'pending', 'issued', 'rejected', 'archived'];
const APP = 'office';

// ---------------------------------------------------------------- visibility
function visibilitySql(user) {
  if (user.role === 'admin') return { sql: '1=1', params: [] };
  return {
    sql: `(d.creator_id = ? OR d.issuer_id = ?
          OR EXISTS (SELECT 1 FROM document_approvers da WHERE da.document_id = d.id AND da.user_id = ?)
          OR (d.status IN ('issued','archived') AND (d.is_public = 1
              OR EXISTS (SELECT 1 FROM document_recipients dr WHERE dr.document_id = d.id
                         AND (dr.user_id = ? OR (dr.department_id IS NOT NULL AND dr.department_id = ?))))))`,
    params: [user.id, user.id, user.id, user.id, user.department_id ?? -1],
  };
}

function canView(user, docId) {
  const v = visibilitySql(user);
  return !!get(`SELECT 1 FROM documents d WHERE d.id = ? AND ${v.sql}`, docId, ...v.params);
}

function loadDocOr404(id) {
  const d = get('SELECT * FROM documents WHERE id = ?', id);
  if (!d) throw notFound('Văn bản không tồn tại');
  return d;
}

const canEdit = (user, d) => user.role === 'admin' || d.creator_id === user.id;

// ---------------------------------------------------------------- list query
function buildListQuery(req) {
  const u = req.user;
  const q = req.query;
  const vis = visibilitySql(u);
  const where = [vis.sql];
  const params = [...vis.params];
  const box = q.box || 'home';

  if (box === 'trash') where.push('d.deleted_at IS NOT NULL');
  else where.push('d.deleted_at IS NULL');

  switch (box) {
    case 'following':
      where.push('EXISTS (SELECT 1 FROM document_follows f WHERE f.document_id = d.id AND f.user_id = ?)');
      params.push(u.id);
      break;
    case 'pending_me':
      where.push(`d.status = 'pending' AND EXISTS (SELECT 1 FROM document_approvers da WHERE da.document_id = d.id
                  AND da.user_id = ? AND da.status = 'pending'
                  AND da.step = (SELECT MIN(step) FROM document_approvers x WHERE x.document_id = d.id AND x.status = 'pending'))`);
      params.push(u.id);
      break;
    case 'starred':
      where.push('EXISTS (SELECT 1 FROM document_stars s WHERE s.document_id = d.id AND s.user_id = ?)');
      params.push(u.id);
      break;
    case 'mine':
      where.push('d.creator_id = ?');
      params.push(u.id);
      break;
    case 'numbering':
      where.push("d.need_numbering = 1 AND (d.code IS NULL OR d.code = '') AND d.status <> 'draft'");
      break;
    case 'system':
      where.push("d.status = 'issued'");
      break;
    case 'drafts':
      where.push("d.status = 'draft' AND d.creator_id = ?");
      params.push(u.id);
      break;
    case 'expired':
      where.push("d.status = 'issued' AND d.expire_date IS NOT NULL AND d.expire_date < ?");
      params.push(today());
      break;
    case 'rejected':
      where.push("d.status = 'rejected'");
      break;
    case 'archived':
      where.push("d.status = 'archived'");
      break;
    case 'trash':
      if (u.role !== 'admin') { where.push('d.creator_id = ?'); params.push(u.id); }
      break;
    default:
      // Trang chủ: văn bản đã ban hành + văn bản của tôi chưa ban hành
      where.push("(d.status = 'issued' OR (d.creator_id = ? AND d.status IN ('pending','rejected')))");
      params.push(u.id);
  }

  if (q.tab && DOC_KINDS.includes(q.tab)) { where.push('d.kind = ?'); params.push(q.tab); }
  if (q.status) {
    const sts = String(q.status).split(',').filter((s) => DOC_STATUSES.includes(s) || s === 'expired');
    if (sts.length) {
      const parts = [];
      for (const s of sts) {
        if (s === 'expired') { parts.push("(d.status = 'issued' AND d.expire_date < ?)"); params.push(today()); }
        else { parts.push('d.status = ?'); params.push(s); }
      }
      where.push(`(${parts.join(' OR ')})`);
    }
  }
  const idFilter = (col, key) => {
    const ids = idList(q[key]);
    if (ids.length) { where.push(`${col} IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
  };
  idFilter('d.type_id', 'type_id');
  idFilter('d.issuer_id', 'issuer_id');
  idFilter('d.department_id', 'department_id');
  idFilter('d.sender_department_id', 'sender_department_id');
  idFilter('d.creator_id', 'creator_id');

  const treeFilter = (col, key, table) => {
    const id = toInt(q[key]);
    if (id) {
      where.push(`${col} IN (WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT c.id FROM ${table} c JOIN t ON c.parent_id = t.id) SELECT id FROM t)`);
      params.push(id);
    }
  };
  treeFilter('d.folder_id', 'folder_id', 'doc_folders');
  treeFilter('d.category_id', 'category_id', 'doc_categories');

  if (q.q) {
    const like = `%${String(q.q).trim()}%`;
    where.push("(d.title LIKE ? OR IFNULL(d.code,'') LIKE ? OR IFNULL(d.description,'') LIKE ? OR IFNULL(d.content,'') LIKE ?)");
    params.push(like, like, like, like);
  }
  if (q.date_from) { where.push("date(COALESCE(d.issued_at, d.created_at)) >= date(?)"); params.push(q.date_from); }
  if (q.date_to) { where.push("date(COALESCE(d.issued_at, d.created_at)) <= date(?)"); params.push(q.date_to); }

  const sorts = {
    newest: 'COALESCE(d.issued_at, d.created_at) DESC, d.id DESC',
    oldest: 'COALESCE(d.issued_at, d.created_at) ASC, d.id ASC',
    title: 'd.title COLLATE NOCASE ASC',
    updated: 'd.updated_at DESC',
  };
  const order = sorts[q.sort] || sorts.newest;
  return { where: where.join(' AND '), params, order };
}

const DOC_SELECT = `
  SELECT d.*, t.name AS type_name, dep.name AS department_name, sdep.name AS sender_department_name,
    iu.name AS issuer_name, iu.color AS issuer_color, idep.name AS issuer_department_name,
    cu.name AS creator_name, f.name AS folder_name, c.name AS category_name,
    (SELECT COUNT(*) FROM document_views v WHERE v.document_id = d.id) AS view_count,
    (SELECT COUNT(*) FROM document_attachments a WHERE a.document_id = d.id) AS attachment_count,
    EXISTS (SELECT 1 FROM document_stars s WHERE s.document_id = d.id AND s.user_id = ?) AS starred,
    EXISTS (SELECT 1 FROM document_follows fo WHERE fo.document_id = d.id AND fo.user_id = ?) AS following,
    EXISTS (SELECT 1 FROM document_views vv WHERE vv.document_id = d.id AND vv.user_id = ?) AS viewed
  FROM documents d
  LEFT JOIN doc_types t ON t.id = d.type_id
  LEFT JOIN departments dep ON dep.id = d.department_id
  LEFT JOIN departments sdep ON sdep.id = d.sender_department_id
  LEFT JOIN users iu ON iu.id = d.issuer_id
  LEFT JOIN departments idep ON idep.id = iu.department_id
  LEFT JOIN users cu ON cu.id = d.creator_id
  LEFT JOIN doc_folders f ON f.id = d.folder_id
  LEFT JOIN doc_categories c ON c.id = d.category_id`;

function decorate(doc) {
  if (!doc) return doc;
  doc.starred = !!doc.starred;
  doc.following = !!doc.following;
  doc.viewed = !!doc.viewed;
  doc.is_expired = doc.status === 'issued' && !!doc.expire_date && doc.expire_date < today();
  return doc;
}

function firstAttachments(ids) {
  if (!ids.length) return {};
  const rows = all(
    `SELECT id, document_id, original_name, mime, size FROM document_attachments
     WHERE document_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
    ...ids
  );
  const map = {};
  for (const a of rows) (map[a.document_id] ||= []).push(a);
  return map;
}

// ---------------------------------------------------------------- meta
r.get('/office/meta', (req, res) => {
  const u = req.user;
  const vis = visibilitySql(u);
  const count = (extra, ...p) =>
    get(`SELECT COUNT(*) AS c FROM documents d WHERE ${vis.sql} AND d.deleted_at IS NULL AND ${extra}`, ...vis.params, ...p).c;
  res.json({
    types: all('SELECT * FROM doc_types ORDER BY name COLLATE NOCASE'),
    folders: all('SELECT * FROM doc_folders ORDER BY name COLLATE NOCASE'),
    categories: all('SELECT * FROM doc_categories ORDER BY name COLLATE NOCASE'),
    departments: all('SELECT id, name, parent_id FROM departments ORDER BY name COLLATE NOCASE'),
    counts: {
      pending_me: count(`d.status = 'pending' AND EXISTS (SELECT 1 FROM document_approvers da WHERE da.document_id = d.id
        AND da.user_id = ? AND da.status = 'pending'
        AND da.step = (SELECT MIN(step) FROM document_approvers x WHERE x.document_id = d.id AND x.status = 'pending'))`, u.id),
      numbering: count("d.need_numbering = 1 AND (d.code IS NULL OR d.code = '') AND d.status <> 'draft'"),
      drafts: count("d.status = 'draft' AND d.creator_id = ?", u.id),
      unread: count("d.status = 'issued' AND NOT EXISTS (SELECT 1 FROM document_views v WHERE v.document_id = d.id AND v.user_id = ?)", u.id),
    },
  });
});

// ---------------------------------------------------------------- list / export
r.get('/documents', (req, res) => {
  const { where, params, order } = buildListQuery(req);
  const { page, limit, offset } = paginate(req, 20);
  const total = get(`SELECT COUNT(*) AS c FROM documents d WHERE ${where}`, ...params).c;
  const items = all(`${DOC_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    req.user.id, req.user.id, req.user.id, ...params, limit, offset).map(decorate);
  const atts = firstAttachments(items.map((d) => d.id));
  for (const d of items) d.attachments = atts[d.id] || [];
  res.json({ items, total, page, limit });
});

const STATUS_LABEL = { draft: 'Đã lưu', pending: 'Chờ duyệt', issued: 'Đã ban hành', rejected: 'Không thông qua', archived: 'Cất giữ' };
const KIND_LABEL = { notice: 'Thông báo', incoming: 'Văn bản đến', outgoing: 'Văn bản đi', internal: 'Văn bản nội bộ' };

r.get('/documents/export', (req, res) => {
  const { where, params, order } = buildListQuery(req);
  const items = all(`${DOC_SELECT} WHERE ${where} ORDER BY ${order} LIMIT 5000`,
    req.user.id, req.user.id, req.user.id, ...params).map(decorate);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Số hiệu', 'Tiêu đề', 'Trích yếu', 'Nhóm', 'Loại văn bản', 'Trạng thái', 'Người ban hành',
    'Phòng ban', 'Ngày ban hành', 'Ngày hiệu lực', 'Ngày hết hạn', 'Lượt xem'];
  const lines = [header.map(esc).join(',')];
  for (const d of items) {
    lines.push([d.code, d.title, d.description, KIND_LABEL[d.kind], d.type_name,
      d.is_expired ? 'Hết hạn' : STATUS_LABEL[d.status], d.issuer_name, d.department_name,
      d.issued_at?.slice(0, 10), d.effective_date, d.expire_date, d.view_count].map(esc).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="van-ban-${today()}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
});

// ---------------------------------------------------------------- detail
function fullDoc(id, user) {
  const d = decorate(get(`${DOC_SELECT} WHERE d.id = ?`, user.id, user.id, user.id, id));
  d.attachments = all('SELECT id, original_name, mime, size, created_at FROM document_attachments WHERE document_id = ? ORDER BY id', id);
  d.approvers = all(
    `SELECT da.*, u.name, u.color, u.title FROM document_approvers da JOIN users u ON u.id = da.user_id
     WHERE da.document_id = ? ORDER BY da.step, u.name`, id);
  d.recipients = all(
    `SELECT dr.user_id, dr.department_id, u.name AS user_name, dep.name AS department_name
     FROM document_recipients dr LEFT JOIN users u ON u.id = dr.user_id LEFT JOIN departments dep ON dep.id = dr.department_id
     WHERE dr.document_id = ?`, id);
  d.followers = all('SELECT u.id, u.name, u.color FROM document_follows f JOIN users u ON u.id = f.user_id WHERE f.document_id = ?', id);
  const pendingStep = get("SELECT MIN(step) AS s FROM document_approvers WHERE document_id = ? AND status = 'pending'", id).s;
  d.can_approve = d.status === 'pending' && d.approvers.some((a) => a.user_id === user.id && a.status === 'pending' && a.step === pendingStep);
  d.can_edit = canEdit(user, d) && (['draft', 'rejected'].includes(d.status) || user.role === 'admin');
  d.can_manage = canEdit(user, d);
  return d;
}

r.get('/documents/:id', (req, res) => {
  const id = toInt(req.params.id);
  loadDocOr404(id);
  if (!canView(req.user, id)) throw forbidden('Bạn không có quyền xem văn bản này');
  run('INSERT INTO document_views(document_id, user_id) VALUES (?,?) ON CONFLICT DO UPDATE SET viewed_at = datetime(\'now\')', id, req.user.id);
  res.json(fullDoc(id, req.user));
});

r.get('/documents/:id/viewers', (req, res) => {
  const id = toInt(req.params.id);
  if (!canView(req.user, id)) throw forbidden();
  res.json(all(`SELECT u.id, u.name, u.color, dep.name AS department_name, v.viewed_at FROM document_views v
    JOIN users u ON u.id = v.user_id LEFT JOIN departments dep ON dep.id = u.department_id
    WHERE v.document_id = ? ORDER BY v.viewed_at DESC`, id));
});

r.get('/documents/:id/activity', (req, res) => {
  const id = toInt(req.params.id);
  if (!canView(req.user, id)) throw forbidden();
  res.json(all(`SELECT l.*, u.name AS user_name, u.color AS user_color FROM activity_logs l
    LEFT JOIN users u ON u.id = l.user_id WHERE l.entity_type = 'document' AND l.entity_id = ? ORDER BY l.id DESC`, id));
});

r.get('/documents/:id/comments', (req, res) => {
  const id = toInt(req.params.id);
  if (!canView(req.user, id)) throw forbidden();
  res.json(all(`SELECT c.*, u.name AS user_name, u.color AS user_color FROM document_comments c
    LEFT JOIN users u ON u.id = c.user_id WHERE c.document_id = ? ORDER BY c.id`, id));
});

r.post('/documents/:id/comments', (req, res) => {
  const id = toInt(req.params.id);
  const d = loadDocOr404(id);
  if (!canView(req.user, id)) throw forbidden();
  const content = String(req.body?.content || '').trim();
  if (!content) throw badRequest('Nội dung bình luận trống');
  const info = run('INSERT INTO document_comments(document_id, user_id, content) VALUES (?,?,?)', id, req.user.id, content);
  const watchers = all('SELECT user_id FROM document_follows WHERE document_id = ?', id).map((x) => x.user_id);
  notify([d.creator_id, ...watchers], {
    actorId: req.user.id, app: APP, type: 'comment',
    title: `${req.user.name} đã bình luận văn bản "${d.title}"`, link: `/office/doc/${id}`,
  });
  res.status(201).json(get(`SELECT c.*, u.name AS user_name, u.color AS user_color FROM document_comments c
    LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?`, Number(info.lastInsertRowid)));
});

// ---------------------------------------------------------------- create / update
function parseDocBody(b) {
  if (!b.title?.trim()) throw badRequest('Tiêu đề văn bản là bắt buộc');
  const kind = DOC_KINDS.includes(b.kind) ? b.kind : 'notice';
  if (b.expire_date && b.effective_date && b.expire_date < b.effective_date) {
    throw badRequest('Ngày hết hạn phải sau ngày hiệu lực');
  }
  return {
    code: b.code?.trim() || null,
    title: b.title.trim(),
    description: b.description || null,
    content: b.content || null,
    kind,
    type_id: toInt(b.type_id),
    folder_id: toInt(b.folder_id),
    category_id: toInt(b.category_id),
    department_id: toInt(b.department_id),
    sender_department_id: toInt(b.sender_department_id),
    sender_org: b.sender_org || null,
    issuer_id: toInt(b.issuer_id),
    need_numbering: b.need_numbering === true || b.need_numbering === '1' || b.need_numbering === 'true' ? 1 : 0,
    effective_date: b.effective_date || null,
    expire_date: b.expire_date || null,
    approvers: idList(b.approvers),
    recipient_users: idList(b.recipient_users),
    recipient_departments: idList(b.recipient_departments),
    followers: idList(b.followers),
  };
}

function saveRelations(id, p) {
  run('DELETE FROM document_approvers WHERE document_id = ?', id);
  p.approvers.forEach((uid, i) => run('INSERT INTO document_approvers(document_id, user_id, step) VALUES (?,?,?)', id, uid, i + 1));
  run('DELETE FROM document_recipients WHERE document_id = ?', id);
  for (const uid of p.recipient_users) run('INSERT INTO document_recipients(document_id, user_id) VALUES (?,?)', id, uid);
  for (const did of p.recipient_departments) run('INSERT INTO document_recipients(document_id, department_id) VALUES (?,?)', id, did);
  run('UPDATE documents SET is_public = ? WHERE id = ?', p.recipient_users.length || p.recipient_departments.length ? 0 : 1, id);
  for (const uid of p.followers) run('INSERT OR IGNORE INTO document_follows(document_id, user_id) VALUES (?,?)', id, uid);
}

function saveAttachments(id, files) {
  for (const f of files || []) {
    run('INSERT INTO document_attachments(document_id, filename, original_name, mime, size) VALUES (?,?,?,?,?)',
      id, f.filename, fixName(f.originalname), f.mimetype, f.size);
  }
}

function recipientUserIds(id) {
  const d = get('SELECT is_public FROM documents WHERE id = ?', id);
  if (d.is_public) return all('SELECT id FROM users WHERE active = 1').map((x) => x.id);
  return all(`SELECT DISTINCT u.id FROM users u JOIN document_recipients dr ON dr.document_id = ?
    AND (dr.user_id = u.id OR dr.department_id = u.department_id) WHERE u.active = 1`, id).map((x) => x.id);
}

/** Move a document forward: submit for approval or publish when no approver remains. */
function advance(id, actor) {
  const d = get('SELECT * FROM documents WHERE id = ?', id);
  const step = get("SELECT MIN(step) AS s FROM document_approvers WHERE document_id = ? AND status = 'pending'", id).s;
  if (step) {
    run("UPDATE documents SET status = 'pending', updated_at = datetime('now') WHERE id = ?", id);
    const approvers = all("SELECT user_id FROM document_approvers WHERE document_id = ? AND step = ? AND status = 'pending'", id, step);
    notify(approvers.map((a) => a.user_id), {
      actorId: actor.id, app: APP, type: 'approval',
      title: `Văn bản "${d.title}" đang chờ bạn duyệt`, link: `/office/doc/${id}`,
    });
    return 'pending';
  }
  run(`UPDATE documents SET status = 'issued', issued_at = COALESCE(issued_at, datetime('now')),
       issuer_id = COALESCE(issuer_id, creator_id), updated_at = datetime('now') WHERE id = ?`, id);
  logActivity('document', id, actor.id, 'issued', 'Văn bản đã được ban hành');
  notify(recipientUserIds(id), {
    actorId: actor.id, app: APP, type: 'issued', title: `Văn bản mới: ${d.title}`, link: `/office/doc/${id}`,
  });
  return 'issued';
}

r.post('/documents', upload.array('files'), (req, res) => {
  const p = parseDocBody(req.body || {});
  const asDraft = req.body.draft === '1' || req.body.draft === true || req.body.draft === 'true';
  const id = tx(() => {
    const info = run(
      `INSERT INTO documents(code, title, description, content, kind, type_id, folder_id, category_id, department_id,
        sender_department_id, sender_org, issuer_id, creator_id, need_numbering, effective_date, expire_date, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'draft')`,
      p.code, p.title, p.description, p.content, p.kind, p.type_id, p.folder_id, p.category_id, p.department_id,
      p.sender_department_id, p.sender_org, p.issuer_id || req.user.id, req.user.id, p.need_numbering,
      p.effective_date, p.expire_date
    );
    const newId = Number(info.lastInsertRowid);
    saveRelations(newId, p);
    run('INSERT OR IGNORE INTO document_follows(document_id, user_id) VALUES (?,?)', newId, req.user.id);
    saveAttachments(newId, req.files);
    logActivity('document', newId, req.user.id, 'created', asDraft ? 'Lưu nháp văn bản' : 'Tạo văn bản');
    if (!asDraft) advance(newId, req.user);
    return newId;
  });
  res.status(201).json(fullDoc(id, req.user));
});

r.put('/documents/:id', upload.array('files'), (req, res) => {
  const id = toInt(req.params.id);
  const d = loadDocOr404(id);
  if (!canEdit(req.user, d)) throw forbidden();
  if (!['draft', 'rejected'].includes(d.status) && req.user.role !== 'admin') {
    throw badRequest('Chỉ có thể chỉnh sửa văn bản ở trạng thái nháp hoặc không thông qua');
  }
  const p = parseDocBody(req.body || {});
  const submit = req.body.submit === '1' || req.body.submit === 'true' || req.body.submit === true;
  tx(() => {
    run(
      `UPDATE documents SET code = ?, title = ?, description = ?, content = ?, kind = ?, type_id = ?, folder_id = ?,
        category_id = ?, department_id = ?, sender_department_id = ?, sender_org = ?, issuer_id = COALESCE(?, issuer_id),
        need_numbering = ?, effective_date = ?, expire_date = ?, updated_at = datetime('now') WHERE id = ?`,
      p.code, p.title, p.description, p.content, p.kind, p.type_id, p.folder_id, p.category_id, p.department_id,
      p.sender_department_id, p.sender_org, p.issuer_id, p.need_numbering, p.effective_date, p.expire_date, id
    );
    const keepApprovals = d.status === 'issued' || d.status === 'archived';
    if (keepApprovals) {
      // Văn bản đã ban hành: chỉ cập nhật người nhận / theo dõi, giữ nguyên lịch sử duyệt
      p.approvers = all('SELECT user_id FROM document_approvers WHERE document_id = ? ORDER BY step', id).map((x) => x.user_id);
      const prev = all('SELECT * FROM document_approvers WHERE document_id = ?', id);
      saveRelations(id, p);
      for (const a of prev) {
        run('UPDATE document_approvers SET status = ?, comment = ?, acted_at = ? WHERE document_id = ? AND user_id = ?',
          a.status, a.comment, a.acted_at, id, a.user_id);
      }
    } else {
      saveRelations(id, p);
    }
    const removeIds = idList(req.body.remove_attachments);
    for (const aid of removeIds) {
      const a = get('SELECT * FROM document_attachments WHERE id = ? AND document_id = ?', aid, id);
      if (a) {
        run('DELETE FROM document_attachments WHERE id = ?', aid);
        fs.rm(path.join(UPLOAD_DIR, a.filename), () => {});
      }
    }
    saveAttachments(id, req.files);
    logActivity('document', id, req.user.id, 'updated', 'Cập nhật văn bản');
    if (submit && ['draft', 'rejected'].includes(d.status)) {
      run("UPDATE document_approvers SET status = 'pending', comment = NULL, acted_at = NULL WHERE document_id = ?", id);
      logActivity('document', id, req.user.id, 'submitted', 'Gửi văn bản');
      advance(id, req.user);
    }
  });
  res.json(fullDoc(id, req.user));
});

r.post('/documents/:id/submit', (req, res) => {
  const id = toInt(req.params.id);
  const d = loadDocOr404(id);
  if (!canEdit(req.user, d)) throw forbidden();
  if (!['draft', 'rejected'].includes(d.status)) throw badRequest('Văn bản đã được gửi');
  tx(() => {
    run("UPDATE document_approvers SET status = 'pending', comment = NULL, acted_at = NULL WHERE document_id = ?", id);
    logActivity('document', id, req.user.id, 'submitted', 'Gửi văn bản');
    advance(id, req.user);
  });
  res.json(fullDoc(id, req.user));
});

r.post('/documents/:id/approve', (req, res) => {
  const id = toInt(req.params.id);
  const d = loadDocOr404(id);
  const decision = req.body?.decision === 'reject' ? 'rejected' : 'approved';
  const comment = req.body?.comment || null;
  const step = get("SELECT MIN(step) AS s FROM document_approvers WHERE document_id = ? AND status = 'pending'", id).s;
  const mine = get('SELECT * FROM document_approvers WHERE document_id = ? AND user_id = ?', id, req.user.id);
  if (d.status !== 'pending' || !mine || mine.status !== 'pending' || mine.step !== step) {
    throw forbidden('Bạn không phải người duyệt ở bước hiện tại');
  }
  tx(() => {
    run("UPDATE document_approvers SET status = ?, comment = ?, acted_at = datetime('now') WHERE document_id = ? AND user_id = ?",
      decision, comment, id, req.user.id);
    if (decision === 'rejected') {
      run("UPDATE documents SET status = 'rejected', updated_at = datetime('now') WHERE id = ?", id);
      logActivity('document', id, req.user.id, 'rejected', comment ? `Không thông qua: ${comment}` : 'Không thông qua');
      notify(d.creator_id, { actorId: req.user.id, app: APP, type: 'rejected',
        title: `${req.user.name} không thông qua văn bản "${d.title}"`, link: `/office/doc/${id}` });
    } else {
      logActivity('document', id, req.user.id, 'approved', comment ? `Đã duyệt: ${comment}` : 'Đã duyệt');
      notify(d.creator_id, { actorId: req.user.id, app: APP, type: 'approved',
        title: `${req.user.name} đã duyệt văn bản "${d.title}"`, link: `/office/doc/${id}` });
      advance(id, req.user);
    }
  });
  res.json(fullDoc(id, req.user));
});

r.post('/documents/:id/number', (req, res) => {
  const id = toInt(req.params.id);
  const d = loadDocOr404(id);
  if (req.user.role !== 'admin' && d.creator_id !== req.user.id) throw forbidden();
  let code = String(req.body?.code || '').trim();
  if (!code) {
    const type = d.type_id ? get('SELECT * FROM doc_types WHERE id = ?', d.type_id) : null;
    const year = new Date().getFullYear();
    const n = get("SELECT COUNT(*) AS c FROM documents WHERE code IS NOT NULL AND code <> '' AND strftime('%Y', created_at) = ?", String(year)).c + 1;
    code = `${String(n).padStart(3, '0')}/${year}/${type?.prefix || 'VB'}`;
  }
  run("UPDATE documents SET code = ?, updated_at = datetime('now') WHERE id = ?", code, id);
  logActivity('document', id, req.user.id, 'numbered', `Cấp số văn bản: ${code}`);
  res.json(fullDoc(id, req.user));
});

const toggle = (table) => (req, res) => {
  const id = toInt(req.params.id);
  loadDocOr404(id);
  if (!canView(req.user, id)) throw forbidden();
  const exists = get(`SELECT 1 FROM ${table} WHERE document_id = ? AND user_id = ?`, id, req.user.id);
  if (exists) run(`DELETE FROM ${table} WHERE document_id = ? AND user_id = ?`, id, req.user.id);
  else run(`INSERT INTO ${table}(document_id, user_id) VALUES (?,?)`, id, req.user.id);
  res.json({ active: !exists });
};
r.post('/documents/:id/star', toggle('document_stars'));
r.post('/documents/:id/follow', toggle('document_follows'));

r.post('/documents/:id/archive', (req, res) => {
  const id = toInt(req.params.id);
  const d = loadDocOr404(id);
  if (!canEdit(req.user, d)) throw forbidden();
  const next = d.status === 'archived' ? 'issued' : 'archived';
  if (d.status !== 'issued' && d.status !== 'archived') throw badRequest('Chỉ cất giữ được văn bản đã ban hành');
  run("UPDATE documents SET status = ?, updated_at = datetime('now') WHERE id = ?", next, id);
  logActivity('document', id, req.user.id, next === 'archived' ? 'archived' : 'unarchived', next === 'archived' ? 'Cất giữ văn bản' : 'Bỏ cất giữ văn bản');
  res.json(fullDoc(id, req.user));
});

r.delete('/documents/:id', (req, res) => {
  const id = toInt(req.params.id);
  const d = loadDocOr404(id);
  if (!canEdit(req.user, d)) throw forbidden();
  if (req.query.permanent === '1') {
    if (!d.deleted_at) throw badRequest('Chỉ xóa vĩnh viễn văn bản trong thùng rác');
    const files = all('SELECT filename FROM document_attachments WHERE document_id = ?', id);
    run('DELETE FROM documents WHERE id = ?', id);
    for (const f of files) fs.rm(path.join(UPLOAD_DIR, f.filename), () => {});
    return res.json({ ok: true });
  }
  run("UPDATE documents SET deleted_at = datetime('now') WHERE id = ?", id);
  logActivity('document', id, req.user.id, 'deleted', 'Tạm xóa văn bản');
  res.json({ ok: true });
});

r.post('/documents/:id/restore', (req, res) => {
  const id = toInt(req.params.id);
  const d = loadDocOr404(id);
  if (!canEdit(req.user, d)) throw forbidden();
  run('UPDATE documents SET deleted_at = NULL WHERE id = ?', id);
  logActivity('document', id, req.user.id, 'restored', 'Khôi phục văn bản');
  res.json({ ok: true });
});

r.post('/documents/bulk', (req, res) => {
  const ids = idList(req.body?.ids);
  const action = req.body?.action;
  let n = 0;
  tx(() => {
    for (const id of ids) {
      const d = get('SELECT * FROM documents WHERE id = ?', id);
      if (!d || !canView(req.user, id)) continue;
      if (action === 'star') { run('INSERT OR IGNORE INTO document_stars(document_id, user_id) VALUES (?,?)', id, req.user.id); n++; }
      else if (action === 'follow') { run('INSERT OR IGNORE INTO document_follows(document_id, user_id) VALUES (?,?)', id, req.user.id); n++; }
      else if (action === 'read') {
        run("INSERT INTO document_views(document_id, user_id) VALUES (?,?) ON CONFLICT DO NOTHING", id, req.user.id); n++;
      } else if (action === 'delete' && canEdit(req.user, d)) {
        run("UPDATE documents SET deleted_at = datetime('now') WHERE id = ?", id);
        logActivity('document', id, req.user.id, 'deleted', 'Tạm xóa văn bản'); n++;
      } else if (action === 'move' && canEdit(req.user, d)) {
        run('UPDATE documents SET folder_id = ? WHERE id = ?', toInt(req.body.folder_id), id); n++;
      }
    }
  });
  res.json({ affected: n });
});

// ---------------------------------------------------------------- attachments
r.get('/documents/:id/attachments/:aid', (req, res) => {
  const id = toInt(req.params.id);
  if (!canView(req.user, id)) throw forbidden();
  const a = get('SELECT * FROM document_attachments WHERE id = ? AND document_id = ?', toInt(req.params.aid), id);
  if (!a) throw notFound('Tệp không tồn tại');
  const file = path.join(UPLOAD_DIR, a.filename);
  if (!fs.existsSync(file)) throw notFound('Tệp không tồn tại trên máy chủ');
  if (req.query.inline === '1') {
    res.setHeader('Content-Type', a.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.original_name)}`);
    return res.sendFile(file);
  }
  res.download(file, a.original_name);
});

// ---------------------------------------------------------------- taxonomies
function taxonomy(table, label) {
  r.post(`/office/${table}`, (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) throw badRequest(`Tên ${label} là bắt buộc`);
    const cols = table === 'types' ? ['name', 'prefix'] : ['name', 'parent_id'];
    const vals = table === 'types' ? [name, req.body.prefix || null] : [name, toInt(req.body.parent_id)];
    const t = `doc_${table}`;
    const info = run(`INSERT INTO ${t}(${cols.join(',')}) VALUES (?,?)`, ...vals);
    res.status(201).json(get(`SELECT * FROM ${t} WHERE id = ?`, Number(info.lastInsertRowid)));
  });
  r.put(`/office/${table}/:id`, requireAdmin, (req, res) => {
    const t = `doc_${table}`;
    const id = toInt(req.params.id);
    const name = String(req.body?.name || '').trim();
    if (!name) throw badRequest(`Tên ${label} là bắt buộc`);
    if (table === 'types') run(`UPDATE ${t} SET name = ?, prefix = ? WHERE id = ?`, name, req.body.prefix || null, id);
    else {
      if (toInt(req.body.parent_id) === id) throw badRequest('Thư mục cha không hợp lệ');
      run(`UPDATE ${t} SET name = ?, parent_id = ? WHERE id = ?`, name, toInt(req.body.parent_id), id);
    }
    res.json(get(`SELECT * FROM ${t} WHERE id = ?`, id));
  });
  r.delete(`/office/${table}/:id`, requireAdmin, (req, res) => {
    run(`DELETE FROM doc_${table} WHERE id = ?`, toInt(req.params.id));
    res.json({ ok: true });
  });
}
taxonomy('types', 'loại văn bản');
taxonomy('folders', 'kho lưu trữ');
taxonomy('categories', 'thư mục');

export default r;
