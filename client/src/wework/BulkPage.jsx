import { useState } from 'react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Spinner, Empty, FilterSelect, UserPicker } from '../components/ui.jsx';
import { TASK_STATUS } from '../utils.js';
import { useWework } from './WeworkLayout.jsx';
import { TaskRow } from './taskParts.jsx';

export default function BulkPage() {
  const { users, user } = useApp();
  if (user.role !== 'admin') return <BulkDenied />;
  return <BulkInner users={users} />;
}

function BulkDenied() {
  return (
    <div className="ww-page">
      <div className="ww-main wide">
        <div className="page-head"><h1>Tác vụ hàng loạt</h1></div>
        <Empty title="Không có quyền truy cập">Chỉ Quản trị cấp cao hoặc Chủ doanh nghiệp mới được thao tác hàng loạt công việc.</Empty>
      </div>
    </div>
  );
}

function BulkInner({ users }) {
  const { projects, openTask, version, bump } = useWework();
  const toast = useToast();
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState('active');
  const [selected, setSelected] = useState([]);
  const [assignee, setAssignee] = useState(null);
  const [due, setDue] = useState('');
  const [data, , loading] = useFetch(() => api.get('/tasks', { project_id: projectId, status, limit: 200, sort: 'due' }), [projectId, status, version]);
  const items = data?.items || [];

  const run = async (action, payload) => {
    if (!selected.length) return;
    if (action === 'delete' && !window.confirm(`Xóa ${selected.length} công việc?`)) return;
    const r = await api.post('/tasks/bulk', { ids: selected, action, data: payload });
    toast(`Đã cập nhật ${r.affected}/${selected.length} công việc`);
    setSelected([]);
    bump();
  };
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="ww-page">
      <div className="ww-main wide">
        <div className="page-head"><h1>Tác vụ hàng loạt</h1></div>
        <div className="ww-toolbar">
          <label className="check"><input type="checkbox" checked={items.length > 0 && selected.length === items.length}
            onChange={() => setSelected(selected.length === items.length ? [] : items.map((t) => t.id))} /> Chọn tất cả</label>
          <div className="grow" />
          <FilterSelect value={projectId} onChange={setProjectId} options={[{ value: '', label: 'Tất cả dự án' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
          <FilterSelect value={status} onChange={setStatus} options={[{ value: '', label: 'Tất cả trạng thái' }, { value: 'active', label: 'Đang thực hiện' }, { value: 'overdue', label: 'Quá hạn' }, ...Object.entries(TASK_STATUS).map(([k, s]) => ({ value: k, label: s.label }))]} />
        </div>
        <div className="bulk-panel">
          <b>Đã chọn {selected.length}</b>
          <select className="input input-sm" value="" onChange={(e) => e.target.value && run('update', { status: e.target.value })} disabled={!selected.length}>
            <option value="">Đổi trạng thái...</option>
            {Object.entries(TASK_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
          <select className="input input-sm" value="" onChange={(e) => e.target.value && run('update', { priority: e.target.value })} disabled={!selected.length}>
            <option value="">Đổi ưu tiên...</option>
            <option value="normal">Bình thường</option><option value="important">Quan trọng</option><option value="urgent">Khẩn cấp</option><option value="critical">Quan trọng & khẩn cấp</option>
          </select>
          <div style={{ minWidth: 200 }}><UserPicker users={users} value={assignee} onChange={setAssignee} placeholder="Giao cho..." /></div>
          <button className="btn btn-sm" disabled={!selected.length || !assignee} onClick={() => run('update', { assignee_id: assignee })}>Giao việc</button>
          <input type="date" className="input input-sm" value={due} onChange={(e) => setDue(e.target.value)} />
          <button className="btn btn-sm" disabled={!selected.length || !due} onClick={() => run('update', { due_date: due })}>Đặt thời hạn</button>
          <button className="btn btn-sm" disabled={!selected.length} onClick={() => run('follow')}>Theo dõi</button>
          <button className="btn btn-sm btn-danger-ghost" disabled={!selected.length} onClick={() => run('delete')}>Xóa</button>
        </div>
        {loading && !data ? <Spinner /> : !items.length ? <Empty title="Không có kết quả nào" /> : (
          <div className="task-groups">
            {items.map((t) => <TaskRow key={t.id} t={t} selectable selected={selected.includes(t.id)} onSelect={toggle} onOpen={openTask} onChanged={bump} />)}
          </div>
        )}
      </div>
    </div>
  );
}
