import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Search, ArrowLeft, Cake, FileWarning, UserPlus, Hourglass, Download, Upload, Plus, Trash2, Users2, BarChart3, FileSignature, BadgeCheck,
  PauseCircle, Building2, PieChart, CheckCircle2, Briefcase, IdCard, LogOut, StickyNote, Phone, Mail, CalendarDays, UserCog, MapPin, Clock3,
  FileText, TrendingUp, Save, Settings2, ShieldCheck, ListChecks, CalendarHeart, Package,
} from 'lucide-react';
import { PersonAssets } from '../asset/AssetPages.jsx';
import { SalesFacts, RoleBadge } from './SalesOrg.jsx';
import { HrHero, Kpi, HrCard, Pill, HBars, StackBar, WORK_TONE, WORK_COLOR, daysLeft } from './hrUi.jsx';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Avatar, Spinner, Field, Empty, UserPicker, FilterSelect, Tabs, useShowMore } from '../components/ui.jsx';
import { ContractsPanel, CareersPanel, DocumentsPanel, ImportProfilesModal, useHrCatalog, CATALOG_LABELS } from './HrmRecords.jsx';
import { useDebounced } from '../components/shell.jsx';
import { fmtDate, cx } from '../utils.js';

export const WORK_STATUS = { working: 'Chính thức', probation: 'Thử việc', leave: 'Tạm nghỉ', resigned: 'Đã nghỉ việc' };

export function useHrMeta() {
  const [meta] = useFetch(() => api.get('/hrm/meta'), []);
  return meta;
}

function PeopleCard({ title, icon, tone, items, chip, empty, to, i }) {
  return (
    <HrCard icon={icon} tone={tone} title={title} count={items.length} i={i}
      action={to && items.length > 0 ? <Link to={to} className="link-btn small">Xem tất cả</Link> : null}>
      {items.length ? (
        <div className="hr-people">
          {items.slice(0, 6).map((x) => (
            <Link key={x.id} to={`/hrm/employees/${x.id}`} className="hr-person">
              <Avatar name={x.name} color={x.color} uid={x.id} size={32} />
              <span className="grow"><b>{x.name}</b>{x.sub && <small className="muted">{x.sub}</small>}</span>
              <span className="hr-chip">{chip(x)}</span>
            </Link>
          ))}
          {items.length > 6 && <small className="muted">và {items.length - 6} người khác</small>}
        </div>
      ) : <div className="hr-empty"><CheckCircle2 size={16} /> {empty}</div>}
    </HrCard>
  );
}

const leftLabel = (d) => { const n = daysLeft(d); return n == null ? '' : n <= 0 ? 'Hôm nay' : `Còn ${n} ngày`; };

export function HrmHome() {
  const { user } = useApp();
  const meta = useHrMeta();
  const [stats] = useFetch(() => (meta?.is_manager ? api.get('/hrm/stats') : Promise.resolve(null)), [meta?.is_manager]);
  if (!meta) return <div className="page hr"><Spinner /></div>;
  if (!meta.is_manager) return <HrmEmployee selfId={user.id} />;
  if (!stats) return <div className="page hr"><Spinner /></div>;
  const count = (k) => stats.by_status.find((x) => x.status === k)?.c || 0;
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Chào buổi sáng' : hour < 14 ? 'Chào buổi trưa' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
  const today = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const alerts = stats.contracts_expiring.length + stats.probation_ending.length;
  return (
    <div className="page hr">
      <HrHero icon={Users2} title={`${greet}, ${user.name.split(' ').slice(-1)[0]}!`}
        subtitle={`${today.charAt(0).toUpperCase()}${today.slice(1)} · ${alerts ? `${alerts} việc nhân sự cần chú ý trong 30 ngày tới` : 'Không có cảnh báo nhân sự trong 30 ngày tới'}`}>
        <Link className="btn" to="/hrm/reports"><BarChart3 size={15} /> Báo cáo</Link>
        <Link className="btn" to="/hrm/contracts"><FileSignature size={15} /> Hợp đồng</Link>
        <Link className="btn solid" to="/hrm/employees"><Users2 size={15} /> Danh sách nhân sự</Link>
      </HrHero>
      <div className="hr-kpis">
        <Kpi i={0} icon={Users2} tone="aqua" label="Đang làm việc" value={stats.total} sub="Không gồm đã nghỉ việc" to="/hrm/employees" />
        <Kpi i={1} icon={BadgeCheck} tone="blue" label="Chính thức" value={count('working')} sub={stats.total ? `${Math.round((count('working') / stats.total) * 100)}% nhân sự` : ''} to="/hrm/employees" />
        <Kpi i={2} icon={Hourglass} tone="amber" label="Thử việc" value={count('probation')} sub={`${stats.probation_ending.length} sắp hết thử việc`} to="/hrm/employees" />
        <Kpi i={3} icon={PauseCircle} tone="violet" label="Tạm nghỉ" value={count('leave')} to="/hrm/employees" />
        <Kpi i={4} icon={FileWarning} tone="red" label="HĐ sắp hết hạn" value={stats.contracts_expiring.length} sub="Trong 30 ngày" to="/hrm/contracts" />
      </div>
      <div className="hr-grid">
        <HrCard i={5} className="hr-span-7" icon={Building2} tone="blue" title="Nhân sự theo phòng ban" count={stats.by_department.length}>
          <HBars items={stats.by_department} total={stats.total} />
        </HrCard>
        <HrCard i={6} className="hr-span-5" icon={PieChart} tone="violet" title="Cơ cấu trạng thái làm việc">
          <StackBar parts={['working', 'probation', 'leave'].map((k) => ({ key: k, label: WORK_STATUS[k], value: count(k), color: WORK_COLOR[k] }))} />
          <p className="muted small hr-note">Nhân sự đã nghỉ việc: <b>{count('resigned')}</b></p>
        </HrCard>
        <div className="hr-span-6"><PeopleCard i={7} title="Hợp đồng sắp hết hạn" icon={FileWarning} tone="red" to="/hrm/contracts" empty="Không có hợp đồng hết hạn trong 30 ngày"
          items={stats.contracts_expiring.map((x) => ({ ...x, sub: x.contract_type }))} chip={(x) => `${fmtDate(x.contract_end)} · ${leftLabel(x.contract_end)}`} /></div>
        <div className="hr-span-6"><PeopleCard i={8} title="Sắp hết thử việc" icon={Hourglass} tone="amber" empty="Không có ai sắp hết thử việc"
          items={stats.probation_ending} chip={(x) => `${fmtDate(x.probation_end)} · ${leftLabel(x.probation_end)}`} /></div>
        <div className="hr-span-6"><PeopleCard i={9} title="Sinh nhật trong tháng" icon={Cake} tone="pink" empty="Không có sinh nhật trong tháng này"
          items={stats.birthdays} chip={(x) => fmtDate(x.birthday).slice(0, 5)} /></div>
        <div className="hr-span-6"><PeopleCard i={10} title="Nhân sự mới trong tháng" icon={UserPlus} tone="green" empty="Chưa có nhân sự mới trong tháng"
          items={stats.new_hires} chip={(x) => fmtDate(x.hire_date)} /></div>
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
  { value: '', label: 'Đang làm việc', tone: 'aqua' }, { value: 'all', label: 'Tất cả nhân sự', tone: 'gray' }, { value: 'mine', label: 'Tôi quản lý', tone: 'blue' },
  { value: 'probation', label: 'Đang thử việc', tone: 'amber' }, { value: 'leave', label: 'Đang tạm nghỉ', tone: 'violet' }, { value: 'resigned', label: 'Nghỉ việc', tone: 'gray' },
];
export const StatusPill = ({ status }) => <Pill tone={WORK_TONE[status] || 'gray'}>{WORK_STATUS[status] || status}</Pill>;
/** Nhóm cột như Base HRM: Tổng quan, Công việc, Hợp đồng & pháp lý, Hồ sơ & liên hệ. */
const COLUMN_SETS = {
  overview: { label: 'Tổng quan', cols: [['department_name', 'Phòng ban'], ['job_position', 'Vị trí'], ['hire_date', 'Ngày bắt đầu', 'date'], ['seniority', 'Thâm niên'], ['work_status', 'Trạng thái']] },
  work: { label: 'Công việc', cols: [['title', 'Chức danh'], ['manager_name', 'Quản lý trực tiếp'], ['office', 'Văn phòng'], ['employee_type', 'Phân loại nhân sự'],
    ['official_date', 'Ngày chính thức', 'date'], ['last_promotion', 'Thăng tiến gần nhất']] },
  legal: { label: 'Hợp đồng & pháp lý', cols: [['contract_type', 'Hợp đồng'], ['contract_end', 'Hết hạn HĐ', 'date'], ['id_number', 'Số CCCD'], ['insurance_number', 'Số sổ BHXH'], ['tax_code', 'MST TNCN']] },
  sales: { label: 'Kinh doanh', cols: [['sales_role', 'Vị trí kinh doanh'], ['sales_industry', 'Ngành hàng'], ['territory_names', 'Địa bàn phụ trách'], ['manager_name', 'Quản lý trực tiếp'], ['office', 'Văn phòng']] },
  contact: { label: 'Hồ sơ & liên hệ', cols: [['gender', 'Giới tính'], ['birthday', 'Ngày sinh', 'date'], ['phone', 'Điện thoại'], ['email', 'Email'], ['resign_date', 'Ngày nghỉ việc', 'date']] },
};

/** Địa bàn theo thứ tự cây (toàn quốc → miền → khu vực → tỉnh) cho ô chọn. */
function orderTerritories(list) {
  const out = [];
  const walk = (pid) => list.filter((t) => (t.parent_id ?? null) === pid).sort((a, b) => a.sort - b.sort).forEach((t) => { out.push(t); walk(t.id); });
  walk(null);
  return out;
}

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
  const [salesRole, setSalesRole] = useState('');
  const [territory, setTerritory] = useState('');
  const [industry, setIndustry] = useState('');
  const [sales] = useFetch(() => api.get('/sales/structure'), []);
  const [colSet, setColSet] = useState('overview');
  const [importing, setImporting] = useState(false);
  const dq = useDebounced(q);
  const params = { q: dq, view, department_id: dep, office, employee_type: type, contract, sales_role: salesRole, territory_id: territory, industry };
  const [items, reload, loading, error] = useFetch(() => api.get('/hrm/employees', params), [dq, view, dep, office, type, contract, salesRole, territory, industry]);
  const pickSales = (setter) => (v) => { setter(v); if (v) setColSet('sales'); };
  const [shown, more] = useShowMore(items, 60, JSON.stringify(params));
  const indent = { national: '', region: '— ', area: '—— ', province: '——— ' };
  if (error) return <div className="page"><div className="alert alert-error">{error.message}</div></div>;
  const cell = (e, [k, , kind]) => {
    if (k === 'work_status') return <StatusPill status={e.work_status} />;
    if (k === 'sales_role') return e.sales_role ? <RoleBadge role={e.sales_role} /> : '—';
    if (k === 'sales_industry') return e.sales_industry ? (sales?.industries || []).find((x) => x.code === e.sales_industry)?.name || e.sales_industry : e.sales_role ? 'Chung' : '—';
    if (k === 'seniority') return seniority(e.hire_date, e.resign_date);
    if (k === 'contract_end') return <span className={e.contract_end && e.contract_end < new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) ? 'text-red' : ''}>{fmtDate(e.contract_end)}</span>;
    const v = e[k];
    return kind === 'date' ? fmtDate(v) : v || '—';
  };
  return (
    <div className="page hr">
      <HrHero icon={Users2} tone="indigo" title="Danh sách nhân sự" subtitle="Tra cứu hồ sơ, lọc theo phòng ban / văn phòng / cơ cấu kinh doanh; nhập từ Excel để thêm nhân sự mới (tạo tài khoản), lịch sử công tác, hợp đồng">
        <a className="btn" href={api.url('/hrm/employees/export', params)}><Download size={15} /> Trích xuất Excel</a>
        <button className="btn solid" onClick={() => setImporting(true)}><Upload size={15} /> Nhập từ Excel</button>
      </HrHero>
      <div className="hr-seg" role="tablist">
        {VIEWS.map((v) => (
          <button key={v.value} role="tab" aria-selected={view === v.value} className={cx(`tone-${v.tone}`, view === v.value && 'active')} onClick={() => setView(v.value)}>
            <i />{v.label}
          </button>
        ))}
      </div>
      <div className="hr-toolbar">
        <div className="ww-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên, mã NV, điện thoại, email" /></div>
        <FilterSelect value={dep} onChange={setDep} options={[{ value: '', label: 'Tất cả phòng ban' }, ...departments.map((d) => ({ value: d.id, label: d.name }))]} />
        <FilterSelect value={office} onChange={setOffice} options={[{ value: '', label: 'Mọi văn phòng' }, ...(cat?.offices || []).map((o) => ({ value: o, label: o }))]} />
        <FilterSelect value={type} onChange={setType} options={[{ value: '', label: 'Mọi phân loại' }, ...(cat?.employee_types || []).map((o) => ({ value: o, label: o }))]} />
        <FilterSelect value={salesRole} onChange={pickSales(setSalesRole)} options={[{ value: '', label: 'Mọi vị trí kinh doanh' },
          ...Object.entries(sales?.roles || {}).map(([k, r]) => ({ value: k, label: r.label })), { value: 'none', label: 'Ngoài cơ cấu kinh doanh' }]} />
        <FilterSelect value={territory} onChange={pickSales(setTerritory)} options={[{ value: '', label: 'Mọi địa bàn' },
          ...orderTerritories((sales?.territories || []).filter((t) => t.level !== 'province')).map((t) => ({ value: t.id, label: `${indent[t.level]}${t.name}` }))]} />
        {(sales?.industries || []).length > 0 && <FilterSelect value={industry} onChange={pickSales(setIndustry)} options={[{ value: '', label: 'Mọi ngành hàng' },
          ...sales.industries.map((x) => ({ value: x.code, label: x.name }))]} />}
        <FilterSelect value={contract} onChange={setContract} options={[{ value: '', label: 'Mọi hợp đồng' }, { value: 'expiring', label: 'HĐ sắp hết hạn (30 ngày)' }]} />
      </div>
      <div className="hr-colsets">
        {Object.entries(COLUMN_SETS).map(([k, c]) => <button key={k} className={cx('chip-btn', colSet === k && 'active')} onClick={() => setColSet(k)}>{c.label}</button>)}
      </div>
      {loading && !items ? <Spinner /> : !items.length ? <div className="hr-table-card"><Empty title="Không có nhân sự phù hợp bộ lọc" /></div> : (
        <div className="hr-table-card hr-rise">
          <div className="table-wrap"><table className="table nowrap-cells">
            <thead><tr><th>Mã NV</th><th>Nhân sự</th>{COLUMN_SETS[colSet].cols.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
            <tbody>{shown.map((e) => (
              <tr key={e.id} className="clickable hr-row" onClick={() => navigate(`/hrm/employees/${e.id}`)}>
                <td>{e.employee_code ? <span className="hr-code">{e.employee_code}</span> : <span className="muted">—</span>}</td>
                <td><span className="hr-name"><Avatar name={e.name} color={e.color} uid={e.id} size={32} /><span><b>{e.name}</b><small className="muted block">{e.title}</small></span></span></td>
                {COLUMN_SETS[colSet].cols.map((c) => <td key={c[0]}>{cell(e, c)}</td>)}
              </tr>))}</tbody>
          </table></div>
          {more}
          <div className="hr-table-foot"><span>{items.length} nhân sự</span><span>Bấm vào một dòng để mở hồ sơ</span></div>
        </div>
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
  if (error) return <div className="page hr"><div className="alert alert-error">{error.message}</div></div>;
  if (loading && !e) return <div className="page hr"><Spinner /></div>;
  const edit = meta?.is_manager;
  const self = e.id === user.id;
  const save = async () => {
    if (f.work_status === 'resigned' && e.work_status !== 'resigned'
      && !window.confirm(`Chuyển ${e.name} sang "Đã nghỉ việc"? Các vị trí trong cơ cấu kinh doanh / trưởng phòng của người này sẽ được để trống cho đến khi có người mới.`)) return;
    try {
      const r = await api.put(`/hrm/employees/${id}`, f);
      toast(r.vacated ? `Đã lưu hồ sơ — ${r.vacated} vị trí trong cơ cấu kinh doanh đang để trống` : 'Đã lưu hồ sơ nhân sự');
      reload();
    } catch (err) { toast(err.message, 'error'); }
  };
  const options = (type, cur) => {
    const list = Array.isArray(type) ? type : type?.startsWith('list:') ? cat?.[type.slice(5)] || [] : null;
    return list && [...new Set([...list, ...(cur && !list.includes(cur) ? [cur] : [])])];
  };
  const dirty = e && f && [...ALL_FIELDS.map(([k]) => k), 'note'].some((k) => String(f[k] ?? '') !== String(e[k] ?? ''));
  const TABS = [['profile', 'Hồ sơ', IdCard], ['contracts', 'Hợp đồng', FileSignature], ['career', 'Phát triển sự nghiệp', TrendingUp], ['documents', 'Giấy tờ', FileText],
    ['assets', 'Tài sản', Package]];
  return (
    <div className="page hr">
      <section className="hr-profile hr-rise">
        <div className="hr-profile-cover">
          {!selfId && <button className="icon-btn hr-back" onClick={() => navigate(-1)} aria-label="Quay lại"><ArrowLeft size={18} /></button>}
        </div>
        <div className="hr-profile-main">
          <span className="hr-profile-avatar"><Avatar name={e.name} color={e.color} uid={e.id} size={84} /></span>
          <div className="hr-profile-info">
            <div className="row gap-sm wrap"><h1>{e.name}</h1><StatusPill status={e.work_status} /></div>
            <div className="muted">{e.title || 'Chưa có chức danh'}{e.department_name ? ` · ${e.department_name}` : ''}</div>
            <div className="hr-facts">
              {e.employee_code && <span className="hr-fact tone-gray"><IdCard size={13} /> {e.employee_code}</span>}
              {e.hire_date && <span className="hr-fact tone-aqua"><Clock3 size={13} /> Thâm niên {seniority(e.hire_date, e.resign_date)}</span>}
              {e.job_position && <span className="hr-fact tone-blue"><Briefcase size={13} /> {e.job_position}</span>}
              {e.office && <span className="hr-fact tone-violet"><MapPin size={13} /> {e.office}</span>}
              {e.manager_name && <span className="hr-fact tone-amber"><UserCog size={13} /> Quản lý: {e.manager_name}</span>}
              <SalesFacts userId={e.id} />
              {e.contract_end && <span className={cx('hr-fact', daysLeft(e.contract_end) <= 30 ? 'tone-red' : 'tone-green')}><FileSignature size={13} /> HĐ đến {fmtDate(e.contract_end)}</span>}
            </div>
          </div>
          <div className="row gap-sm wrap">
            <Link className="btn btn-sm" to={`/checkin?user_id=${id}`}><CalendarDays size={14} /> Bảng công</Link>
            <Link className="btn btn-sm" to={`/timeoff?user_id=${id}`}><CalendarHeart size={14} /> Nghỉ phép</Link>
            <Link className="btn btn-sm" to={`/account/u/${id}`}>Tài khoản</Link>
          </div>
        </div>
        <nav className="hr-profile-tabs" role="tablist">
          {TABS.map(([k, l, Icon]) => <button key={k} role="tab" aria-selected={tab === k} className={cx(tab === k && 'active')} onClick={() => setTab(k)}><Icon size={15} /> {l}</button>)}
        </nav>
      </section>
      {selfId && <div className="alert alert-info">Đây là hồ sơ nhân sự của bạn. Liên hệ phòng Hành chính Nhân sự nếu thông tin chưa chính xác.</div>}
      <div className="hr-tab-panel" key={tab}>
        {tab === 'profile' && f && (
          <>
            <HrCard icon={Phone} tone="aqua" title="Liên hệ">
              <div className="hr-field-grid">
                <Field label="Email"><input className="input" value={e.email || ''} disabled /></Field>
                <Field label="Điện thoại"><input className="input" value={e.phone || ''} disabled /></Field>
                <Field label="Ngày sinh"><input className="input" value={fmtDate(e.birthday)} disabled /></Field>
              </div>
            </HrCard>
            {FIELD_GROUPS.map(([title, fields], gi) => {
              const [Icon, tone] = [[Briefcase, 'blue'], [ShieldCheck, 'violet'], [LogOut, 'gray']][gi] || [FileText, 'blue'];
              return (
                <HrCard key={title} icon={Icon} tone={tone} title={title} i={gi + 1}>
                  <div className="hr-field-grid">
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
                </HrCard>
              );
            })}
            <HrCard icon={StickyNote} tone="amber" title="Ghi chú" i={4}>
              <textarea className="input" rows={3} disabled={!edit} value={f.note} onChange={(ev) => setF({ ...f, note: ev.target.value })} placeholder={edit ? 'Ghi chú nội bộ của phòng Nhân sự' : ''} />
            </HrCard>
            {edit && dirty && (
              <div className="hr-savebar hr-rise">
                <span className="grow small"><b>Có thay đổi chưa lưu</b></span>
                {dirty && <button className="btn" onClick={() => setF(Object.fromEntries([...ALL_FIELDS.map(([k]) => [k, e[k] || '']), ['note', e.note || '']]))}>Hoàn tác</button>}
                <button className="btn btn-primary" disabled={!dirty} onClick={save}><Save size={15} /> Lưu hồ sơ</button>
              </div>
            )}
          </>
        )}
        {tab === 'contracts' && (edit || self ? <ContractsPanel userId={id} canEdit={edit} /> : <HrCard><div className="hr-empty"><ShieldCheck size={16} /> Chỉ nhân viên và quản lý nhân sự xem được hợp đồng.</div></HrCard>)}
        {tab === 'career' && <CareersPanel userId={id} canEdit={edit} />}
        {tab === 'assets' && <PersonAssets userId={id} />}
        {tab === 'documents' && (edit || self ? <DocumentsPanel userId={id} isHr={edit} selfView={self} /> : <HrCard><div className="hr-empty"><ShieldCheck size={16} /> Chỉ nhân viên và quản lý nhân sự xem được giấy tờ.</div></HrCard>)}
      </div>
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
  if (!ids || !cat) return <div className="page hr"><Spinner /></div>;
  if (!meta.is_manager) return <div className="page hr"><div className="alert alert-error">Chỉ quản lý nhân sự mới vào được cài đặt.</div></div>;
  const setList = (k) => (v) => setCat({ ...cat, [k]: v });
  const saveCat = async () => {
    try { setCat(await api.put('/hrm/catalog', cat)); toast('Đã lưu danh mục'); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="page hr">
      <HrHero icon={Settings2} tone="slate" title="Cài đặt LDL HRM" subtitle="Phân quyền quản lý nhân sự và danh mục dùng chung cho hồ sơ, hợp đồng, giấy tờ" />
      {user.role === 'admin' && (
        <HrCard icon={ShieldCheck} tone="red" title="Phân quyền">
          <Field label="Quản lý nhân sự" hint="Được xem / sửa toàn bộ hồ sơ nhân sự, hợp đồng, giấy tờ, bảng công và quỹ phép của công ty (ngoài quản trị viên)">
            <UserPicker users={users} multiple value={ids} onChange={setIds} placeholder="Chọn người" />
          </Field>
          <button className="btn btn-primary mt" onClick={async () => { await api.put('/hrm/settings', { managers: ids }); toast('Đã lưu'); }}><Save size={15} /> Lưu phân quyền</button>
        </HrCard>
      )}
      <HrCard icon={ListChecks} tone="blue" title="Danh mục" i={1} action={<button className="btn btn-primary btn-sm" onClick={saveCat}><Save size={14} /> Lưu danh mục</button>}>
        <p className="muted small">Mỗi dòng một giá trị. Dùng cho lựa chọn trong hồ sơ nhân sự, hợp đồng, giấy tờ và bộ lọc danh sách.</p>
        <div className="form-grid">
          {Object.entries(CATALOG_LABELS).map(([k, [label, hint]]) => <ListEditor key={k} label={label} hint={hint} value={cat[k] || []} onChange={setList(k)} />)}
        </div>
      </HrCard>
      <HrCard icon={CalendarHeart} tone="pink" title="Ngày lễ" count={(cat.holidays || []).length} i={2}
        action={<button className="btn btn-primary btn-sm" onClick={saveCat}><Save size={14} /> Lưu</button>}>
        {(cat.holidays || []).map((h, i) => (
          <div key={i} className="row gap-sm mt-xs">
            <input className="input input-sm" type="date" value={h.date} onChange={(e) => setCat({ ...cat, holidays: cat.holidays.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} aria-label="Ngày" />
            <input className="input" value={h.name} placeholder="Tên ngày lễ" onChange={(e) => setCat({ ...cat, holidays: cat.holidays.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <button className="icon-btn sm" aria-label="Xoá" onClick={() => setCat({ ...cat, holidays: cat.holidays.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
          </div>
        ))}
        {!(cat.holidays || []).length && <div className="hr-empty"><CalendarHeart size={16} /> Chưa có ngày lễ nào</div>}
        <button className="btn btn-sm mt" onClick={() => setCat({ ...cat, holidays: [...(cat.holidays || []), { date: '', name: '' }] })}><Plus size={14} /> Thêm ngày lễ</button>
      </HrCard>
    </div>
  );
}
