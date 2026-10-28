/** Chuyển công việc thành công việc con của một công việc khác, hoặc tách khỏi công việc cha. */
import { useState } from 'react';
import { Search, GitBranch, Unlink } from 'lucide-react';
import { api } from '../api.js';
import { useFetch, useToast } from '../context.jsx';
import { Modal, Spinner } from '../components/ui.jsx';
import { useDebounced } from '../components/shell.jsx';
import { TASK_STATUS, cx } from '../utils.js';

export default function MoveTaskModal({ task, onClose, onMoved }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const dq = useDebounced(q);
  const [data, , loading] = useFetch(() => api.get('/tasks', { q: dq, limit: 30, sort: 'updated' }), [dq]);
  // loại chính nó, công việc cha hiện tại và các công việc con trực tiếp (máy chủ chặn cả công việc cháu)
  const exclude = new Set([task.id, task.parent_id, ...(task.subtasks || []).map((s) => s.id)]);
  const items = (data?.items || []).filter((t) => !exclude.has(t.id));
  const move = async (parentId) => {
    setBusy(true);
    try {
      await api.post(`/tasks/${task.id}/move`, { parent_id: parentId });
      toast(parentId ? 'Đã chuyển thành công việc con' : 'Đã tách thành công việc độc lập');
      onMoved();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Chuyển thành công việc con" onClose={onClose} width={560}
      footer={<>
        {task.parent_id && <button className="btn" disabled={busy} onClick={() => move(null)}><Unlink size={14} /> Tách khỏi công việc cha</button>}
        <div className="grow" />
        <button className="btn" onClick={onClose}>Hủy</button>
        <button className="btn btn-primary" disabled={!pick || busy} onClick={() => move(pick.id)}>Chuyển vào công việc này</button>
      </>}>
      <p className="muted small">Chọn công việc cha cho <b>“{task.title}”</b>. Công việc (cùng các công việc con của nó) sẽ chuyển theo dự án của công việc cha.</p>
      <div className="ww-search mv-search"><Search size={14} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm công việc theo tên" /></div>
      <div className="mv-list">
        {loading && !data ? <Spinner /> : !items.length ? <p className="muted small">Không tìm thấy công việc phù hợp</p> : items.map((t) => (
          <button key={t.id} type="button" className={cx('mv-item', pick?.id === t.id && 'active')} onClick={() => setPick(t)}>
            <GitBranch size={14} />
            <span className="grow ellipsis"><b>{t.title}</b><small className="muted block">#{t.id} · {t.project_name || 'Công việc cá nhân'}{t.assignee_name ? ` · ${t.assignee_name}` : ''}</small></span>
            <span className="small" style={{ color: TASK_STATUS[t.status]?.color }}>{TASK_STATUS[t.status]?.label}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
