/** LDL Asset — biên bản bàn giao / thu hồi (danh sách, chi tiết, bản in) · thủ tục nhận việc / nghỉ việc · cài đặt. */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  FileSignature, PackagePlus, PackageMinus, Search, Printer, ArrowLeft, CheckCircle2, XCircle, ClipboardCheck, LogIn, LogOut, Plus,
  UserCheck, Package, AlertTriangle, Settings2, ShieldCheck, Tag, MapPin, Truck, ListChecks, Save, Trash2, Clock3, Lock, Hourglass,
} from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Avatar, Spinner, Empty, FilterSelect, Modal, Field, UserPicker, Progress } from '../components/ui.jsx';
import { useDebounced } from '../components/shell.jsx';
import { HrHero, Kpi, HrCard, Pill } from '../hrm/hrUi.jsx';
import { fmtDate, fmtDateTime, cx } from '../utils.js';
import { HandoverTable } from './AssetPages.jsx';
import { AssetStatus, HandoverStatus, KindPill, CONDITION_LABEL, REASON_LABEL, money, useAssetMeta, HandoverModal } from './assetShared.jsx';

// ================================================================ biên bản
export function HandoverList() {
  const navigate = useNavigate();
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const dq = useDebounced(q);
  const [items, , loading, error] = useFetch(() => api.get('/asset/handovers', { kind, status, q: dq }), [kind, status, dq]);
  const [all] = useFetch(() => api.get('/asset/handovers'), [items]);
  if (error) return <div className="page hr"><div className="alert alert-error">{error.message}</div></div>;
  const c = (fn) => (all || []).filter(fn).length;
  return (
    <div className="page hr">
      <HrHero icon={FileSignature} tone="brown" title="Bàn giao & thu hồi" subtitle="Biên bản cấp phát, thu hồi tài sản; nhân viên xác nhận trên hệ thống, in ký khi cần">
        <button className="btn" onClick={() => setModal('return')}><PackageMinus size={15} /> Lập biên bản thu hồi</button>
        <button className="btn solid" onClick={() => setModal('issue')}><PackagePlus size={15} /> Lập biên bản bàn giao</button>
      </HrHero>
      <div className="hr-kpis">
        <Kpi i={0} icon={FileSignature} tone="gray" label="Tất cả biên bản" value={c(() => true)} onClick={() => { setKind(''); setStatus(''); }} active={!kind && !status} />
        <Kpi i={1} icon={PackagePlus} tone="blue" label="Bàn giao" value={c((h) => h.kind === 'issue')} onClick={() => setKind(kind === 'issue' ? '' : 'issue')} active={kind === 'issue'} />
        <Kpi i={2} icon={PackageMinus} tone="violet" label="Thu hồi" value={c((h) => h.kind === 'return')} onClick={() => setKind(kind === 'return' ? '' : 'return')} active={kind === 'return'} />
        <Kpi i={3} icon={Hourglass} tone="amber" label="Chờ xác nhận" value={c((h) => h.status === 'pending')} onClick={() => setStatus(status === 'pending' ? '' : 'pending')} active={status === 'pending'} />
      </div>
      <div className="hr-toolbar">
        <div className="ww-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Số biên bản, tên nhân viên" /></div>
        <FilterSelect value={status} onChange={setStatus} options={[{ value: '', label: 'Mọi trạng thái' }, { value: 'pending', label: 'Chờ xác nhận' }, { value: 'confirmed', label: 'Đã xác nhận' }, { value: 'cancelled', label: 'Đã huỷ' }]} />
      </div>
      {loading && !items ? <Spinner /> : !items.length ? <div className="hr-table-card"><Empty title="Chưa có biên bản" /></div>
        : <div className="hr-table-card hr-rise"><HandoverTable items={items} /></div>}
      {modal && <HandoverModal kind={modal} onClose={() => setModal(null)} onSaved={(h) => { setModal(null); navigate(`/asset/handovers/${h.id}`); }} />}
    </div>
  );
}

/** Chi tiết biên bản dạng phiếu in A4: bên giao / bên nhận, danh sách tài sản, tình trạng, ô ký, xác nhận điện tử. */
export function HandoverDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { company, user } = useApp();
  const [meta] = useAssetMeta();
  const [h, reload, , error] = useFetch(() => api.get(`/asset/handovers/${id}`), [id]);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (h) document.title = `${h.code} - Biên bản ${h.kind === 'issue' ? 'bàn giao' : 'thu hồi'} tài sản`;
    return () => { document.title = 'Công ty LDL Việt Nam'; };
  }, [h]);
  if (error) return <div className="print-shell"><div className="alert alert-error">{error.message}</div></div>;
  if (!h) return <div className="print-shell"><Spinner /></div>;
  const issue = h.kind === 'issue';
  const act = async (path, msg) => {
    try { await api.post(`/asset/handovers/${h.id}/${path}`, { note }); toast(msg); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const company_ = { role: issue ? 'Bên giao (công ty)' : 'Bên nhận lại (công ty)', name: h.created_by_name };
  const staff = { role: issue ? 'Bên nhận (nhân viên)' : 'Bên trả (nhân viên)', name: h.employee_name };
  return (
    <div className="print-shell">
      <div className="print-toolbar no-print">
        <button className="btn" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/asset'))}><ArrowLeft size={15} /> Quay lại</button>
        <div className="grow" />
        {h.can_confirm && h.employee_id === user.id && (
          <>
            <input className="input as-confirm-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú khi xác nhận (tuỳ chọn)" />
            <button className="btn btn-success" onClick={() => act('confirm', 'Đã xác nhận biên bản')}><CheckCircle2 size={15} /> Xác nhận {issue ? 'đã nhận đủ' : 'đã bàn giao lại'}</button>
          </>
        )}
        {h.can_confirm && h.employee_id !== user.id && meta?.is_manager && (
          <button className="btn" onClick={() => act('confirm', 'Đã ghi nhận xác nhận thay')}><ClipboardCheck size={15} /> Xác nhận thay (đã ký giấy)</button>
        )}
        {h.status === 'pending' && meta?.is_manager && (
          <button className="btn btn-danger-ghost" onClick={() => window.confirm('Huỷ biên bản và hoàn tác việc chuyển tài sản?') && act('cancel', 'Đã huỷ biên bản')}><XCircle size={15} /> Huỷ</button>
        )}
        <button className="btn btn-primary" onClick={() => window.print()}><Printer size={15} /> In / Lưu PDF</button>
      </div>
      <article className="print-sheet">
        {h.status !== 'confirmed' && <div className="print-watermark">{h.status === 'pending' ? 'CHỜ XÁC NHẬN' : 'ĐÃ HUỶ'}</div>}
        <header className="print-head">
          <div className="print-brand"><img src="/logo-192.png" alt="" /><div><b>{company}</b><small>LDL Asset · Quản lý tài sản</small></div></div>
          <div className="print-meta">
            <div>Số: <b>{h.code}</b></div>
            <div>Ngày lập: <b>{fmtDate(h.created_at)}</b></div>
            <div className="no-print as-print-status"><HandoverStatus status={h.status} /></div>
          </div>
        </header>
        <h1 className="print-title">BIÊN BẢN {issue ? 'BÀN GIAO' : 'THU HỒI'} TÀI SẢN</h1>
        <p className="print-sub">Lý do: {REASON_LABEL[h.reason]}</p>
        <section>
          <h2>I. Các bên</h2>
          <table className="print-kv"><tbody>
            <tr><th>{issue ? 'Bên giao' : 'Bên nhận lại'}</th><td>{company}<small className="block">Đại diện: {h.created_by_name || '—'}</small></td>
              <th>{issue ? 'Bên nhận' : 'Bên trả'}</th><td>{h.employee_name}<small className="block">{h.employee_title || ''}{h.employee_department ? ` · ${h.employee_department}` : ''}</small></td></tr>
          </tbody></table>
        </section>
        <section>
          <h2>II. Danh sách tài sản</h2>
          <table className="print-grid">
            <thead><tr><th>STT</th><th>Mã</th><th>Tên tài sản</th><th>Serial</th><th>Tình trạng</th><th>Nguyên giá</th><th>Ghi chú</th></tr></thead>
            <tbody>{h.items.map((a, i) => (
              <tr key={a.id}><td className="c">{i + 1}</td><td className="nowrap">{a.code}</td>
                <td><Link to={`/asset/item/${a.id}`} className="as-print-link">{a.name}</Link><small className="block">{a.type || ''}</small></td>
                <td>{a.serial || ''}</td><td>{CONDITION_LABEL[a.handover_condition] || ''}</td><td className="nowrap">{money(a.price)}</td><td>{a.item_note || ''}</td></tr>
            ))}</tbody>
          </table>
          <p className="small">Tổng cộng: <b>{h.items.length}</b> tài sản · tổng nguyên giá <b>{money(h.total_value)}</b></p>
          {h.note && <p className="small pre">Ghi chú: {h.note}</p>}
        </section>
        <section>
          <h2>III. Cam kết</h2>
          <p className="small">{issue
            ? 'Bên nhận đã kiểm tra đủ số lượng, đúng tình trạng như trên; có trách nhiệm bảo quản, sử dụng đúng mục đích công việc và hoàn trả khi điều chuyển, nghỉ việc hoặc khi công ty yêu cầu. Làm mất, hư hỏng do lỗi chủ quan phải bồi thường theo quy định.'
            : 'Hai bên đã kiểm tra số lượng và tình trạng tài sản như trên. Kể từ thời điểm xác nhận, bên trả không còn trách nhiệm quản lý các tài sản này.'}</p>
        </section>
        <section className="print-signs" style={{ '--cols': 2 }}>
          {[company_, staff].map((s, i) => {
            const ok = i === 0 || h.status === 'confirmed';
            return (
              <div key={s.role} className="print-sign">
                <b>{s.role}</b>
                <div className={`print-sign-box ${ok && h.status !== 'cancelled' ? 'ok' : ''}`}>
                  {ok && h.status !== 'cancelled' ? '✓' : ''}
                  <small>{i === 0 ? `Lập ${fmtDateTime(h.created_at)}` : h.confirmed_at ? `${h.confirmed_by_name && h.confirmed_by_name !== h.employee_name ? `Xác nhận thay bởi ${h.confirmed_by_name}` : 'Đã xác nhận điện tử'} ${fmtDateTime(h.confirmed_at)}` : 'Chưa xác nhận'}</small>
                </div>
                <span>{s.name}</span>
              </div>
            );
          })}
        </section>
        {h.confirm_note && <p className="print-note">Ghi chú xác nhận: {h.confirm_note}</p>}
        <footer className="print-foot">
          <span>{h.status === 'confirmed' ? 'Biên bản đã được xác nhận trên hệ thống LDL — có giá trị như bản ký tay theo quy định nội bộ.' : 'Biên bản chưa được xác nhận.'}</span>
          <span>In lúc {fmtDateTime(new Date().toISOString())} bởi {user.name}</span>
        </footer>
      </article>
    </div>
  );
}

// ================================================================ thủ tục nhận việc / nghỉ việc
function ProcedureModal({ kind: kind0, onClose, onSaved }) {
  const { users } = useApp();
  const toast = useToast();
  const [kind, setKind] = useState(kind0 || 'onboard');
  const [userId, setUserId] = useState(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [cat] = useFetch(() => api.get('/hrm/catalog').catch(() => null), []);
  const save = async () => {
    try {
      const p = await api.post('/asset/procedures', { kind, user_id: userId, effective_date: date, resign_reason: reason, note });
      toast(`Đã mở thủ tục ${kind === 'onboard' ? 'nhận việc' : 'nghỉ việc'}`);
      onSaved(p);
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title="Mở thủ tục nhân sự" onClose={onClose} width={560}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" disabled={!userId || !date} onClick={save}>Mở thủ tục</button></>}>
      <div className="hr-seg">
        <button className={cx('tone-green', kind === 'onboard' && 'active')} onClick={() => setKind('onboard')}><LogIn size={15} /> Nhận việc</button>
        <button className={cx('tone-orange', kind === 'offboard' && 'active')} onClick={() => setKind('offboard')}><LogOut size={15} /> Nghỉ việc</button>
      </div>
      <div className="form-grid">
        <div className="span-2"><Field label="Nhân sự" required><UserPicker users={users} value={userId} onChange={setUserId} /></Field></div>
        <Field label={kind === 'onboard' ? 'Ngày nhận việc' : 'Ngày nghỉ việc'} required><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {kind === 'offboard' && (
          <Field label="Lý do nghỉ việc">
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">— Chọn —</option>{(cat?.resign_reasons || []).map((x) => <option key={x}>{x}</option>)}
            </select>
          </Field>
        )}
        <div className="span-2"><Field label="Ghi chú"><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
      </div>
      <p className="muted small">{kind === 'onboard' ? 'Checklist nhận việc theo Cài đặt; bước "Bàn giao tài sản" tự hoàn thành khi nhân viên xác nhận biên bản bàn giao.'
        : 'Checklist nghỉ việc theo Cài đặt; chỉ hoàn tất được khi đã thu hồi hết tài sản nhân viên đang giữ. Khi hoàn tất, hồ sơ nhân sự chuyển sang "Đã nghỉ việc".'}</p>
    </Modal>
  );
}

export function ProcedureList() {
  const navigate = useNavigate();
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const dq = useDebounced(q);
  const [items, reload, loading, error] = useFetch(() => api.get('/asset/procedures', { kind, status, q: dq }), [kind, status, dq]);
  const [all] = useFetch(() => api.get('/asset/procedures'), [items]);
  if (error) return <div className="page hr"><div className="alert alert-error">{error.message}</div></div>;
  const c = (fn) => (all || []).filter(fn).length;
  return (
    <div className="page hr">
      <HrHero icon={UserCheck} tone="teal" title="Thủ tục nhận việc & nghỉ việc" subtitle="Checklist từng bước, gắn với biên bản bàn giao / thu hồi tài sản">
        <button className="btn" onClick={() => setModal('offboard')}><LogOut size={15} /> Nghỉ việc</button>
        <button className="btn solid" onClick={() => setModal('onboard')}><LogIn size={15} /> Nhận việc</button>
      </HrHero>
      <div className="hr-kpis">
        <Kpi i={0} icon={Clock3} tone="amber" label="Đang thực hiện" value={c((p) => p.status === 'open')} onClick={() => { setStatus('open'); setKind(''); }} active={status === 'open' && !kind} />
        <Kpi i={1} icon={LogIn} tone="green" label="Nhận việc đang mở" value={c((p) => p.status === 'open' && p.kind === 'onboard')} onClick={() => { setStatus('open'); setKind('onboard'); }} active={status === 'open' && kind === 'onboard'} />
        <Kpi i={2} icon={LogOut} tone="orange" label="Nghỉ việc đang mở" value={c((p) => p.status === 'open' && p.kind === 'offboard')} onClick={() => { setStatus('open'); setKind('offboard'); }} active={status === 'open' && kind === 'offboard'} />
        <Kpi i={3} icon={AlertTriangle} tone="red" label="Nghỉ việc còn giữ tài sản" value={c((p) => p.status === 'open' && p.kind === 'offboard' && p.holding > 0)} />
        <Kpi i={4} icon={CheckCircle2} tone="blue" label="Đã hoàn tất" value={c((p) => p.status === 'done')} onClick={() => { setStatus('done'); setKind(''); }} active={status === 'done'} />
      </div>
      <div className="hr-toolbar">
        <div className="ww-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên nhân sự" /></div>
        <FilterSelect value={kind} onChange={setKind} options={[{ value: '', label: 'Nhận việc & nghỉ việc' }, { value: 'onboard', label: 'Nhận việc' }, { value: 'offboard', label: 'Nghỉ việc' }]} />
        <FilterSelect value={status} onChange={setStatus} options={[{ value: '', label: 'Mọi trạng thái' }, { value: 'open', label: 'Đang thực hiện' }, { value: 'done', label: 'Hoàn tất' }, { value: 'cancelled', label: 'Đã huỷ' }]} />
      </div>
      {loading && !items ? <Spinner /> : !items.length ? <div className="hr-table-card"><Empty title="Không có thủ tục" /></div> : (
        <div className="as-proc-grid">
          {items.map((p, i) => {
            const pct = p.step_count ? Math.round((p.step_done / p.step_count) * 100) : 0;
            return (
              <Link key={p.id} to={`/asset/procedures/${p.id}`} className={cx('as-proc', 'hr-rise', p.kind === 'onboard' ? 'tone-green' : 'tone-orange')} style={{ '--i': i }}>
                <div className="row gap-sm">
                  <Avatar name={p.name} color={p.color} uid={p.user_id} size={38} />
                  <span className="grow"><b>{p.name}</b><small className="muted block">{p.title || ''}{p.department_name ? ` · ${p.department_name}` : ''}</small></span>
                  <Pill tone={p.kind === 'onboard' ? 'green' : 'orange'}>{p.kind === 'onboard' ? 'Nhận việc' : 'Nghỉ việc'}</Pill>
                </div>
                <div className="row between small"><span className="muted">{p.kind === 'onboard' ? 'Ngày nhận việc' : 'Ngày nghỉ việc'}: <b>{fmtDate(p.effective_date)}</b></span>
                  <span><b>{p.step_done}/{p.step_count}</b> bước</span></div>
                <div className="hr-hbar-track"><span style={{ width: `${pct}%`, background: p.status === 'done' ? 'var(--hr-green)' : 'var(--tone)' }} /></div>
                <div className="row gap-sm wrap">
                  {p.status === 'done' ? <Pill tone="blue">Hoàn tất {fmtDate(p.completed_at)}</Pill> : p.status === 'cancelled' ? <Pill tone="gray">Đã huỷ</Pill> : <Pill tone="amber">Đang thực hiện</Pill>}
                  {p.kind === 'offboard' && p.status === 'open' && (p.holding ? <Pill tone="red">Còn giữ {p.holding} tài sản</Pill> : <Pill tone="green">Đã thu hồi hết tài sản</Pill>)}
                </div>
              </Link>
            );
          })}
        </div>
      )}
      {modal && <ProcedureModal kind={modal} onClose={() => setModal(null)} onSaved={(p) => { setModal(null); reload(); navigate(`/asset/procedures/${p.id}`); }} />}
    </div>
  );
}

export function ProcedureDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [meta] = useAssetMeta();
  const [p, reload, loading, error] = useFetch(() => api.get(`/asset/procedures/${id}`), [id]);
  const [modal, setModal] = useState(null);
  const [lock, setLock] = useState(false);
  if (error) return <div className="page hr"><div className="alert alert-error">{error.message}</div></div>;
  if (loading && !p) return <div className="page hr"><Spinner /></div>;
  const on = p.kind === 'onboard';
  const open = p.status === 'open';
  const toggle = async (s) => {
    try { await api.put(`/asset/procedures/${p.id}/steps`, { key: s.key, done: !s.done }); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const complete = async () => {
    try { await api.post(`/asset/procedures/${p.id}/complete`, { lock_account: lock }); toast('Đã hoàn tất thủ tục'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const cancel = async () => {
    if (!window.confirm('Huỷ thủ tục này?')) return;
    try { await api.post(`/asset/procedures/${p.id}/cancel`, {}); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="page hr">
      <section className="hr-profile hr-rise">
        <div className={cx('hr-profile-cover', on ? 'as-cover-on' : 'as-cover-off')}><button className="icon-btn hr-back" onClick={() => navigate(-1)} aria-label="Quay lại"><ArrowLeft size={18} /></button></div>
        <div className="hr-profile-main">
          <span className="hr-profile-avatar"><Avatar name={p.name} color={p.color} uid={p.user_id} size={84} /></span>
          <div className="hr-profile-info">
            <div className="row gap-sm wrap"><h1>{on ? 'Nhận việc' : 'Nghỉ việc'}: {p.name}</h1>
              {p.status === 'done' ? <Pill tone="blue">Hoàn tất</Pill> : p.status === 'cancelled' ? <Pill tone="gray">Đã huỷ</Pill> : <Pill tone="amber">Đang thực hiện</Pill>}</div>
            <div className="muted">{p.title || ''}{p.department_name ? ` · ${p.department_name}` : ''}</div>
            <div className="hr-facts">
              <span className={cx('hr-fact', on ? 'tone-green' : 'tone-orange')}>{on ? <LogIn size={13} /> : <LogOut size={13} />} {on ? 'Ngày nhận việc' : 'Ngày nghỉ việc'} {fmtDate(p.effective_date)}</span>
              {p.resign_reason && <span className="hr-fact tone-gray">{p.resign_reason}</span>}
              <span className="hr-fact tone-blue"><Package size={13} /> Đang giữ {p.assets.length} tài sản</span>
              <span className="hr-fact tone-violet">Mở bởi {p.created_by_name || '—'} · {fmtDate(p.created_at)}</span>
            </div>
          </div>
          <div className="row gap-sm wrap"><Link className="btn btn-sm" to={`/hrm/employees/${p.user_id}`}>Hồ sơ nhân sự</Link></div>
        </div>
      </section>
      <div className="hr-grid">
        <HrCard className="hr-span-7" icon={ListChecks} tone={on ? 'green' : 'orange'} title="Các bước thực hiện" action={<b className="small">{p.progress}%</b>}>
          <Progress value={p.progress} color={on ? '#0f9d58' : '#e0602a'} />
          <ul className="as-steps">
            {p.steps.map((s, i) => (
              <li key={s.key} className={cx(s.done && 'done', s.key === 'assets' && 'asset-step')}>
                <button type="button" className="as-step-check" disabled={!open || !meta?.is_manager || (s.auto && !s.done && !on && p.assets.length > 0)} onClick={() => toggle(s)}
                  aria-label={s.done ? 'Bỏ đánh dấu' : 'Đánh dấu hoàn thành'}>{s.done ? <CheckCircle2 size={20} /> : <span className="as-step-no">{i + 1}</span>}</button>
                <div className="grow">
                  <b>{s.label}</b>
                  {s.key === 'assets' && <small className="muted block">{on ? 'Tự hoàn thành khi nhân viên xác nhận biên bản bàn giao.' : p.assets.length ? `Còn ${p.assets.length} tài sản chưa thu hồi.` : 'Đã thu hồi hết tài sản.'}</small>}
                  {s.done && s.done_by && <small className="muted block">{s.done_by} · {fmtDateTime(s.done_at)}</small>}
                </div>
                {s.key === 'assets' && open && meta?.is_manager && (
                  on ? <button className="btn btn-sm btn-primary" onClick={() => setModal('issue')}><PackagePlus size={14} /> Bàn giao tài sản</button>
                    : p.assets.length > 0 && <button className="btn btn-sm btn-primary" onClick={() => setModal('return')}><PackageMinus size={14} /> Thu hồi {p.assets.length} tài sản</button>
                )}
              </li>
            ))}
          </ul>
          {open && meta?.is_manager && (
            <div className="as-complete">
              {!on && meta?.is_admin && <label className="check small"><input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> <Lock size={13} /> Khoá tài khoản LDL khi hoàn tất</label>}
              <div className="grow" />
              <button className="btn btn-danger-ghost btn-sm" onClick={cancel}>Huỷ thủ tục</button>
              <button className="btn btn-success" disabled={!p.can_complete} onClick={complete} title={p.can_complete ? '' : 'Hoàn thành tất cả các bước (và thu hồi hết tài sản) trước'}>
                <CheckCircle2 size={15} /> Hoàn tất thủ tục</button>
            </div>
          )}
          {p.note && <p className="small muted pre">Ghi chú: {p.note}</p>}
        </HrCard>
        <div className="hr-span-5">
          <HrCard icon={Package} tone="blue" title="Tài sản đang giữ" count={p.assets.length}>
            {p.assets.length ? (
              <div className="hr-people">{p.assets.map((a) => (
                <Link key={a.id} to={`/asset/item/${a.id}`} className="hr-person">
                  <span className="hr-code">{a.code}</span>
                  <span className="grow"><b>{a.name}</b><small className="muted">{a.type || ''} · {CONDITION_LABEL[a.condition]}</small></span>
                  <AssetStatus status={a.status} />
                </Link>
              ))}</div>
            ) : <div className="hr-empty"><CheckCircle2 size={16} /> Không giữ tài sản nào</div>}
          </HrCard>
          <HrCard icon={FileSignature} tone="violet" title="Biên bản của thủ tục" count={p.handovers.length} i={1}>
            {p.handovers.length ? (
              <div className="hr-people">{p.handovers.map((h) => (
                <Link key={h.id} to={`/asset/handovers/${h.id}`} className="hr-person">
                  <KindPill kind={h.kind} />
                  <span className="grow"><b>{h.code}</b><small className="muted">{h.item_count} tài sản · {fmtDate(h.created_at)}</small></span>
                  <HandoverStatus status={h.status} />
                </Link>
              ))}</div>
            ) : <div className="hr-empty"><FileSignature size={16} /> Chưa có biên bản</div>}
          </HrCard>
        </div>
      </div>
      {(modal === 'issue' || modal === 'return') && (
        <HandoverModal kind={modal} lockKind employeeId={p.user_id} reason={on ? 'onboard' : 'offboard'} procedureId={p.id}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />
      )}
    </div>
  );
}

// ================================================================ cài đặt
export function AssetSettings() {
  const { users } = useApp();
  const toast = useToast();
  const [meta, reloadMeta] = useAssetMeta();
  const [s, setS] = useState(null);
  useEffect(() => { if (meta) setS(meta.settings); }, [meta]);
  if (!meta || !s) return <div className="page hr"><Spinner /></div>;
  if (!meta.is_manager) return <div className="page hr"><div className="alert alert-error">Chỉ quản lý tài sản mới vào được cài đặt.</div></div>;
  const save = async (patch) => {
    try { setS(await api.put('/asset/settings', patch || s)); toast('Đã lưu cài đặt'); reloadMeta(); } catch (e) { toast(e.message, 'error'); }
  };
  const setType = (i, patch) => setS({ ...s, types: s.types.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const lines = (k) => (
    <textarea className="input" rows={Math.min(8, Math.max(3, s[k].length + 1))} value={s[k].join('\n')} onChange={(e) => setS({ ...s, [k]: e.target.value.split('\n') })} />
  );
  const { managers, ...noManagers } = s;
  return (
    <div className="page hr">
      <HrHero icon={Settings2} tone="slate" title="Cài đặt LDL Asset" subtitle="Loại tài sản, địa điểm, nhà cung cấp, phân quyền và checklist thủ tục nhân sự" />
      {meta.is_admin && (
        <HrCard icon={ShieldCheck} tone="red" title="Phân quyền quản lý tài sản">
          <Field label="Người quản lý tài sản" hint="Được thêm / sửa tài sản, lập biên bản bàn giao / thu hồi, mở thủ tục nhận việc / nghỉ việc (quản trị viên và quản lý nhân sự luôn có quyền)">
            <UserPicker users={users} multiple value={s.managers} onChange={(v) => setS({ ...s, managers: v })} placeholder="Chọn người" />
          </Field>
          <button className="btn btn-primary mt" onClick={() => save({ managers: s.managers })}><Save size={15} /> Lưu phân quyền</button>
        </HrCard>
      )}
      <HrCard icon={Tag} tone="blue" title="Loại tài sản" count={s.types.length} i={1} action={<button className="btn btn-primary btn-sm" onClick={() => save(noManagers)}><Save size={14} /> Lưu</button>}>
        <p className="muted small">Tiền tố dùng để tự sinh mã (VD: LAP → LAP-0001). Khấu hao mặc định (tháng) điền sẵn khi tạo tài sản thuộc loại này.</p>
        <div className="as-types">
          <div className="as-type-row head"><span>Tên loại</span><span>Tiền tố mã</span><span>Phân loại</span><span>Khấu hao (tháng)</span><span /></div>
          {s.types.map((t, i) => (
            <div key={i} className="as-type-row">
              <input className="input" value={t.name} onChange={(e) => setType(i, { name: e.target.value })} aria-label="Tên loại" />
              <input className="input" value={t.prefix} onChange={(e) => setType(i, { prefix: e.target.value.toUpperCase() })} aria-label="Tiền tố" />
              <select className="input" value={t.kind} onChange={(e) => setType(i, { kind: e.target.value })} aria-label="Phân loại"><option value="asset">Tài sản</option><option value="tool">Công cụ dụng cụ</option></select>
              <input className="input" type="number" min="1" value={t.depreciation_months || ''} onChange={(e) => setType(i, { depreciation_months: e.target.value })} aria-label="Khấu hao" />
              <button className="icon-btn sm" onClick={() => setS({ ...s, types: s.types.filter((_, j) => j !== i) })} aria-label="Xoá loại"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <button className="btn btn-sm mt" onClick={() => setS({ ...s, types: [...s.types, { name: '', prefix: '', kind: 'asset', depreciation_months: '' }] })}><Plus size={14} /> Thêm loại</button>
      </HrCard>
      <div className="hr-grid">
        <HrCard className="hr-span-6" icon={MapPin} tone="aqua" title="Địa điểm" i={2} action={<button className="btn btn-primary btn-sm" onClick={() => save(noManagers)}><Save size={14} /> Lưu</button>}>
          <p className="muted small">Mỗi dòng một địa điểm (văn phòng, kho, chi nhánh).</p>{lines('locations')}
        </HrCard>
        <HrCard className="hr-span-6" icon={Truck} tone="amber" title="Nhà cung cấp" i={3} action={<button className="btn btn-primary btn-sm" onClick={() => save(noManagers)}><Save size={14} /> Lưu</button>}>
          <p className="muted small">Mỗi dòng một nhà cung cấp.</p>{lines('suppliers')}
        </HrCard>
        <HrCard className="hr-span-6" icon={LogIn} tone="green" title="Checklist nhận việc" i={4} action={<button className="btn btn-primary btn-sm" onClick={() => save(noManagers)}><Save size={14} /> Lưu</button>}>
          <p className="muted small">Mỗi dòng một bước. Dòng bắt đầu bằng <code>[assets]</code> là bước bàn giao tài sản (tự hoàn thành khi nhân viên xác nhận biên bản).</p>{lines('onboard_steps')}
        </HrCard>
        <HrCard className="hr-span-6" icon={LogOut} tone="orange" title="Checklist nghỉ việc" i={5} action={<button className="btn btn-primary btn-sm" onClick={() => save(noManagers)}><Save size={14} /> Lưu</button>}>
          <p className="muted small">Dòng bắt đầu bằng <code>[assets]</code> là bước thu hồi tài sản — chỉ hoàn thành khi nhân viên không còn giữ tài sản nào.</p>{lines('offboard_steps')}
        </HrCard>
      </div>
    </div>
  );
}
