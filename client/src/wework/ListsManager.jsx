/** Quản lý nhóm công việc của dự án / phòng ban: thêm, đổi tên, sắp xếp thứ tự, xoá. */
import { useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Check } from 'lucide-react';
import { api } from '../api.js';
import { useToast } from '../context.jsx';
import { Modal } from '../components/ui.jsx';

export default function ListsManager({ project, tasks, canDelete, onClose, onChanged }) {
  const toast = useToast();
  const [lists, setLists] = useState(project.lists);
  const [names, setNames] = useState(Object.fromEntries(project.lists.map((l) => [l.id, l.name])));
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const count = (id) => tasks.filter((t) => t.list_id === id).length;
  const call = async (fn, msg) => {
    setBusy(true);
    try {
      const r = await fn();
      setLists(r);
      setNames(Object.fromEntries(r.map((l) => [l.id, l.name])));
      if (msg) toast(msg);
      onChanged();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const add = () => newName.trim() && call(() => api.post(`/projects/${project.id}/lists`, { name: newName.trim() }), `Đã thêm nhóm "${newName.trim()}"`).then(() => setNewName(''));
  const rename = (l) => names[l.id]?.trim() && names[l.id].trim() !== l.name && call(() => api.put(`/projects/${project.id}/lists/${l.id}`, { name: names[l.id].trim() }), 'Đã đổi tên nhóm');
  // đổi chỗ với nhóm bên cạnh: đánh lại vị trí 1..n cho toàn bộ danh sách
  const move = async (i, d) => {
    const next = [...lists];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    await call(async () => {
      let r = lists;
      for (const [pos, l] of next.entries()) r = await api.put(`/projects/${project.id}/lists/${l.id}`, { position: pos + 1 });
      return r;
    });
  };
  const remove = (l) => {
    const n = count(l.id);
    if (!window.confirm(`Xoá nhóm "${l.name}"?${n ? ` ${n} công việc trong nhóm sẽ chuyển sang "Chưa phân nhóm".` : ''}`)) return;
    call(() => api.del(`/projects/${project.id}/lists/${l.id}`), 'Đã xoá nhóm công việc');
  };
  return (
    <Modal title="Quản lý nhóm công việc" onClose={onClose} width={560} footer={<button className="btn" onClick={onClose}>Đóng</button>}>
      <p className="muted small">Chia công việc của {project.kind === 'department' ? 'phòng ban' : 'dự án'} theo giai đoạn / hạng mục (VD: Chuẩn bị, Triển khai, Nghiệm thu).
        {canDelete ? '' : ' Chỉ quản lý dự án được xoá nhóm.'}</p>
      <div className="lm-list">
        {lists.map((l, i) => (
          <div key={l.id} className="lm-row">
            <input className="input" value={names[l.id] ?? ''} onChange={(e) => setNames({ ...names, [l.id]: e.target.value })}
              onBlur={() => rename(l)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label="Tên nhóm công việc" />
            <small className="muted lm-count">{count(l.id)} việc</small>
            <button className="icon-btn sm" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label="Lên"><ArrowUp size={14} /></button>
            <button className="icon-btn sm" disabled={busy || i === lists.length - 1} onClick={() => move(i, 1)} aria-label="Xuống"><ArrowDown size={14} /></button>
            {canDelete && <button className="icon-btn sm" disabled={busy} onClick={() => remove(l)} aria-label="Xoá nhóm"><Trash2 size={14} /></button>}
          </div>
        ))}
        {!lists.length && <p className="muted small">Chưa có nhóm công việc nào.</p>}
      </div>
      <div className="lm-row lm-new">
        <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Tên nhóm công việc mới" />
        <button className="btn btn-primary" disabled={busy || !newName.trim()} onClick={add}><Plus size={14} /> Thêm</button>
      </div>
      <small className="muted"><Check size={12} /> Đổi tên: sửa trực tiếp rồi bấm ra ngoài hoặc Enter.</small>
    </Modal>
  );
}
