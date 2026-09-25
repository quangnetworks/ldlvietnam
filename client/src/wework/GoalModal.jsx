import { useEffect, useRef, useState } from 'react';
import { Target, Trash2, Plus, X, Search, Link2 } from 'lucide-react';
import { api } from '../api.js';
import { useFetch, useToast } from '../context.jsx';
import { Modal, Field, Progress, Avatar } from '../components/ui.jsx';
import { useDebounced } from '../components/shell.jsx';
import { fmtDate, cx } from '../utils.js';
import { useWework } from './WeworkLayout.jsx';
import { StatusPill } from './taskParts.jsx';

/** Tìm công việc để gắn vào mục tiêu (công việc tôi giao / được giao). */
function TaskSearch({ exclude, onPick }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q, 250);
  const [items, setItems] = useState([]);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    api.get('/tasks', { scope: 'mine', q: dq.trim() || undefined, status: 'unreviewed', limit: 20, sort: 'due' })
      .then((r) => setItems(r.items.filter((t) => !exclude.includes(t.id)))).catch(() => setItems([]));
  }, [dq, open, exclude]);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div className="goal-search" ref={ref}>
      <div className="input-icon"><Search size={14} className="muted" />
        <input className="input" value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          placeholder="Tìm công việc liên quan để gắn vào mục tiêu…" /></div>
      {open && (
        <div className="replace-menu">
          {items.map((t) => (
            <button type="button" key={t.id} className="menu-item" onClick={() => { onPick(t); setQ(''); setOpen(false); }}>
              <span className="grow ellipsis">{t.title}{t.goal_id ? <small className="muted"> · đang thuộc mục tiêu khác</small> : null}</span>
              <small className="muted">{t.project_name || 'Cá nhân'}{t.due_date ? ` · ${fmtDate(t.due_date)}` : ''}</small>
            </button>
          ))}
          {!items.length && <div className="empty-small">Không tìm thấy công việc đang thực hiện</div>}
        </div>
      )}
    </div>
  );
}

/**
 * Mục tiêu: tên, mô tả, hạn, tiến độ (tự tính theo công việc gắn kèm hoặc nhập tay)
 * và danh sách công việc liên quan (gắn thêm / bỏ gắn / tạo công việc mới cho mục tiêu).
 */
export default function GoalModal({ goal, onClose, onSaved }) {
  const { openTask, openCreate, version } = useWework();
  const toast = useToast();
  const [f, setF] = useState({ title: '', description: '', progress: 0, due_date: '', auto_progress: true, ...goal,
    auto_progress: goal?.auto_progress === undefined ? true : !!goal.auto_progress, due_date: goal?.due_date || '' });
  const [pending, setPending] = useState([]); // công việc chọn trước khi lưu mục tiêu mới
  const [tasks, reloadTasks] = useFetch(() => (goal?.id ? api.get(`/goals/${goal.id}/tasks`) : Promise.resolve([])), [goal?.id, version]);
  const linked = [...(tasks || []), ...pending];
  const done = linked.filter((t) => t.status === 'done').length;
  const autoPct = linked.length ? Math.round((done / linked.length) * 100) : null;
  const pct = f.auto_progress && autoPct !== null ? autoPct : f.progress;

  const save = async () => {
    try {
      const body = { title: f.title, description: f.description, due_date: f.due_date, progress: f.progress, auto_progress: f.auto_progress };
      if (goal?.id) await api.put(`/goals/${goal.id}`, body);
      else await api.post('/goals', { ...body, task_ids: pending.map((t) => t.id) });
      toast('Đã lưu mục tiêu');
      onSaved();
    } catch (e) { toast(e.message, 'error'); }
  };
  const link = async (t) => {
    if (!goal?.id) { setPending((p) => [...p, t]); return; }
    try {
      const r = await api.post(`/goals/${goal.id}/tasks`, { task_ids: [t.id] });
      if (!r.linked) toast('Bạn không có quyền gắn công việc này', 'error');
      reloadTasks();
    } catch (e) { toast(e.message, 'error'); }
  };
  const unlink = async (t) => {
    if (!goal?.id) { setPending((p) => p.filter((x) => x.id !== t.id)); return; }
    await api.del(`/goals/${goal.id}/tasks/${t.id}`);
    reloadTasks();
  };

  return (
    <Modal title={<span className="row gap-sm"><Target size={17} /> {goal?.id ? 'Mục tiêu' : 'Thêm mục tiêu'}</span>} onClose={() => { onClose(); }} width={640}
      footer={<>
        {goal?.id && (
          <button className="btn btn-danger-ghost" onClick={async () => {
            if (!window.confirm('Xoá mục tiêu? Các công việc gắn kèm vẫn giữ nguyên, chỉ bỏ liên kết.')) return;
            await api.del(`/goals/${goal.id}`); onSaved();
          }}><Trash2 size={14} /> Xoá</button>
        )}
        <div className="grow" />
        <button className="btn" onClick={onClose}>Hủy</button>
        <button className="btn btn-primary" disabled={!f.title.trim()} onClick={save}>Lưu</button>
      </>}>
      <div className="form-grid one">
        <Field label="Tên mục tiêu" required><input className="input" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ví dụ: Mở 20 điểm bán mới trong Q4" /></Field>
        <Field label="Mô tả / chỉ tiêu"><textarea className="input" rows={2} value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="form-grid">
          <Field label="Hạn hoàn thành"><input type="date" className="input" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          <div className="field">
            <span className="field-label">Tiến độ: <b>{pct}%</b></span>
            <Progress value={pct} color="#37b24d" />
            <label className="check small"><input type="checkbox" checked={f.auto_progress} onChange={(e) => setF({ ...f, auto_progress: e.target.checked })} /> Tự tính theo công việc đã hoàn thành</label>
            {(!f.auto_progress || autoPct === null) && (
              <input type="range" min="0" max="100" step="5" value={f.progress} onChange={(e) => setF({ ...f, progress: Number(e.target.value) })} aria-label="Tiến độ" />
            )}
          </div>
        </div>
      </div>

      <div className="goal-tasks">
        <div className="row between">
          <b><Link2 size={14} /> Công việc liên quan ({linked.length}){linked.length > 0 && <small className="muted"> · {done} đã hoàn thành</small>}</b>
          {goal?.id && <button className="link-btn" onClick={() => openCreate({ goal_id: goal.id, openAfter: false })}><Plus size={14} /> Tạo công việc mới</button>}
        </div>
        <TaskSearch exclude={linked.map((t) => t.id)} onPick={link} />
        <div className="goal-task-list">
          {linked.map((t) => (
            <div key={t.id} className={cx('goal-task', t.status === 'done' && 'done')}>
              <button type="button" className="grow goal-task-main" onClick={() => goal?.id && openTask(t.id)}>
                <span className="ellipsis block">{t.title}</span>
                <small className="muted">{t.project_name || 'Cá nhân'}{t.due_date ? ` · hạn ${fmtDate(t.due_date)}` : ''}</small>
              </button>
              {t.is_overdue && <span className="status-pill overdue">Quá hạn</span>}
              <StatusPill status={t.status} />
              {t.assignee_name && <Avatar name={t.assignee_name} color={t.assignee_color} uid={t.assignee_id} size={22} title={t.assignee_name} />}
              <button type="button" className="icon-btn sm" title="Bỏ gắn khỏi mục tiêu" onClick={() => unlink(t)}><X size={14} /></button>
            </div>
          ))}
          {!linked.length && <p className="muted small">Chưa có công việc nào. Tìm và gắn các công việc giúp đạt mục tiêu — tiến độ mục tiêu sẽ tự cập nhật khi công việc hoàn thành.</p>}
        </div>
      </div>
    </Modal>
  );
}
