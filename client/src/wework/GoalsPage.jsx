/** Quản lý mục tiêu: thêm, sửa, xoá; quản trị Wework xem và quản lý mục tiêu của mọi người. */
import { useState } from 'react';
import { Plus, Search, Target, Pencil, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Spinner, Empty, Tabs, FilterSelect, Avatar, Progress } from '../components/ui.jsx';
import { useDebounced } from '../components/shell.jsx';
import { fmtDate, cx } from '../utils.js';
import { useWework } from './WeworkLayout.jsx';
import GoalModal from './GoalModal.jsx';

export default function GoalsPage() {
  const { users } = useApp();
  const { isAdmin, version } = useWework();
  const toast = useToast();
  const [scope, setScope] = useState('mine');
  const [status, setStatus] = useState('');
  const [owner, setOwner] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const dq = useDebounced(q);
  const all = isAdmin && scope === 'all';
  const [items, reload, loading] = useFetch(() => api.get('/goals', { scope: all ? 'all' : '', user_id: all ? owner : '', status, q: dq }), [all, owner, status, dq, version]);
  const remove = async (g) => {
    if (!window.confirm(`Xoá mục tiêu "${g.title}"? Các công việc gắn kèm vẫn giữ nguyên, chỉ bỏ liên kết.`)) return;
    try { await api.del(`/goals/${g.id}`); toast('Đã xoá mục tiêu'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="ww-page">
      <div className="ww-main wide">
        <div className="page-head"><h1><Target size={20} /> Mục tiêu</h1>
          <button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={14} /> Thêm mục tiêu</button></div>
        {isAdmin && <Tabs value={scope} onChange={setScope} tabs={[{ value: 'mine', label: 'Mục tiêu của tôi' }, { value: 'all', label: 'Tất cả mục tiêu' }]} />}
        <div className="toolbar">
          <div className="ww-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm mục tiêu" /></div>
          <FilterSelect value={status} onChange={setStatus} options={[{ value: '', label: 'Mọi trạng thái' }, { value: 'active', label: 'Đang thực hiện' }, { value: 'done', label: 'Đã đạt (100%)' }]} />
          {all && <FilterSelect value={owner} onChange={setOwner} options={[{ value: '', label: 'Mọi người' }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />}
        </div>
        {loading && !items ? <Spinner /> : !items.length ? (
          <Empty icon={Target} title="Chưa có mục tiêu">Đặt mục tiêu và gắn các công việc liên quan — tiến độ tự cập nhật khi công việc hoàn thành.</Empty>
        ) : (
          <div className="goal-grid">
            {items.map((g) => (
              <div key={g.id} className={cx('goal-card', g.progress >= 100 && 'done')}>
                <div className="row gap-sm">
                  <button type="button" className="grow goal-card-title" onClick={() => setEditing(g)}><b>{g.title}</b></button>
                  <button className="icon-btn sm" aria-label="Sửa" onClick={() => setEditing(g)}><Pencil size={14} /></button>
                  <button className="icon-btn sm" aria-label="Xoá" onClick={() => remove(g)}><Trash2 size={14} /></button>
                </div>
                {g.description && <p className="small muted goal-card-desc">{g.description}</p>}
                <div className="row gap-sm"><Progress value={g.progress} color={g.progress >= 100 ? '#37b24d' : '#2d7ff9'} /><b className="small">{g.progress}%</b></div>
                <small className="muted">
                  {g.task_count ? `${g.task_done}/${g.task_count} công việc hoàn thành` : 'Chưa gắn công việc'}
                  {g.task_overdue ? <span className="text-red"> · {g.task_overdue} quá hạn</span> : null}
                  {g.due_date ? <span className={g.progress < 100 && g.due_date < today ? 'text-red' : ''}> · hạn {fmtDate(g.due_date)}</span> : null}
                </small>
                {all && <div className="row gap-sm goal-card-owner"><Avatar name={g.owner_name} color={g.owner_color} uid={g.user_id} size={20} /><small>{g.owner_name}{g.department_name ? ` · ${g.department_name}` : ''}</small></div>}
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && <GoalModal goal={editing.id ? editing : null} defaultOwner={all && owner ? Number(owner) : undefined}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

/** Cài đặt Wework (quản trị viên hệ thống): chức danh quản trị — người có chức danh này có quyền quản trị tối cao trong Wework. */
export function WeworkSettingsPage() {
  const { user } = useApp();
  const toast = useToast();
  const [st, , loading] = useFetch(() => api.get('/wework/settings'), []);
  const [text, setText] = useState(null);
  const titles = text ?? (st?.admin_titles || []).join('\n');
  const dText = useDebounced(text);
  const [admins, reloadAdmins] = useFetch(() => api.get('/wework/settings/admins', dText === null ? {} : { titles: dText }), [dText]);
  if (user.role !== 'admin') return <div className="ww-page"><div className="ww-main"><Empty title="Chỉ quản trị viên hệ thống mới vào được cài đặt Wework" /></div></div>;
  const save = async () => {
    try { await api.put('/wework/settings', { admin_titles: titles.split('\n') }); toast('Đã lưu chức danh quản trị'); reloadAdmins(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="ww-page">
      <div className="ww-main">
        <div className="page-head"><h1>Cài đặt Wework</h1></div>
        {loading && !st ? <Spinner /> : (
          <div className="card">
            <h3 className="card-title">Chức danh quản trị</h3>
            <p className="muted small">Người có chức danh trùng hoặc bắt đầu bằng một dòng dưới đây (không phân biệt hoa thường) có <b>quyền quản trị tối cao</b> trong Wework:
              xem, sửa, xoá, giao mọi công việc và dự án, duyệt hoàn thành, xem báo cáo, thao tác hàng loạt, quản lý mục tiêu của mọi người.
              Quản trị cấp cao và Chủ doanh nghiệp luôn có quyền này. Chức danh do quản trị viên đặt trong Tài khoản → Thành viên; nhân viên không tự đổi được.</p>
            <textarea className="input" rows={4} value={titles} onChange={(e) => setText(e.target.value)} placeholder="Mỗi dòng một chức danh, VD: Quản trị" />
            <button className="btn btn-primary mt" onClick={save}>Lưu</button>
            <h3 className="card-title mt">Đang có quyền quản trị Wework ({admins?.length || 0})</h3>
            <div className="ws-admins">
              {(admins || []).map((u) => (
                <div key={u.id} className="user-row"><Avatar name={u.name} color={u.color} uid={u.id} size={26} />
                  <span className="grow">{u.name}<small className="muted block">{u.title || '—'}</small></span>
                  <span className={cx('badge', u.by === 'role' ? 'badge-red' : 'badge-blue')}>{u.by === 'role' ? 'Quản trị hệ thống' : 'Theo chức danh'}</span></div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
