import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Search, ArrowLeft, Cake, FileWarning, UserPlus, Hourglass, Download, Upload, Plus, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Avatar, Spinner, Field, Empty, UserPicker, FilterSelect, Tabs } from '../components/ui.jsx';
import { ContractsPanel, CareersPanel, DocumentsPanel, ImportProfilesModal, useHrCatalog, CATALOG_LABELS } from './HrmRecords.jsx';
import { useDebounced } from '../components/shell.jsx';
import { fmtDate, cx } from '../utils.js';

export const WORK_STATUS = { working: 'Chính thức', probation: 'Thử việc', leave: 'Tạm nghỉ', resigned: 'Đã nghỉ việc' };
const STATUS_CLS = { working: 'badge-green', probation: 'badge-orange', leave: 'badge-purple', resigned: 'badge-gray' };

export function useHrMeta() {
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

/** Thâm niên từ ngày bắt đầu: "2 năm 3 tháng". */
export function seniority(from, to) {
  if (!from) return '—';
  const a = new Date(`${from}T00:00:00`);
  const b = to ? new Date(`${to}T00:00:00`) : new Date();
  let m = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() - (b.getDate() < a.getDate() ? 1 : 0);
  if (m < 0) return '—';
  const y = Math.floor(m / 12);
  m %= 12;
  return [y ? `${y} năm` : '', m ? `${m} tháng` : '', !y && !m ? 'Dưới 1 tháng' : ''].filter(Boolean).join(' ');
}

const VIEWS = [
  { value: '', label: 'Đang làm việc' }, { value: 'all', label: 'Tất cả nhân sự' }, { value: 'mine', label: 'Tôi quản lý' },
  { value: 'probation', label: 'Đang thử việc' }, { value: 'leave', label: 'Đang tạm nghỉ' }, { value: 'resigned', label: 'Nghỉ việc' },
];
/** Nhóm cột như Base HRM: Tổng quan, Công việc, Hợp đồng & pháp lý, Hồ sơ & liên hệ. */
const COLUMN_SETS = {
  overview: { label: 'Tổng quan', cols: [['department_name', 'Phòng ban'], ['job_position', 'Vị trí'], ['hire_date', 'Ngày bắt đầu', 'date'], ['seniority', 'Thâm niên'], ['work_status', 'Trạng thái']] },
  work: { label: 'Công việc', cols: [['title', 'Chức danh'], ['manager_name', 'Quản lý trực tiếp'], ['office', 'Văn phòng'], ['employee_type', 'Phân loại nhân sự'],
    ['official_date', 'Ngày chính thức', 'date'], ['last_promotion', 'Thăng tiến gần nhất']] },
  legal: { label: 'Hợp đồng & pháp lý', cols: [['contract_type', 'Hợp đồng'], ['contract_end', 'Hết hạn HĐ', 'date'], ['id_number', 'Số CCCD'], ['insurance_number', 'Số sổ BHXH'], ['tax_code', 'MST TNCN']] },
  contact: { label: 'Hồ sơ & liên hệ', cols: [['gender', 'Giới tính'], ['birthday', 'Ngày sinh', 'date'], ['phone', 'Điện thoại'], ['email', 'Email'], ['resign_date', 'Ngày nghỉ việc', 'date']] },
};

export function HrmEmployees() {
  const { departments } = useApp();
  const navigate = useNavigate();
  const [cat] = useHrCatalog();
  const [q, setQ] = useState('');
  const [view, setView] = useState('');
  const [dep, setDep] = useState('');
  const [office, setOffice] = useState('');
  const [type, setType] = useState('');
  const [contract, setContract] = useState('');
  const [colSet, setColSet] = useState('overview');
  const [importing, setImporting] = useState(false);
  const dq = useDebounced(q);
  const params = { q: dq, view, department_id: dep, office, employee_type: type, contract };
  const [items, reload, loading, error] = useFetch(() => api.get('/hrm/employees', params), [dq, view, dep, office, type, contract]);
  if (error) return <div className="page"><div className="alert alert-error">{error.message}</div></div>;
  const cell = (e, [k, , kind]) => {
    if (k === 'work_status') return <span className={cx('badge', STATUS_CLS[e.work_status])}>{WORK_STATUS[e.work_status].toUpperCase()}</span>;
    if (k === 'seniority') return seniority(e.hire_date, e.resign_date);
    if (k === 'contract_end') return <span className={e.contract_end && e.contract_end < new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) ? 'text-red' : ''}>{fmtDate(e.contract_end)}</span>;
    const v = e[k];
    return kind === 'date' ? fmtDate(v) : v || '—';
  };
  return (
    <div className="page">
      <div className="page-head"><h1>Danh sách nhân sự</h1>
        <div className="row gap-sm">
          <a className="btn" href={api.url('/hrm/employees/export', params)}><Download size={14} /> Trích xuất</a>
          <button className="btn" onClick={() => setImporting(true)}><Upload size={14} /> Cập nhật hàng loạt</button>
        </div>
      </div>
      <Tabs value={view} onChange={setView} tabs={VIEWS} />
      <div className="toolbar">
        <div className="ww-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tên, mã NV, điện thoại, email" /></div>
        <FilterSelect value={dep} onChange={setDep} options={[{ value: '', label: 'Tất cả phòng ban' }, ...departments.map((d) => ({ value: d.id, label: d.name }))]} />
        <FilterSelect value={office} onChange={setOffice} options={[{ value: '', label: 'Mọi văn phòng' }, ...(cat?.offices || []).map((o) => ({ value: o, label: o }))]} />
        <FilterSelect value={type} onChange={setType} options={[{ value: '', label: 'Mọi phân loại' }, ...(cat?.employee_types || []).map((o) => ({ value: o, label: o }))]} />
        <FilterSelect value={contract} onChange={setContract} options={[{ value: '', label: 'Mọi hợp đồng' }, { value: 'expiring', label: 'HĐ sắp hết hạn (30 ngày)' }]} />
      </div>
      <div className="hr-colsets">
        {Object.entries(COLUMN_SETS).map(([k, c]) => <button key={k} className={cx('chip-btn', colSet === k && 'active')} onClick={() => setColSet(k)}>{c.label}</button>)}
        {items && <small className="muted">{items.length} nhân sự</small>}
      </div>
      {loading && !items ? <Spinner /> : !items.length ? <Empty title="Không có nhân sự" /> : (
        <div className="table-wrap"><table className="table nowrap-cells">
          <thead><tr><th>Mã NV</th><th>Nhân sự</th>{COLUMN_SETS[colSet].cols.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
          <tbody>{items.map((e) => (
            <tr key={e.id} className="clickable" onClick={() => navigate(`/hrm/employees/${e.id}`)}>
              <td className="mono">{e.employee_code || '—'}</td>
              <td><span className="row gap-sm"><Avatar name={e.name} color={e.color} size={28} /><span>{e.name}<small className="muted block">{e.title}</small></span></span></td>
              {COLUMN_SETS[colSet].cols.map((c) => <td key={c[0]}>{cell(e, c)}</td>)}
            </tr>))}</tbody>
        </table></div>
      )}
      {importing && <ImportProfilesModal onClose={() => setImporting(false)} onDone={reload} />}
    </div>
  );
}

/** Nhóm trường hồ sơ; list = lấy lựa chọn từ danh mục HRM (Cài đặt). */
const FIELD_GROUPS = [
  ['Thông tin công việc', [
    ['employee_code', 'Mã nhân viên'], ['work_status', 'Trạng thái', Object.keys(WORK_STATUS)], ['job_position', 'Vị trí công việc', 'list:positions'],
    ['employee_type', 'Phân loại nhân sự', 'list:employee_types'], ['office', 'Văn phòng', 'list:offices'], ['hire_date', 'Ngày bắt đầu', 'date'],
    ['probation_end', 'Hết thử việc', 'date'], ['official_date', 'Ngày chính thức', 'date'],
    ['contract_type', 'Loại hợp đồng', 'list:contract_types'], ['contract_end', 'Ngày hết hạn HĐ', 'date'],
  ]],
  ['Thông tin cá nhân & pháp lý', [
    ['gender', 'Giới tính', ['Nam', 'Nữ', 'Khác']], ['id_number', 'Số CCCD'], ['id_issue_date', 'Ngày cấp', 'date'], ['id_issue_place', 'Nơi cấp'],
    ['insurance_number', 'Số sổ BHXH'], ['tax_code', 'Mã số thuế TNCN'], ['bank_account', 'Tài khoản ngân hàng'], ['emergency_contact', 'Liên hệ khẩn cấp'],
  ]],
  ['Nghỉ việc', [['resign_date', 'Ngày nghỉ việc', 'date'], ['resign_reason', 'Lý do nghỉ việc', 'list:resign_reasons']]],
];
const ALL_FIELDS = FIELD_GROUPS.flatMap(([, f]) => f);

export function HrmEmployee({ selfId }) {
  const params = useParams();
  const id = selfId || Number(params.id);
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useApp();
  const meta = useHrMeta();
  const [cat] = useHrCatalog();
  const [tab, setTab] = useState('profile');
  const [e, reload, loading, error] = useFetch(() => api.get(`/hrm/employees/${id}`), [id]);
  const [f, setF] = useState(null);
  useEffect(() => { if (e) setF(Object.fromEntries([...ALL_FIELDS.map(([k]) => [k, e[k] || '']), ['note', e.note || '']])); }, [e]);
  if (error) return <div className="page"><div className="alert alert-error">{error.message}</div></div>;
  if (loading && !e) return <div className="page"><Spinner /></div>;
  const edit = meta?.is_manager;
  const self = e.id === user.id;
  const save = async () => {
    try { await api.put(`/hrm/employees/${id}`, f); toast('Đã lưu hồ sơ nhân sự'); reload(); } catch (err) { toast(err.message, 'error'); }
  };
  const options = (type, cur) => {
    const list = Array.isArray(type) ? type : type?.startsWith('list:') ? cat?.[type.slice(5)] || [] : null;
    return list && [...new Set([...list, ...(cur && !list.includes(cur) ? [cur] : [])])];
  };
  return (
    <div className="page">
      <div className="page-head">
        <div className="row gap">
          {!selfId && <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Quay lại"><ArrowLeft size={18} /></button>}
          <Avatar name={e.name} color={e.color} size={48} />
          <div><h1>{e.name}</h1><div className="muted">{e.title} · {e.department_name}{e.manager_name ? ` · Quản lý: ${e.manager_name}` : ''}</div>
            <div className="row gap-sm wrap mt-xs"><span className={cx('badge', STATUS_CLS[e.work_status])}>{WORK_STATUS[e.work_status].toUpperCase()}</span>
              {e.hire_date && <small className="muted">Thâm niên {seniority(e.hire_date, e.resign_date)}</small>}</div></div>
        </div>
        {edit && tab === 'profile' && <button className="btn btn-success" onClick={save}>Lưu hồ sơ</button>}
      </div>
      {selfId && <p className="muted">Đây là hồ sơ nhân sự của bạn. Liên hệ phòng Hành chính Nhân sự nếu thông tin chưa chính xác.</p>}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'profile', label: 'Hồ sơ' }, { value: 'contracts', label: 'Hợp đồng' },
        { value: 'career', label: 'Phát triển sự nghiệp' }, { value: 'documents', label: 'Giấy tờ' }]} />
      {tab === 'profile' && f && (
        <>
          <div className="card">
            <h3 className="card-title">Liên hệ</h3>
            <div className="form-grid three">
              <Field label="Email"><input className="input" value={e.email || ''} disabled /></Field>
              <Field label="Điện thoại"><input className="input" value={e.phone || ''} disabled /></Field>
              <Field label="Ngày sinh"><input className="input" value={fmtDate(e.birthday)} disabled /></Field>
            </div>
          </div>
          {FIELD_GROUPS.map(([title, fields]) => (
            <div key={title} className="card">
              <h3 className="card-title">{title}</h3>
              <div className="form-grid three">
                {fields.map(([k, label, type]) => {
                  const opts = options(type, f[k]);
                  return (
                    <Field key={k} label={label}>
                      {opts ? (
                        <select className="input" disabled={!edit} value={f[k]} onChange={(ev) => setF({ ...f, [k]: ev.target.value })}>
                          <option value="">—</option>
                          {opts.map((o) => <option key={o} value={o}>{WORK_STATUS[o] || o}</option>)}
                        </select>
                      ) : <input className="input" type={type === 'date' ? 'date' : 'text'} disabled={!edit} value={f[k]} onChange={(ev) => setF({ ...f, [k]: ev.target.value })} />}
                    </Field>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="card"><Field label="Ghi chú"><textarea className="input" rows={3} disabled={!edit} value={f.note} onChange={(ev) => setF({ ...f, note: ev.target.value })} /></Field></div>
          <div className="row gap wrap">
            <Link className="btn" to={`/checkin?user_id=${id}`}>Xem bảng công</Link>
            <Link className="btn" to={`/timeoff?user_id=${id}`}>Xem nghỉ phép</Link>
            <Link className="btn" to={`/account/u/${id}`}>Xem tài khoản</Link>
          </div>
        </>
      )}
      {tab === 'contracts' && (edit || self ? <ContractsPanel userId={id} canEdit={edit} /> : <p className="muted">Chỉ nhân viên và quản lý nhân sự xem được hợp đồng.</p>)}
      {tab === 'career' && <CareersPanel userId={id} canEdit={edit} />}
      {tab === 'documents' && (edit || self ? <DocumentsPanel userId={id} isHr={edit} selfView={self} /> : <p className="muted">Chỉ nhân viên và quản lý nhân sự xem được giấy tờ.</p>)}
    </div>
  );
}

function ListEditor({ label, hint, value, onChange }) {
  return (
    <Field label={label} hint={hint}>
      <textarea className="input" rows={Math.min(8, Math.max(3, value.length + 1))} value={value.join('\n')} onChange={(e) => onChange(e.target.value.split('\n'))} />
    </Field>
  );
}

export function HrmSettings() {
  const { users, user } = useApp();
  const toast = useToast();
  const meta = useHrMeta();
  const [catRemote] = useHrCatalog();
  const [ids, setIds] = useState(null);
  const [cat, setCat] = useState(null);
  useEffect(() => { if (meta) setIds(meta.settings.managers); }, [meta]);
  useEffect(() => { if (catRemote) setCat(catRemote); }, [catRemote]);
  if (!ids || !cat) return <div className="page"><Spinner /></div>;
  if (!meta.is_manager) return <div className="page"><div className="alert alert-error">Chỉ quản lý nhân sự mới vào được cài đặt.</div></div>;
  const setList = (k) => (v) => setCat({ ...cat, [k]: v });
  const saveCat = async () => {
    try { setCat(await api.put('/hrm/catalog', cat)); toast('Đã lưu danh mục'); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <h1>Cài đặt LDL HRM</h1>
      {user.role === 'admin' && (
        <div className="card mt">
          <h3 className="card-title">Phân quyền</h3>
          <Field label="Quản lý nhân sự" hint="Được xem / sửa toàn bộ hồ sơ nhân sự, hợp đồng, giấy tờ, bảng công và quỹ phép của công ty (ngoài quản trị viên)">
            <UserPicker users={users} multiple value={ids} onChange={setIds} placeholder="Chọn người" />
          </Field>
          <button className="btn btn-primary mt" onClick={async () => { await api.put('/hrm/settings', { managers: ids }); toast('Đã lưu'); }}>Lưu phân quyền</button>
        </div>
      )}
      <div className="card">
        <div className="row between"><h3 className="card-title">Danh mục</h3><button className="btn btn-primary" onClick={saveCat}>Lưu danh mục</button></div>
        <p className="muted small">Mỗi dòng một giá trị. Dùng cho lựa chọn trong hồ sơ nhân sự, hợp đồng, giấy tờ và bộ lọc danh sách.</p>
        <div className="form-grid">
          {Object.entries(CATALOG_LABELS).map(([k, [label, hint]]) => <ListEditor key={k} label={label} hint={hint} value={cat[k] || []} onChange={setList(k)} />)}
        </div>
        <h3 className="card-title mt">Ngày lễ</h3>
        {(cat.holidays || []).map((h, i) => (
          <div key={i} className="row gap-sm mt-xs">
            <input className="input input-sm" type="date" value={h.date} onChange={(e) => setCat({ ...cat, holidays: cat.holidays.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} aria-label="Ngày" />
            <input className="input" value={h.name} placeholder="Tên ngày lễ" onChange={(e) => setCat({ ...cat, holidays: cat.holidays.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <button className="icon-btn sm" aria-label="Xoá" onClick={() => setCat({ ...cat, holidays: cat.holidays.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
          </div>
        ))}
        <button className="btn btn-sm mt" onClick={() => setCat({ ...cat, holidays: [...(cat.holidays || []), { date: '', name: '' }] })}><Plus size={14} /> Thêm ngày lễ</button>
      </div>
    </div>
  );
}
