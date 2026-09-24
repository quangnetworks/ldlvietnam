import { Star, Check, X, Repeat, MessageSquare, ListChecks, GitBranch, Play } from 'lucide-react';
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

export function TaskRow({ t, onOpen, onChanged, selectable, selected, onSelect, showProject = true }) {
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
    <div className={cx('task-row', t.status === 'done' && 'is-done', selected && 'selected')} onClick={() => onOpen(t.id)}>
      {selectable && (
        <input type="checkbox" checked={selected} onClick={(e) => e.stopPropagation()} onChange={() => onSelect(t.id)} aria-label="Chọn" />
      )}
      <StatusCircle task={t} onChange={setStatus} />
      <div className="task-body">
        <div className="task-title">{t.parent_id ? <GitBranch size={13} className="muted" /> : null} {t.title}</div>
        <div className="task-meta">
          <TaskTags t={t} showProject={showProject} />
          <span className="muted ellipsis">
            {desc && `${desc.slice(0, 120)} · `}Tạo bởi @{t.creator_username}
          </span>
          {t.subtask_count > 0 && <span className="muted mini"><GitBranch size={12} /> {t.subtask_done}/{t.subtask_count}</span>}
          {t.checklist_count > 0 && <span className="muted mini"><ListChecks size={12} /> {t.checklist_done}/{t.checklist_count}</span>}
          {t.comment_count > 0 && <span className="muted mini"><MessageSquare size={12} /> {t.comment_count}</span>}
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
