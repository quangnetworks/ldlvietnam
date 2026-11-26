/** LDL Asset — đồng phục, nón, xe kéo… cấp phát theo số lượng, theo dõi theo người giữ (kể cả PG/PS không có tài khoản, NPP). */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Shirt, PackagePlus, PackageMinus, ArrowLeftRight, AlertTriangle, Warehouse, UserPlus, Settings2, Search, ArrowLeft, Pencil,
  Undo2, Store, UserRound, History, Plus, Download,
} from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Spinner, Empty, FilterSelect, Modal, Field, UserPicker, useShowMore, foldVi } from '../components/ui.jsx';
import { useDebounced } from '../components/shell.jsx';
import { HrHero, Kpi, HrCard, Pill } from '../hrm/hrUi.jsx';
import { downloadCsv } from '../sheet.js';
import { fmtDate, cx } from '../utils.js';
import { money } from './assetShared.jsx';

const KIND_TONE = { opening: 'gray', receive: 'aqua', issue: 'blue', return: 'green', transfer: 'violet', writeoff: 'red' };
const WS = { working: ['Đang làm', 'blue'], probation: ['Thử việc', 'amber'], leave: ['Tạm nghỉ', 'violet'], resigned: ['Đã nghỉ việc', 'red'] };
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const fold = foldVi;
/** Người đã nghỉ việc (hồ sơ HRM) hoặc ngừng theo dõi mà vẫn còn giữ đồ phải hoàn trả */
const owes = (h, items) => (h.work_status === 'resigned' || !h.active) && items.some((i) => i.returnable && (h.balances[i.id] || 0) > 0);

export function HolderTag({ h }) {
  return (
    <span className="row gap-xs wrap">
      {h.kind === 'partner' ? <Pill tone="aqua">NPP / đối tác</Pill> : h.role ? <Pill tone="gray">{h.role}</Pill> : null}
      {h.user_id ? <Pill tone={(WS[h.work_status] || WS.working)[1]}>{(WS[h.work_status] || WS.working)[0]}</Pill> : h.kind !== 'partner' && <Pill tone="gray">Chưa có tài khoản</Pill>}
      {!h.active && <Pill tone="gray">Ngừng theo dõi</Pill>}
    </span>
  );
}

// ================================================================ ghi sổ
const TITLES = {
  issue: 'Cấp phát từ kho', return: 'Thu hồi về kho', transfer: 'Chuyển giao giữa người giữ', writeoff: 'Ghi nhận hỏng / mất', receive: 'Nhập kho', opening: 'Số dư đầu kỳ',
};
export function MoveModal({ kind: kind0, data, holderId, note: note0 = '', requestId, onClose, onSaved }) {
  const toast = useToast();
  const [kind, setKind] = useState(kind0);
  const [f, setF] = useState({ date: today(), from: ['return', 'transfer', 'writeoff'].includes(kind0) ? holderId || '' : '', to: ['issue', 'opening'].includes(kind0) ? holderId || '' : '', reason: 'damaged', note: note0 });
  const [qty, setQty] = useState({});
  const [charge, setCharge] = useState({});
  const [err, setErr] = useState('');
  const items = data.items.filter((i) => i.active);
  const holders = data.holders.filter((h) => h.active || h.id === Number(f.from) || h.id === Number(f.to));
  const needFrom = ['return', 'transfer', 'writeoff'].includes(kind);
  const needTo = ['issue', 'transfer', 'opening'].includes(kind);
  const fromH = data.holders.find((h) => h.id === Number(f.from));
  const avail = (i) => (needFrom ? (fromH ? fromH.balances[i.id] || 0 : kind === 'writeoff' ? data.warehouse[i.id] : 0) : kind === 'issue' ? data.warehouse[i.id] : null);
  const save = async () => {
    setErr('');
    try {
      const lines = items.map((i) => ({ item_id: i.id, qty: Number(qty[i.id]) || 0, charge: charge[i.id] })).filter((l) => l.qty > 0);
      await api.post('/asset/supply-moves', { kind, date: f.date, from_holder_id: f.from || null, to_holder_id: f.to || null, reason: f.reason, note: f.note, request_id: requestId, lines });
      toast(`Đã ghi sổ: ${TITLES[kind].toLowerCase()}`);
      onSaved();
    } catch (e) { setErr(e.message); }
  };
  const holderSelect = (value, onChange, placeholder, excludeId) => (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {['person', 'partner'].map((k) => (
        <optgroup key={k} label={k === 'partner' ? 'NPP / đối tác' : 'Nhân sự'}>
          {holders.filter((h) => h.kind === k && h.id !== Number(excludeId)).map((h) => (
            <option key={h.id} value={h.id}>{h.name}{h.role ? ` · ${h.role}` : ''}{h.area ? ` · ${h.area}` : ''}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
  return (
    <Modal title={TITLES[kind]} onClose={onClose} width={620}
      footer={<><button className="btn" onClick={onClose}>Huỷ</button><button className="btn btn-primary" onClick={save}>Ghi sổ</button></>}>
      {err && <div className="alert alert-error">{err}</div>}
      <div className="hr-seg sm">
        {['issue', 'return', 'transfer', 'writeoff', 'receive'].map((k) => (
          <button key={k} className={cx(`tone-${KIND_TONE[k]}`, kind === k && 'active')} onClick={() => setKind(k)}><i />{TITLES[k].split(' ')[0] === 'Ghi' ? 'Hỏng / mất' : TITLES[k].replace(' từ kho', '').replace(' về kho', '').replace(' giữa người giữ', '')}</button>
        ))}
      </div>
      <div className="form-grid">
        <Field label="Ngày"><input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        {kind === 'writeoff' && (
          <Field label="Lý do"><select className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
            {Object.entries(data.reasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></Field>
        )}
        {needFrom && <Field label={kind === 'writeoff' ? 'Người đang giữ (để trống = trong kho)' : 'Người giao / trả'} required={kind !== 'writeoff'}>{holderSelect(f.from, (v) => setF({ ...f, from: v }), kind === 'writeoff' ? 'Kho công ty' : 'Chọn người', f.to)}</Field>}
        {needTo && <Field label="Người nhận" required>{holderSelect(f.to, (v) => setF({ ...f, to: v }), 'Chọn người nhận', f.from)}</Field>}
      </div>
      <div className="sp-lines">
        {items.map((i) => {
          const a = avail(i);
          return (
            <div key={i.id} className="sp-line">
              <span className="grow"><b>{i.name}</b><small className="muted block">{a != null ? `${needFrom && fromH ? 'Đang giữ' : 'Tồn kho'}: ${a} ${i.unit}` : 'Kho chưa theo dõi tồn'}</small></span>
              <input type="number" min="0" className="input sp-qty" placeholder="0" value={qty[i.id] || ''}
                onChange={(e) => { setQty({ ...qty, [i.id]: e.target.value }); if (kind === 'writeoff' && f.reason === 'lost' && i.penalty) setCharge({ ...charge, [i.id]: (Number(e.target.value) || 0) * i.penalty }); }} />
              <span className="muted sp-unit">{i.unit}</span>
              {kind === 'writeoff' && (
                <input className="input sp-charge" placeholder="Bồi thường (đ)" value={charge[i.id] ?? ''} onChange={(e) => setCharge({ ...charge, [i.id]: e.target.value })} />
              )}
            </div>
          );
        })}
        {!items.length && <div className="hr-empty">Chưa có công cụ dụng cụ trong danh mục.</div>}
      </div>
      <Field label="Ghi chú"><textarea className="input" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="VD: theo đề xuất cấp phát ngày…, NPP Hùng Vỹ Phúc" /></Field>
    </Modal>
  );
}

function HolderModal({ holder, onClose, onSaved }) {
  const { users } = useApp();
  const toast = useToast();
  const [f, setF] = useState(holder || { name: '', kind: 'person', role: '', area: '', partner: '', note: '', user_id: null, active: true });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const save = async () => {
    setErr('');
    try {
      const r = holder ? await api.put(`/asset/supply-holders/${holder.id}`, f) : await api.post('/asset/supply-holders', f);
      toast(holder ? 'Đã cập nhật người giữ' : 'Đã thêm người giữ');
      onSaved(r.id);
    } catch (e) { setErr(e.message); }
  };
  return (
    <Modal title={holder ? 'Sửa người giữ' : 'Thêm người giữ'} onClose={onClose} width={560}
      footer={<><button className="btn" onClick={onClose}>Huỷ</button><button className="btn btn-primary" onClick={save}>Lưu</button></>}>
      {err && <div className="alert alert-error">{err}</div>}
      <div className="form-grid">
        <Field label="Loại"><select className="input" value={f.kind} onChange={set('kind')}><option value="person">Nhân sự</option><option value="partner">NPP / đối tác</option></select></Field>
        <Field label="Tên" required><input className="input" value={f.name} onChange={set('name')} /></Field>
        {f.kind === 'person' && <Field label="Vị trí"><input className="input" value={f.role || ''} onChange={set('role')} placeholder="PG / PS / PB / SS…" /></Field>}
        <Field label="Khu vực"><input className="input" value={f.area || ''} onChange={set('area')} placeholder="VD: Kiên Giang" /></Field>
        {f.kind === 'person' && <Field label="NPP làm việc cùng"><input className="input" value={f.partner || ''} onChange={set('partner')} /></Field>}
        {f.kind === 'person' && (
          <Field label="Liên kết nhân sự trên hệ thống" hint="Để thủ tục nghỉ việc nhắc thu hồi và hồ sơ tài sản hiện số đang giữ">
            <UserPicker users={users} value={f.user_id} onChange={(v) => setF({ ...f, user_id: v, name: f.name || users.find((u) => u.id === v)?.name || '' })} placeholder="Chưa liên kết" />
          </Field>
        )}
      </div>
      <Field label="Ghi chú"><textarea className="input" rows={2} value={f.note || ''} onChange={set('note')} /></Field>
      <label className="row gap-sm"><input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Đang theo dõi</label>
    </Modal>
  );
}

function ItemsModal({ items, onClose, onSaved }) {
  const toast = useToast();
  const [rows, setRows] = useState(items.map((i) => ({ ...i, returnable: !!i.returnable, active: !!i.active })));
  const [err, setErr] = useState('');
  const set = (idx, k, v) => setRows(rows.map((r, j) => (j === idx ? { ...r, [k]: v, dirty: true } : r)));
  const save = async () => {
    setErr('');
    try {
      for (const r of rows.filter((x) => x.dirty && x.name?.trim())) {
        if (r.id) await api.put(`/asset/supply-items/${r.id}`, r); else await api.post('/asset/supply-items', r);
      }
      toast('Đã lưu danh mục công cụ dụng cụ');
      onSaved();
    } catch (e) { setErr(e.message); }
  };
  return (
    <Modal title="Danh mục công cụ dụng cụ cấp phát" onClose={onClose} width={820}
      footer={<><button className="btn" onClick={() => setRows([...rows, { name: '', unit: 'cái', returnable: true, active: true, dirty: true }])}><Plus size={14} /> Thêm dòng</button>
        <div className="grow" /><button className="btn" onClick={onClose}>Huỷ</button><button className="btn btn-primary" onClick={save}>Lưu</button></>}>
      {err && <div className="alert alert-error">{err}</div>}
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Tên</th><th>Đơn vị</th><th>Đơn giá</th><th>Bồi thường / đơn vị khi không trả</th><th>Phải hoàn trả</th><th>Đang dùng</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.id || `n${i}`}>
            <td><input className="input" value={r.name} onChange={(e) => set(i, 'name', e.target.value)} /></td>
            <td><input className="input sp-unit-in" value={r.unit} onChange={(e) => set(i, 'unit', e.target.value)} /></td>
            <td><input className="input" value={r.price ?? ''} onChange={(e) => set(i, 'price', e.target.value)} placeholder="đ" /></td>
            <td><input className="input" value={r.penalty ?? ''} onChange={(e) => set(i, 'penalty', e.target.value)} placeholder="đ" /></td>
            <td><input type="checkbox" checked={r.returnable} onChange={(e) => set(i, 'returnable', e.target.checked)} /></td>
            <td><input type="checkbox" checked={r.active} onChange={(e) => set(i, 'active', e.target.checked)} /></td>
          </tr>
        ))}</tbody>
      </table></div>
    </Modal>
  );
}

// ================================================================ tổng hợp
export function SupplyOverview() {
  const navigate = useNavigate();
  const [data, reload, loading, error] = useFetch(() => api.get('/asset/supplies'), []);
  const [q, setQ] = useState('');
  const [area, setArea] = useState('');
  const [seg, setSeg] = useState('holding');
  const [modal, setModal] = useState(null);
  const dq = useDebounced(q, 200);
  const items = data?.items.filter((i) => i.active) || [];
  const rows = useMemo(() => {
    if (!data) return [];
    return data.holders.filter((h) => {
      const holding = items.some((i) => (h.balances[i.id] || 0) > 0);
      if (seg === 'holding' && !holding) return false;
      if (seg === 'owes' && !owes(h, items)) return false;
      if (area && h.area !== area) return false;
      if (dq && !fold(`${h.name} ${h.role || ''} ${h.area || ''} ${h.partner || ''} ${h.note || ''}`).includes(fold(dq))) return false;
      return true;
    });
  }, [data, seg, area, dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const [shown, more] = useShowMore(rows, 80, `${seg}|${area}|${dq}`);
  if (error) return <div className="page hr"><div className="alert alert-error">{error.message}</div></div>;
  if (loading && !data) return <div className="page hr"><Spinner /></div>;
  const total = (i) => data.holders.reduce((s, h) => s + Math.max(0, h.balances[i.id] || 0), 0);
  const owing = data.holders.filter((h) => owes(h, items));
  const areas = [...new Set(data.holders.map((h) => h.area).filter(Boolean))].sort();
  const done = () => { setModal(null); reload(); };
  const exportCsv = () => downloadCsv(`ccdc-dang-giu-${today()}`,
    ['Người giữ', 'Loại', 'Vị trí', 'Khu vực', 'NPP', 'Trạng thái', ...items.flatMap((i) => [`${i.name} đã nhận`, `${i.name} còn giữ`]), 'Ghi chú'],
    rows.map((h) => [h.name, h.kind === 'partner' ? 'NPP / đối tác' : 'Nhân sự', h.role || '', h.area || '', h.partner || '',
      h.user_id ? (WS[h.work_status] || WS.working)[0] : '', ...items.flatMap((i) => [(h.received || {})[i.id] || 0, h.balances[i.id] || 0]), h.note || '']),
  );
  return (
    <div className="page hr">
      <HrHero icon={Shirt} tone="brown" title="Đồng phục & công cụ dụng cụ cấp phát"
        subtitle="Áo, nón, xe kéo… cấp theo số lượng cho PG, PS, giám sát và NPP — ai đang giữ bao nhiêu, nhận từ đâu, đã trả chưa">
        <button className="btn btn-primary" onClick={() => setModal({ kind: 'issue' })}><PackagePlus size={15} /> Cấp phát</button>
        <button className="btn" onClick={() => setModal({ kind: 'return' })}><PackageMinus size={15} /> Thu hồi</button>
        <button className="btn" onClick={() => setModal({ kind: 'transfer' })}><ArrowLeftRight size={15} /> Chuyển giao</button>
      </HrHero>
      <div className="hr-kpis">
        {items.map((i, n) => (
          <Kpi key={i.id} i={n} icon={Shirt} tone={['blue', 'violet', 'aqua', 'green'][n % 4]} label={`${i.name} đang cấp phát`} value={total(i)}
            sub={data.warehouse[i.id] != null ? `Tồn kho ${data.warehouse[i.id]} ${i.unit}` : `${i.unit} · kho chưa theo dõi tồn`} />
        ))}
        <Kpi i={items.length} icon={AlertTriangle} tone="red" label="Đã nghỉ việc, chưa hoàn trả" value={owing.length} sub="người / NPP cần thu hồi"
          onClick={() => setSeg('owes')} active={seg === 'owes'} />
      </div>
      <div className="hr-seg">
        <button className={cx('tone-blue', seg === 'holding' && 'active')} onClick={() => setSeg('holding')}><i />Đang giữ</button>
        <button className={cx('tone-red', seg === 'owes' && 'active')} onClick={() => setSeg('owes')}><i />Nghỉ việc chưa trả ({owing.length})</button>
        <button className={cx('tone-gray', seg === 'all' && 'active')} onClick={() => setSeg('all')}><i />Tất cả người giữ</button>
      </div>
      <div className="hr-toolbar">
        <div className="ww-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm người giữ, NPP, khu vực, ghi chú" /></div>
        <FilterSelect value={area} onChange={setArea} options={[{ value: '', label: 'Tất cả khu vực' }, ...areas.map((a) => ({ value: a, label: a }))]} />
        <div className="grow" />
        <button className="btn btn-sm" onClick={() => setModal({ kind: 'writeoff' })}><AlertTriangle size={14} /> Hỏng / mất</button>
        <button className="btn btn-sm" onClick={() => setModal({ kind: 'receive' })}><Warehouse size={14} /> Nhập kho</button>
        <button className="btn btn-sm" onClick={() => setModal({ holder: true })}><UserPlus size={14} /> Thêm người giữ</button>
        <button className="btn btn-sm" onClick={() => setModal({ items: true })}><Settings2 size={14} /> Danh mục</button>
        <button className="btn btn-sm" onClick={exportCsv}><Download size={14} /> Xuất Excel</button>
      </div>
      {!rows.length ? <div className="hr-table-card"><Empty icon={Shirt} title={seg === 'owes' ? 'Không có ai nghỉ việc mà chưa hoàn trả' : 'Chưa có dữ liệu'} /></div> : (
        <div className="hr-table-card hr-rise">
          <div className="table-wrap"><table className="table nowrap-cells sp-table">
            <thead><tr><th>Người giữ</th><th>Khu vực / NPP</th>{items.map((i) => <th key={i.id} className="num">{i.name}</th>)}<th>Ghi chú</th></tr></thead>
            <tbody>{shown.map((h) => (
              <tr key={h.id} className={cx('clickable hr-row', owes(h, items) && 'sp-owes')} onClick={() => navigate(`/asset/supplies/holder/${h.id}`)}>
                <td><span className="hr-name"><span className={cx('hr-card-icon', h.kind === 'partner' ? 'tone-aqua' : 'tone-blue')}>{h.kind === 'partner' ? <Store size={15} /> : <UserRound size={15} />}</span>
                  <span><b>{h.name}</b><small className="block"><HolderTag h={h} /></small></span></span></td>
                <td>{h.area || '—'}{h.partner ? <small className="muted block">{h.partner}</small> : null}</td>
                {items.map((i) => {
                  const now = h.balances[i.id] || 0;
                  const got = (h.received || {})[i.id] || 0;
                  return <td key={i.id} className="num"><b className={cx(!now && 'muted')}>{now}</b>{got !== now && got ? <small className="muted block">đã nhận {got}</small> : null}</td>;
                })}
                <td className="sp-note">{h.note || ''}</td>
              </tr>
            ))}</tbody>
          </table></div>
          {more}
        </div>
      )}
      {modal?.kind && <MoveModal kind={modal.kind} data={data} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.holder && <HolderModal onClose={() => setModal(null)} onSaved={done} />}
      {modal?.items && <ItemsModal items={data.items} onClose={() => setModal(null)} onSaved={done} />}
    </div>
  );
}

// ================================================================ một người giữ
export function SupplyHolder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, reload] = useFetch(() => api.get('/asset/supplies'), []);
  const [moves, reloadMoves] = useFetch(() => api.get('/asset/supply-moves', { holder_id: id }), [id]);
  const [modal, setModal] = useState(null);
  const h = data?.holders.find((x) => x.id === Number(id));
  if (!data || !moves) return <div className="page hr"><Spinner /></div>;
  if (!h) return <div className="page hr"><Empty title="Người giữ không tồn tại" /></div>;
  const items = data.items;
  const done = () => { setModal(null); reload(); reloadMoves(); };
  const voidMove = async (m) => {
    if (!window.confirm(`Huỷ dòng "${data.kinds[m.kind]} ${m.qty} ${m.unit} ${m.item_name}"?`)) return;
    try { await api.post(`/asset/supply-moves/${m.id}/void`, {}); toast('Đã huỷ dòng ghi sổ'); done(); } catch (e) { toast(e.message, 'error'); }
  };
  const holding = items.filter((i) => (h.balances[i.id] || 0) !== 0);
  const penalty = holding.reduce((s, i) => s + (i.returnable && i.penalty ? i.penalty * Math.max(0, h.balances[i.id]) : 0), 0);
  return (
    <div className="page hr">
      <section className="hr-profile hr-rise">
        <div className="hr-profile-cover as-cover"><button className="icon-btn hr-back" onClick={() => navigate(-1)} aria-label="Quay lại"><ArrowLeft size={18} /></button></div>
        <div className="hr-profile-main">
          <span className={cx('hr-profile-avatar sp-avatar', h.kind === 'partner' ? 'tone-aqua' : 'tone-blue')}>{h.kind === 'partner' ? <Store size={34} /> : <UserRound size={34} />}</span>
          <div className="hr-profile-info">
            <h1>{h.name}</h1>
            <div className="muted">{[h.role, h.area, h.partner].filter(Boolean).join(' · ')}</div>
            <div className="hr-facts"><HolderTag h={h} />{h.employee_code && <span className="hr-code">{h.employee_code}</span>}</div>
          </div>
          <div className="row gap-sm wrap">
            {h.user_id && <Link className="btn btn-sm" to={`/hrm/employees/${h.user_id}`}>Hồ sơ nhân sự</Link>}
            <button className="btn btn-sm" onClick={() => setModal({ holder: true })}><Pencil size={14} /> Sửa</button>
          </div>
        </div>
      </section>
      {owes(h, items) && (
        <div className="as-alert hr-rise"><AlertTriangle size={20} /><div className="grow"><b>Đã nghỉ việc nhưng chưa hoàn trả</b>
          <small className="block">Thu hồi về kho, chuyển cho người kế nhiệm, hoặc ghi nhận mất kèm bồi thường{penalty ? ` (theo quy định ${money(penalty)})` : ''}.</small></div></div>
      )}
      <HrCard icon={Shirt} tone="blue" title="Đang giữ" count={holding.length}
        action={<div className="row gap-sm wrap">
          <button className="btn btn-sm btn-primary" onClick={() => setModal({ kind: 'issue' })}><PackagePlus size={14} /> Cấp thêm</button>
          <button className="btn btn-sm" onClick={() => setModal({ kind: 'return' })}><PackageMinus size={14} /> Thu hồi</button>
          <button className="btn btn-sm" onClick={() => setModal({ kind: 'transfer' })}><ArrowLeftRight size={14} /> Chuyển giao</button>
          <button className="btn btn-sm" onClick={() => setModal({ kind: 'writeoff' })}><AlertTriangle size={14} /> Hỏng / mất</button>
        </div>}>
        {holding.length ? (
          <div className="sp-holdings">{holding.map((i) => (
            <div key={i.id} className="sp-holding"><b>{h.balances[i.id]}</b><span>{i.unit} {i.name.toLowerCase()}</span>
              {(h.received || {})[i.id] ? <small className="muted">đã nhận {(h.received || {})[i.id]}</small> : null}</div>
          ))}</div>
        ) : <div className="hr-empty"><Shirt size={16} /> Không giữ công cụ dụng cụ nào.</div>}
        {h.note && <p className="muted sp-holder-note">{h.note}</p>}
      </HrCard>
      <HrCard icon={History} tone="violet" title="Lịch sử nhận / giao" count={moves.length} i={1}>
        {moves.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Ngày</th><th>Nghiệp vụ</th><th>Công cụ dụng cụ</th><th className="num">Số lượng</th><th>Từ → Đến</th><th>Ghi chú</th><th /></tr></thead>
            <tbody>{moves.map((m) => {
              const out = m.from_holder_id === h.id;
              return (
                <tr key={m.id} className={cx(m.voided && 'sp-voided')}>
                  <td className="nowrap">{fmtDate(m.date)}</td>
                  <td><Pill tone={KIND_TONE[m.kind]}>{data.kinds[m.kind]}{m.reason ? ` · ${data.reasons[m.reason]}` : ''}</Pill></td>
                  <td>{m.item_name}</td>
                  <td className="num"><b className={out ? 'text-red' : 'text-green'}>{out ? '−' : '+'}{m.qty}</b> {m.unit}</td>
                  <td className="nowrap">{m.from_name || (m.kind === 'opening' ? '—' : 'Kho')} → {m.to_name || (m.kind === 'writeoff' ? 'Loại bỏ' : 'Kho')}</td>
                  <td>{m.note || ''}{m.charge ? <small className="block">Bồi thường {money(m.charge)}</small> : null}<small className="muted block">{m.created_by_name}</small></td>
                  <td>{m.voided ? <small className="muted">Đã huỷ</small> : <button className="icon-btn sm" title="Huỷ dòng ghi nhầm" aria-label="Huỷ dòng" onClick={() => voidMove(m)}><Undo2 size={14} /></button>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <div className="hr-empty"><History size={16} /> Chưa có lịch sử.</div>}
      </HrCard>
      {modal?.kind && <MoveModal kind={modal.kind} data={data} holderId={h.id} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.holder && <HolderModal holder={h} onClose={() => setModal(null)} onSaved={done} />}
    </div>
  );
}

/** CCDC đang giữ — thẻ trong hồ sơ tài sản của nhân sự / thủ tục nghỉ việc */
export function SupplyHoldingCard({ supplies, i = 0, offboard }) {
  if (!supplies?.length) return null;
  return (
    <HrCard icon={Shirt} tone={offboard ? 'orange' : 'blue'} title={offboard ? 'Đồng phục & CCDC phải hoàn trả' : 'Đồng phục & CCDC đang giữ'} count={supplies.length} i={i}
      action={<Link className="btn btn-sm" to={`/asset/supplies/holder/${supplies[0].holder_id}`}>Thu hồi / chi tiết</Link>}>
      <div className="sp-holdings">{supplies.map((s) => (
        <div key={s.item_id} className="sp-holding"><b>{s.qty}</b><span>{s.unit} {s.name.toLowerCase()}</span>
          {s.returnable && s.penalty ? <small className="muted">không trả: {money(s.penalty * s.qty)}</small> : null}</div>
      ))}</div>
    </HrCard>
  );
}
