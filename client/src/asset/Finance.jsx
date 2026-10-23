/** LDL Asset — khấu hao theo tháng, thanh lý, liên kết với đề xuất (LDL Request). */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Calculator, TrendingDown, Wallet, Recycle, Download, PackagePlus, Shirt, AlertTriangle, Link2 } from 'lucide-react';
import { api } from '../api.js';
import { useFetch, useToast } from '../context.jsx';
import { Spinner, Empty, Modal, Field } from '../components/ui.jsx';
import { HrHero, Kpi, HrCard, Pill } from '../hrm/hrUi.jsx';
import { downloadCsv } from '../sheet.js';
import { fmtDate, cx } from '../utils.js';
import { money, AssetFormModal } from './assetShared.jsx';
import { MoveModal } from './Supplies.jsx';

const METHODS = { sell: 'Bán thanh lý', destroy: 'Huỷ bỏ', donate: 'Tặng / cho', return_supplier: 'Trả nhà cung cấp' };
const thisMonth = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);

// ---------------------------------------------------------------- phiếu thanh lý
export function DisposeModal({ asset, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ date: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), method: 'sell', proceeds: '', request_id: '', note: '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setErr('');
    try { await api.post(`/assets/${asset.id}/dispose`, f); toast(`Đã thanh lý ${asset.code}`); onSaved(); } catch (e) { setErr(e.message); }
  };
  const proceeds = Number(String(f.proceeds).replace(/[^\d]/g, '')) || 0;
  const gain = asset.book_value != null && f.proceeds !== '' ? proceeds - asset.book_value : null;
  return (
    <Modal title={`Thanh lý tài sản — ${asset.code}`} onClose={onClose} width={520}
      footer={<><button className="btn" onClick={onClose}>Huỷ</button><button className="btn btn-danger" onClick={save}><Recycle size={14} /> Thanh lý</button></>}>
      {err && <div className="alert alert-error">{err}</div>}
      <p className="muted small">{asset.name} · nguyên giá {money(asset.price)} · giá trị còn lại hiện tại {money(asset.book_value)}</p>
      <div className="form-grid">
        <Field label="Ngày thanh lý"><input type="date" className="input" value={f.date} onChange={set('date')} /></Field>
        <Field label="Hình thức"><select className="input" value={f.method} onChange={set('method')}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Số tiền thu về (đ)" hint={gain != null ? `${gain >= 0 ? 'Lãi' : 'Lỗ'} so với giá trị còn lại: ${money(Math.abs(gain))}` : undefined}>
          <input className="input" value={f.proceeds} onChange={set('proceeds')} placeholder="0" />
        </Field>
        <Field label="Số đề xuất duyệt thanh lý"><input className="input" value={f.request_id} onChange={set('request_id')} placeholder="VD: 128" /></Field>
      </div>
      <Field label="Ghi chú / biên bản"><textarea className="input" rows={2} value={f.note} onChange={set('note')} /></Field>
    </Modal>
  );
}

// ---------------------------------------------------------------- trang khấu hao & thanh lý
export function AssetFinance() {
  const [tab, setTab] = useState('dep');
  const [month, setMonth] = useState(thisMonth());
  const [year, setYear] = useState(thisMonth().slice(0, 4));
  const [dep, , depLoading, depErr] = useFetch(() => (tab === 'dep' ? api.get('/asset/depreciation', { month }) : Promise.resolve(null)), [tab, month]);
  const [disp, , dispLoading] = useFetch(() => (tab === 'disp' ? api.get('/asset/disposals', { year }) : Promise.resolve(null)), [tab, year]);
  if (depErr) return <div className="page hr"><div className="alert alert-error">{depErr.message}</div></div>;
  const exportDep = () => downloadCsv(`khau-hao-${dep.month}`,
    ['Mã', 'Tài sản', 'Loại', 'Ngày mua', 'Nguyên giá', 'Số tháng KH', 'Đã KH (tháng)', 'KH trong tháng', 'KH luỹ kế', 'Giá trị còn lại'],
    dep.rows.map((x) => [x.code, x.name, x.type || '', x.purchase_date, x.price, x.depreciation_months, x.months_used, x.in_month, x.accumulated, x.book_value]));
  const exportDisp = () => downloadCsv(`thanh-ly-${disp.year}`,
    ['Ngày', 'Mã', 'Tài sản', 'Hình thức', 'Nguyên giá', 'Giá trị còn lại', 'Thu về', 'Lãi / lỗ', 'Đề xuất', 'Ghi chú'],
    disp.rows.map((x) => [x.date, x.code, x.name, METHODS[x.method], x.cost ?? '', x.book_value ?? '', x.proceeds ?? '', (x.proceeds ?? 0) - (x.book_value ?? 0), x.request_id || '', x.note || '']));
  return (
    <div className="page hr">
      <HrHero icon={Calculator} tone="violet" title="Khấu hao & thanh lý" subtitle="Bảng khấu hao đường thẳng theo tháng cho kế toán, sổ thanh lý tài sản theo năm" />
      <div className="hr-seg">
        <button className={cx('tone-violet', tab === 'dep' && 'active')} onClick={() => setTab('dep')}><i />Khấu hao theo tháng</button>
        <button className={cx('tone-red', tab === 'disp' && 'active')} onClick={() => setTab('disp')}><i />Thanh lý</button>
      </div>
      {tab === 'dep' && (depLoading && !dep ? <Spinner /> : dep && (
        <>
          <div className="hr-toolbar">
            <Field label="Kỳ"><input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value || thisMonth())} /></Field>
            <div className="grow" />
            {dep.rows.length > 0 && <button className="btn btn-sm" onClick={exportDep}><Download size={14} /> Xuất Excel</button>}
          </div>
          <div className="hr-kpis">
            <Kpi i={0} icon={Wallet} tone="blue" label="Nguyên giá" value={money(dep.totals.cost)} sub={`${dep.totals.count} tài sản tính khấu hao`} />
            <Kpi i={1} icon={TrendingDown} tone="violet" label={`Khấu hao tháng ${month.split('-').reverse().join('/')}`} value={money(dep.totals.in_month)} />
            <Kpi i={2} icon={Calculator} tone="amber" label="Khấu hao luỹ kế" value={money(dep.totals.accumulated)} />
            <Kpi i={3} icon={Wallet} tone="green" label="Giá trị còn lại" value={money(dep.totals.book_value)} />
          </div>
          {dep.missing_purchase_date > 0 && (
            <div className="as-alert"><AlertTriangle size={18} /><div className="grow"><b>{dep.missing_purchase_date} tài sản có nguyên giá nhưng chưa có ngày mua</b>
              <small className="block">Không tính được khấu hao — bổ sung ngày mua trong <Link to="/asset/list">Tài sản & công cụ</Link>.</small></div></div>
          )}
          <HrCard icon={Calculator} tone="violet" title="Theo loại tài sản" count={dep.by_type.length}>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Loại</th><th className="num">Số lượng</th><th className="num">Nguyên giá</th><th className="num">KH trong tháng</th><th className="num">KH luỹ kế</th><th className="num">Còn lại</th></tr></thead>
              <tbody>{dep.by_type.map((t) => (
                <tr key={t.type}><td>{t.type}</td><td className="num">{t.count}</td><td className="num">{money(t.cost)}</td><td className="num"><b>{money(t.in_month)}</b></td><td className="num">{money(t.accumulated)}</td><td className="num">{money(t.book_value)}</td></tr>
              ))}</tbody>
            </table></div>
          </HrCard>
          {!dep.rows.length ? <div className="hr-table-card"><Empty title="Không có tài sản tính khấu hao trong kỳ" /></div> : (
            <div className="hr-table-card hr-rise">
              <div className="table-wrap"><table className="table nowrap-cells">
                <thead><tr><th>Tài sản</th><th>Ngày mua</th><th className="num">Nguyên giá</th><th className="num">Đã KH</th><th className="num">Trong tháng</th><th className="num">Luỹ kế</th><th className="num">Còn lại</th></tr></thead>
                <tbody>{dep.rows.map((x) => (
                  <tr key={x.id}>
                    <td><Link to={`/asset/item/${x.id}`}><b>{x.name}</b></Link><small className="muted block"><span className="hr-code">{x.code}</span> {x.type || ''}</small></td>
                    <td>{fmtDate(x.purchase_date)}</td><td className="num">{money(x.price)}</td>
                    <td className="num">{x.months_used}/{x.depreciation_months}{x.fully && <small className="muted block">đã hết</small>}</td>
                    <td className="num"><b>{money(x.in_month)}</b></td><td className="num">{money(x.accumulated)}</td><td className="num">{money(x.book_value)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
          )}
        </>
      ))}
      {tab === 'disp' && (dispLoading && !disp ? <Spinner /> : disp && (
        <>
          <div className="hr-toolbar">
            <Field label="Năm"><input type="number" className="input" style={{ width: 110 }} value={year} onChange={(e) => setYear(e.target.value)} /></Field>
            <div className="grow" />
            {disp.rows.length > 0 && <button className="btn btn-sm" onClick={exportDisp}><Download size={14} /> Xuất Excel</button>}
          </div>
          <div className="hr-kpis">
            <Kpi i={0} icon={Recycle} tone="red" label="Tài sản đã thanh lý" value={disp.rows.length} />
            <Kpi i={1} icon={Wallet} tone="blue" label="Giá trị còn lại khi thanh lý" value={money(disp.rows.reduce((s, x) => s + (x.book_value || 0), 0))} />
            <Kpi i={2} icon={Wallet} tone="green" label="Thu về" value={money(disp.rows.reduce((s, x) => s + (x.proceeds || 0), 0))} />
          </div>
          {!disp.rows.length ? <div className="hr-table-card"><Empty icon={Recycle} title={`Chưa thanh lý tài sản nào trong năm ${disp.year}`}>Mở tài sản (đã thu hồi về công ty) → <b>Thanh lý</b>.</Empty></div> : (
            <div className="hr-table-card hr-rise">
              <div className="table-wrap"><table className="table nowrap-cells">
                <thead><tr><th>Ngày</th><th>Tài sản</th><th>Hình thức</th><th className="num">Còn lại</th><th className="num">Thu về</th><th className="num">Lãi / lỗ</th><th>Đề xuất</th></tr></thead>
                <tbody>{disp.rows.map((x) => {
                  const g = (x.proceeds ?? 0) - (x.book_value ?? 0);
                  return (
                    <tr key={x.id}>
                      <td>{fmtDate(x.date)}</td>
                      <td><Link to={`/asset/item/${x.asset_id}`}><b>{x.name}</b></Link><small className="muted block"><span className="hr-code">{x.code}</span>{x.note ? ` · ${x.note}` : ''}</small></td>
                      <td><Pill tone="gray">{METHODS[x.method]}</Pill></td>
                      <td className="num">{money(x.book_value)}</td><td className="num">{money(x.proceeds)}</td>
                      <td className={cx('num', g < 0 ? 'text-red' : 'text-green')}>{g < 0 ? '−' : '+'}{money(Math.abs(g))}</td>
                      <td>{x.request_id ? <Link to={`/request/${x.request_id}`}>#{x.request_id}</Link> : '—'}</td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            </div>
          )}
        </>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- trên trang đề xuất đã duyệt
const fieldMoney = (q) => {
  for (const f of q.fields || []) if (f.type === 'money' && q.data?.[f.key]) return Number(String(q.data[f.key]).replace(/[^\d]/g, '')) || '';
  return '';
};
export function RequestAssetCard({ q }) {
  const [meta] = useFetch(() => api.get('/asset/meta').catch(() => null), []);
  const manager = meta?.is_manager;
  const [links, reload] = useFetch(() => (manager ? api.get(`/asset/by-request/${q.id}`) : Promise.resolve(null)), [manager, q.id]);
  const [supplies] = useFetch(() => (manager ? api.get('/asset/supplies') : Promise.resolve(null)), [manager]);
  const [modal, setModal] = useState(null);
  if (!manager || q.status !== 'approved' || !links) return null;
  const any = links.assets.length || links.moves.length || links.disposals.length;
  return (
    <div className="card">
      <h3 className="card-title"><Link2 size={15} /> LDL Asset</h3>
      {links.assets.map((a) => <p key={a.id} className="small"><Link to={`/asset/item/${a.id}`}>{a.code}</Link> — {a.name}</p>)}
      {links.moves.map((m) => <p key={m.id} className="small">Cấp {m.qty} {m.unit} {m.item_name.toLowerCase()} → {m.to_name}</p>)}
      {links.disposals.map((d) => <p key={d.id} className="small">Thanh lý <Link to={`/asset/item/${d.asset_id}`}>{d.code}</Link></p>)}
      {!any && <p className="small muted">Ghi kết quả đề xuất đã duyệt vào sổ tài sản:</p>}
      <div className="row gap-sm wrap">
        <button className="btn btn-sm" onClick={() => setModal('asset')}><PackagePlus size={14} /> Tạo tài sản</button>
        {supplies?.items?.length > 0 && <button className="btn btn-sm" onClick={() => setModal('supply')}><Shirt size={14} /> Ghi phiếu cấp phát</button>}
      </div>
      {modal === 'asset' && (
        <AssetFormModal defaults={{ name: q.title, price: fieldMoney(q), request_id: q.id, note: `Theo đề xuất #${q.id}: ${q.title}` }}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />
      )}
      {modal === 'supply' && supplies && (
        <MoveModal kind="issue" data={supplies} note={`Theo đề xuất #${q.id}: ${q.title}`} requestId={q.id}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />
      )}
    </div>
  );
}
