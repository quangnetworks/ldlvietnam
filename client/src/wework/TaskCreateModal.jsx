import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp, useToast } from '../context.jsx';
import { Modal, Field, UserPicker, RichEditor } from '../components/ui.jsx';
import { useAssignable } from './taskParts.jsx';
import { useWework } from './WeworkLayout.jsx';
import { RECURRING } from '../utils.js';

export default function TaskCreateModal({ defaults, onClose, onCreated }) {
  const { users, user } = useApp();
  const { projects } = useWework();
  const toast = useToast();
  const [form, setForm] = useState({
    title: '', description: '', project_id: '', list_id: '', assignee_id: user.id, followers: [], start_date: '',
    due_date: '', priority: 'normal', recurring: '', status: 'todo', ...defaults,
  });
  const [lists, setLists] = useState([]);
  const [members, setMembers] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!form.project_id) { setLists([]); setMembers(null); return; }
    api.get(`/projects/${form.project_id}`).then((p) => {
      setLists(p.lists);
      setMembers(p.members.map((m) => m.id));
    });
  }, [form.project_id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const submit = async (e) => {
    e?.preventDefault();
    setError('');
    if (!form.title.trim()) return setError('Vui lòng nhập tên công việc');
    setBusy(true);
    try {
      const t = await api.post('/tasks', { ...form, recurring: form.recurring || null, list_id: form.list_id || null, project_id: form.project_id || null });
      toast('Đã tạo công việc');
      onCreated(t);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  const allowed = useAssignable(users, form.project_id);
  const assignable = members ? allowed.filter((u) => members.includes(u.id) || u.id === user.id) : allowed;

  return (
    <Modal title={defaults.parent_id ? 'Tạo công việc con' : 'Tạo công việc mới'} onClose={onClose} width={720}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" disabled={busy} onClick={submit}>Tạo công việc</button></>}>
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={submit} className="form-grid">
        <div className="span-2">
          <input className="input input-lg" autoFocus placeholder="Tên công việc" value={form.title} onChange={set('title')} />
        </div>
        {!defaults.parent_id && (
          <>
            <Field label="Dự án / phòng ban">
              <select className="input" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value, list_id: '' })}>
                <option value="">— Công việc cá nhân —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Nhóm công việc">
              <select className="input" value={form.list_id} onChange={set('list_id')} disabled={!lists.length}>
                <option value="">— Không chọn —</option>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
          </>
        )}
        <Field label="Người thực hiện" hint={assignable.length < users.length ? 'Chỉ hiện những người bạn được giao việc (nhân viên do bạn quản lý / thành viên dự án bạn quản lý)' : undefined}>
          <UserPicker users={assignable} value={form.assignee_id} onChange={set('assignee_id')} />
        </Field>
        <Field label="Người theo dõi"><UserPicker users={users} multiple value={form.followers} onChange={set('followers')} placeholder="Thêm người theo dõi" /></Field>
        <Field label="Ngày bắt đầu"><input type="date" className="input" value={form.start_date} onChange={set('start_date')} /></Field>
        <Field label="Thời hạn"><input type="date" className="input" value={form.due_date} onChange={set('due_date')} /></Field>
        <Field label="Mức độ ưu tiên">
          <select className="input" value={form.priority} onChange={set('priority')}>
            <option value="normal">Bình thường</option>
            <option value="important">Quan trọng</option>
            <option value="urgent">Khẩn cấp</option>
          </select>
        </Field>
        <Field label="Lặp lại">
          <select className="input" value={form.recurring} onChange={set('recurring')}>
            <option value="">Không lặp lại</option>
            {Object.entries(RECURRING).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <div className="span-2">
          <Field label="Mô tả"><RichEditor value={form.description} onChange={set('description')} placeholder="Mô tả chi tiết công việc..." minHeight={100} /></Field>
        </div>
      </form>
    </Modal>
  );
}
