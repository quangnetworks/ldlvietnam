import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Search, ArrowLeft, Cake, FileWarning, UserPlus, Hourglass } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Avatar, Spinner, Field, Empty, UserPicker, FilterSelect } from '../components/ui.jsx';
import { useDebounced } from '../components/shell.jsx';
import { fmtDate, cx } from '../utils.js';

export const WORK_STATUS = { working: 'Chính thức', probation: 'Thử việc', leave: 'Tạm nghỉ', resigned: 'Đã nghỉ việc' };
const STATUS_CLS = { working: 'badge-green', probation: 'badge-orange', leave: 'badge-purple', resigned: 'badge-gray' };

function useHrMeta() {
  const [meta] = useFetch(() => api.get('/hrm/meta'), []);
  return meta;
}

function PersonList({ title, icon: Icon, items, render }) {
  return (
    <div className="card">
      <h3 className="card-title row gap-sm"><Icon size={16} /> {title} ({items.length})</h3>
      {items.length ? items.map((x) => (
        <Link key={x.id} to={`/hrm/employees/${x.id}`} className="user-row"><Avatar name={x.name} color={x.color} size={28} /><span className="grow">{x.name}</span><small className="muted">{render(x)}</small></Link>
      )) : <p className="muted small">Không có</p>}
    </div>
  );
}

export function HrmHome() {
  const { user } = useApp();
  const meta = useHrMeta();
  const [stats] = useFetch(() => (meta?.is_manager ? api.get('/hrm/stats') : Promise.resolve(null)), [meta?.is_manager]);
  if (!meta) return <div className="page"><Spinner /></div>;
  if (!meta.is_manager) return <HrmEmployee selfId={user.id} />;
  if (!stats) return <div className="page"><Spinner /></div>;
  const max = Math.max(1, ...stats.by_department.map((d) => d.c));
  return (
    <div className="page">
      <div className="page-head"><h1>Tổng quan nhân sự</h1><Link className="btn btn-primary" to="/hrm/employees">Hồ sơ nhân sự</Link></div>
      <div className="stat-row">
        <div className="stat-tile"><div className="stat-label">Tổng nhân sự</div><div className="stat-value">{stats.total}</div></div>
        {Object.entries(WORK_STATUS).map(([k, l]) => (
          <div key={k} className="stat-tile"><div className="stat-label">{l}</div><div className="stat-value">{stats.by_status.find((x) => x.status === k)?.c || 0}</div></div>
        ))}
      </div>
      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">Nhân sự theo phòng ban</h3>
          {stats.by_department.map((d) => (
            <div key={d.name} className="bar-row"><span className="ellipsis">{d.name}</span>
              <div className="meter"><div style={{ width: `${(d.c / max) * 100}%`, background: 'var(--blue-2)' }} /></div><b>{d.c}</b></div>
          ))}
        </div>
        <div>
          <PersonList title="Hợp đồng sắp hết hạn (30 ngày)" icon={FileWarning} items={stats.contracts_expiring} render={(x) => fmtDate(x.contract_end)} />
          <PersonList title="Sắp hết thử việc" icon={Hourglass} items={stats.probation_ending} render={(x) => fmtDate(x.probation_end)} />
        </div>
        <PersonList title="Sinh nhật trong tháng" icon={Cake} items={stats.birthdays} render={(x) => fmtDate(x.birthday).slice(0, 5)} />
        <PersonList title="Nhân sự mới trong tháng" icon={UserPlus} items={stats.new_hires} render={(x) => fmtDate(x.hire_date)} />
      </div>
    </div>
  );
}

export function HrmEmployees() {
  const { departments } = useApp();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [dep, setDep] = useState('');
  const [contract, setContract] = useState('');
  const dq = useDebounced(q);
  const [items, , loading, error] = useFetch(() => api.get('/hrm/employees', { q: dq, status, department_id: dep, contract }), [dq, status, dep, contract]);
  if (error) return <div className="page"><div className="alert alert-error">{error.message}</div></div>;
  return (
    <div className="page">
      <div className="page-head"><h1>Hồ sơ nhân sự</h1></div>
      <div className="toolbar">
        <div className="ww-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tên, mã NV, điện thoại" /></div>
        <FilterSelect value={status} onChange={setStatus} options={[{ value: '', label: 'Đang làm việc' }, ...Object.entries(WORK_STATUS).map(([value, label]) => ({ value, label }))]} />
        <FilterSelect value={dep} onChange={setDep} options={[{ value: '', label: 'Tất cả phòng ban' }, ...departments.map((d) => ({ value: d.id, label: d.name }))]} />
        <FilterSelect value={contract} onChange={setContract} options={[{ value: '', label: 'Mọi hợp đồng' }, { value: 'expiring', label: 'Sắp hết hạn (30 ngày)' }]} />
      </div>
      {loading && !items ? <Spinner /> : !items.length ? <Empty title="Không có nhân sự" /> : (
        <div className="table-wrap"><table className="table nowrap-cells">
          <thead><tr><th>Mã NV</th><th>Nhân viên</th><th>Phòng ban</th><th>Ngày vào làm</th><th>Loại hợp đồng</th><th>Hết hạn HĐ</th><th>Trạng thái</th></tr></thead>
          <tbody>{items.map((e) => (
            <tr key={e.id} className="clickable" onClick={() => { window.location.href = `/hrm/employees/${e.id}`; }}>
              <td className="mono">{e.employee_code || '—'}</td>
              <td><span className="row gap-sm"><Avatar name={e.name} color={e.color} size={28} /><span>{e.name}<small className="muted block">{e.title}</small></span></span></td>
              <td>{e.department_name}</td><td>{fmtDate(e.hire_date)}</td><td>{e.contract_type}</td>
              <td className={e.contract_end && e.contract_end < new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) ? 'text-red' : ''}>{fmtDate(e.contract_end)}</td>
              <td><span className={cx('badge', STATUS_CLS[e.work_status])}>{WORK_STATUS[e.work_status].toUpperCase()}</span></td>
            </tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}

const FIELDS = [
  ['employee_code', 'Mã nhân viên'], ['gender', 'Giới tính', ['Nam', 'Nữ', 'Khác']], ['id_number', 'Số CCCD'], ['id_issue_date', 'Ngày cấp', 'date'],
  ['id_issue_place', 'Nơi cấp'], ['hire_date', 'Ngày vào làm', 'date'], ['probation_end', 'Hết thử việc', 'date'],
  ['contract_type', 'Loại hợp đồng', ['Thử việc', 'Xác định thời hạn 12 tháng', 'Xác định thời hạn 24 tháng', 'Xác định thời hạn 36 tháng', 'Không xác định thời hạn', 'Cộng tác viên']],
  ['contract_end', 'Ngày hết hạn HĐ', 'date'], ['work_status', 'Trạng thái', Object.keys(WORK_STATUS)], ['insurance_number', 'Số sổ BHXH'],
  ['tax_code', 'Mã số thuế TNCN'], ['bank_account', 'Tài khoản ngân hàng'], ['emergency_contact', 'Liên hệ khẩn cấp'],
];

export function HrmEmployee({ selfId }) {
  const params = useParams();
  const id = selfId || Number(params.id);
  const navigate = useNavigate();
  const toast = useToast();
  const meta = useHrMeta();
  const [e, reload, loading, error] = useFetch(() => api.get(`/hrm/employees/${id}`), [id]);
  const [f, setF] = useState(null);
  useEffect(() => { if (e) setF(Object.fromEntries([...FIELDS.map(([k]) => [k, e[k] || '']), ['note', e.note || '']])); }, [e]);
  if (error) return <div className="page"><div className="alert alert-error">{error.message}</div></div>;
  if (loading && !e) return <div className="page"><Spinner /></div>;
  const edit = meta?.is_manager;
  const save = async () => {
    try { await api.put(`/hrm/employees/${id}`, f); toast('Đã lưu hồ sơ nhân sự'); reload(); } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div className="row gap">
          {!selfId && <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Quay lại"><ArrowLeft size={18} /></button>}
          <Avatar name={e.name} color={e.color} size={48} />
          <div><h1>{e.name}</h1><div className="muted">{e.title} · {e.department_name}{e.manager_name ? ` · Quản lý: ${e.manager_name}` : ''}</div></div>
        </div>
        {edit && <button className="btn btn-success" onClick={save}>Lưu hồ sơ</button>}
      </div>
      {selfId && <p className="muted">Đây là hồ sơ nhân sự của bạn. Liên hệ phòng Hành chính Nhân sự nếu thông tin chưa chính xác.</p>}
      {f && (
        <div className="card">
          <div className="form-grid three">
            <Field label="Email"><input className="input" value={e.email || ''} disabled /></Field>
            <Field label="Điện thoại"><input className="input" value={e.phone || ''} disabled /></Field>
            <Field label="Ngày sinh"><input className="input" value={fmtDate(e.birthday)} disabled /></Field>
            {FIELDS.map(([k, label, type]) => (
              <Field key={k} label={label}>
                {Array.isArray(type) ? (
                  <select className="input" disabled={!edit} value={f[k]} onChange={(ev) => setF({ ...f, [k]: ev.target.value })}>
                    <option value="">—</option>
                    {type.map((o) => <option key={o} value={o}>{WORK_STATUS[o] || o}</option>)}
                  </select>
                ) : <input className="input" type={type === 'date' ? 'date' : 'text'} disabled={!edit} value={f[k]} onChange={(ev) => setF({ ...f, [k]: ev.target.value })} />}
              </Field>
            ))}
            <div className="span-3"><Field label="Ghi chú"><textarea className="input" rows={3} disabled={!edit} value={f.note} onChange={(ev) => setF({ ...f, note: ev.target.value })} /></Field></div>
          </div>
        </div>
      )}
      <div className="row gap wrap">
        <Link className="btn" to={`/checkin?user_id=${id}`}>Xem bảng công</Link>
        <Link className="btn" to={`/timeoff?user_id=${id}`}>Xem nghỉ phép</Link>
        <Link className="btn" to={`/account/u/${id}`}>Xem tài khoản</Link>
      </div>
    </div>
  );
}

export function HrmSettings() {
  const { users } = useApp();
  const toast = useToast();
  const meta = useHrMeta();
  const [ids, setIds] = useState(null);
  useEffect(() => { if (meta) setIds(meta.settings.managers); }, [meta]);
  if (!ids) return <div className="page"><Spinner /></div>;
  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <h1>Cài đặt LDL HRM</h1>
      <div className="card mt">
        <Field label="Quản lý nhân sự" hint="Được xem / sửa toàn bộ hồ sơ nhân sự, bảng công và quỹ phép của công ty (ngoài quản trị viên)">
          <UserPicker users={users} multiple value={ids} onChange={setIds} placeholder="Chọn người" />
        </Field>
        <button className="btn btn-primary mt" onClick={async () => { await api.put('/hrm/settings', { managers: ids }); toast('Đã lưu'); }}>Lưu</button>
      </div>
    </div>
  );
}
