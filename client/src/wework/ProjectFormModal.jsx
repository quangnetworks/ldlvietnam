import { useState } from 'react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Modal, Field, UserPicker, MultiSelect } from '../components/ui.jsx';

const COLORS = ['#2d7ff9', '#20c997', '#f59f00', '#e8590c', '#7048e8', '#d6336c', '#0ca678', '#1098ad', '#ae3ec9', '#5c940d'];

export default function ProjectFormModal({ kind = 'project', project, templateId, onClose, onSaved }) {
  const { users, departments, user } = useApp();
  const toast = useToast();
  const [templates] = useFetch(() => (project ? Promise.resolve([]) : api.get('/projects', { template: 1 })), []);
  const [form, setForm] = useState(() => project ? {
    name: project.name, description: project.description || '', color: project.color || COLORS[0], kind: project.kind,
    department_ids: (project.departments || []).map((d) => d.id).concat(project.departments?.length || !project.department_id ? [] : [project.department_id]),
    start_date: project.start_date || '', end_date: project.end_date || '', status: project.status, add_department_members: false,
  } : {
    name: '', description: '', color: COLORS[Math.floor(Math.random() * COLORS.length)], kind, department_ids: [], add_department_members: false,
    start_date: '', end_date: '', members: [], managers: [], template_id: templateId || '', lists: 'Cần làm, Đang làm, Hoàn thành',
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e?.target ? e.target.value : e });
  const isDep = form.kind === 'department';

  const submit = async () => {
    setError('');
    if (!form.name.trim()) return setError(`Vui lòng nhập tên ${isDep ? 'phòng ban' : 'dự án'}`);
    try {
      let p;
      if (project) p = await api.put(`/projects/${project.id}`, form);
      else {
        p = await api.post('/projects', {
          ...form,
          template_id: form.template_id || null,
          lists: form.lists.split(',').map((s) => s.trim()).filter(Boolean),
        });
      }
      toast(project ? 'Đã cập nhật' : `Đã tạo ${isDep ? 'phòng ban' : 'dự án'}`);
      onSaved(p);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Modal title={project ? 'Cài đặt' : isDep ? 'Tạo phòng ban mới' : 'Tạo dự án mới'} onClose={onClose} width={640}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" onClick={submit}>{project ? 'Lưu' : 'Tạo mới'}</button></>}>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="form-grid">
        <div className="span-2">
          <Field label={isDep ? 'Tên phòng ban' : 'Tên dự án'} required>
            <input className="input" autoFocus value={form.name} onChange={set('name')} />
          </Field>
        </div>
        <div className="span-2">
          <Field label="Mô tả"><textarea className="input" rows={2} value={form.description} onChange={set('description')} /></Field>
        </div>
        <Field label="Loại">
          <select className="input" value={form.kind} onChange={set('kind')}>
            <option value="project">Dự án</option>
            <option value="department">Phòng ban</option>
          </select>
        </Field>
        <Field label={isDep ? 'Phòng ban' : 'Phòng ban phối hợp'} hint={isDep ? undefined : 'Một dự án có thể phối hợp nhiều phòng ban'}>
          <MultiSelect options={departments.map((d) => ({ value: d.id, label: d.name }))} value={form.department_ids} onChange={set('department_ids')}
            placeholder={isDep ? 'Chọn phòng ban' : 'Chọn các phòng ban tham gia'} />
        </Field>
        {form.department_ids.length > 0 && (
          <label className="check span-2"><input type="checkbox" checked={!!form.add_department_members} onChange={(e) => setForm({ ...form, add_department_members: e.target.checked })} />
            Thêm toàn bộ nhân sự của {form.department_ids.length > 1 ? 'các phòng ban' : 'phòng ban'} đã chọn làm thành viên</label>
        )}
        <Field label="Ngày bắt đầu"><input type="date" className="input" value={form.start_date} onChange={set('start_date')} /></Field>
        <Field label="Ngày kết thúc"><input type="date" className="input" value={form.end_date} onChange={set('end_date')} /></Field>
        <div className="span-2">
          <span className="field-label">Màu sắc</span>
          <div className="color-row">
            {COLORS.map((c) => (
              <button key={c} type="button" className={`color-dot ${form.color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setForm({ ...form, color: c })} aria-label={c} />
            ))}
          </div>
        </div>
        {project ? (
          <Field label="Trạng thái">
            <select className="input" value={form.status} onChange={set('status')}>
              <option value="active">Đang hoạt động</option>
              <option value="archived">Lưu trữ (đóng)</option>
            </select>
          </Field>
        ) : (
          <>
            <Field label="Quản lý"><UserPicker users={users} multiple exclude={[user.id]} value={form.managers} onChange={set('managers')} placeholder="Thêm quản lý" /></Field>
            <Field label="Thành viên"><UserPicker users={users} multiple exclude={[user.id]} value={form.members} onChange={set('members')} placeholder="Thêm thành viên" /></Field>
            <Field label="Tạo từ mẫu">
              <select className="input" value={form.template_id} onChange={set('template_id')}>
                <option value="">— Không dùng mẫu —</option>
                {templates?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            {!form.template_id && (
              <Field label="Nhóm công việc" hint="Phân tách bằng dấu phẩy">
                <input className="input" value={form.lists} onChange={set('lists')} />
              </Field>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
