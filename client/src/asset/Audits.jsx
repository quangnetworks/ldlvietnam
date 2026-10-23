/** LDL Asset — tem QR và kiểm kê định kỳ. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { ClipboardList, Plus, ScanLine, CheckCircle2, AlertTriangle, MapPin, Printer, Download, Lock, Undo2, ArrowLeft, QrCode } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Spinner, Empty, Modal, Field } from '../components/ui.jsx';
import { HrHero, Kpi, HrCard, Pill } from '../hrm/hrUi.jsx';
import { downloadCsv } from '../sheet.js';
import { fmtDate, fmtDateTime, cx } from '../utils.js';
import { CONDITION_LABEL, useAssetMeta } from './assetShared.jsx';

const itemUrl = (id) => `${window.location.origin}/asset/item/${id}`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// ================================================================ tem QR
export function AssetLabels() {
  const [params] = useSearchParams();
  const { company } = useApp();
  const ids = (params.get('ids') || '').split(',').map(Number).filter(Boolean);
  const [items] = useFetch(() => api.get('/assets'), []);
  const [codes, setCodes] = useState({});
  const list = useMemo(() => (items || []).filter((a) => !ids.length || ids.includes(a.id)), [items]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    Promise.all(list.map(async (a) => [a.id, await QRCode.toDataURL(itemUrl(a.id), { margin: 1, width: 240, errorCorrectionLevel: 'M' })]))
      .then((pairs) => alive && setCodes(Object.fromEntries(pairs)));
    return () => { alive = false; };
  }, [list]);
  if (!items) return <div className="page hr"><Spinner /></div>;
  return (
    <div className="page hr ql-page">
      <div className="ql-bar no-print">
        <Link to="/asset/list" className="btn btn-sm"><ArrowLeft size={14} /> Danh sách tài sản</Link>
        <span className="muted">{list.length} tem · khổ A4, 3 cột — dán lên tài sản, quét bằng camera điện thoại để mở trang tài sản / xác nhận kiểm kê</span>
        <div className="grow" />
        <button className="btn btn-primary btn-sm" onClick={() => window.print()} disabled={Object.keys(codes).length < list.length}><Printer size={14} /> In tem</button>
      </div>
      <div className="ql-grid">
        {list.map((a) => (
          <div key={a.id} className="ql-label">
            {codes[a.id] ? <img src={codes[a.id]} alt={a.code} /> : <span className="ql-ph" />}
            <div className="ql-text"><b>{a.code}</b><span>{a.name}</span><small>{company}</small></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ================================================================ danh sách đợt kiểm kê
function OpenAuditModal({ onClose, onSaved }) {
  const { departments } = useApp();
  const toast = useToast();
  const [meta] = useAssetMeta();
  const [market] = useFetch(() => api.get('/asset/market').catch(() => ({ assets: [] })), []);
  const [f, setF] = useState({ name: `Kiểm kê ${new Date().toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric' })}`, type: '', location: '', partner: '', placement: '', kind: '', department_id: '', note: '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setErr('');
    try { const r = await api.post('/asset/audits', f); toast(`Đã mở đợt kiểm kê (${r.total} tài sản)`); onSaved(r.id); } catch (e) { setErr(e.message); }
  };
  const partners = [...new Set((market?.assets || []).map((a) => a.partner))].sort();
  return (
    <Modal title="Mở đợt kiểm kê" onClose={onClose} width={600}
      footer={<><button className="btn" onClick={onClose}>Huỷ</button><button className="btn btn-primary" onClick={save}>Mở đợt</button></>}>
      {err && <div className="alert alert-error">{err}</div>}
      <Field label="Tên đợt" required><input className="input" value={f.name} onChange={set('name')} /></Field>
      <p className="muted small">Phạm vi: để trống = toàn bộ tài sản (trừ đã mất / thanh lý và tài sản đang nằm trong đợt khác).</p>
      <div className="form-grid">
        <Field label="Loại tài sản"><select className="input" value={f.type} onChange={set('type')}><option value="">Tất cả</option>{meta?.settings.types.map((t) => <option key={t.name}>{t.name}</option>)}</select></Field>
        <Field label="Địa điểm"><select className="input" value={f.location} onChange={set('location')}><option value="">Tất cả</option>{meta?.settings.locations.map((l) => <option key={l}>{l}</option>)}</select></Field>
        <Field label="Nơi đặt"><select className="input" value={f.placement} onChange={set('placement')}><option value="">Tất cả</option><option value="company">Tại công ty</option><option value="market">Tại NPP / điểm bán</option></select></Field>
        <Field label="NPP"><select className="input" value={f.partner} onChange={set('partner')}><option value="">Tất cả</option>{partners.map((p) => <option key={p}>{p}</option>)}</select></Field>
        <Field label="Phòng ban người giữ"><select className="input" value={f.department_id} onChange={set('department_id')}><option value="">Tất cả</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <Field label="Phân loại"><select className="input" value={f.kind} onChange={set('kind')}><option value="">Tất cả</option><option value="asset">Tài sản cố định</option><option value="tool">Công cụ dụng cụ</option></select></Field>
      </div>
      <Field label="Ghi chú"><textarea className="input" rows={2} value={f.note} onChange={set('note')} placeholder="Người kiểm kê, thời hạn hoàn thành…" /></Field>
    </Modal>
  );
}

export function AuditList() {
  const navigate = useNavigate();
  const [list, reload, loading, error] = useFetch(() => api.get('/asset/audits'), []);
  const [modal, setModal] = useState(false);
  if (error) return <div className="page hr"><div className="alert alert-error">{error.message}</div></div>;
  if (loading && !list) return <div className="page hr"><Spinner /></div>;
  return (
    <div className="page hr">
      <HrHero icon={ClipboardList} tone="green" title="Kiểm kê tài sản" subtitle="Mở đợt theo phạm vi, quét tem QR hoặc nhập mã để xác nhận có mặt, chốt biên bản thiếu / hỏng / sai vị trí">
        <Link className="btn" to="/asset/labels"><QrCode size={15} /> In tem QR</Link>
        <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={15} /> Mở đợt kiểm kê</button>
      </HrHero>
      {!list.length ? <div className="hr-table-card"><Empty icon={ClipboardList} title="Chưa có đợt kiểm kê nào" /></div> : (
        <div className="hr-table-card hr-rise">
          <div className="table-wrap"><table className="table nowrap-cells">
            <thead><tr><th>Đợt kiểm kê</th><th>Tiến độ</th><th>Hỏng / kém</th><th>Sai vị trí</th><th>Trạng thái</th><th>Mở bởi</th></tr></thead>
            <tbody>{list.map((x) => (
              <tr key={x.id} className="clickable hr-row" onClick={() => navigate(`/asset/audits/${x.id}`)}>
                <td><b>{x.name}</b><small className="muted block">{fmtDate(x.created_at)}{x.closed_at ? ` → ${fmtDate(x.closed_at)}` : ''}</small></td>
                <td><div className="au-progress"><span style={{ width: `${pct(x.found, x.total)}%` }} /></div><small className="muted">{x.found || 0}/{x.total} ({pct(x.found, x.total)}%)</small></td>
                <td>{x.bad || 0}</td><td>{x.moved || 0}</td>
                <td><Pill tone={x.status === 'open' ? 'amber' : 'green'}>{x.status === 'open' ? 'Đang kiểm kê' : 'Đã chốt'}</Pill></td>
                <td>{x.created_by_name}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
      {modal && <OpenAuditModal onClose={() => setModal(false)} onSaved={(id) => navigate(`/asset/audits/${id}`)} />}
    </div>
  );
}

// ================================================================ một đợt
export function AuditDetail() {
  const { id } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const [d, reload, loading, error] = useFetch(() => api.get(`/asset/audits/${id}`), [id]);
  const [code, setCode] = useState('');
  const [seg, setSeg] = useState('pending');
  const [closing, setClosing] = useState(false);
  const [last, setLast] = useState(null);
  const input = useRef(null);
  if (error) return <div className="page hr"><div className="alert alert-error">{error.message}</div></div>;
  if (loading && !d) return <div className="page hr"><Spinner /></div>;
  const open = d.status === 'open';
  const found = d.lines.filter((l) => l.found);
  const bad = found.filter((l) => ['poor', 'broken'].includes(l.condition));
  const moved = found.filter((l) => l.actual_place);
  const changed = d.lines.filter((l) => l.holder_id !== l.expected_holder_id);
  const rows = { pending: d.lines.filter((l) => !l.found), found, bad, moved, all: d.lines }[seg];
  const scan = async (e) => {
    e?.preventDefault();
    if (!code.trim()) return;
    try {
      const r = await api.post(`/asset/audits/${d.id}/scan`, { code: code.trim() });
      setLast({ ok: true, text: `${r.already ? 'Đã xác nhận trước đó' : 'Có mặt'}: ${r.code} — ${r.name}` });
      setCode(''); reload();
    } catch (er) { setLast({ ok: false, text: er.message }); }
    input.current?.focus();
  };
  const reset = async (l) => { try { await api.post(`/asset/audits/${d.id}/lines/${l.asset_id}/reset`, {}); reload(); } catch (e) { toast(e.message, 'error'); } };
  const exportCsv = () => downloadCsv(`kiem-ke-${d.id}`,
    ['Mã', 'Tài sản', 'Loại', 'Người giữ theo sổ', 'Vị trí theo sổ', 'Kết quả', 'Tình trạng', 'Vị trí thực tế', 'Ghi chú', 'Người xác nhận', 'Thời điểm'],
    d.lines.map((l) => [l.code, l.name, l.type || '', l.expected_holder_name || '', l.expected_place || '', l.found ? 'Có mặt' : 'Không tìm thấy',
      l.condition ? CONDITION_LABEL[l.condition] : '', l.actual_place || '', l.note || '', l.found_by_name || '', l.found_at || '']));
  return (
    <div className="page hr">
      <HrHero icon={ClipboardList} tone="green" title={d.name}
        subtitle={`Mở ${fmtDateTime(d.created_at)} bởi ${d.created_by_name || '—'}${d.closed_at ? ` · chốt ${fmtDateTime(d.closed_at)} bởi ${d.closed_by_name}` : ''}`}>
        <button className="btn no-print" onClick={() => navigate('/asset/audits')}><ArrowLeft size={15} /> Các đợt</button>
        {d.can_manage && <button className="btn no-print" onClick={exportCsv}><Download size={15} /> Xuất Excel</button>}
        {d.can_manage && <button className="btn no-print" onClick={() => window.print()}><Printer size={15} /> In biên bản</button>}
        {d.can_manage && open && <button className="btn btn-primary no-print" onClick={() => setClosing(true)}><Lock size={15} /> Chốt đợt</button>}
      </HrHero>
      <div className="hr-kpis">
        <Kpi i={0} icon={CheckCircle2} tone="green" label="Đã xác nhận" value={`${found.length}/${d.lines.length}`} sub={`${pct(found.length, d.lines.length)}%`} onClick={() => setSeg('found')} active={seg === 'found'} />
        <Kpi i={1} icon={ScanLine} tone="amber" label={open ? 'Chưa xác nhận' : 'Không tìm thấy'} value={d.lines.length - found.length} onClick={() => setSeg('pending')} active={seg === 'pending'} />
        <Kpi i={2} icon={AlertTriangle} tone="red" label="Hỏng / tình trạng kém" value={bad.length} onClick={() => setSeg('bad')} active={seg === 'bad'} />
        <Kpi i={3} icon={MapPin} tone="violet" label="Sai vị trí" value={moved.length} sub={changed.length ? `${changed.length} đổi người giữ trong đợt` : undefined} onClick={() => setSeg('moved')} active={seg === 'moved'} />
      </div>
      {open && (
        <HrCard icon={ScanLine} tone="green" title="Quét / nhập mã tài sản" className="no-print">
          <form className="au-scan" onSubmit={scan}>
            <input ref={input} autoFocus className="input" value={code} onChange={(e) => setCode(e.target.value)}
              placeholder="Mã tài sản (VD: TM-0001) hoặc dán nội dung tem QR — máy quét mã vạch dùng được trực tiếp" />
            <button className="btn btn-primary"><CheckCircle2 size={15} /> Xác nhận</button>
          </form>
          {last && <div className={cx('au-last', last.ok ? 'ok' : 'err')}>{last.text}</div>}
          <small className="muted">Trên điện thoại: mở camera, quét tem QR trên tài sản → trang tài sản hiện nút <b>Xác nhận có mặt</b>.</small>
        </HrCard>
      )}
      <div className="hr-seg no-print">
        {[['pending', open ? 'Chưa xác nhận' : 'Không tìm thấy', 'amber'], ['found', 'Đã xác nhận', 'green'], ['bad', 'Hỏng / kém', 'red'], ['moved', 'Sai vị trí', 'violet'], ['all', 'Tất cả', 'gray']].map(([k, label, tone]) => (
          <button key={k} className={cx(`tone-${tone}`, seg === k && 'active')} onClick={() => setSeg(k)}><i />{label}</button>
        ))}
      </div>
      {!rows.length ? <div className="hr-table-card"><Empty title="Không có tài sản" /></div> : (
        <div className="hr-table-card hr-rise">
          <div className="table-wrap"><table className="table nowrap-cells">
            <thead><tr><th>Tài sản</th><th>Theo sổ</th><th>Kết quả</th><th>Ghi nhận</th><th className="no-print" /></tr></thead>
            <tbody>{rows.map((l) => (
              <tr key={l.asset_id}>
                <td><Link to={`/asset/item/${l.asset_id}`}><b>{l.name}</b></Link><small className="muted block"><span className="hr-code">{l.code}</span> {l.type || ''}</small></td>
                <td>{l.expected_holder_name || <span className="muted">Trong kho</span>}<small className="muted block">{l.expected_place || ''}</small></td>
                <td>{l.found ? <Pill tone={['poor', 'broken'].includes(l.condition) ? 'red' : 'green'}>Có mặt · {CONDITION_LABEL[l.condition] || ''}</Pill> : <Pill tone="amber">{open ? 'Chưa xác nhận' : 'Không tìm thấy'}</Pill>}
                  {l.actual_place && <small className="text-red block">Thực tế: {l.actual_place}</small>}</td>
                <td>{l.found ? <>{l.found_by_name}<small className="muted block">{fmtDateTime(l.found_at)}{l.note ? ` · ${l.note}` : ''}</small></> : <span className="muted">—</span>}</td>
                <td className="no-print">{open && d.can_manage && l.found ? <button className="icon-btn sm" title="Bỏ xác nhận" aria-label="Bỏ xác nhận" onClick={() => reset(l)}><Undo2 size={14} /></button> : null}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
      {closing && <CloseAuditModal audit={d} missing={d.lines.length - found.length} onClose={() => setClosing(false)} onSaved={() => { setClosing(false); reload(); }} />}
    </div>
  );
}

function CloseAuditModal({ audit, missing, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ mark_missing_lost: false, note: '' });
  const save = async () => {
    try { await api.post(`/asset/audits/${audit.id}/close`, f); toast('Đã chốt đợt kiểm kê'); onSaved(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title="Chốt đợt kiểm kê" onClose={onClose} width={500}
      footer={<><button className="btn" onClick={onClose}>Huỷ</button><button className="btn btn-primary" onClick={save}><Lock size={14} /> Chốt</button></>}>
      <p>Còn <b>{missing}</b> tài sản chưa xác nhận. Sau khi chốt không quét thêm được.</p>
      {missing > 0 && <label className="row gap-sm"><input type="checkbox" checked={f.mark_missing_lost} onChange={(e) => setF({ ...f, mark_missing_lost: e.target.checked })} /> Chuyển {missing} tài sản không tìm thấy sang trạng thái <b>Mất</b></label>}
      <Field label="Kết luận / ghi chú"><textarea className="input" rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
    </Modal>
  );
}

/** Thanh trên trang tài sản (sau khi quét QR): xác nhận có mặt trong đợt kiểm kê đang mở */
export function AuditConfirmBar({ a, canConfirm, onDone }) {
  const toast = useToast();
  const [f, setF] = useState(null);
  const pending = (a.open_audits || []).filter((x) => !x.found);
  if (!a.open_audits?.length) return null;
  const confirm = async (x) => {
    try { await api.post(`/asset/audits/${x.id}/scan`, { asset_id: a.id, ...f }); toast(`Đã xác nhận có mặt — ${x.name}`); setF(null); onDone(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className={cx('as-alert hr-rise', !pending.length && 'au-done')}>
      <ClipboardList size={20} />
      <div className="grow">
        {pending.length ? <b>Đang kiểm kê: {pending.map((x) => x.name).join(', ')}</b> : <b>Đã xác nhận có mặt trong đợt kiểm kê {a.open_audits.map((x) => x.name).join(', ')}</b>}
        {pending.length > 0 && f && (
          <div className="au-confirm-form">
            <select className="input" value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })}>{Object.entries(CONDITION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input className="input" placeholder="Vị trí thực tế (nếu khác sổ)" value={f.actual_place} onChange={(e) => setF({ ...f, actual_place: e.target.value })} />
            <input className="input" placeholder="Ghi chú" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </div>
        )}
      </div>
      {pending.length > 0 && canConfirm && (f
        ? pending.map((x) => <button key={x.id} className="btn btn-primary btn-sm" onClick={() => confirm(x)}><CheckCircle2 size={14} /> Xác nhận</button>)
        : <button className="btn btn-primary btn-sm" onClick={() => setF({ condition: a.condition, actual_place: '', note: '' })}><CheckCircle2 size={14} /> Xác nhận có mặt</button>)}
    </div>
  );
}
