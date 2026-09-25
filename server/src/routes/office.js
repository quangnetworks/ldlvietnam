import { Hono } from 'hono';
import { all, get, run, batch, logActivity, notify, getSetting, setSetting, markSeen, findMentions } from '../db.js';
import { audit } from '../platform.js';
import { requireAdmin, deptIn, userDeptIds, inDeptSql } from '../auth.js';
import {
  badRequest, notFound, forbidden, toInt, idList, paginate, today, jsonBody, formBody, storeFiles, removeFile, sendFile,
} from '../util.js';
import { publicFileLink } from '../files.js';
import { readComment, saveCommentFiles, withCommentFiles, commentFileOr404, commentSnippet, purgeCommentFiles } from '../comments.js';

const r = new Hono();

export const DOC_KINDS = ['notice', 'incoming', 'outgoing', 'internal'];
export const DOC_STATUSES = ['draft', 'pending', 'issued', 'rejected', 'archived'];
const APP = 'office';

// ---------------------------------------------------------------- visibility
function visibilitySql(user) {
  if (user.role === 'admin') return { sql: '1=1', params: [] };
  const dep = deptIn('dr.department_id', user); // mọi phòng ban (chính + kiêm nhiệm)
  return {
    sql: `(d.creator_id = ? OR d.issuer_id = ?
          OR EXISTS (SELECT 1 FROM document_approvers da WHERE da.document_id = d.id AND da.user_id = ?)
          OR EXISTS (SELECT 1 FROM document_follows df WHERE df.document_id = d.id AND df.user_id = ?)
          OR (d.status IN ('issued','archived') AND (${user.role === 'guest' ? '0' : 'd.is_public'} = 1
              OR EXISTS (SELECT 1 FROM document_recipients dr WHERE dr.document_id = d.id
                         AND (dr.user_id = ? OR (dr.department_id IS NOT NULL AND ${dep.sql}))))))`,
    params: [user.id, user.id, user.id, user.id, user.id, ...dep.params],
  };
}

async function canView(user, docId) {
  const v = visibilitySql(user);
  return !!(await get(`SELECT 1 FROM documents d WHERE d.id = ? AND ${v.sql}`, docId, ...v.params));
}

async function loadDocOr404(id) {
  const d = await get('SELECT * FROM documents WHERE id = ?', id);
  if (!d) throw notFound('Văn bản không tồn tại');
  return d;
}

const canEdit = (user, d) => user.role === 'admin' || d.creator_id === user.id;

/** Văn bản đã bị văn bản khác thay thế và văn bản thay thế đã có hiệu lực. */
const SUPERSEDED_SQL = "(d.superseded_by IS NOT NULL AND IFNULL(d.superseded_at, '') <= ?)";

const PENDING_STEP_SQL = `da.step = (SELECT MIN(step) FROM document_approvers x WHERE x.document_id = d.id AND x.status = 'pending')`;

// ---------------------------------------------------------------- list query
function buildListQuery(user, q) {
  const vis = visibilitySql(user);
  const where = [vis.sql];
  const params = [...vis.params];
  const box = q.box || 'home';

  if (box === 'trash') where.push('d.deleted_at IS NOT NULL');
  else where.push('d.deleted_at IS NULL');

  switch (box) {
    case 'following':
      where.push('EXISTS (SELECT 1 FROM document_follows f WHERE f.document_id = d.id AND f.user_id = ?)');
      params.push(user.id);
      break;
    case 'pending_me':
      where.push(`d.status = 'pending' AND EXISTS (SELECT 1 FROM document_approvers da WHERE da.document_id = d.id
                  AND da.user_id = ? AND da.status = 'pending' AND ${PENDING_STEP_SQL})`);
      params.push(user.id);
      break;
    case 'starred':
      where.push('EXISTS (SELECT 1 FROM document_stars s WHERE s.document_id = d.id AND s.user_id = ?)');
      params.push(user.id);
      break;
    case 'mine':
      where.push('d.creator_id = ?');
      params.push(user.id);
      break;
    case 'numbering':
      where.push("d.need_numbering = 1 AND (d.code IS NULL OR d.code = '') AND d.status <> 'draft'");
      break;
    case 'system':
      where.push("d.status = 'issued'");
      if (!q.q) { where.push(`NOT ${SUPERSEDED_SQL}`); params.push(today()); }
      break;
    case 'superseded':
      where.push(`d.status IN ('issued','archived') AND ${SUPERSEDED_SQL}`);
      params.push(today());
      break;
    case 'drafts':
      where.push("d.status = 'draft' AND d.creator_id = ?");
      params.push(user.id);
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
      if (user.role !== 'admin') { where.push('d.creator_id = ?'); params.push(user.id); }
      break;
    default:
      // Trang chủ: văn bản đã ban hành + văn bản của tôi chưa ban hành
      where.push("(d.status = 'issued' OR (d.creator_id = ? AND d.status IN ('pending','rejected')))");
      params.push(user.id);
      // chính sách cũ đã bị thay thế chuyển sang mục "Đã bị thay thế" (vẫn tìm thấy khi tìm kiếm)
      if (!q.q) { where.push(`NOT ${SUPERSEDED_SQL}`); params.push(today()); }
  }

  if (q.tab && DOC_KINDS.includes(q.tab)) { where.push('d.kind = ?'); params.push(q.tab); }
  if (q.status) {
    const parts = [];
    for (const s of String(q.status).split(',')) {
      if (s === 'expired') { parts.push("(d.status = 'issued' AND d.expire_date < ?)"); params.push(today()); }
      else if (DOC_STATUSES.includes(s)) { parts.push('d.status = ?'); params.push(s); }
    }
    if (parts.length) where.push(`(${parts.join(' OR ')})`);
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
  if (q.date_from) { where.push('date(COALESCE(d.issued_at, d.created_at)) >= date(?)'); params.push(q.date_from); }
  if (q.date_to) { where.push('date(COALESCE(d.issued_at, d.created_at)) <= date(?)'); params.push(q.date_to); }

  const sorts = {
    newest: 'COALESCE(d.issued_at, d.created_at) DESC, d.id DESC',
    oldest: 'COALESCE(d.issued_at, d.created_at) ASC, d.id ASC',
    title: 'd.title COLLATE NOCASE ASC',
    updated: 'd.updated_at DESC',
  };
  return { where: where.join(' AND '), params, order: sorts[q.sort] || sorts.newest };
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
  doc.is_superseded = !!doc.superseded_by && (doc.superseded_at || '') <= today();
  doc.supersede_scheduled = !!doc.superseded_by && !doc.is_superseded;
  return doc;
}

async function attachmentsFor(ids) {
  if (!ids.length) return {};
  const rows = await all(
    `SELECT id, document_id, original_name, mime, size FROM document_attachments
     WHERE document_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
    ...ids
  );
  const map = {};
  for (const a of rows) (map[a.document_id] ||= []).push(a);
  return map;
}

// ---------------------------------------------------------------- settings (Cài đặt Office)
const DEFAULT_SETTINGS = {
  create_mode: 'all', // all | restricted
  creator_users: [], creator_groups: [], creator_departments: [],
  clerks: [], // văn thư: được cấp số văn bản
  code_format: '{seq}/{year}/{prefix}-LDL',
  seq_digits: 3,
  default_expire_days: null,
};

export async function officeSettings() {
  const raw = await getSetting('office_settings');
  let v = {};
  try { v = raw ? JSON.parse(raw) : {}; } catch { v = {}; }
  return { ...DEFAULT_SETTINGS, ...v };
}

async function canCreateDoc(user, st) {
  if (user.role === 'admin' || st.create_mode !== 'restricted') return true;
  if (st.creator_users.includes(user.id) || st.clerks.includes(user.id)) return true;
  if (userDeptIds(user).some((d) => st.creator_departments.includes(d))) return true;
  if (st.creator_groups.length) {
    const hit = await get(`SELECT 1 FROM user_group_members WHERE user_id = ? AND group_id IN (${st.creator_groups.map(() => '?').join(',')})`,
      user.id, ...st.creator_groups);
    if (hit) return true;
  }
  return false;
}
const isClerk = (user, st) => user.role === 'admin' || st.clerks.includes(user.id);

r.get('/office/settings', async (c) => c.json(await officeSettings()));
r.put('/office/settings', requireAdmin, async (c) => {
  const b = await jsonBody(c);
  const fmt = String(b.code_format || DEFAULT_SETTINGS.code_format).trim().slice(0, 80);
  if (!fmt.includes('{seq}')) throw badRequest('Mẫu số hiệu phải chứa {seq}');
  const days = toInt(b.default_expire_days);
  const next = {
    create_mode: b.create_mode === 'restricted' ? 'restricted' : 'all',
    creator_users: idList(b.creator_users), creator_groups: idList(b.creator_groups), creator_departments: idList(b.creator_departments),
    clerks: idList(b.clerks), code_format: fmt, seq_digits: Math.min(6, Math.max(1, toInt(b.seq_digits, 3))),
    default_expire_days: days && days > 0 ? days : null,
  };
  await setSetting('office_settings', JSON.stringify(next));
  await audit(c.get('user').id, 'office.settings', 'Cập nhật cài đặt LDL Office');
  return c.json(next);
});

/** Build the next document number from the configured template. */
async function nextCode(d, st) {
  const type = d.type_id ? await get('SELECT * FROM doc_types WHERE id = ?', d.type_id) : null;
  const dep = d.department_id ? await get('SELECT code, name FROM departments WHERE id = ?', d.department_id) : null;
  const year = String(new Date().getFullYear());
  const n = (await get(`SELECT COUNT(*) AS c FROM documents WHERE code IS NOT NULL AND code <> '' AND strftime('%Y', COALESCE(issued_at, created_at)) = ?
    AND IFNULL(type_id, 0) = IFNULL(?, 0)`, year, d.type_id ?? null)).c + 1;
  return st.code_format
    .replaceAll('{seq}', String(n).padStart(st.seq_digits, '0'))
    .replaceAll('{year}', year)
    .replaceAll('{month}', String(new Date().getMonth() + 1).padStart(2, '0'))
    .replaceAll('{prefix}', type?.prefix || 'VB')
    .replaceAll('{dept}', dep?.code || '');
}

// ---------------------------------------------------------------- meta
r.get('/office/meta', async (c) => {
  const u = c.get('user');
  const vis = visibilitySql(u);
  const count = async (extra, ...p) =>
    (await get(`SELECT COUNT(*) AS c FROM documents d WHERE ${vis.sql} AND d.deleted_at IS NULL AND ${extra}`, ...vis.params, ...p)).c;
  const st = await officeSettings();
  return c.json({
    can_create: await canCreateDoc(u, st),
    is_clerk: isClerk(u, st),
    code_format: st.code_format,
    types: await all('SELECT * FROM doc_types ORDER BY name COLLATE NOCASE'),
    folders: await all('SELECT * FROM doc_folders ORDER BY name COLLATE NOCASE'),
    categories: await all('SELECT * FROM doc_categories ORDER BY name COLLATE NOCASE'),
    departments: await all('SELECT id, name, parent_id FROM departments ORDER BY name COLLATE NOCASE'),
    counts: {
      pending_me: await count(`d.status = 'pending' AND EXISTS (SELECT 1 FROM document_approvers da WHERE da.document_id = d.id
        AND da.user_id = ? AND da.status = 'pending' AND ${PENDING_STEP_SQL})`, u.id),
      numbering: await count("d.need_numbering = 1 AND (d.code IS NULL OR d.code = '') AND d.status <> 'draft'"),
      drafts: await count("d.status = 'draft' AND d.creator_id = ?", u.id),
      unread: await count("d.status = 'issued' AND NOT EXISTS (SELECT 1 FROM document_views v WHERE v.document_id = d.id AND v.user_id = ?)", u.id),
    },
  });
});

// ---------------------------------------------------------------- list / export
r.get('/documents', async (c) => {
  const u = c.get('user');
  const q = c.req.query();
  const { where, params, order } = buildListQuery(u, q);
  const { page, limit, offset } = paginate(q, 20);
  const total = (await get(`SELECT COUNT(*) AS c FROM documents d WHERE ${where}`, ...params)).c;
  const items = (await all(`${DOC_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    u.id, u.id, u.id, ...params, limit, offset)).map(decorate);
  const atts = await attachmentsFor(items.map((d) => d.id));
  for (const d of items) d.attachments = atts[d.id] || [];
  return c.json({ items, total, page, limit });
});

const STATUS_LABEL = { draft: 'Đã lưu', pending: 'Chờ duyệt', issued: 'Đã ban hành', rejected: 'Không thông qua', archived: 'Cất giữ' };
const KIND_LABEL = { notice: 'Thông báo', incoming: 'Văn bản đến', outgoing: 'Văn bản đi', internal: 'Văn bản nội bộ' };

r.get('/documents/export', async (c) => {
  const u = c.get('user');
  const { where, params, order } = buildListQuery(u, c.req.query());
  const items = (await all(`${DOC_SELECT} WHERE ${where} ORDER BY ${order} LIMIT 5000`, u.id, u.id, u.id, ...params)).map(decorate);
  const esc = (v) => `"${String(v ?? '').replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;
  const header = ['Số hiệu', 'Tiêu đề', 'Trích yếu', 'Nhóm', 'Loại văn bản', 'Trạng thái', 'Người ban hành',
    'Phòng ban', 'Ngày ban hành', 'Ngày hiệu lực', 'Ngày hết hạn', 'Lượt xem'];
  const lines = [header.map(esc).join(',')];
  for (const d of items) {
    lines.push([d.code, d.title, d.description, KIND_LABEL[d.kind], d.type_name,
      d.is_superseded ? 'Đã bị thay thế' : d.is_expired ? 'Hết hạn' : STATUS_LABEL[d.status], d.issuer_name, d.department_name,
      d.issued_at?.slice(0, 10), d.effective_date, d.expire_date, d.view_count].map(esc).join(','));
  }
  return new Response('﻿' + lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="van-ban-${today()}.csv"`,
    },
  });
});

// ---------------------------------------------------------------- detail
async function fullDoc(id, user) {
  const d = decorate(await get(`${DOC_SELECT} WHERE d.id = ?`, user.id, user.id, user.id, id));
  d.attachments = await all('SELECT id, original_name, mime, size, created_at FROM document_attachments WHERE document_id = ? ORDER BY id', id);
  d.approvers = await all(
    `SELECT da.*, u.name, u.color, u.title FROM document_approvers da JOIN users u ON u.id = da.user_id
     WHERE da.document_id = ? ORDER BY da.step, u.name`, id);
  d.recipients = await all(
    `SELECT dr.user_id, dr.department_id, u.name AS user_name, dep.name AS department_name
     FROM document_recipients dr LEFT JOIN users u ON u.id = dr.user_id LEFT JOIN departments dep ON dep.id = dr.department_id
     WHERE dr.document_id = ?`, id);
  d.followers = await all('SELECT u.id, u.name, u.color FROM document_follows f JOIN users u ON u.id = f.user_id WHERE f.document_id = ?', id);
  const pendingStep = (await get("SELECT MIN(step) AS s FROM document_approvers WHERE document_id = ? AND status = 'pending'", id)).s;
  d.can_approve = d.status === 'pending' && d.approvers.some((a) => a.user_id === user.id && a.status === 'pending' && a.step === pendingStep);
  d.can_edit = canEdit(user, d) && (['draft', 'rejected'].includes(d.status) || user.role === 'admin');
  d.can_manage = canEdit(user, d);
  d.can_number = d.creator_id === user.id || isClerk(user, await officeSettings());
  d.versions = await versionChain(d, user);
  const pick = (vid) => d.versions.find((v) => v.id === vid) || null;
  d.replaces = d.replaces_id ? pick(d.replaces_id) : null;
  d.superseded_doc = d.superseded_by ? pick(d.superseded_by) : null;
  return d;
}

// ---------------------------------------------------------------- thay thế văn bản / chính sách cũ
const VERSION_COLS = 'id, code, title, status, issued_at, effective_date, expire_date, replaces_id, superseded_by, superseded_at, deleted_at';

/** Chuỗi phiên bản: các văn bản cũ đã bị thay thế → văn bản hiện tại → văn bản thay thế nó (chỉ những bản người xem được xem). */
async function versionChain(d, user) {
  if (!d.replaces_id && !d.superseded_by) return [];
  const older = [];
  const seen = new Set([d.id]);
  for (let id = d.replaces_id; id && older.length < 20 && !seen.has(id);) {
    seen.add(id);
    const x = await get(`SELECT ${VERSION_COLS} FROM documents WHERE id = ?`, id);
    if (!x) break;
    older.unshift(x);
    id = x.replaces_id;
  }
  const newer = [];
  for (let id = d.superseded_by; id && newer.length < 20 && !seen.has(id);) {
    seen.add(id);
    const x = await get(`SELECT ${VERSION_COLS} FROM documents WHERE id = ?`, id);
    if (!x) break;
    newer.push(x);
    id = x.superseded_by;
  }
  const self = await get(`SELECT ${VERSION_COLS} FROM documents WHERE id = ?`, d.id);
  const out = [];
  for (const x of [...older, self, ...newer]) {
    if (x.deleted_at || (x.id !== d.id && !(await canView(user, x.id)))) continue;
    const { deleted_at, ...v } = x;
    out.push({ ...decorate(v), current: x.id === d.id });
  }
  return out;
}

/** Kiểm tra văn bản được chọn để thay thế: đã ban hành, người tạo xem được, chưa bị văn bản khác thay thế. */
async function checkReplaceTarget(user, targetId, selfId = null) {
  if (!targetId) return;
  if (targetId === selfId) throw badRequest('Văn bản không thể thay thế chính nó');
  const t = await get('SELECT id, status, superseded_by, deleted_at FROM documents WHERE id = ?', targetId);
  if (!t || t.deleted_at || !(await canView(user, targetId))) throw badRequest('Văn bản cần thay thế không tồn tại');
  if (!['issued', 'archived'].includes(t.status)) throw badRequest('Chỉ thay thế được văn bản đã ban hành');
  if (t.superseded_by && t.superseded_by !== selfId) throw badRequest('Văn bản này đã được một văn bản khác thay thế');
  // tránh vòng lặp: văn bản cũ không được nằm sau văn bản mới trong chuỗi
  for (let id = targetId, n = 0; id && n < 50; n++) {
    const x = await get('SELECT replaces_id FROM documents WHERE id = ?', id);
    if (!x) break;
    if (x.replaces_id === selfId && selfId) throw badRequest('Chuỗi thay thế không hợp lệ');
    id = x.replaces_id;
  }
}

/**
 * Khi văn bản mới được ban hành: văn bản cũ được đánh dấu "đã bị thay thế" kể từ ngày hiệu lực của văn bản mới,
 * tự rời khỏi danh sách văn bản đang áp dụng, hiện biểu ngữ dẫn sang văn bản mới; người nhận / theo dõi / đã xem văn bản cũ được thông báo.
 */
async function applySupersede(newId, actor) {
  const n = await get('SELECT id, title, code, replaces_id, effective_date, issued_at FROM documents WHERE id = ?', newId);
  if (!n?.replaces_id) return;
  const old = await get('SELECT id, title, code FROM documents WHERE id = ? AND deleted_at IS NULL', n.replaces_id);
  if (!old) return;
  const from = n.effective_date || today();
  await run("UPDATE documents SET superseded_by = ?, superseded_at = ?, updated_at = datetime('now') WHERE id = ?", n.id, from, old.id);
  const label = (x) => `${x.code ? `[${x.code}] ` : ''}${x.title}`;
  await logActivity('document', old.id, actor.id, 'superseded', `Bị thay thế bởi văn bản ${label(n)} (áp dụng từ ${from})`);
  await logActivity('document', n.id, actor.id, 'replaces', `Thay thế văn bản ${label(old)}`);
  const watchers = [
    ...(await recipientUserIds(old.id)),
    ...(await all('SELECT user_id FROM document_follows WHERE document_id = ?', old.id)).map((x) => x.user_id),
    ...(await all('SELECT user_id FROM document_views WHERE document_id = ?', old.id)).map((x) => x.user_id),
  ];
  await notify(watchers, { actorId: actor.id, app: APP, type: 'superseded',
    title: `"${old.title}" đã được thay thế bởi "${n.title}" — áp dụng từ ${from.split('-').reverse().join('/')}`, link: `/office/doc/${n.id}` });
}

/** Văn bản thay thế bị xoá / thu hồi: văn bản cũ trở lại hiệu lực. */
async function revertSupersede(newId, actor) {
  const olds = await all('SELECT id FROM documents WHERE superseded_by = ?', newId);
  if (!olds.length) return;
  await run('UPDATE documents SET superseded_by = NULL, superseded_at = NULL WHERE superseded_by = ?', newId);
  for (const o of olds) await logActivity('document', o.id, actor.id, 'restored', 'Văn bản thay thế đã bị huỷ — văn bản trở lại hiệu lực');
}

async function requireViewable(c) {
  const id = toInt(c.req.param('id'));
  await loadDocOr404(id);
  if (!(await canView(c.get('user'), id))) throw forbidden('Bạn không có quyền xem văn bản này');
  return id;
}

r.get('/documents/:id', async (c) => {
  const id = await requireViewable(c);
  await run("INSERT INTO document_views(document_id, user_id) VALUES (?,?) ON CONFLICT DO UPDATE SET viewed_at = datetime('now')", id, c.get('user').id);
  await markSeen(c.get('user').id, `/office/doc/${id}`);
  return c.json(await fullDoc(id, c.get('user')));
});

r.get('/documents/:id/viewers', async (c) => {
  const id = await requireViewable(c);
  return c.json(await all(`SELECT u.id, u.name, u.color, dep.name AS department_name, v.viewed_at FROM document_views v
    JOIN users u ON u.id = v.user_id LEFT JOIN departments dep ON dep.id = u.department_id
    WHERE v.document_id = ? ORDER BY v.viewed_at DESC`, id));
});

r.get('/documents/:id/activity', async (c) => {
  const id = await requireViewable(c);
  return c.json(await all(`SELECT l.*, u.name AS user_name, u.color AS user_color FROM activity_logs l
    LEFT JOIN users u ON u.id = l.user_id WHERE l.entity_type = 'document' AND l.entity_id = ? ORDER BY l.id DESC`, id));
});

const COMMENT_SELECT = `SELECT c.*, u.name AS user_name, u.color AS user_color FROM document_comments c
  LEFT JOIN users u ON u.id = c.user_id`;

r.get('/documents/:id/comments', async (c) => {
  const id = await requireViewable(c);
  return c.json(await withCommentFiles('document', id, await all(`${COMMENT_SELECT} WHERE c.document_id = ? ORDER BY c.id`, id)));
});

r.post('/documents/:id/comments', async (c) => {
  const id = await requireViewable(c);
  const user = c.get('user');
  const d = await loadDocOr404(id);
  const { content, files } = await readComment(c);
  const { lastId } = await run('INSERT INTO document_comments(document_id, user_id, content) VALUES (?,?,?)', id, user.id, content);
  await saveCommentFiles('document', id, lastId, user.id, files);
  const watchers = (await all('SELECT user_id FROM document_follows WHERE document_id = ?', id)).map((x) => x.user_id);
  // @nhắc tên: người được nhắc theo dõi văn bản (được xem để trao đổi) và nhận thông báo riêng
  const mentioned = await findMentions(content, user.id);
  await batch(mentioned.map((uid) => ['INSERT OR IGNORE INTO document_follows(document_id, user_id) VALUES (?,?)', [id, uid]]));
  const snippet = commentSnippet(content, files);
  await notify(mentioned, { actorId: user.id, app: APP, type: 'mention',
    title: `${user.name} đã nhắc đến bạn trong văn bản "${d.title}": ${snippet}`, link: `/office/doc/${id}` });
  await notify([d.creator_id, ...watchers].filter((x) => !mentioned.includes(x)), {
    actorId: user.id, app: APP, type: 'comment',
    title: `${user.name} đã bình luận văn bản "${d.title}"`, link: `/office/doc/${id}`,
  });
  return c.json(await withCommentFiles('document', id, await get(`${COMMENT_SELECT} WHERE c.id = ?`, lastId)), 201);
});
r.get('/documents/:id/comment-files/:fid', async (c) => {
  const id = await requireViewable(c);
  return sendFile(c, await commentFileOr404('document', id, c.req.param('fid')), c.req.query('inline') === '1');
});
r.post('/documents/:id/comment-files/:fid/link', async (c) => {
  const id = await requireViewable(c);
  return c.json(await publicFileLink(c, 'cf', await commentFileOr404('document', id, c.req.param('fid'))));
});

// ---------------------------------------------------------------- create / update
function parseDocBody(b) {
  if (!b.title?.trim()) throw badRequest('Tiêu đề văn bản là bắt buộc');
  if (b.expire_date && b.effective_date && b.expire_date < b.effective_date) {
    throw badRequest('Ngày hết hạn phải sau ngày hiệu lực');
  }
  return {
    code: b.code?.trim() || null,
    title: b.title.trim(),
    description: b.description || null,
    content: b.content || null,
    kind: DOC_KINDS.includes(b.kind) ? b.kind : 'notice',
    type_id: toInt(b.type_id),
    folder_id: toInt(b.folder_id),
    category_id: toInt(b.category_id),
    department_id: toInt(b.department_id),
    sender_department_id: toInt(b.sender_department_id),
    sender_org: b.sender_org || null,
    issuer_id: toInt(b.issuer_id),
    need_numbering: ['1', 'true', true, 1].includes(b.need_numbering) ? 1 : 0,
    effective_date: b.effective_date || null,
    expire_date: b.expire_date || null,
    replaces_id: toInt(b.replaces_id),
    approvers: idList(b.approvers),
    recipient_users: idList(b.recipient_users),
    recipient_departments: idList(b.recipient_departments),
    followers: idList(b.followers),
  };
}

const truthy = (v) => ['1', 'true', true, 1].includes(v);

/** Statements that replace approvers / recipients / followers of a document. */
function relationStatements(id, p, previousApprovals = null) {
  const stmts = [['DELETE FROM document_approvers WHERE document_id = ?', [id]]];
  p.approvers.forEach((uid, i) => {
    const prev = previousApprovals?.find((a) => a.user_id === uid);
    stmts.push(['INSERT INTO document_approvers(document_id, user_id, step, status, comment, acted_at) VALUES (?,?,?,?,?,?)',
      [id, uid, i + 1, prev?.status || 'pending', prev?.comment ?? null, prev?.acted_at ?? null]]);
  });
  stmts.push(['DELETE FROM document_recipients WHERE document_id = ?', [id]]);
  for (const uid of p.recipient_users) stmts.push(['INSERT INTO document_recipients(document_id, user_id) VALUES (?,?)', [id, uid]]);
  for (const did of p.recipient_departments) stmts.push(['INSERT INTO document_recipients(document_id, department_id) VALUES (?,?)', [id, did]]);
  stmts.push(['UPDATE documents SET is_public = ? WHERE id = ?', [p.recipient_users.length || p.recipient_departments.length ? 0 : 1, id]]);
  for (const uid of p.followers) stmts.push(['INSERT OR IGNORE INTO document_follows(document_id, user_id) VALUES (?,?)', [id, uid]]);
  return stmts;
}

async function saveAttachments(id, files) {
  const stored = await storeFiles(files);
  await batch(stored.map((f) => [
    'INSERT INTO document_attachments(document_id, filename, original_name, mime, size) VALUES (?,?,?,?,?)',
    [id, f.filename, f.original_name, f.mime, f.size],
  ]));
}

async function recipientUserIds(id) {
  const d = await get('SELECT is_public FROM documents WHERE id = ?', id);
  if (d.is_public) return (await all('SELECT id FROM users WHERE active = 1')).map((x) => x.id);
  return (await all(`SELECT DISTINCT u.id FROM users u JOIN document_recipients dr ON dr.document_id = ?
    AND (dr.user_id = u.id OR ${inDeptSql('u', 'dr.department_id')}) WHERE u.active = 1`, id)).map((x) => x.id);
}

/** Move a document forward: send to the next approval step, or publish when no approver remains. */
async function advance(id, actor) {
  const d = await get('SELECT * FROM documents WHERE id = ?', id);
  const step = (await get("SELECT MIN(step) AS s FROM document_approvers WHERE document_id = ? AND status = 'pending'", id)).s;
  if (step) {
    await run("UPDATE documents SET status = 'pending', updated_at = datetime('now') WHERE id = ?", id);
    const approvers = await all("SELECT user_id FROM document_approvers WHERE document_id = ? AND step = ? AND status = 'pending'", id, step);
    await notify(approvers.map((a) => a.user_id), {
      actorId: actor.id, app: APP, type: 'approval',
      title: `Văn bản "${d.title}" đang chờ bạn duyệt`, link: `/office/doc/${id}`,
    });
    return 'pending';
  }
  await run(`UPDATE documents SET status = 'issued', issued_at = COALESCE(issued_at, datetime('now')),
       issuer_id = COALESCE(issuer_id, creator_id), updated_at = datetime('now') WHERE id = ?`, id);
  await logActivity('document', id, actor.id, 'issued', 'Văn bản đã được ban hành');
  await applySupersede(id, actor);
  await notify(await recipientUserIds(id), {
    actorId: actor.id, app: APP, type: 'issued', title: `Văn bản mới: ${d.title}`, link: `/office/doc/${id}`,
  });
  return 'issued';
}

async function resubmit(id, user) {
  await run("UPDATE document_approvers SET status = 'pending', comment = NULL, acted_at = NULL WHERE document_id = ?", id);
  await logActivity('document', id, user.id, 'submitted', 'Gửi văn bản');
  await advance(id, user);
}

r.post('/documents', async (c) => {
  const user = c.get('user');
  const st = await officeSettings();
  if (!(await canCreateDoc(user, st))) throw forbidden('Bạn chưa được cấp quyền tạo văn bản (Cài đặt Office)');
  const { fields, files } = await formBody(c);
  if (!fields.expire_date && st.default_expire_days) {
    const d = new Date(fields.effective_date || Date.now());
    d.setDate(d.getDate() + st.default_expire_days);
    fields.expire_date = d.toISOString().slice(0, 10);
  }
  const p = parseDocBody(fields);
  await checkReplaceTarget(user, p.replaces_id);
  const asDraft = truthy(fields.draft);
  const { lastId: id } = await run(
    `INSERT INTO documents(code, title, description, content, kind, type_id, folder_id, category_id, department_id,
      sender_department_id, sender_org, issuer_id, creator_id, need_numbering, effective_date, expire_date, replaces_id, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'draft')`,
    p.code, p.title, p.description, p.content, p.kind, p.type_id, p.folder_id, p.category_id, p.department_id,
    p.sender_department_id, p.sender_org, p.issuer_id || user.id, user.id, p.need_numbering, p.effective_date, p.expire_date, p.replaces_id
  );
  await batch([
    ...relationStatements(id, p),
    ['INSERT OR IGNORE INTO document_follows(document_id, user_id) VALUES (?,?)', [id, user.id]],
  ]);
  await saveAttachments(id, files);
  await logActivity('document', id, user.id, 'created', asDraft ? 'Lưu nháp văn bản' : 'Tạo văn bản');
  if (!asDraft) await advance(id, user);
  return c.json(await fullDoc(id, user), 201);
});

r.put('/documents/:id', async (c) => {
  const user = c.get('user');
  const id = toInt(c.req.param('id'));
  const d = await loadDocOr404(id);
  if (!canEdit(user, d)) throw forbidden();
  if (!['draft', 'rejected'].includes(d.status) && user.role !== 'admin') {
    throw badRequest('Chỉ có thể chỉnh sửa văn bản ở trạng thái nháp hoặc không thông qua');
  }
  const { fields, files } = await formBody(c);
  const p = parseDocBody(fields);
  if (fields.replaces_id === undefined) p.replaces_id = d.replaces_id;
  if (p.replaces_id !== d.replaces_id) await checkReplaceTarget(user, p.replaces_id, id);
  const stmts = [[
    `UPDATE documents SET code = ?, title = ?, description = ?, content = ?, kind = ?, type_id = ?, folder_id = ?,
      category_id = ?, department_id = ?, sender_department_id = ?, sender_org = ?, issuer_id = COALESCE(?, issuer_id),
      need_numbering = ?, effective_date = ?, expire_date = ?, replaces_id = ?, updated_at = datetime('now') WHERE id = ?`,
    [p.code, p.title, p.description, p.content, p.kind, p.type_id, p.folder_id, p.category_id, p.department_id,
      p.sender_department_id, p.sender_org, p.issuer_id, p.need_numbering, p.effective_date, p.expire_date, p.replaces_id, id],
  ]];
  if (d.status === 'issued' || d.status === 'archived') {
    // Văn bản đã ban hành: giữ nguyên luồng duyệt và kết quả duyệt
    const prev = await all('SELECT * FROM document_approvers WHERE document_id = ? ORDER BY step', id);
    p.approvers = prev.map((a) => a.user_id);
    stmts.push(...relationStatements(id, p, prev));
  } else {
    stmts.push(...relationStatements(id, p));
  }
  const removeIds = idList(fields.remove_attachments);
  const removed = removeIds.length
    ? await all(`SELECT * FROM document_attachments WHERE document_id = ? AND id IN (${removeIds.map(() => '?').join(',')})`, id, ...removeIds)
    : [];
  for (const a of removed) stmts.push(['DELETE FROM document_attachments WHERE id = ?', [a.id]]);
  await batch(stmts);
  for (const a of removed) await removeFile(a.filename);
  await saveAttachments(id, files);
  await logActivity('document', id, user.id, 'updated', 'Cập nhật văn bản');
  // văn bản đã ban hành được sửa: cập nhật lại liên kết thay thế
  if (d.status === 'issued' || d.status === 'archived') {
    if (d.replaces_id && d.replaces_id !== p.replaces_id) await revertSupersede(id, user);
    if (p.replaces_id && (p.replaces_id !== d.replaces_id || p.effective_date !== d.effective_date)) await applySupersede(id, user);
  }
  if (truthy(fields.submit) && ['draft', 'rejected'].includes(d.status)) await resubmit(id, user);
  return c.json(await fullDoc(id, user));
});

r.post('/documents/:id/submit', async (c) => {
  const user = c.get('user');
  const id = toInt(c.req.param('id'));
  const d = await loadDocOr404(id);
  if (!canEdit(user, d)) throw forbidden();
  if (!['draft', 'rejected'].includes(d.status)) throw badRequest('Văn bản đã được gửi');
  await resubmit(id, user);
  return c.json(await fullDoc(id, user));
});

r.post('/documents/:id/approve', async (c) => {
  const user = c.get('user');
  const id = toInt(c.req.param('id'));
  const d = await loadDocOr404(id);
  const b = await jsonBody(c);
  const decision = b.decision === 'reject' ? 'rejected' : 'approved';
  const comment = b.comment || null;
  const step = (await get("SELECT MIN(step) AS s FROM document_approvers WHERE document_id = ? AND status = 'pending'", id)).s;
  const mine = await get('SELECT * FROM document_approvers WHERE document_id = ? AND user_id = ?', id, user.id);
  if (d.status !== 'pending' || !mine || mine.status !== 'pending' || mine.step !== step) {
    throw forbidden('Bạn không phải người duyệt ở bước hiện tại');
  }
  // Guard against a concurrent decision on the same step
  const { changes } = await run(
    "UPDATE document_approvers SET status = ?, comment = ?, acted_at = datetime('now') WHERE document_id = ? AND user_id = ? AND status = 'pending'",
    decision, comment, id, user.id
  );
  if (!changes) throw badRequest('Văn bản đã được xử lý');
  if (decision === 'rejected') {
    await run("UPDATE documents SET status = 'rejected', updated_at = datetime('now') WHERE id = ?", id);
    await logActivity('document', id, user.id, 'rejected', comment ? `Không thông qua: ${comment}` : 'Không thông qua');
    await notify(d.creator_id, { actorId: user.id, app: APP, type: 'rejected',
      title: `${user.name} không thông qua văn bản "${d.title}"`, link: `/office/doc/${id}` });
  } else {
    await logActivity('document', id, user.id, 'approved', comment ? `Đã duyệt: ${comment}` : 'Đã duyệt');
    await notify(d.creator_id, { actorId: user.id, app: APP, type: 'approved',
      title: `${user.name} đã duyệt văn bản "${d.title}"`, link: `/office/doc/${id}` });
    await advance(id, user);
  }
  return c.json(await fullDoc(id, user));
});

r.post('/documents/:id/number', async (c) => {
  const user = c.get('user');
  const id = toInt(c.req.param('id'));
  const d = await loadDocOr404(id);
  const st = await officeSettings();
  if (!isClerk(user, st) && d.creator_id !== user.id) throw forbidden('Chỉ văn thư hoặc người tạo được cấp số văn bản');
  let code = String((await jsonBody(c)).code || '').trim();
  if (!code) code = await nextCode(d, st);
  if (await get("SELECT 1 FROM documents WHERE code = ? AND id <> ? AND deleted_at IS NULL", code, id)) {
    throw badRequest(`Số hiệu "${code}" đã được dùng cho văn bản khác`);
  }
  await run("UPDATE documents SET code = ?, updated_at = datetime('now') WHERE id = ?", code, id);
  await logActivity('document', id, user.id, 'numbered', `Cấp số văn bản: ${code}`);
  return c.json(await fullDoc(id, user));
});

const toggle = (table) => async (c) => {
  const id = await requireViewable(c);
  const uid = c.get('user').id;
  const exists = await get(`SELECT 1 FROM ${table} WHERE document_id = ? AND user_id = ?`, id, uid);
  if (exists) await run(`DELETE FROM ${table} WHERE document_id = ? AND user_id = ?`, id, uid);
  else await run(`INSERT INTO ${table}(document_id, user_id) VALUES (?,?)`, id, uid);
  return c.json({ active: !exists });
};
r.post('/documents/:id/star', toggle('document_stars'));
r.post('/documents/:id/follow', toggle('document_follows'));

r.post('/documents/:id/archive', async (c) => {
  const user = c.get('user');
  const id = toInt(c.req.param('id'));
  const d = await loadDocOr404(id);
  if (!canEdit(user, d)) throw forbidden();
  if (d.status !== 'issued' && d.status !== 'archived') throw badRequest('Chỉ cất giữ được văn bản đã ban hành');
  const next = d.status === 'archived' ? 'issued' : 'archived';
  await run("UPDATE documents SET status = ?, updated_at = datetime('now') WHERE id = ?", next, id);
  await logActivity('document', id, user.id, next === 'archived' ? 'archived' : 'unarchived', next === 'archived' ? 'Cất giữ văn bản' : 'Bỏ cất giữ văn bản');
  return c.json(await fullDoc(id, user));
});

r.delete('/documents/:id', async (c) => {
  const user = c.get('user');
  const id = toInt(c.req.param('id'));
  const d = await loadDocOr404(id);
  if (!canEdit(user, d)) throw forbidden();
  if (c.req.query('permanent') === '1') {
    if (!d.deleted_at) throw badRequest('Chỉ xóa vĩnh viễn văn bản trong thùng rác');
    const files = await all('SELECT filename FROM document_attachments WHERE document_id = ?', id);
    await purgeCommentFiles('document', { entityIds: [id] });
    await run('DELETE FROM documents WHERE id = ?', id);
    for (const f of files) await removeFile(f.filename);
    return c.json({ ok: true });
  }
  await run("UPDATE documents SET deleted_at = datetime('now') WHERE id = ?", id);
  await logActivity('document', id, user.id, 'deleted', 'Tạm xóa văn bản');
  await revertSupersede(id, user);
  return c.json({ ok: true });
});

r.post('/documents/:id/restore', async (c) => {
  const user = c.get('user');
  const id = toInt(c.req.param('id'));
  const d = await loadDocOr404(id);
  if (!canEdit(user, d)) throw forbidden();
  await run('UPDATE documents SET deleted_at = NULL WHERE id = ?', id);
  await logActivity('document', id, user.id, 'restored', 'Khôi phục văn bản');
  if (['issued', 'archived'].includes(d.status) && d.replaces_id) {
    const old = await get('SELECT superseded_by FROM documents WHERE id = ?', d.replaces_id);
    if (old && !old.superseded_by) await applySupersede(id, user);
  }
  return c.json({ ok: true });
});

r.post('/documents/bulk', async (c) => {
  const user = c.get('user');
  const b = await jsonBody(c);
  let n = 0;
  for (const id of idList(b.ids)) {
    const d = await get('SELECT * FROM documents WHERE id = ?', id);
    if (!d || !(await canView(user, id))) continue;
    if (b.action === 'star') await run('INSERT OR IGNORE INTO document_stars(document_id, user_id) VALUES (?,?)', id, user.id);
    else if (b.action === 'follow') await run('INSERT OR IGNORE INTO document_follows(document_id, user_id) VALUES (?,?)', id, user.id);
    else if (b.action === 'read') await run('INSERT OR IGNORE INTO document_views(document_id, user_id) VALUES (?,?)', id, user.id);
    else if (b.action === 'delete' && canEdit(user, d)) {
      await run("UPDATE documents SET deleted_at = datetime('now') WHERE id = ?", id);
      await logActivity('document', id, user.id, 'deleted', 'Tạm xóa văn bản');
      await revertSupersede(id, user);
    } else if (b.action === 'move' && canEdit(user, d)) await run('UPDATE documents SET folder_id = ? WHERE id = ?', toInt(b.folder_id), id);
    else continue;
    n++;
  }
  return c.json({ affected: n });
});

// ---------------------------------------------------------------- attachments
r.post('/documents/:id/attachments/:aid/link', async (c) => {
  const id = await requireViewable(c);
  const a = await get('SELECT id, original_name FROM document_attachments WHERE id = ? AND document_id = ?', toInt(c.req.param('aid')), id);
  if (!a) throw notFound('Tệp không tồn tại');
  return c.json(await publicFileLink(c, 'da', a));
});
r.get('/documents/:id/attachments/:aid', async (c) => {
  const id = await requireViewable(c);
  const a = await get('SELECT * FROM document_attachments WHERE id = ? AND document_id = ?', toInt(c.req.param('aid')), id);
  if (!a) throw notFound('Tệp không tồn tại');
  return sendFile(c, a, c.req.query('inline') === '1');
});

// ---------------------------------------------------------------- taxonomies
function taxonomy(kind, label) {
  const table = `doc_${kind}`;
  const isType = kind === 'types';
  r.post(`/office/${kind}`, async (c) => {
    const b = await jsonBody(c);
    const name = String(b.name || '').trim();
    if (!name) throw badRequest(`Tên ${label} là bắt buộc`);
    const { lastId } = isType
      ? await run(`INSERT INTO ${table}(name, prefix) VALUES (?,?)`, name, b.prefix || null)
      : await run(`INSERT INTO ${table}(name, parent_id) VALUES (?,?)`, name, toInt(b.parent_id));
    return c.json(await get(`SELECT * FROM ${table} WHERE id = ?`, lastId), 201);
  });
  r.put(`/office/${kind}/:id`, requireAdmin, async (c) => {
    const id = toInt(c.req.param('id'));
    const b = await jsonBody(c);
    const name = String(b.name || '').trim();
    if (!name) throw badRequest(`Tên ${label} là bắt buộc`);
    if (isType) await run(`UPDATE ${table} SET name = ?, prefix = ? WHERE id = ?`, name, b.prefix || null, id);
    else {
      if (toInt(b.parent_id) === id) throw badRequest('Thư mục cha không hợp lệ');
      await run(`UPDATE ${table} SET name = ?, parent_id = ? WHERE id = ?`, name, toInt(b.parent_id), id);
    }
    return c.json(await get(`SELECT * FROM ${table} WHERE id = ?`, id));
  });
  r.delete(`/office/${kind}/:id`, requireAdmin, async (c) => {
    await run(`DELETE FROM ${table} WHERE id = ?`, toInt(c.req.param('id')));
    return c.json({ ok: true });
  });
}
taxonomy('types', 'loại văn bản');
taxonomy('folders', 'kho lưu trữ');
taxonomy('categories', 'thư mục');

export default r;
