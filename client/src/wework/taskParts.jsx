import { useEffect, useState } from 'react';
import { Star, Check, X, Repeat, MessageSquare, ListChecks, GitBranch, Play, Award, CornerDownRight, FolderTree, ChevronRight } from 'lucide-react';
import { api } from '../api.js';
import { Avatar } from '../components/ui.jsx';
import { TASK_STATUS, PRIORITY, RECURRING, fmtDate, stripHtml, cx } from '../utils.js';

export function StatusCircle({ task, onChange, size = 26 }) {
  const done = task.status === 'done';
  const failed = task.status === 'failed';
  return (
    <button
      type="button"
      className={cx('status-circle', done && 'done', failed && 'failed', task.status === 'doing' && 'doing', task.status === 'review' && 'review')}
      style={{ width: size, height: size }}
      title={done ? 'Đánh dấu chưa hoàn thành' : 'Đánh dấu hoàn thành'}
      onClick={(e) => {
        e.stopPropagation();
        onChange(done ? 'todo' : 'done');
      }}
    >
      {done && <Check size={size * 0.6} strokeWidth={3} />}
      {failed && <X size={size * 0.6} strokeWidth={3} />}
      {task.status === 'doing' && <Play size={size * 0.4} fill="currentColor" />}
    </button>
  );
}

export function TaskTags({ t, showProject = true }) {
  return (
    <>
      {showProject && t.project_name && <span className="tag tag-blue-outline">{t.project_name}</span>}
      {t.is_overdue && <span className="tag tag-red">Quá hạn</span>}
      {t.is_late && <span className="tag tag-orange">Hoàn thành muộn</span>}
      {t.status === 'review' && <span className="tag tag-orange-outline">Chờ đánh giá</span>}
      {t.status === 'failed' && <span className="tag tag-red-outline">Thất bại</span>}
      {t.status === 'doing' && <span className="tag tag-blue">Đang làm</span>}
      {t.priority !== 'normal' && <span className={cx('tag', PRIORITY[t.priority].cls)}>{PRIORITY[t.priority].label}</span>}
      {t.recurring && <span className="tag tag-gray"><Repeat size={10} /> {RECURRING[t.recurring]}</span>}
      {t.start_date && <span className="tag tag-gray">▸ bắt đầu {fmtDate(t.start_date)}</span>}
    </>
  );
}

/**
 * Sắp xếp để công việc con nằm ngay dưới công việc cha (nếu cha cũng có trong danh sách).
 * Trả về [{ t, depth, orphan }] — orphan: công việc con mà cha không nằm trong danh sách đang xem.
 */
export function nestTasks(items) {
  const ids = new Set(items.map((t) => t.id));
  const children = new Map();
  for (const t of items) {
    if (t.parent_id && ids.has(t.parent_id)) {
      if (!children.has(t.parent_id)) children.set(t.parent_id, []);
      children.get(t.parent_id).push(t);
    }
  }
  const out = [];
  const walk = (t, depth) => {
    out.push({ t, depth, orphan: depth === 0 && !!t.parent_id, childrenShown: children.has(t.id) });
    for (const c of children.get(t.id) || []) if (depth < 6) walk(c, depth + 1);
  };
  for (const t of items) if (!t.parent_id || !ids.has(t.parent_id)) walk(t, 0);
  return out;
}

/** Nhãn phân biệt cấp: "Công việc cha · 2/3 việc con" hoặc "↳ Việc con của …". */
export function LevelTag({ t, orphan }) {
  if (t.parent_id) {
    return <span className="lvl-tag child" title={t.parent_title ? `Công việc con của: ${t.parent_title}` : 'Công việc con'}>
      <CornerDownRight size={11} /> Việc con{orphan && t.parent_title ? <> của <b className="ellipsis">{t.parent_title}</b></> : ''}
    </span>;
  }
  if (t.subtask_count > 0) {
    return <span className="lvl-tag parent" title="Công việc cha"><FolderTree size={11} /> Việc cha · {t.subtask_done}/{t.subtask_count} việc con</span>;
  }
  return null;
}

export function TaskRow(props) {
  const { t, depth = 0, childrenShown = false, onOpen, onChanged } = props;
  const [open, setOpen] = useState(false);
  const [kids, setKids] = useState(null);
  const canExpand = t.subtask_count > 0 && !childrenShown && depth < 5;
  const toggle = async (e) => {
    e.stopPropagation();
    if (!open && !kids) {
      try { setKids((await api.get('/tasks', { parent_id: t.id, sort: 'position', limit: 100 })).items); } catch { setKids([]); }
    }
    setOpen(!open);
  };
  const reloadKids = async () => {
    if (open) { try { setKids((await api.get('/tasks', { parent_id: t.id, sort: 'position', limit: 100 })).items); } catch { /* bỏ qua */ } }
    onChanged?.();
  };
  return (
    <>
      <TaskRowInner {...props} expander={canExpand ? (
        <button type="button" className={cx('expander', open && 'open')} onClick={toggle} title={open ? 'Thu gọn việc con' : `Xem ${t.subtask_count} việc con`} aria-expanded={open}>
          <ChevronRight size={15} />
        </button>
      ) : depth === 0 ? <span className="expander-space" /> : null} />
      {open && kids?.map((k) => <TaskRow key={k.id} {...props} t={k} depth={depth + 1} orphan={false} childrenShown={false} onOpen={onOpen} onChanged={reloadKids} selectable={false} />)}
    </>
  );
}

function TaskRowInner({ t, onOpen, onChanged, selectable, selected, onSelect, showProject = true, depth = 0, orphan = false, expander }) {
  const setStatus = async (status) => {
    await api.put(`/tasks/${t.id}`, { status });
    onChanged?.();
  };
  const star = async (e) => {
    e.stopPropagation();
    await api.post(`/tasks/${t.id}/star`);
    onChanged?.();
  };
  const desc = t.description ? stripHtml(t.description) : '';
  return (
    <div className={cx('task-row', t.status === 'done' && 'is-done', selected && 'selected', t.parent_id ? 'is-child' : t.subtask_count > 0 && 'is-parent', depth > 0 && 'nested')}
      style={depth > 0 ? { '--depth': depth } : undefined} onClick={() => onOpen(t.id)}>
      {depth > 0 && <span className="tree-line" aria-hidden />}
      {expander}
      {selectable && (
        <input type="checkbox" checked={selected} onClick={(e) => e.stopPropagation()} onChange={() => onSelect(t.id)} aria-label="Chọn" />
      )}
      <StatusCircle task={t} onChange={setStatus} />
      <div className="task-body">
        <div className="task-title">{t.title}</div>
        <div className="task-meta">
          <LevelTag t={t} orphan={orphan || depth === 0} />
          <TaskTags t={t} showProject={showProject} />
          <span className="muted ellipsis">
            {desc && `${desc.slice(0, 120)} · `}Tạo bởi @{t.creator_username}
          </span>
          {t.checklist_count > 0 && <span className="muted mini"><ListChecks size={12} /> {t.checklist_done}/{t.checklist_count}</span>}
          {t.comment_count > 0 && <span className="muted mini"><MessageSquare size={12} /> {t.comment_count}</span>}
          {t.result_count > 0 && <span className="muted mini" title="Kết quả đã cập nhật"><Award size={12} /> {t.result_count}</span>}
        </div>
      </div>
      <div className={cx('task-due', t.is_overdue && 'text-red')}>{fmtDate(t.due_date)}</div>
      <div className="task-assignee">
        {t.assignee_name && <><Avatar name={t.assignee_name} color={t.assignee_color} size={22} /> <span className="ellipsis">{t.assignee_name}</span></>}
      </div>
      <button className={cx('icon-btn sm', t.starred && 'starred')} onClick={star} title="Đánh dấu sao">
        <Star size={16} fill={t.starred ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
}

export function StatusPill({ status }) {
  const s = TASK_STATUS[status];
  return <span className="status-pill" style={{ background: `${s.color}1a`, color: s.color }}>{s.label}</span>;
}

/** Người mà tài khoản hiện tại được giao việc (quản trị viên: mọi người; quản lý: nhân viên mình; quản lý dự án: thành viên dự án). */
export function useAssignable(users, projectId, keep = []) {
  const [scope, setScope] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get('/wework/assignable', { project_id: projectId || undefined }).then((s) => alive && setScope(s)).catch(() => alive && setScope(null));
    return () => { alive = false; };
  }, [projectId]);
  if (!scope || scope.all) return users;
  const ok = new Set([...scope.ids, ...keep.filter(Boolean)]);
  return users.filter((u) => ok.has(u.id));
}

/** Tạo nhanh nhóm công việc trong dự án; trả về id nhóm mới (hoặc null nếu huỷ). */
export async function createTaskList(projectId, toast) {
  const name = window.prompt('Tên nhóm công việc mới (ví dụ: Chuẩn bị, Triển khai, Nghiệm thu)');
  if (!name?.trim()) return null;
  try {
    const lists = await api.post(`/projects/${projectId}/lists`, { name: name.trim() });
    toast?.(`Đã tạo nhóm "${name.trim()}"`);
    return { lists, id: lists.reduce((m, l) => (l.id > m ? l.id : m), 0) };
  } catch (e) {
    toast?.(e.message, 'error');
    return null;
  }
}
