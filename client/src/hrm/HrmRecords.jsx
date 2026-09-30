/**
 * LDL HRM — hồ sơ theo Base HRM: hợp đồng lao động, phát triển sự nghiệp, hồ sơ giấy tờ, báo cáo nhân sự,
 * cập nhật hàng loạt từ Excel.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, Search, Trash2, Pencil, Paperclip, Upload, Download, FileText, TrendingUp, ArrowRightLeft, Award, AlertTriangle, BadgeDollarSign, FileSignature, Layers,
  CheckCircle2, AlarmClock, History, XCircle, BarChart3, Users2, Users, UserPlus, UserMinus, Percent, Clock3, Activity, Shapes, Cake, MapPin, Briefcase, Network, Map as MapIcon,
} from 'lucide-react';
import { api, toFormData } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Avatar, Spinner, Field, Empty, Modal, UserPicker, FilterSelect, FileChip, Tabs } from '../components/ui.jsx';
import { Donut } from '../components/charts.jsx';
import { HrHero, Kpi, HrCard, Pill, HBars, GroupedColumns, daysLeft } from './hrUi.jsx';
import FileViewer from '../components/FileViewer.jsx';
import { useDebounced } from '../components/shell.jsx';
import { readSheetFile, rowsToObjects, downloadCsv } from '../sheet.js';
import { fmtDate, cx } from '../utils.js';

export const CONTRACT_STATUS = { active: 'Đang hiệu lực', ended: 'Đã hết hạn', terminated: 'Đã chấm dứt' };
const CONTRACT_TONE = { active: 'green', ended: 'gray', terminated: 'red' };
export const CAREER_TYPES = {
  promotion: { tone: 'green', label: 'Thăng tiến', icon: TrendingUp, cls: 'badge-green', to: 'Chức danh mới' },
  raise: { tone: 'blue', label: 'Điều chỉnh lương', icon: BadgeDollarSign, cls: 'badge-blue', to: 'Mức lương mới', from: 'Mức lương cũ' },
  transfer: { tone: 'violet', label: 'Điều chuyển', icon: ArrowRightLeft, cls: 'badge-purple', to: 'Phòng ban mới' },
  reward: { tone: 'amber', label: 'Khen thưởng', icon: Award, cls: 'badge-orange', to: 'Danh hiệu / hình thức' },
  discipline: { tone: 'red', label: 'Kỷ luật', icon: AlertTriangle, cls: 'badge-red', to: 'Hình thức kỷ luật' },
};
const money = (v) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString('vi-VN')} ₫`);
const isMoneyText = (v) => /^\d+$/.test(String(v || ''));

export function useHrCatalog() {
  const [cat, reload] = useFetch(() => api.get('/hrm/catalog'), []);
  return [cat, reload];
}

// ================================================================ hợp đồng
export function ContractModal({ userId, contract, onClose, onSaved }) {
  const { users } = useApp();
  const toast = useToast();
  const [cat] = useHrCatalog();
  const [f, setF] = useState(() => ({
    user_id: userId || contract?.user_id || null, code: contract?.code || '', contract_type: contract?.contract_type || '',
    start_date: contract?.start_date || new Date().toISOString().slice(0, 10), end_date: contract?.end_date || '',
    salary: contract?.salary ?? '', status: contract?.status === 'ended' && contract?.end_date ? 'active' : contract?.status || 'active',
    note: contract?.note || '', close_previous: !contract,
  }));
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e });
  const save = async () => {
    setBusy(true);
    try {
      const body = toFormData({ ...f, close_previous: f.close_previous ? 1 : '' }, file ? [file] : []);
      const r = contract ? await api.put(`/hrm/contracts/${contract.id}`, body) : await api.post(`/hrm/employees/${f.user_id}/contracts`, body);
      toast(contract ? 'Đã cập nhật hợp đồng' : 'Đã thêm hợp đồng');
      onSaved(r);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title={contract ? 'Sửa hợp đồng' : 'Thêm hợp đồng lao động'} onClose={onClose} width={620}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" disabled={busy || !f.user_id || !f.contract_type} onClick={save}>Lưu hợp đồng</button></>}>
      <div className="form-grid">
        {!userId && !contract && <div className="span-2"><Field label="Nhân sự" required><UserPicker users={users} value={f.user_id} onChange={set('user_id')} /></Field></div>}
        <Field label="Loại hợp đồng" required>
          <select className="input" value={f.contract_type} onChange={set('contract_type')}>
            <option value="">— Chọn —</option>
            {[...new Set([...(cat?.contract_types || []), ...(f.contract_type ? [f.contract_type] : [])])].map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Số hợp đồng"><input className="input" value={f.code} onChange={set('code')} placeholder="VD: 12/2026/HĐLĐ" /></Field>
        <Field label="Ngày bắt đầu" required><input className="input" type="date" value={f.start_date} onChange={set('start_date')} /></Field>
        <Field label="Ngày kết thúc" hint="Để trống: không xác định thời hạn"><input className="input" type="date" value={f.end_date} onChange={set('end_date')} /></Field>
        <Field label="Mức lương (VNĐ)">
          <input className="input" inputMode="numeric" value={f.salary === '' ? '' : Number(String(f.salary).replace(/\D/g, '') || 0).toLocaleString('vi-VN')}
            onChange={(e) => setF({ ...f, salary: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="Trạng thái">
          <select className="input" value={f.status} onChange={set('status')}>
            <option value="active">Đang hiệu lực</option><option value="ended">Đã hết hạn</option><option value="terminated">Đã chấm dứt</option>
          </select>
        </Field>
        <div className="span-2"><Field label="Ghi chú"><textarea className="input" rows={2} value={f.note} onChange={set('note')} /></Field></div>
        <div className="span-2">
          <Field label="Tệp hợp đồng (bản scan / PDF)">
            <input type="file" className="input" onChange={(e) => setFile(e.target.files[0] || null)} />
            {contract?.original_name && !file && <small className="muted">Đang có: {contract.original_name}</small>}
          </Field>
        </div>
        {!contract && <label className="check span-2"><input type="checkbox" checked={f.close_previous} onChange={set('close_previous')} /> Kết thúc các hợp đồng đang hiệu lực trước đó của nhân sự</label>}
      </div>
    </Modal>
  );
}

function ContractTable({ items, showPerson, canEdit, onEdit, onDelete, onOpenFile }) {
  return (
    <div className="table-wrap"><table className="table nowrap-cells">
      <thead><tr>{showPerson && <th>Nhân sự</th>}<th>Số HĐ</th><th>Loại hợp đồng</th><th>Bắt đầu</th><th>Kết thúc</th><th>Mức lương</th><th>Trạng thái</th><th /></tr></thead>
      <tbody>{items.map((k) => (
        <tr key={k.id} className="hr-row">
          {showPerson && <td><Link to={`/hrm/employees/${k.user_id}`} className="hr-name"><Avatar name={k.name} color={k.color} uid={k.user_id} size={30} />
            <span><b>{k.name}</b><small className="muted block">{k.employee_code || ''}{k.department_name ? ` · ${k.department_name}` : ''}</small></span></Link></td>}
          <td>{k.code ? <span className="hr-code">{k.code}</span> : <span className="muted">—</span>}</td><td>{k.contract_type}</td><td>{fmtDate(k.start_date)}</td>
          <td>{k.end_date ? <>{fmtDate(k.end_date)}{k.status === 'active' && daysLeft(k.end_date) <= 30 && <span className="hr-after"><Pill tone="red">Còn {Math.max(0, daysLeft(k.end_date))} ngày</Pill></span>}</> : <span className="muted">Không thời hạn</span>}</td>
          <td>{money(k.salary)}</td>
          <td><Pill tone={CONTRACT_TONE[k.status]}>{CONTRACT_STATUS[k.status]}</Pill></td>
          <td><div className="row gap-xs">
            {k.original_name && <button className="icon-btn sm" title={k.original_name} aria-label="Xem tệp hợp đồng" onClick={() => onOpenFile(k)}><Paperclip size={14} /></button>}
            {canEdit && <button className="icon-btn sm" aria-label="Sửa" onClick={() => onEdit(k)}><Pencil size={14} /></button>}
            {canEdit && <button className="icon-btn sm" aria-label="Xoá" onClick={() => onDelete(k)}><Trash2 size={14} /></button>}
          </div></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function useContractActions(reload) {
  const toast = useToast();
  const [editing, setEditing] = useState(null); // hợp đồng | 'new'
  const [viewing, setViewing] = useState(null);
  const remove = async (k) => {
    if (!window.confirm(`Xoá hợp đồng "${k.contract_type}" của ${k.name}?`)) return;
    try { await api.del(`/hrm/contracts/${k.id}`); toast('Đã xoá hợp đồng'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const viewer = viewing && (
    <FileViewer files={[viewing]} index={0} urlOf={(k) => api.url(`/hrm/contracts/${k.id}/file`)} onClose={() => setViewing(null)}
      publicUrlOf={async (k, share) => (await api.post(`/hrm/contracts/${k.id}/file/link${share ? '?share=1' : ''}`)).url} />
  );
  return { editing, setEditing, remove, setViewing, viewer };
}

export function ContractsPanel({ userId, canEdit }) {
  const [items, reload, loading] = useFetch(() => api.get(`/hrm/employees/${userId}/contracts`), [userId]);
  const a = useContractActions(reload);
  return (
    <HrCard icon={FileSignature} tone="green" title="Hợp đồng lao động" count={items?.length}
      action={canEdit && <button className="btn btn-sm btn-primary" onClick={() => a.setEditing('new')}><Plus size={14} /> Thêm hợp đồng</button>}>
      {loading && !items ? <Spinner /> : !items?.length ? <div className="hr-empty"><FileSignature size={16} /> Chưa có hợp đồng</div>
        : <ContractTable items={items} canEdit={canEdit} onEdit={a.setEditing} onDelete={a.remove} onOpenFile={a.setViewing} />}
      {a.editing && <ContractModal userId={userId} contract={a.editing === 'new' ? null : a.editing} onClose={() => a.setEditing(null)} onSaved={() => { a.setEditing(null); reload(); }} />}
      {a.viewer}
    </HrCard>
  );
}

export function HrmContracts() {
  const [cat] = useHrCatalog();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const dq = useDebounced(q);
  const [items, reload, loading, error] = useFetch(() => api.get('/hrm/contracts', { q: dq, status, type }), [dq, status, type]);
  const a = useContractActions(reload);
  const [all] = useFetch(() => api.get('/hrm/contracts'), [items]);
  if (error) return <div className="page hr"><div className="alert alert-error">{error.message}</div></div>;
  const n = (st) => (all || []).filter((k) => (st === 'expiring' ? k.status === 'active' && k.end_date && daysLeft(k.end_date) >= 0 && daysLeft(k.end_date) <= 30 : k.status === st)).length;
  const exportCsv = () => downloadCsv('hop-dong-lao-dong', ['Nhân sự', 'Mã NV', 'Phòng ban', 'Số HĐ', 'Loại hợp đồng', 'Bắt đầu', 'Kết thúc', 'Mức lương', 'Trạng thái'],
    items.map((k) => [k.name, k.employee_code, k.department_name, k.code, k.contract_type, k.start_date, k.end_date || 'Không thời hạn', k.salary, CONTRACT_STATUS[k.status]]));
  const pick = (st) => setStatus(status === st ? '' : st);
  return (
    <div className="page hr">
      <HrHero icon={FileSignature} tone="teal" title="Hợp đồng lao động" subtitle="Theo dõi hiệu lực, thời hạn và tệp hợp đồng của toàn công ty">
        {items?.length > 0 && <button className="btn" onClick={exportCsv}><Download size={15} /> Trích xuất</button>}
        <button className="btn solid" onClick={() => a.setEditing('new')}><Plus size={15} /> Thêm hợp đồng</button>
      </HrHero>
      <div className="hr-kpis">
        <Kpi i={0} icon={Layers} tone="blue" label="Tất cả hợp đồng" value={(all || []).length} onClick={() => setStatus('')} active={status === ''} />
        <Kpi i={1} icon={CheckCircle2} tone="green" label="Đang hiệu lực" value={n('active')} onClick={() => pick('active')} active={status === 'active'} />
        <Kpi i={2} icon={AlarmClock} tone="red" label="Sắp hết hạn" sub="Trong 30 ngày" value={n('expiring')} onClick={() => pick('expiring')} active={status === 'expiring'} />
        <Kpi i={3} icon={History} tone="gray" label="Đã hết hạn" value={n('ended')} onClick={() => pick('ended')} active={status === 'ended'} />
        <Kpi i={4} icon={XCircle} tone="orange" label="Đã chấm dứt" value={n('terminated')} onClick={() => pick('terminated')} active={status === 'terminated'} />
      </div>
      <div className="hr-toolbar">
        <div className="ww-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tên nhân sự, số HĐ, mã NV" /></div>
        <FilterSelect value={type} onChange={setType} options={[{ value: '', label: 'Mọi loại hợp đồng' }, ...(cat?.contract_types || []).map((t) => ({ value: t, label: t }))]} />
      </div>
      {loading && !items ? <Spinner /> : !items.length ? <div className="hr-table-card"><Empty title="Không có hợp đồng" /></div> : (
        <div className="hr-table-card hr-rise">
          <ContractTable items={items} showPerson canEdit onEdit={a.setEditing} onDelete={a.remove} onOpenFile={a.setViewing} />
          <div className="hr-table-foot"><span>{items.length} hợp đồng</span><span>Bấm biểu tượng kẹp giấy để xem tệp</span></div>
        </div>
      )}
      {a.editing && <ContractModal contract={a.editing === 'new' ? null : a.editing} onClose={() => a.setEditing(null)} onSaved={() => { a.setEditing(null); reload(); }} />}
      {a.viewer}
    </div>
  );
}

// ================================================================ phát triển sự nghiệp
export function CareerModal({ userId, onClose, onSaved }) {
  const { users, departments } = useApp();
  const toast = useToast();
  const [cat] = useHrCatalog();
  const [f, setF] = useState({ user_id: userId || null, type: 'promotion', effective_date: new Date().toISOString().slice(0, 10), from_value: '', to_value: '',
    to_department_id: '', decision_no: '', note: '', apply: true });
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e });
  const t = CAREER_TYPES[f.type];
  const save = async () => {
    try {
      const r = await api.post(`/hrm/employees/${f.user_id}/careers`, f);
      toast(`Đã ghi nhận: ${t.label}`);
      onSaved(r);
    } catch (e) { toast(e.message, 'error'); }
  };
  const moneyInput = (k) => (
    <input className="input" inputMode="numeric" value={f[k] === '' ? '' : Number(String(f[k]).replace(/\D/g, '') || 0).toLocaleString('vi-VN')}
      onChange={(e) => setF({ ...f, [k]: e.target.value.replace(/\D/g, '') })} />
  );
  return (
    <Modal title="Ghi nhận phát triển sự nghiệp" onClose={onClose} width={580}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" disabled={!f.user_id} onClick={save}>Lưu</button></>}>
      <div className="form-grid">
        {!userId && <div className="span-2"><Field label="Nhân sự" required><UserPicker users={users} value={f.user_id} onChange={set('user_id')} /></Field></div>}
        <Field label="Loại">
          <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, from_value: '', to_value: '' })}>
            {Object.entries(CAREER_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
        <Field label="Ngày hiệu lực" required><input className="input" type="date" value={f.effective_date} onChange={set('effective_date')} /></Field>
        {f.type === 'raise' && <Field label={t.from}>{moneyInput('from_value')}</Field>}
        <Field label={t.to} required={['promotion', 'raise', 'transfer'].includes(f.type)}>
          {f.type === 'raise' ? moneyInput('to_value') : f.type === 'transfer' ? (
            <select className="input" value={f.to_department_id} onChange={set('to_department_id')}>
              <option value="">— Chọn phòng ban —</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          ) : (
            <>
              <input className="input" list="hr-positions" value={f.to_value} onChange={set('to_value')} />
              {f.type === 'promotion' && <datalist id="hr-positions">{(cat?.positions || []).map((p) => <option key={p} value={p} />)}</datalist>}
            </>
          )}
        </Field>
        <Field label="Số quyết định"><input className="input" value={f.decision_no} onChange={set('decision_no')} placeholder="VD: QĐ-15/2026" /></Field>
        <div className="span-2"><Field label="Ghi chú / lý do"><textarea className="input" rows={2} value={f.note} onChange={set('note')} /></Field></div>
        {(f.type === 'promotion' || f.type === 'transfer') && (
          <label className="check span-2"><input type="checkbox" checked={f.apply} onChange={set('apply')} />
            {f.type === 'promotion' ? ' Cập nhật chức danh trên tài khoản ngay' : ' Chuyển phòng ban trên tài khoản ngay'}</label>
        )}
      </div>
    </Modal>
  );
}

function CareerValue({ k }) {
  const fmt = (v) => (k.type === 'raise' && isMoneyText(v) ? money(v) : v);
  if (k.type === 'raise' && k.to_value == null) return <span className="muted">Ẩn</span>;
  return <span>{k.from_value ? <>{fmt(k.from_value)} → </> : null}<b>{fmt(k.to_value) || '—'}</b></span>;
}

function CareerList({ items, showPerson, canEdit, onDelete }) {
  return (
    <ul className="hr-timeline">
      {items.map((k) => {
        const t = CAREER_TYPES[k.type];
        return (
          <li key={k.id}>
            <span className={cx('hr-tl-icon', k.type)}><t.icon size={14} /></span>
            <div className="grow">
              <div className="row gap-sm wrap">
                <Pill tone={t.tone}>{t.label}</Pill>
                {showPerson && <Link to={`/hrm/employees/${k.user_id}`}><b>{k.name}</b></Link>}
                <CareerValue k={k} />
              </div>
              <small className="muted block">Hiệu lực {fmtDate(k.effective_date)}{k.decision_no ? ` · ${k.decision_no}` : ''}{k.created_by_name ? ` · ghi nhận bởi ${k.created_by_name}` : ''}</small>
              {k.note && <div className="small">{k.note}</div>}
            </div>
            {canEdit && <button className="icon-btn sm" aria-label="Xoá" onClick={() => onDelete(k)}><Trash2 size={14} /></button>}
          </li>
        );
      })}
    </ul>
  );
}

export function CareersPanel({ userId, canEdit }) {
  const toast = useToast();
  const [items, reload] = useFetch(() => api.get(`/hrm/employees/${userId}/careers`), [userId]);
  const [adding, setAdding] = useState(false);
  const remove = async (k) => {
    if (!window.confirm('Xoá bản ghi này?')) return;
    try { await api.del(`/hrm/careers/${k.id}`); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <HrCard icon={TrendingUp} tone="violet" title="Phát triển sự nghiệp" count={items?.length}
      action={canEdit && <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}><Plus size={14} /> Ghi nhận</button>}>
      {!items ? <Spinner /> : !items.length ? <div className="hr-empty"><TrendingUp size={16} /> Chưa có thăng tiến, điều chỉnh lương, điều chuyển hay khen thưởng nào</div>
        : <CareerList items={items} canEdit={canEdit} onDelete={remove} />}
      {adding && <CareerModal userId={userId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </HrCard>
  );
}

export function HrmCareers() {
  const toast = useToast();
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const dq = useDebounced(q);
  const [items, reload, loading, error] = useFetch(() => api.get('/hrm/careers', { type, q: dq, year }), [type, dq, year]);
  const [adding, setAdding] = useState(false);
  const remove = async (k) => {
    if (!window.confirm('Xoá bản ghi này?')) return;
    try { await api.del(`/hrm/careers/${k.id}`); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const [yearAll] = useFetch(() => api.get('/hrm/careers', { year }), [year, items]);
  if (error) return <div className="page hr"><div className="alert alert-error">{error.message}</div></div>;
  const years = Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - i));
  return (
    <div className="page hr">
      <HrHero icon={TrendingUp} tone="indigo" title="Phát triển sự nghiệp" subtitle="Thăng tiến, điều chỉnh lương, điều chuyển, khen thưởng và kỷ luật của nhân sự">
        <button className="btn solid" onClick={() => setAdding(true)}><Plus size={15} /> Ghi nhận</button>
      </HrHero>
      <div className="hr-kpis">
        {Object.entries(CAREER_TYPES).map(([k, t], i) => (
          <Kpi key={k} i={i} icon={t.icon} tone={t.tone} label={t.label} value={(yearAll || []).filter((x) => x.type === k).length}
            sub={year ? `Năm ${year}` : 'Mọi năm'} onClick={() => setType(type === k ? '' : k)} active={type === k} />
        ))}
      </div>
      <div className="hr-toolbar">
        <div className="ww-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên nhân sự" /></div>
        <FilterSelect value={year} onChange={setYear} options={[{ value: '', label: 'Mọi năm' }, ...years.map((y) => ({ value: y, label: `Năm ${y}` }))]} />
        {type && <button className="btn btn-sm" onClick={() => setType('')}>Bỏ lọc: {CAREER_TYPES[type].label}</button>}
      </div>
      {loading && !items ? <Spinner /> : !items.length ? <HrCard><Empty title="Chưa có bản ghi" /></HrCard>
        : <HrCard icon={History} tone="violet" title="Dòng thời gian" count={items.length}><CareerList items={items} showPerson canEdit onDelete={remove} /></HrCard>}
      {adding && <CareerModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </div>
  );
}

// ================================================================ hồ sơ giấy tờ
export function DocumentsPanel({ userId, isHr, selfView }) {
  const toast = useToast();
  const [cat] = useHrCatalog();
  const [items, reload, , error] = useFetch(() => api.get(`/hrm/employees/${userId}/documents`), [userId]);
  const [type, setType] = useState('');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null);
  if (error) return null; // không có quyền xem giấy tờ
  const upload = async (files) => {
    if (!files.length) return;
    setBusy(true);
    try {
      await api.post(`/hrm/employees/${userId}/documents`, toFormData({ doc_type: type || 'Khác', expires_on: expires }, [...files]));
      toast(`Đã tải lên ${files.length} giấy tờ`);
      reload();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const remove = async (d) => {
    if (!window.confirm(`Xoá "${d.original_name}"?`)) return;
    try { await api.del(`/hrm/documents/${d.id}`); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const groups = [...new Set((items || []).map((d) => d.doc_type))];
  const today = new Date().toISOString().slice(0, 10);
  return (
    <HrCard icon={FileText} tone="amber" title="Hồ sơ giấy tờ" count={items?.length}>
      <p className="muted small">{selfView ? 'Bổ sung bản scan / ảnh giấy tờ của bạn để phòng Nhân sự lưu hồ sơ.' : 'CCCD, sơ yếu lý lịch, bằng cấp, giấy khám sức khoẻ… chỉ nhân viên và quản lý nhân sự xem được.'}</p>
      <div className="row gap-sm wrap">
        <select className="input input-sm" value={type} onChange={(e) => setType(e.target.value)} aria-label="Loại giấy tờ">
          <option value="">— Loại giấy tờ —</option>{(cat?.doc_types || []).map((t) => <option key={t}>{t}</option>)}
        </select>
        <input className="input input-sm" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} title="Ngày hết hạn (nếu có)" aria-label="Ngày hết hạn" />
        <label className={cx('btn btn-sm', busy && 'disabled')}><Upload size={14} /> Tải lên
          <input type="file" multiple hidden disabled={busy} onChange={(e) => { upload(e.target.files); e.target.value = ''; }} /></label>
      </div>
      {!items ? <Spinner /> : !items.length ? <p className="muted small mt">Chưa có giấy tờ</p> : groups.map((g) => (
        <div key={g} className="rq-guide-group">
          <small className="muted rq-guide-label">{g}</small>
          <div className="attach-list">
            {items.filter((d) => d.doc_type === g).map((d) => (
              <FileChip key={d.id} file={d} onOpen={() => setViewing(items.indexOf(d))} onRemove={isHr || selfView ? () => remove(d) : undefined}
                extra={d.expires_on ? <small className={d.expires_on < today ? 'text-red' : 'muted'}>HH {fmtDate(d.expires_on)}</small> : null} />
            ))}
          </div>
        </div>
      ))}
      {viewing != null && (
        <FileViewer files={items} index={viewing} urlOf={(d) => api.url(`/hrm/documents/${d.id}`)} onClose={() => setViewing(null)}
          publicUrlOf={async (d, share) => (await api.post(`/hrm/documents/${d.id}/link${share ? '?share=1' : ''}`)).url} />
      )}
    </HrCard>
  );
}

// ================================================================ cập nhật hàng loạt từ Excel
export const PROFILE_COLUMNS = [
  ['username', 'Tài khoản'], ['employee_code', 'Mã NV', 'Mã nhân viên'], ['gender', 'Giới tính'], ['job_position', 'Vị trí công việc'],
  ['employee_type', 'Phân loại nhân sự'], ['office', 'Văn phòng'], ['hire_date', 'Ngày bắt đầu', 'Ngày vào làm'], ['official_date', 'Ngày chính thức'],
  ['probation_end', 'Hết thử việc'], ['work_status', 'Trạng thái'], ['id_number', 'Số CCCD'], ['id_issue_date', 'Ngày cấp'], ['id_issue_place', 'Nơi cấp'],
  ['insurance_number', 'Số sổ BHXH'], ['tax_code', 'MST TNCN', 'Mã số thuế'], ['bank_account', 'Tài khoản ngân hàng'], ['emergency_contact', 'Liên hệ khẩn cấp'],
  ['resign_date', 'Ngày nghỉ việc'], ['resign_reason', 'Lý do nghỉ việc'],
];

export function ImportProfilesModal({ onClose, onDone }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [result, setResult] = useState(null);
  const template = () => downloadCsv('mau-cap-nhat-nhan-su', PROFILE_COLUMNS.map((c) => c[1]), [
    ['demo', 'LDL006', 'Nam', 'Nhân viên', 'Toàn thời gian', 'Văn phòng Hà Nội', '20/02/2023', '20/04/2023', '', 'Chính thức', '001095000111', '', 'Hà Nội', '', '', '', '', '', ''],
  ]);
  const pick = async (file) => {
    if (!file) return;
    setResult(null);
    try { setRows(rowsToObjects(await readSheetFile(file), PROFILE_COLUMNS).filter((r) => r.username || r.employee_code)); } catch (e) { toast(e.message, 'error'); }
  };
  const run = async () => {
    try {
      const r = await api.post('/hrm/employees/import', { rows });
      setResult(r);
      if (r.updated) { toast(`Đã cập nhật ${r.updated} hồ sơ`); onDone(); }
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title="Cập nhật hàng loạt hồ sơ nhân sự" onClose={onClose} width={620}
      footer={<><button className="btn" onClick={onClose}>Đóng</button><button className="btn btn-primary" disabled={!rows?.length || !!result} onClick={run}>Cập nhật {rows?.length || 0} hồ sơ</button></>}>
      <p className="muted small">Tệp Excel (.xlsx) hoặc CSV: mỗi dòng một nhân sự, xác định bằng <b>Tài khoản</b> hoặc <b>Mã NV</b>. Chỉ các ô có giá trị được cập nhật;
        ngày ghi dạng dd/mm/yyyy hoặc yyyy-mm-dd. <button className="link-btn" onClick={template}><Download size={13} /> Tải file mẫu</button></p>
      <input type="file" className="input" accept=".xlsx,.csv" onChange={(e) => pick(e.target.files[0])} />
      {rows && !result && <p className="small mt">{rows.length ? `Đọc được ${rows.length} dòng: ${rows.slice(0, 5).map((r) => r.username || r.employee_code).join(', ')}${rows.length > 5 ? '…' : ''}` : 'Không có dòng hợp lệ (cần cột Tài khoản hoặc Mã NV).'}</p>}
      {result && (
        <div className="mt">
          <p className="text-green">Đã cập nhật {result.updated} hồ sơ.</p>
          {result.errors.length > 0 && <ul className="small text-red">{result.errors.slice(0, 30).map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      )}
    </Modal>
  );
}

// ================================================================ báo cáo nhân sự
/** Bảng màu phân loại đã kiểm định (thứ tự cố định: xanh dương, cam, xanh ngọc, vàng, hồng); phần dư gộp "Khác" màu trung tính. */
const CAT = ['var(--hr-cat-1)', 'var(--hr-cat-2)', 'var(--hr-cat-3)', 'var(--hr-cat-4)', 'var(--hr-cat-5)'];
function DonutOf({ items, label }) {
  const top = items.slice(0, 4);
  const rest = items.slice(4).reduce((s, x) => s + x.c, 0);
  const list = rest ? [...top, { name: 'Khác', c: rest }] : top;
  const series = list.map((x, i) => ({ key: x.name, label: x.name, color: x.name === 'Khác' || /^Chưa/.test(x.name) ? 'var(--viz-neutral)' : CAT[i] }));
  return <Donut series={series} values={Object.fromEntries(list.map((x) => [x.name, x.c]))} centerLabel={label} size={150} />;
}

export function HrmReports() {
  const [r, , loading, error] = useFetch(() => api.get('/hrm/report'), []);
  if (error) return <div className="page hr"><div className="alert alert-error">{error.message}</div></div>;
  if (loading && !r) return <div className="page hr"><Spinner /></div>;
  const hires = r.turnover.reduce((s, m) => s + m.hires, 0);
  const resigns = r.turnover.reduce((s, m) => s + m.resigns, 0);
  const exportCsv = () => downloadCsv('bao-cao-nhan-su', ['Chỉ tiêu', 'Nhóm', 'Số lượng'], [
    ...[['Phân loại nhân sự', r.by_type], ['Văn phòng', r.by_office], ['Giới tính', r.by_gender], ['Loại hợp đồng', r.by_contract], ['Vị trí', r.by_position],
      ['Vị trí kinh doanh', r.by_sales || []], ['Kinh doanh theo miền', r.by_region || []], ['Thâm niên', r.seniority], ['Độ tuổi', r.ages]].flatMap(([k, list]) => list.map((x) => [k, x.name, x.c])),
    ...r.turnover.map((m) => ['Biến động', m.month, `+${m.hires} / -${m.resigns}`]),
  ]);
  const rows = r.turnover.map((m) => ({ label: `T${Number(m.month.slice(5))}`, tip: `Tháng ${m.month.slice(5)}/${m.month.slice(0, 4)}`, hires: m.hires, resigns: m.resigns }));
  return (
    <div className="page hr">
      <HrHero icon={BarChart3} tone="indigo" title="Báo cáo nhân sự" subtitle={`Số liệu đến ${new Date().toLocaleDateString('vi-VN')} · biến động 12 tháng gần nhất`}>
        <button className="btn solid" onClick={exportCsv}><Download size={15} /> Xuất Excel</button>
      </HrHero>
      <div className="hr-kpis">
        <Kpi i={0} icon={Users2} tone="aqua" label="Nhân sự đang làm việc" value={r.total} />
        <Kpi i={1} icon={UserPlus} tone="green" label="Tuyển mới" sub="12 tháng" value={hires} />
        <Kpi i={2} icon={UserMinus} tone="orange" label="Nghỉ việc" sub="12 tháng" value={resigns} />
        <Kpi i={3} icon={Percent} tone={r.turnover_rate > 15 ? 'red' : 'blue'} label="Tỷ lệ nghỉ việc" sub="12 tháng" value={`${r.turnover_rate}%`} />
        <Kpi i={4} icon={Clock3} tone="violet" label="Thâm niên trung bình" value={r.avg_seniority == null ? '—' : `${r.avg_seniority} năm`} />
      </div>
      <div className="hr-grid">
        <HrCard i={5} className="hr-span-12" icon={Activity} tone="blue" title="Biến động nhân sự 12 tháng">
          <GroupedColumns rows={rows} series={[{ key: 'hires', label: 'Tuyển mới', color: 'var(--hr-cat-1)' }, { key: 'resigns', label: 'Nghỉ việc', color: 'var(--hr-cat-2)' }]} />
        </HrCard>
        <HrCard i={6} className="hr-span-6" icon={Users} tone="pink" title="Giới tính"><DonutOf items={r.by_gender} label="nhân sự" /></HrCard>
        <HrCard i={7} className="hr-span-6" icon={Shapes} tone="aqua" title="Phân loại nhân sự"><DonutOf items={r.by_type} label="nhân sự" /></HrCard>
        <HrCard i={8} className="hr-span-6" icon={Clock3} tone="violet" title="Thâm niên"><HBars items={r.seniority} total={r.total} /></HrCard>
        <HrCard i={9} className="hr-span-6" icon={Cake} tone="amber" title="Độ tuổi"><HBars items={r.ages} total={r.total} /></HrCard>
        <HrCard i={10} className="hr-span-4" icon={MapPin} tone="blue" title="Văn phòng"><HBars items={r.by_office} total={r.total} /></HrCard>
        <HrCard i={11} className="hr-span-4" icon={FileSignature} tone="green" title="Loại hợp đồng"><HBars items={r.by_contract} total={r.total} /></HrCard>
        <HrCard i={12} className="hr-span-4" icon={Briefcase} tone="orange" title="Vị trí công việc"><HBars items={r.by_position} total={r.total} /></HrCard>
        {(r.by_sales?.length > 0 || r.by_region?.length > 0) && (
          <>
            <HrCard i={13} className="hr-span-6" icon={Network} tone="aqua" title="Cơ cấu kinh doanh theo vị trí"
              action={<Link to="/hrm/sales" className="link-btn small">Xem sơ đồ</Link>}><HBars items={r.by_sales} color="var(--hr-cat-3)" /></HrCard>
            <HrCard i={14} className="hr-span-6" icon={MapIcon} tone="orange" title="Nhân sự kinh doanh theo miền"><HBars items={r.by_region} color="var(--hr-cat-2)" /></HrCard>
          </>
        )}
        <HrCard i={15} className="hr-span-12" icon={TrendingUp} tone="violet" title={`Phát triển sự nghiệp năm ${r.year}`}>
          <div className="hr-kpis compact">
            {r.careers.map((c) => { const t = CAREER_TYPES[c.type]; return <Kpi key={c.type} icon={t.icon} tone={t.tone} label={c.name} value={c.c} />; })}
          </div>
        </HrCard>
      </div>
    </div>
  );
}

export const CATALOG_LABELS = {
  offices: ['Văn phòng', 'Văn phòng / chi nhánh làm việc'],
  positions: ['Vị trí công việc', 'Dùng cho vị trí và thăng tiến'],
  employee_types: ['Phân loại nhân sự', 'VD: Toàn thời gian, Bán thời gian'],
  contract_types: ['Phân loại hợp đồng', 'Loại hợp đồng lao động'],
  doc_types: ['Phân loại giấy tờ', 'Hồ sơ giấy tờ nhân viên'],
  resign_reasons: ['Lý do nghỉ việc', 'Dùng khi ghi nhận nghỉ việc'],
};
