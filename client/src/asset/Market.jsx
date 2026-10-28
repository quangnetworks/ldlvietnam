/** LDL Asset — tài sản đặt tại NPP / điểm bán: đặt, kiểm tra tại chỗ (ảnh + GPS), thu hồi. */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Store, MapPin, Camera, CalendarClock, AlertTriangle, Search, PackageMinus, ClipboardCheck, Download } from 'lucide-react';
import { api, toFormData } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Spinner, Empty, FilterSelect, Modal, Field, UserPicker, useShowMore, foldVi } from '../components/ui.jsx';
import { useDebounced } from '../components/shell.jsx';
import { HrHero, Kpi, HrCard, Pill } from '../hrm/hrUi.jsx';
import { downloadCsv } from '../sheet.js';
import { fmtDate, fmtDateTime, cx } from '../utils.js';
import { AssetStatus, money } from './assetShared.jsx';

export const CHECK_RESULT = {
  ok: ['Còn đúng chỗ, tốt', 'green'], damaged: ['Hư hỏng', 'red'], moved: ['Sai điểm bán', 'amber'], missing: ['Không tìm thấy', 'red'],
};
const mapUrl = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Thiết bị không hỗ trợ định vị')); return; }
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => reject(new Error('Chưa bật định vị (GPS) cho trình duyệt')), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });
}

// ---------------------------------------------------------------- đặt tại NPP / điểm bán
export function PlaceModal({ asset, onClose, onSaved }) {
  const { users } = useApp();
  const [market] = useFetch(() => api.get('/asset/market').catch(() => ({ assets: [] })), []);
  const partners = [...new Set((market?.assets || []).map((x) => x.partner))].sort();
  const toast = useToast();
  const [f, setF] = useState({ partner: asset.partner || '', outlet: asset.outlet || '', outlet_address: asset.outlet_address || '', area: asset.area || '',
    responsible_id: asset.holder_id || null, agreement_until: asset.agreement_until || '', placed_at: today(), note: '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const save = async () => {
    setErr('');
    try { await api.post(`/assets/${asset.id}/place`, f); toast(`Đã đặt ${asset.code} tại ${f.partner}`); onSaved(); } catch (e) { setErr(e.message); }
  };
  return (
    <Modal title={`Đặt tại NPP / điểm bán — ${asset.code}`} onClose={onClose} width={600}
      footer={<><button className="btn" onClick={onClose}>Huỷ</button><button className="btn btn-primary" onClick={save}>Lưu</button></>}>
      {err && <div className="alert alert-error">{err}</div>}
      <div className="form-grid">
        <Field label="NPP / đại lý" required>
          <input className="input" list="mk-partners" value={f.partner} onChange={set('partner')} placeholder="VD: NPP Hùng Vỹ Phúc" />
          <datalist id="mk-partners">{partners.map((p) => <option key={p} value={p} />)}</datalist>
        </Field>
        <Field label="Điểm bán / cửa hàng"><input className="input" value={f.outlet} onChange={set('outlet')} placeholder="Để trống nếu đặt tại kho NPP" /></Field>
        <Field label="Khu vực / tỉnh"><input className="input" value={f.area} onChange={set('area')} /></Field>
        <Field label="Ngày đặt"><input type="date" className="input" value={f.placed_at} onChange={set('placed_at')} /></Field>
        <div className="span-2"><Field label="Địa chỉ"><input className="input" value={f.outlet_address} onChange={set('outlet_address')} /></Field></div>
        <Field label="Người phụ trách (SR / SS)" hint="Nhận trách nhiệm qua biên bản bàn giao; kiểm tra tại chỗ định kỳ">
          <UserPicker users={users} value={f.responsible_id} onChange={set('responsible_id')} placeholder="Chọn người phụ trách" />
        </Field>
        <Field label="Hạn thoả thuận cho mượn"><input type="date" className="input" value={f.agreement_until} onChange={set('agreement_until')} /></Field>
      </div>
      <Field label="Ghi chú"><textarea className="input" rows={2} value={f.note} onChange={set('note')} placeholder="Điều kiện cho mượn, doanh số cam kết…" /></Field>
    </Modal>
  );
}

// ---------------------------------------------------------------- kiểm tra tại chỗ
export function CheckModal({ asset, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ result: 'ok', note: '' });
  const [photo, setPhoto] = useState(null);
  const [geo, setGeo] = useState(null);
  const [geoErr, setGeoErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const locate = () => { setGeoErr(''); getPosition().then(setGeo).catch((e) => setGeoErr(e.message)); };
  useEffect(() => { locate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setErr(''); setBusy(true);
    try {
      await api.post(`/assets/${asset.id}/checks`, toFormData({ ...f, lat: geo?.lat ?? '', lng: geo?.lng ?? '', accuracy: geo?.accuracy ?? '' }, photo ? [photo] : []));
      toast('Đã ghi nhận kiểm tra');
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Kiểm tra tại chỗ — ${asset.code}`} onClose={onClose} width={520}
      footer={<><button className="btn" onClick={onClose}>Huỷ</button><button className="btn btn-primary" disabled={busy} onClick={save}><ClipboardCheck size={15} /> Ghi nhận</button></>}>
      {err && <div className="alert alert-error">{err}</div>}
      <p className="muted small">{asset.name}{asset.partner ? ` · ${asset.partner}` : ''}{asset.outlet ? ` · ${asset.outlet}` : ''}</p>
      <div className="mk-results">
        {Object.entries(CHECK_RESULT).map(([k, [label, tone]]) => (
          <button key={k} type="button" className={cx('mk-result', `tone-${tone}`, f.result === k && 'active')} onClick={() => setF({ ...f, result: k })}>{label}</button>
        ))}
      </div>
      <label className={cx('mk-photo', photo && 'has')}>
        <input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
        {photo ? <img src={URL.createObjectURL(photo)} alt="Ảnh tài sản" /> : <span><Camera size={22} /> Chụp ảnh tài sản tại điểm bán</span>}
      </label>
      <div className="row gap-sm small">
        <MapPin size={14} />
        {geo ? <a className="link" href={mapUrl(geo.lat, geo.lng)} target="_blank" rel="noreferrer">Đã lấy vị trí ±{Math.round(geo.accuracy)}m</a>
          : geoErr ? <span className="text-red">{geoErr} <button type="button" className="link-btn" onClick={locate}>Thử lại</button></span> : <span className="muted">Đang lấy vị trí…</span>}
      </div>
      <Field label="Ghi chú"><textarea className="input" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Tình trạng, vị trí trưng bày, hàng trong tủ…" /></Field>
    </Modal>
  );
}

/** Thẻ "Đang đặt tại thị trường" + lịch sử kiểm tra trong trang chi tiết tài sản */
export function MarketCard({ a, i = 0, onCheck }) {
  if (a.placement !== 'market' && !a.checks?.length) return null;
  return (
    <HrCard className="hr-span-12" icon={Store} tone="aqua" i={i}
      title={a.placement === 'market' ? `Đang đặt tại ${a.partner}` : 'Lịch sử kiểm tra tại chỗ'}
      action={a.can_check && <button className="btn btn-sm btn-primary" onClick={onCheck}><Camera size={14} /> Kiểm tra tại chỗ</button>}>
      {a.placement === 'market' && (
        <div className="hr-facts mk-facts">
          {a.outlet && <span className="hr-fact tone-aqua"><Store size={13} /> {a.outlet}</span>}
          {(a.outlet_address || a.area) && <span className="hr-fact tone-gray"><MapPin size={13} /> {[a.outlet_address, a.area].filter(Boolean).join(', ')}</span>}
          {a.placed_at && <span className="hr-fact tone-blue">Đặt từ {fmtDate(a.placed_at)}</span>}
          {a.agreement_until && <span className={cx('hr-fact', a.agreement_until < today() ? 'tone-red' : 'tone-violet')}><CalendarClock size={13} /> Thoả thuận đến {fmtDate(a.agreement_until)}</span>}
        </div>
      )}
      {a.checks?.length ? (
        <ul className="mk-checks">{a.checks.map((k) => (
          <li key={k.id}>
            {k.has_photo ? <a href={api.url(`/asset/checks/${k.id}/photo`)} target="_blank" rel="noreferrer"><img src={api.url(`/asset/checks/${k.id}/photo`)} alt="Ảnh kiểm tra" loading="lazy" /></a>
              : <span className="mk-nophoto"><Camera size={16} /></span>}
            <div className="grow">
              <Pill tone={(CHECK_RESULT[k.result] || ['', 'gray'])[1]}>{(CHECK_RESULT[k.result] || [k.result])[0]}</Pill>
              {k.note && <span> {k.note}</span>}
              <small className="muted block">{fmtDateTime(k.checked_at)} · {k.checked_by_name || '—'}
                {k.lat != null && <> · <a className="link" href={mapUrl(k.lat, k.lng)} target="_blank" rel="noreferrer">Bản đồ{k.accuracy != null ? ` ±${k.accuracy}m` : ''}</a></>}</small>
            </div>
          </li>
        ))}</ul>
      ) : <div className="hr-empty"><Camera size={16} /> Chưa kiểm tra lần nào.</div>}
    </HrCard>
  );
}

// ---------------------------------------------------------------- tổng hợp
export function MarketOverview() {
  const navigate = useNavigate();
  const toast = useToast();
  const [d, reload, loading, error] = useFetch(() => api.get('/asset/market'), []);
  const [q, setQ] = useState('');
  const [partner, setPartner] = useState('');
  const [seg, setSeg] = useState('all');
  const dq = useDebounced(q, 200);
  const rows = useMemo(() => (d?.assets || []).filter((a) => {
    if (partner && a.partner !== partner) return false;
    if (seg === 'overdue' && !a.check_overdue) return false;
    if (seg === 'issue' && !['damaged', 'missing', 'moved'].includes(a.last_check_result)) return false;
    if (seg === 'expiring' && !(a.agreement_until && a.agreement_until <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10))) return false;
    return !dq || foldVi(`${a.code} ${a.name} ${a.partner} ${a.outlet || ''} ${a.area || ''} ${a.holder_name || ''}`).includes(foldVi(dq));
  }), [d, partner, seg, dq]);
  const [shown, more] = useShowMore(rows, 80, `${partner}|${seg}|${dq}`);
  if (error) return <div className="page hr"><div className="alert alert-error">{error.message}</div></div>;
  if (loading && !d) return <div className="page hr"><Spinner /></div>;
  const all = d.assets;
  const partners = [...new Set(all.map((a) => a.partner))].sort();
  const issues = all.filter((a) => ['damaged', 'missing', 'moved'].includes(a.last_check_result));
  const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const recallPartner = async () => {
    const n = all.filter((a) => a.partner === partner).length;
    if (!window.confirm(`Thu hồi toàn bộ ${n} tài sản đang đặt tại ${partner} về công ty?`)) return;
    try { await api.post('/asset/market/recall-partner', { partner }); toast(`Đã thu hồi ${n} tài sản tại ${partner}`); setPartner(''); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const exportCsv = () => downloadCsv(`tai-san-tai-npp-${today()}`,
    ['Mã', 'Tài sản', 'NPP', 'Điểm bán', 'Địa chỉ', 'Khu vực', 'Người phụ trách', 'Đặt từ', 'Thoả thuận đến', 'Kiểm tra gần nhất', 'Kết quả', 'Nguyên giá'],
    rows.map((a) => [a.code, a.name, a.partner, a.outlet || '', a.outlet_address || '', a.area || '', a.holder_name || '', a.placed_at || '', a.agreement_until || '',
      a.last_check_at ? a.last_check_at.slice(0, 10) : '', a.last_check_result ? CHECK_RESULT[a.last_check_result]?.[0] : '', a.price || '']));
  return (
    <div className="page hr">
      <HrHero icon={Store} tone="aqua" title="Tài sản tại NPP / điểm bán"
        subtitle={`Tủ mát, kệ trưng bày, biển hiệu, POSM, xe kéo… cho NPP và cửa hàng mượn — người phụ trách kiểm tra tại chỗ mỗi ${d.check_interval_days} ngày`} />
      <div className="hr-kpis">
        <Kpi i={0} icon={Store} tone="aqua" label="Đang đặt tại thị trường" value={all.length} sub={`${partners.length} NPP · ${money(all.reduce((s, a) => s + (a.price || 0), 0))}`} onClick={() => setSeg('all')} active={seg === 'all'} />
        <Kpi i={1} icon={CalendarClock} tone="amber" label="Quá hạn kiểm tra" value={all.filter((a) => a.check_overdue).length} sub={`chưa kiểm tra trong ${d.check_interval_days} ngày`} onClick={() => setSeg('overdue')} active={seg === 'overdue'} />
        <Kpi i={2} icon={AlertTriangle} tone="red" label="Hỏng / mất / sai điểm bán" value={issues.length} sub="theo lần kiểm tra gần nhất" onClick={() => setSeg('issue')} active={seg === 'issue'} />
        <Kpi i={3} icon={CalendarClock} tone="violet" label="Thoả thuận sắp hết hạn" value={all.filter((a) => a.agreement_until && a.agreement_until <= soon).length} sub="trong 30 ngày tới" onClick={() => setSeg('expiring')} active={seg === 'expiring'} />
      </div>
      <div className="hr-toolbar">
        <div className="ww-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm mã, tài sản, NPP, cửa hàng, người phụ trách" /></div>
        <FilterSelect value={partner} onChange={setPartner} options={[{ value: '', label: 'Tất cả NPP' }, ...partners.map((p) => ({ value: p, label: p }))]} />
        <div className="grow" />
        {partner && <button className="btn btn-sm btn-danger-ghost" onClick={recallPartner}><PackageMinus size={14} /> Thu hồi tất cả tại NPP này</button>}
        <button className="btn btn-sm" onClick={exportCsv}><Download size={14} /> Xuất Excel</button>
      </div>
      {!rows.length ? (
        <div className="hr-table-card"><Empty icon={Store} title={all.length ? 'Không có tài sản phù hợp' : 'Chưa có tài sản nào đặt tại NPP / điểm bán'}>
          {!all.length && <>Mở một tài sản trong <Link to="/asset/list">Tài sản & công cụ</Link> → <b>Đặt tại NPP / điểm bán</b>.</>}
        </Empty></div>
      ) : (
        <div className="hr-table-card hr-rise">
          <div className="table-wrap"><table className="table nowrap-cells">
            <thead><tr><th>Tài sản</th><th>NPP / điểm bán</th><th>Người phụ trách</th><th>Thoả thuận</th><th>Kiểm tra gần nhất</th><th>Trạng thái</th></tr></thead>
            <tbody>{shown.map((a) => (
              <tr key={a.id} className="clickable hr-row" onClick={() => navigate(`/asset/item/${a.id}`)}>
                <td><b>{a.name}</b><small className="muted block"><span className="hr-code">{a.code}</span> {a.type || ''}</small></td>
                <td><b>{a.partner}</b><small className="muted block">{[a.outlet, a.area].filter(Boolean).join(' · ')}</small></td>
                <td>{a.holder_name || <span className="muted">—</span>}</td>
                <td>{a.agreement_until ? <span className={cx(a.agreement_until < today() && 'text-red')}>{fmtDate(a.agreement_until)}</span> : <span className="muted">—</span>}</td>
                <td>{a.last_check_at ? <><Pill tone={(CHECK_RESULT[a.last_check_result] || ['', 'gray'])[1]}>{(CHECK_RESULT[a.last_check_result] || ['—'])[0]}</Pill><small className="muted block">{fmtDate(a.last_check_at)}</small></>
                  : <Pill tone="amber">Chưa kiểm tra</Pill>}
                  {a.check_overdue && a.last_check_at && <small className="text-red block">Quá hạn</small>}</td>
                <td><AssetStatus status={a.status} /></td>
              </tr>
            ))}</tbody>
          </table></div>
          {more}
        </div>
      )}
    </div>
  );
}

/** Nút trong trang chi tiết tài sản (quản lý): đặt / thu hồi */
export function MarketActions({ a, onPlace, onRecalled }) {
  const toast = useToast();
  if (['lost', 'disposed'].includes(a.status)) return null;
  const recall = async () => {
    const note = window.prompt(`Thu hồi ${a.code} từ ${a.partner} về công ty. Ghi chú (tuỳ chọn):`, '');
    if (note === null) return;
    try { await api.post(`/assets/${a.id}/recall`, { note }); toast('Đã thu hồi về công ty'); onRecalled(); } catch (e) { toast(e.message, 'error'); }
  };
  return a.placement === 'market'
    ? <><button className="btn btn-sm" onClick={onPlace}><Store size={14} /> Đổi điểm đặt</button><button className="btn btn-sm" onClick={recall}><PackageMinus size={14} /> Thu hồi về công ty</button></>
    : <button className="btn btn-sm" onClick={onPlace}><Store size={14} /> Đặt tại NPP / điểm bán</button>;
}

