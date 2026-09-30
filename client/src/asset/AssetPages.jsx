/** LDL Asset — tài sản của tôi, tổng quan, danh sách tài sản, chi tiết, theo người sử dụng. */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Package, PackageCheck, PackagePlus, PackageMinus, Wrench, AlertTriangle, Wallet, TrendingDown, Users2, Search, Plus, Upload, Download,
  ArrowLeftRight, Pencil, Trash2, History, ClipboardCheck, UserRound, MapPin, Tag, Boxes, ShieldCheck, CalendarClock, ArrowLeft, UserCheck,
  CheckCircle2, LogIn, LogOut, FileSignature, Layers,
} from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Avatar, Spinner, Empty, FilterSelect, Modal, Field, UserPicker, useShowMore } from '../components/ui.jsx';
import { useDebounced } from '../components/shell.jsx';
import { HrHero, Kpi, HrCard, Pill, HBars, StackBar } from '../hrm/hrUi.jsx';
import { readSheetFile, rowsToObjects, downloadCsv } from '../sheet.js';
import { fmtDate, fmtDateTime, timeAgo, cx } from '../utils.js';
import {
  AssetStatus, HandoverStatus, KindPill, STATUS_LABEL, STATUS_TONE, CONDITION_LABEL, REASON_LABEL, money, moneyShort,
  useAssetMeta, AssetFormModal, HandoverModal,
} from './assetShared.jsx';

// ================================================================ tài sản của tôi
function AssetCard({ a, i }) {
  return (
    <Link to={`/asset/item/${a.id}`} className="as-card hr-rise" style={{ '--i': i }}>
      <span className={cx('as-card-icon', `tone-${a.kind === 'tool' ? 'amber' : 'blue'}`)}>{a.kind === 'tool' ? <Wrench size={18} /> : <Package size={18} />}</span>
      <span className="grow">
        <b className="ellipsis">{a.name}</b>
        <small className="muted block ellipsis"><span className="hr-code">{a.code}</span> {a.type || ''}{a.serial ? ` · ${a.serial}` : ''}</small>
        <span className="as-card-foot"><AssetStatus status={a.status} /><small className="muted">Nhận {fmtDate(a.assigned_at)} · {CONDITION_LABEL[a.condition]?.toLowerCase()}</small></span>
      </span>
    </Link>
  );
}

/** Tài sản đang giữ + biên bản + thủ tục của một người (dùng cho "Tài sản của tôi" và hồ sơ HRM). */
export function PersonAssets({ userId, embedded, onChanged }) {
  const { user } = useApp();
  const toast = useToast();
  const [meta] = useAssetMeta();
  const [d, reload, loading, error] = useFetch(() => api.get(`/asset/people/${userId}`), [userId]);
  const [modal, setModal] = useState(null);
  if (error) return <HrCard><div className="hr-empty"><ShieldCheck size={16} /> {error.message}</div></HrCard>;
  if (loading && !d) return <Spinner />;
  const manager = meta?.is_manager;
  const self = userId === user.id;
  const pending = d.handovers.filter((h) => h.status === 'pending');
  const confirm = async (h) => {
    try { await api.post(`/asset/handovers/${h.id}/confirm`, {}); toast(`Đã xác nhận biên bản ${h.code}`); reload(); onChanged?.(); } catch (e) { toast(e.message, 'error'); }
  };
  const value = d.assets.reduce((s, a) => s + (a.price || 0), 0);
  return (
    <>
      {pending.length > 0 && (
        <div className="as-alert hr-rise">
          <ClipboardCheck size={20} />
          <div className="grow"><b>{self ? `Bạn có ${pending.length} biên bản cần xác nhận` : `${pending.length} biên bản đang chờ nhân viên xác nhận`}</b>
            <small className="block">Kiểm tra đúng tài sản, số lượng và tình trạng rồi bấm xác nhận.</small></div>
          <div className="row gap-sm wrap">
            {pending.map((h) => (
              <span key={h.id} className="row gap-xs">
                <Link className="btn btn-sm" to={`/asset/handovers/${h.id}`}>{h.code} · {h.kind === 'issue' ? 'nhận' : 'trả'} {h.item_count}</Link>
                {self && <button className="btn btn-sm btn-primary" onClick={() => confirm(h)}><CheckCircle2 size={14} /> Xác nhận</button>}
              </span>
            ))}
          </div>
        </div>
      )}
      <HrCard icon={Package} tone="blue" title={self ? 'Tài sản bạn đang giữ' : 'Tài sản đang giữ'} count={d.assets.length}
        action={<div className="row gap-sm">
          {!!value && manager && <small className="muted">Tổng nguyên giá {money(value)}</small>}
          {manager && <button className="btn btn-sm" onClick={() => setModal('issue')}><PackagePlus size={14} /> Bàn giao thêm</button>}
          {manager && d.assets.length > 0 && <button className="btn btn-sm" onClick={() => setModal('return')}><PackageMinus size={14} /> Thu hồi</button>}
        </div>}>
        {d.assets.length ? <div className="as-cards">{d.assets.map((a, i) => <AssetCard key={a.id} a={a} i={i} />)}</div>
          : <div className="hr-empty"><PackageCheck size={16} /> {self ? 'Bạn không giữ tài sản nào của công ty.' : 'Không giữ tài sản nào.'}</div>}
      </HrCard>
      {d.procedures.length > 0 && (
        <HrCard icon={UserCheck} tone="aqua" title="Thủ tục nhận việc / nghỉ việc" count={d.procedures.length} i={1}>
          <div className="hr-people">
            {d.procedures.map((p) => (
              <Link key={p.id} to={manager ? `/asset/procedures/${p.id}` : '#'} className="hr-person">
                <span className={cx('hr-card-icon', p.kind === 'onboard' ? 'tone-green' : 'tone-orange')}>{p.kind === 'onboard' ? <LogIn size={15} /> : <LogOut size={15} />}</span>
                <span className="grow"><b>{p.kind === 'onboard' ? 'Nhận việc' : 'Nghỉ việc'} · {fmtDate(p.effective_date)}</b>
                  <small className="muted">{JSON.parse(p.steps || '[]').filter((s) => s.done).length}/{JSON.parse(p.steps || '[]').length} bước</small></span>
                <Pill tone={p.status === 'done' ? 'green' : p.status === 'open' ? 'amber' : 'gray'}>{{ open: 'Đang thực hiện', done: 'Hoàn tất', cancelled: 'Đã huỷ' }[p.status]}</Pill>
              </Link>
            ))}
          </div>
        </HrCard>
      )}
      <HrCard icon={FileSignature} tone="violet" title="Biên bản bàn giao / thu hồi" count={d.handovers.length} i={2}>
        {d.handovers.length ? <HandoverTable items={d.handovers} hidePerson /> : <div className="hr-empty"><FileSignature size={16} /> Chưa có biên bản nào.</div>}
      </HrCard>
      {modal && <HandoverModal kind={modal} lockKind employeeId={userId} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); onChanged?.(); }} />}
      {embedded ? null : null}
    </>
  );
}

export function HandoverTable({ items, hidePerson }) {
  const navigate = useNavigate();
  return (
    <div className="table-wrap"><table className="table nowrap-cells">
      <thead><tr><th>Số biên bản</th><th>Loại</th>{!hidePerson && <th>Nhân viên</th>}<th>Lý do</th><th>Số tài sản</th><th>Ngày lập</th><th>Trạng thái</th></tr></thead>
      <tbody>{items.map((h) => (
        <tr key={h.id} className="clickable hr-row" onClick={() => navigate(`/asset/handovers/${h.id}`)}>
          <td><span className="hr-code">{h.code}</span></td><td><KindPill kind={h.kind} /></td>
          {!hidePerson && <td><span className="hr-name"><Avatar name={h.employee_name} color={h.employee_color} uid={h.employee_id} size={28} /><span><b>{h.employee_name}</b><small className="muted block">{h.employee_department || ''}</small></span></span></td>}
          <td>{REASON_LABEL[h.reason]}</td><td>{h.item_count}{h.total_value ? <small className="muted"> · {moneyShort(h.total_value)}</small> : null}</td>
          <td>{fmtDate(h.created_at)}</td><td><HandoverStatus status={h.status} /></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

export function MyAssets() {
  const { user } = useApp();
  return (
    <div className="page hr">
      <HrHero icon={Package} tone="brown" title="Tài sản của tôi" subtitle="Tài sản, công cụ công ty đang giao cho bạn và các biên bản bàn giao / thu hồi cần xác nhận" />
      <PersonAssets userId={user.id} />
    </div>
  );
}

// ================================================================ tổng quan (quản lý)
export function AssetOverview() {
  const [s, , loading, error] = useFetch(() => api.get('/asset/summary'), []);
  const [modal, setModal] = useState(null);
  const navigate = useNavigate();
  if (error) return <div className="page hr"><div className="alert alert-error">{error.message}</div></div>;
  if (loading && !s) return <div className="page hr"><Spinner /></div>;
  const n = (k) => s.by_status.find((x) => x.status === k)?.c || 0;
  const TX = { create: ['Tạo mới', 'gray'], assign: ['Bàn giao', 'blue'], return: ['Thu hồi', 'violet'], transfer: ['Điều chuyển', 'aqua'], status: ['Trạng thái', 'amber'], update: ['Cập nhật', 'gray'] };
  return (
    <div className="page hr">
      <HrHero icon={Boxes} tone="brown" title="Quản lý tài sản" subtitle={`${s.total} tài sản · ${s.holder_count} người đang giữ · ${s.pending_handovers} biên bản chờ xác nhận`}>
        <button className="btn" onClick={() => setModal('return')}><PackageMinus size={15} /> Thu hồi</button>
        <button className="btn" onClick={() => setModal('issue')}><PackagePlus size={15} /> Bàn giao</button>
        <button className="btn solid" onClick={() => setModal('asset')}><Plus size={15} /> Thêm tài sản</button>
      </HrHero>
      <div className="hr-kpis">
        <Kpi i={0} icon={Boxes} tone="aqua" label="Tổng tài sản" value={s.total} sub={s.by_kind.map((k) => `${k.c} ${k.name.toLowerCase()}`).join(' · ')} to="/asset/list" />
        <Kpi i={1} icon={UserRound} tone="blue" label="Đang sử dụng" value={n('in_use')} sub={`${s.holder_count} người đang giữ`} to="/asset/list?status=in_use" />
        <Kpi i={2} icon={PackageCheck} tone="green" label="Sẵn sàng trong kho" value={n('available')} to="/asset/list?status=available" />
        <Kpi i={3} icon={Wrench} tone="amber" label="Bảo trì / hỏng" value={n('maintenance') + n('broken')} sub={`${n('lost')} mất`} to="/asset/list?status=broken" />
        <Kpi i={4} icon={Wallet} tone="violet" label="Giá trị còn lại" value={`${moneyShort(s.book_value)} ₫`} sub={`Nguyên giá ${moneyShort(s.value)} ₫`} />
      </div>
      <div className="hr-grid">
        <HrCard i={5} className="hr-span-7" icon={Tag} tone="blue" title="Theo loại tài sản" count={s.by_type.length}><HBars items={s.by_type} total={s.total} /></HrCard>
        <HrCard i={6} className="hr-span-5" icon={Layers} tone="violet" title="Theo trạng thái">
          <StackBar parts={['in_use', 'available', 'maintenance', 'broken'].map((k, i) => ({ key: k, label: STATUS_LABEL[k], value: n(k),
            color: ['var(--hr-cat-1)', 'var(--hr-cat-3)', 'var(--hr-cat-4)', 'var(--hr-cat-2)'][i] }))} />
          <h4 className="as-subhead"><MapPin size={14} /> Theo địa điểm</h4>
          <HBars items={s.by_location} total={s.total} color="var(--hr-cat-7)" />
        </HrCard>
        <HrCard i={7} className="hr-span-6" icon={UserCheck} tone="aqua" title="Thủ tục đang mở" count={s.open_procedures.length}
          action={<Link to="/asset/procedures" className="link-btn small">Xem tất cả</Link>}>
          {s.open_procedures.length ? (
            <div className="hr-people">{s.open_procedures.map((p) => (
              <Link key={p.id} to={`/asset/procedures/${p.id}`} className="hr-person">
                <Avatar name={p.name} color={p.color} uid={p.user_id} size={32} />
                <span className="grow"><b>{p.name}</b><small className="muted">{p.kind === 'onboard' ? 'Nhận việc' : 'Nghỉ việc'} · {fmtDate(p.effective_date)}</small></span>
                {p.kind === 'offboard' && p.holding > 0 ? <span className="hr-chip tone-red">Còn {p.holding} tài sản</span>
                  : <span className={cx('hr-chip', p.kind === 'onboard' ? 'tone-green' : 'tone-orange')}>{p.kind === 'onboard' ? 'Nhận việc' : 'Nghỉ việc'}</span>}
              </Link>
            ))}</div>
          ) : <div className="hr-empty"><CheckCircle2 size={16} /> Không có thủ tục đang mở</div>}
        </HrCard>
        <HrCard i={8} className="hr-span-6" icon={Users2} tone="pink" title="Người giữ nhiều tài sản" action={<Link to="/asset/people" className="link-btn small">Theo người sử dụng</Link>}>
          {s.holders.length ? (
            <div className="hr-people">{s.holders.slice(0, 6).map((h) => (
              <Link key={h.id} to={`/asset/people/${h.id}`} className="hr-person">
                <Avatar name={h.name} color={h.color} uid={h.id} size={32} />
                <span className="grow"><b>{h.name}</b><small className="muted">{h.department || ''}</small></span>
                <span className="hr-chip tone-blue">{h.c} tài sản · {moneyShort(h.value)}</span>
              </Link>
            ))}</div>
          ) : <div className="hr-empty"><Package size={16} /> Chưa giao tài sản cho ai</div>}
        </HrCard>
        <HrCard i={9} className="hr-span-12" icon={History} tone="gray" title="Giao dịch gần đây">
          {s.recent.length ? (
            <ul className="as-feed">{s.recent.map((t) => {
              const [label, tone] = TX[t.type] || [t.type, 'gray'];
              return (
                <li key={t.id} onClick={() => navigate(`/asset/item/${t.asset_id}`)}>
                  <Pill tone={tone}>{label}</Pill>
                  <span className="grow ellipsis"><span className="hr-code">{t.code}</span> <b>{t.asset_name}</b> <span className="muted">— {t.detail}</span></span>
                  <small className="muted nowrap">{t.actor_name} · {timeAgo(t.created_at)}</small>
                </li>
              );
            })}</ul>
          ) : <div className="hr-empty">Chưa có giao dịch</div>}
        </HrCard>
      </div>
      {modal === 'asset' && <AssetFormModal onClose={() => setModal(null)} onSaved={() => { setModal(null); navigate('/asset/list'); }} />}
      {(modal === 'issue' || modal === 'return') && <HandoverModal kind={modal} onClose={() => setModal(null)} onSaved={(h) => { setModal(null); navigate(`/asset/handovers/${h.id}`); }} />}
    </div>
  );
}

// ================================================================ danh sách tài sản
const IMPORT_COLUMNS = [
  ['code', 'Mã tài sản', 'Mã'], ['name', 'Tên tài sản', 'Tên'], ['type', 'Loại tài sản', 'Loại'], ['serial', 'Serial', 'Số serial'], ['location', 'Địa điểm'],
  ['supplier', 'Nhà cung cấp'], ['purchase_date', 'Ngày mua'], ['price', 'Nguyên giá', 'Giá'], ['depreciation_months', 'Khấu hao (tháng)'], ['holder', 'Người sử dụng', 'Tài khoản người sử dụng'],
];

function ImportAssetsModal({ onClose, onDone }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [result, setResult] = useState(null);
  const template = () => downloadCsv('mau-nhap-tai-san', IMPORT_COLUMNS.map((c) => c[1]), [
    ['', 'Laptop Dell Latitude 5440', 'Máy tính xách tay', 'DL5440-001', 'Văn phòng Hà Nội', 'CellphoneS', '10/01/2026', '22500000', '36', 'demo'],
    ['', 'Ghế xoay văn phòng', 'Bàn ghế, tủ', '', 'Văn phòng Hà Nội', '', '10/01/2026', '1500000', '', ''],
  ]);
  const pick = async (file) => {
    if (!file) return;
    setResult(null);
    try { setRows(rowsToObjects(await readSheetFile(file), IMPORT_COLUMNS).filter((r) => r.name)); } catch (e) { toast(e.message, 'error'); }
  };
  const run = async () => {
    try {
      const r = await api.post('/assets/import', { rows });
      setResult(r);
      if (r.created) { toast(`Đã nhập ${r.created} tài sản`); onDone(); }
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title="Nhập tài sản từ Excel" onClose={onClose} width={620}
      footer={<><button className="btn" onClick={onClose}>Đóng</button><button className="btn btn-primary" disabled={!rows?.length || !!result} onClick={run}>Nhập {rows?.length || 0} tài sản</button></>}>
      <p className="muted small">Tệp .xlsx hoặc .csv, mỗi dòng một tài sản. Để trống mã để tự sinh theo loại. Cột "Người sử dụng" ghi tên đăng nhập:
        tài sản được giao ngay cho người đó (ghi nhận như đã ký biên bản). <button className="link-btn" onClick={template}><Download size={13} /> Tải file mẫu</button></p>
      <input type="file" className="input" accept=".xlsx,.csv" onChange={(e) => pick(e.target.files[0])} />
      {rows && !result && <p className="small mt">Đọc được {rows.length} dòng{rows.length ? `: ${rows.slice(0, 4).map((r) => r.name).join(', ')}${rows.length > 4 ? '…' : ''}` : ''}</p>}
      {result && <div className="mt"><p className="text-green">Đã nhập {result.created} tài sản.</p>
        {result.errors.length > 0 && <ul className="small text-red">{result.errors.slice(0, 30).map((e) => <li key={e}>{e}</li>)}</ul>}</div>}
    </Modal>
  );
}

export function AssetList() {
  const navigate = useNavigate();
  const [meta] = useAssetMeta();
  const init = new URLSearchParams(window.location.search);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(init.get('status') || 'active');
  const [type, setType] = useState('');
  const [location, setLocation] = useState('');
  const [kind, setKind] = useState('');
  const [modal, setModal] = useState(null);
  const dq = useDebounced(q);
  const params = { q: dq, status, type, location, kind };
  const [items, reload, loading, error] = useFetch(() => api.get('/assets', params), [dq, status, type, location, kind]);
  const [allItems] = useFetch(() => api.get('/assets'), [items]);
  const [shown, more] = useShowMore(items, 80, JSON.stringify(params));
  if (error) return <div className="page hr"><div className="alert alert-error">{error.message}</div></div>;
  const n = (k) => (allItems || []).filter((a) => (k === 'active' ? !['disposed', 'lost'].includes(a.status) : a.status === k)).length;
  const exportCsv = () => downloadCsv('tai-san', ['Mã', 'Tên', 'Loại', 'Phân loại', 'Serial', 'Địa điểm', 'Trạng thái', 'Người sử dụng', 'Ngày giao', 'Ngày mua', 'Nguyên giá', 'Giá trị còn lại', 'Tình trạng'],
    items.map((a) => [a.code, a.name, a.type, a.kind === 'tool' ? 'Công cụ dụng cụ' : 'Tài sản', a.serial, a.location, STATUS_LABEL[a.status], a.holder_name, a.assigned_at?.slice(0, 10),
      a.purchase_date, a.price, a.book_value, CONDITION_LABEL[a.condition]]));
  return (
    <div className="page hr">
      <HrHero icon={Package} tone="brown" title="Tài sản & công cụ" subtitle="Danh mục tài sản, người đang giữ, tình trạng và giá trị còn lại">
        {items?.length > 0 && <button className="btn" onClick={exportCsv}><Download size={15} /> Xuất Excel</button>}
        <button className="btn" onClick={() => setModal('import')}><Upload size={15} /> Nhập Excel</button>
        <button className="btn solid" onClick={() => setModal('asset')}><Plus size={15} /> Thêm tài sản</button>
      </HrHero>
      <div className="hr-kpis">
        {[['active', 'Đang quản lý', Boxes, 'aqua'], ['in_use', 'Đang sử dụng', UserRound, 'blue'], ['available', 'Sẵn sàng', PackageCheck, 'green'],
          ['maintenance', 'Bảo trì', Wrench, 'amber'], ['broken', 'Hỏng', AlertTriangle, 'red'], ['disposed', 'Đã thanh lý', TrendingDown, 'gray']].map(([k, l, I, t], i) => (
          <Kpi key={k} i={i} icon={I} tone={t} label={l} value={n(k)} onClick={() => setStatus(k)} active={status === k} />
        ))}
      </div>
      <div className="hr-toolbar">
        <div className="ww-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo mã, tên, serial, người sử dụng" /></div>
        <FilterSelect value={type} onChange={setType} options={[{ value: '', label: 'Mọi loại' }, ...(meta?.settings.types || []).map((t) => ({ value: t.name, label: t.name }))]} />
        <FilterSelect value={location} onChange={setLocation} options={[{ value: '', label: 'Mọi địa điểm' }, ...(meta?.settings.locations || []).map((l) => ({ value: l, label: l }))]} />
        <FilterSelect value={kind} onChange={setKind} options={[{ value: '', label: 'Tài sản & công cụ' }, { value: 'asset', label: 'Tài sản cố định' }, { value: 'tool', label: 'Công cụ dụng cụ' }]} />
        <FilterSelect value={status} onChange={setStatus} options={[{ value: '', label: 'Mọi trạng thái' }, { value: 'active', label: 'Đang quản lý' }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))]} />
      </div>
      {loading && !items ? <Spinner /> : !items.length ? <div className="hr-table-card"><Empty title="Không có tài sản phù hợp" /></div> : (
        <div className="hr-table-card hr-rise">
          <div className="table-wrap"><table className="table nowrap-cells">
            <thead><tr><th>Mã</th><th>Tài sản</th><th>Người sử dụng</th><th>Địa điểm</th><th>Nguyên giá</th><th>Còn lại</th><th>Trạng thái</th></tr></thead>
            <tbody>{shown.map((a) => (
              <tr key={a.id} className="clickable hr-row" onClick={() => navigate(`/asset/item/${a.id}`)}>
                <td><span className="hr-code">{a.code}</span></td>
                <td><span className="hr-name"><span className={cx('as-mini-icon', `tone-${a.kind === 'tool' ? 'amber' : 'blue'}`)}>{a.kind === 'tool' ? <Wrench size={14} /> : <Package size={14} />}</span>
                  <span><b>{a.name}</b><small className="muted block">{a.type || '—'}{a.serial ? ` · ${a.serial}` : ''}</small></span></span></td>
                <td>{a.holder_id ? <span className="hr-name"><Avatar name={a.holder_name} color={a.holder_color} uid={a.holder_id} size={26} /><span>{a.holder_name}<small className="muted block">từ {fmtDate(a.assigned_at)}</small></span></span> : <span className="muted">Trong kho</span>}</td>
                <td>{a.location || '—'}</td><td>{money(a.price)}</td><td>{money(a.book_value)}</td><td><AssetStatus status={a.status} /></td>
              </tr>
            ))}</tbody>
          </table></div>
          {more}
          <div className="hr-table-foot"><span>{items.length} tài sản · nguyên giá {money(items.reduce((s, a) => s + (a.price || 0), 0))}</span><span>Bấm một dòng để xem chi tiết, bàn giao, thu hồi</span></div>
        </div>
      )}
      {modal === 'asset' && <AssetFormModal onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal === 'import' && <ImportAssetsModal onClose={() => setModal(null)} onDone={reload} />}
    </div>
  );
}

// ================================================================ chi tiết tài sản
function StatusModal({ asset, onClose, onSaved }) {
  const toast = useToast();
  const [status, setStatus] = useState(asset.status === 'maintenance' ? 'available' : 'maintenance');
  const [note, setNote] = useState('');
  const options = Object.entries(STATUS_LABEL).filter(([k]) => k !== 'in_use' && k !== asset.status && !(k === 'available' && asset.holder_id));
  const save = async () => {
    try { await api.post(`/assets/${asset.id}/status`, { status, note }); toast('Đã cập nhật trạng thái'); onSaved(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title="Đổi trạng thái tài sản" onClose={onClose} width={460}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" onClick={save}>Lưu</button></>}>
      <Field label="Trạng thái mới">
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>{options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </Field>
      {['lost', 'disposed'].includes(status) && asset.holder_id && <p className="small text-red">Tài sản sẽ được gỡ khỏi {asset.holder_name}.</p>}
      <Field label="Ghi chú"><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Gửi bảo hành tại hãng, dự kiến 7 ngày" /></Field>
    </Modal>
  );
}

function TransferModal({ asset, onClose, onSaved }) {
  const { users } = useApp();
  const toast = useToast();
  const [to, setTo] = useState(null);
  const [note, setNote] = useState('');
  const save = async () => {
    try { await api.post(`/assets/${asset.id}/transfer`, { to_user_id: to, note }); toast('Đã điều chuyển — người nhận sẽ xác nhận biên bản'); onSaved(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title="Điều chuyển tài sản" onClose={onClose} width={480}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" disabled={!to} onClick={save}>Điều chuyển</button></>}>
      <p className="muted small">{asset.holder_id ? `Thu hồi từ ${asset.holder_name} và bàn giao cho người mới (lập 2 biên bản).` : 'Bàn giao tài sản trong kho cho người nhận.'}</p>
      <Field label="Người nhận" required><UserPicker users={users} value={to} onChange={setTo} exclude={asset.holder_id ? [asset.holder_id] : []} /></Field>
      <Field label="Ghi chú"><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

export function AssetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [meta] = useAssetMeta();
  const [a, reload, loading, error] = useFetch(() => api.get(`/assets/${id}`), [id]);
  const [modal, setModal] = useState(null);
  if (error) return <div className="page hr"><div className="alert alert-error">{error.message}</div></div>;
  if (loading && !a) return <div className="page hr"><Spinner /></div>;
  const manager = meta?.is_manager;
  const done = () => { setModal(null); reload(); };
  const del = async () => {
    if (!window.confirm(`Xoá tài sản ${a.code}? Lịch sử giao dịch cũng bị xoá.`)) return;
    try { await api.del(`/assets/${a.id}`); toast('Đã xoá tài sản'); navigate('/asset/list'); } catch (e) { toast(e.message, 'error'); }
  };
  const TX = { create: [Plus, 'gray', 'Tạo tài sản'], assign: [PackagePlus, 'blue', 'Bàn giao'], return: [PackageMinus, 'violet', 'Thu hồi'],
    transfer: [ArrowLeftRight, 'aqua', 'Điều chuyển'], status: [Wrench, 'amber', 'Trạng thái'], update: [Pencil, 'gray', 'Cập nhật'] };
  const pct = a.price ? Math.round(((a.book_value ?? a.price) / a.price) * 100) : null;
  return (
    <div className="page hr">
      <section className="hr-profile hr-rise">
        <div className="hr-profile-cover as-cover"><button className="icon-btn hr-back" onClick={() => navigate(-1)} aria-label="Quay lại"><ArrowLeft size={18} /></button></div>
        <div className="hr-profile-main">
          <span className="hr-profile-avatar"><span className={cx('as-big-icon', `tone-${a.kind === 'tool' ? 'amber' : 'blue'}`)}>{a.kind === 'tool' ? <Wrench size={34} /> : <Package size={34} />}</span></span>
          <div className="hr-profile-info">
            <div className="row gap-sm wrap"><h1>{a.name}</h1><AssetStatus status={a.status} /></div>
            <div className="muted">{a.type || 'Chưa phân loại'} · {a.kind === 'tool' ? 'Công cụ dụng cụ' : 'Tài sản cố định'}</div>
            <div className="hr-facts">
              <span className="hr-fact tone-gray"><Tag size={13} /> {a.code}</span>
              {a.serial && <span className="hr-fact tone-violet">SN {a.serial}</span>}
              {a.location && <span className="hr-fact tone-aqua"><MapPin size={13} /> {a.location}</span>}
              <span className="hr-fact tone-green"><ShieldCheck size={13} /> {CONDITION_LABEL[a.condition]}</span>
              {a.warranty_until && <span className={cx('hr-fact', a.warranty_until < new Date().toISOString().slice(0, 10) ? 'tone-red' : 'tone-blue')}><CalendarClock size={13} /> BH đến {fmtDate(a.warranty_until)}</span>}
            </div>
          </div>
          {manager && (
            <div className="row gap-sm wrap">
              {a.holder_id ? <button className="btn btn-sm" onClick={() => setModal('return')}><PackageMinus size={14} /> Thu hồi</button>
                : a.status === 'available' && <button className="btn btn-sm btn-primary" onClick={() => setModal('issue')}><PackagePlus size={14} /> Bàn giao</button>}
              {!['disposed', 'lost'].includes(a.status) && <button className="btn btn-sm" onClick={() => setModal('transfer')}><ArrowLeftRight size={14} /> Điều chuyển</button>}
              <button className="btn btn-sm" onClick={() => setModal('status')}><Wrench size={14} /> Trạng thái</button>
              <button className="btn btn-sm" onClick={() => setModal('edit')}><Pencil size={14} /> Sửa</button>
              {!a.holder_id && <button className="icon-btn sm" onClick={del} aria-label="Xoá"><Trash2 size={15} /></button>}
            </div>
          )}
        </div>
      </section>
      <div className="hr-grid">
        <HrCard className="hr-span-5" icon={UserRound} tone="blue" title="Người đang giữ">
          {a.holder_id ? (
            <Link to={manager ? `/asset/people/${a.holder_id}` : '/asset'} className="hr-person">
              <Avatar name={a.holder_name} color={a.holder_color} uid={a.holder_id} size={40} />
              <span className="grow"><b>{a.holder_name}</b><small className="muted">{a.holder_title || ''}{a.holder_department ? ` · ${a.holder_department}` : ''}</small></span>
              <span className="hr-chip tone-blue">Từ {fmtDate(a.assigned_at)}</span>
            </Link>
          ) : <div className="hr-empty"><PackageCheck size={16} /> {a.status === 'available' ? 'Đang trong kho, sẵn sàng bàn giao' : STATUS_LABEL[a.status]}</div>}
        </HrCard>
        <HrCard className="hr-span-7" icon={Wallet} tone="violet" title="Giá trị & khấu hao" i={1}>
          <div className="as-value">
            <div><small className="muted">Nguyên giá</small><b>{money(a.price)}</b></div>
            <div><small className="muted">Giá trị còn lại</small><b>{money(a.book_value)}</b></div>
            <div><small className="muted">Ngày mua</small><b>{fmtDate(a.purchase_date) || '—'}</b></div>
            <div><small className="muted">Khấu hao</small><b>{a.depreciation_months ? `${a.depreciation_months} tháng` : 'Không'}</b></div>
          </div>
          {pct != null && <div className="hr-hbar-track as-depr" title={`Còn ${pct}% giá trị`}><span style={{ width: `${pct}%`, background: 'var(--hr-cat-7)' }} /></div>}
          {a.supplier && <small className="muted">Nhà cung cấp: {a.supplier}</small>}
          {a.note && <p className="small pre">{a.note}</p>}
        </HrCard>
        <HrCard className="hr-span-12" icon={History} tone="gray" title="Lịch sử giao dịch" count={a.history.length} i={2}>
          <ul className="hr-timeline">
            {a.history.map((t) => {
              const [Icon, tone, label] = TX[t.type] || [History, 'gray', t.type];
              return (
                <li key={t.id}>
                  <span className={cx('hr-tl-icon', `as-tl-${tone}`)}><Icon size={14} /></span>
                  <div className="grow">
                    <div className="row gap-sm wrap"><Pill tone={tone}>{label}</Pill><span>{t.detail}</span></div>
                    <small className="muted block">{fmtDateTime(t.created_at)} · {t.actor_name || 'Hệ thống'}
                      {t.handover_code && <> · <Link to={`/asset/handovers/${t.handover_id}`}>{t.handover_code}</Link></>}</small>
                  </div>
                </li>
              );
            })}
          </ul>
        </HrCard>
      </div>
      {modal === 'edit' && <AssetFormModal asset={a} onClose={() => setModal(null)} onSaved={done} />}
      {modal === 'status' && <StatusModal asset={a} onClose={() => setModal(null)} onSaved={done} />}
      {modal === 'transfer' && <TransferModal asset={a} onClose={() => setModal(null)} onSaved={done} />}
      {modal === 'issue' && <HandoverModal kind="issue" lockKind assetIds={[a.id]} onClose={() => setModal(null)} onSaved={done} />}
      {modal === 'return' && <HandoverModal kind="return" lockKind employeeId={a.holder_id} assetIds={[a.id]} onClose={() => setModal(null)} onSaved={done} />}
    </div>
  );
}

// ================================================================ theo người sử dụng
export function AssetPeople() {
  const { departments } = useApp();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [dep, setDep] = useState('');
  const [holding, setHolding] = useState('1');
  const dq = useDebounced(q);
  const [items, , loading, error] = useFetch(() => api.get('/asset/people', { q: dq, department_id: dep, holding }), [dq, dep, holding]);
  const [shown, more] = useShowMore(items, 80, `${dq}|${dep}|${holding}`);
  if (error) return <div className="page hr"><div className="alert alert-error">{error.message}</div></div>;
  const WS = { working: ['Chính thức', 'blue'], probation: ['Thử việc', 'amber'], leave: ['Tạm nghỉ', 'violet'], resigned: ['Đã nghỉ việc', 'red'] };
  return (
    <div className="page hr">
      <HrHero icon={Users2} tone="brown" title="Theo người sử dụng" subtitle="Ai đang giữ tài sản gì — để bàn giao, thu hồi khi nhận việc, điều chuyển, nghỉ việc" />
      <div className="hr-seg">
        <button className={cx('tone-blue', holding === '1' && 'active')} onClick={() => setHolding('1')}><i />Đang giữ tài sản</button>
        <button className={cx('tone-gray', holding === '' && 'active')} onClick={() => setHolding('')}><i />Tất cả nhân sự</button>
      </div>
      <div className="hr-toolbar">
        <div className="ww-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên nhân sự" /></div>
        <FilterSelect value={dep} onChange={setDep} options={[{ value: '', label: 'Tất cả phòng ban' }, ...departments.map((d) => ({ value: d.id, label: d.name }))]} />
      </div>
      {loading && !items ? <Spinner /> : !items.length ? <div className="hr-table-card"><Empty title="Không có nhân sự phù hợp" /></div> : (
        <div className="hr-table-card hr-rise">
          <div className="table-wrap"><table className="table nowrap-cells">
            <thead><tr><th>Nhân sự</th><th>Phòng ban</th><th>Trạng thái</th><th>Số tài sản</th><th>Nguyên giá</th><th>Biên bản chờ</th></tr></thead>
            <tbody>{shown.map((u) => (
              <tr key={u.id} className="clickable hr-row" onClick={() => navigate(`/asset/people/${u.id}`)}>
                <td><span className="hr-name"><Avatar name={u.name} color={u.color} uid={u.id} size={30} /><span><b>{u.name}</b><small className="muted block">{u.title}</small></span></span></td>
                <td>{u.department_name || '—'}</td>
                <td><Pill tone={(WS[u.work_status] || WS.working)[1]}>{(WS[u.work_status] || WS.working)[0]}</Pill>{!u.active && <span className="hr-after"><Pill tone="gray">Đã khoá</Pill></span>}</td>
                <td><b>{u.asset_count}</b></td><td>{money(u.asset_value)}</td>
                <td>{u.pending_count ? <Pill tone="amber">{u.pending_count} chờ xác nhận</Pill> : <span className="muted">—</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          {more}
        </div>
      )}
    </div>
  );
}

export function AssetPerson() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [p] = useFetch(() => api.get(`/asset/people/${id}`), [id]);
  return (
    <div className="page hr">
      {p && (
        <section className="hr-profile hr-rise">
          <div className="hr-profile-cover as-cover"><button className="icon-btn hr-back" onClick={() => navigate(-1)} aria-label="Quay lại"><ArrowLeft size={18} /></button></div>
          <div className="hr-profile-main">
            <span className="hr-profile-avatar"><Avatar name={p.user.name} color={p.user.color} uid={p.user.id} size={84} /></span>
            <div className="hr-profile-info">
              <h1>{p.user.name}</h1>
              <div className="muted">{p.user.title || ''}{p.user.department_name ? ` · ${p.user.department_name}` : ''}</div>
              <div className="hr-facts">
                <span className="hr-fact tone-blue"><Package size={13} /> {p.assets.length} tài sản đang giữ</span>
                <span className="hr-fact tone-violet"><Wallet size={13} /> {money(p.assets.reduce((s, a) => s + (a.price || 0), 0))}</span>
              </div>
            </div>
            <div className="row gap-sm wrap">
              <Link className="btn btn-sm" to={`/hrm/employees/${p.user.id}`}>Hồ sơ nhân sự</Link>
            </div>
          </div>
        </section>
      )}
      <PersonAssets userId={Number(id)} />
    </div>
  );
}
