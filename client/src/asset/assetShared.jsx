/** LDL Asset — dùng chung: danh mục, nhãn trạng thái, biểu mẫu tài sản, lập biên bản bàn giao / thu hồi. */
import { useEffect, useMemo, useState } from 'react';
import { Search, PackagePlus, PackageMinus } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Modal, Field, UserPicker, Spinner } from '../components/ui.jsx';
import { Pill } from '../hrm/hrUi.jsx';
import { cx } from '../utils.js';

export const STATUS_TONE = { available: 'green', in_use: 'blue', maintenance: 'amber', broken: 'red', lost: 'orange', disposed: 'gray' };
export const STATUS_LABEL = {
  available: 'Sẵn sàng', in_use: 'Đang sử dụng', maintenance: 'Bảo trì / sửa chữa', broken: 'Hỏng', lost: 'Mất', disposed: 'Đã thanh lý',
};
export const CONDITION_LABEL = { new: 'Mới', good: 'Tốt', fair: 'Trung bình', poor: 'Kém', broken: 'Hỏng' };
export const REASON_LABEL = { onboard: 'Nhận việc', offboard: 'Nghỉ việc', transfer: 'Điều chuyển', adhoc: 'Cấp phát / thu hồi thường xuyên' };
export const HANDOVER_STATUS = { pending: ['Chờ xác nhận', 'amber'], confirmed: ['Đã xác nhận', 'green'], cancelled: ['Đã huỷ', 'gray'] };

export const money = (v) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString('vi-VN')} ₫`);
export const moneyShort = (v) => {
  const n = Number(v) || 0;
  if (n >= 1e9) return `${(n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tỷ`;
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr`;
  return n.toLocaleString('vi-VN');
};

export function AssetStatus({ status }) {
  return <Pill tone={STATUS_TONE[status] || 'gray'}>{STATUS_LABEL[status] || status}</Pill>;
}
export function HandoverStatus({ status }) {
  const [label, tone] = HANDOVER_STATUS[status] || [status, 'gray'];
  return <Pill tone={tone}>{label}</Pill>;
}
export function KindPill({ kind }) {
  return kind === 'issue' ? <Pill tone="blue">Bàn giao</Pill> : <Pill tone="violet">Thu hồi</Pill>;
}

export function useAssetMeta() {
  const [meta, reload] = useFetch(() => api.get('/asset/meta'), []);
  return [meta, reload];
}

const moneyInput = (value, onChange) => (
  <input className="input" inputMode="numeric" value={value === '' || value == null ? '' : Number(String(value).replace(/\D/g, '') || 0).toLocaleString('vi-VN')}
    onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} />
);

/** Tạo / sửa tài sản. Tạo mới: số lượng (tạo nhiều đơn vị, mã tự sinh theo loại) và giao ngay cho một người (tuỳ chọn). */
export function AssetFormModal({ asset, onClose, onSaved }) {
  const { users } = useApp();
  const toast = useToast();
  const [meta] = useAssetMeta();
  const [f, setF] = useState(() => ({
    name: '', code: '', type: '', kind: 'asset', serial: '', location: '', supplier: '', purchase_date: '', price: '', depreciation_months: '',
    warranty_until: '', condition: 'new', note: '', quantity: 1, holder_id: null, ...(asset || {}),
  }));
  const [busy, setBusy] = useState(false);
  const types = meta?.settings.types || [];
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const pickType = (name) => {
    const t = types.find((x) => x.name === name);
    setF({ ...f, type: name, kind: t?.kind || f.kind, depreciation_months: t?.depreciation_months ?? f.depreciation_months });
  };
  const save = async () => {
    setBusy(true);
    try {
      const r = asset ? await api.put(`/assets/${asset.id}`, f) : await api.post('/assets', f);
      toast(asset ? 'Đã cập nhật tài sản' : `Đã tạo ${r.items.length} tài sản: ${r.items.map((x) => x.code).join(', ')}`);
      onSaved(r);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const list = (k) => [...new Set([...(meta?.settings[k] || []), ...(f[k === 'locations' ? 'location' : 'supplier'] ? [f[k === 'locations' ? 'location' : 'supplier']] : [])])];
  return (
    <Modal title={asset ? `Sửa tài sản ${asset.code}` : 'Thêm tài sản / công cụ'} onClose={onClose} width={720}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" disabled={busy || !f.name.trim()} onClick={save}>Lưu</button></>}>
      {!meta ? <Spinner /> : (
        <div className="form-grid">
          <div className="span-2"><Field label="Tên tài sản" required><input className="input" autoFocus value={f.name} onChange={set('name')} placeholder="VD: Laptop Dell Latitude 5440" /></Field></div>
          <Field label="Loại tài sản">
            <select className="input" value={f.type || ''} onChange={(e) => pickType(e.target.value)}>
              <option value="">— Chọn loại —</option>
              {[...new Set([...types.map((t) => t.name), ...(f.type ? [f.type] : [])])].map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Phân loại">
            <select className="input" value={f.kind} onChange={set('kind')}><option value="asset">Tài sản cố định</option><option value="tool">Công cụ dụng cụ</option></select>
          </Field>
          <Field label="Mã tài sản" hint={asset ? undefined : 'Để trống: tự sinh theo loại (VD: LAP-0005)'}>
            <input className="input" value={f.code || ''} onChange={set('code')} disabled={!asset && Number(f.quantity) > 1} />
          </Field>
          <Field label="Số serial / IMEI"><input className="input" value={f.serial || ''} onChange={set('serial')} /></Field>
          <Field label="Địa điểm">
            <input className="input" list="asset-locations" value={f.location || ''} onChange={set('location')} />
            <datalist id="asset-locations">{list('locations').map((x) => <option key={x} value={x} />)}</datalist>
          </Field>
          <Field label="Nhà cung cấp">
            <input className="input" list="asset-suppliers" value={f.supplier || ''} onChange={set('supplier')} />
            <datalist id="asset-suppliers">{list('suppliers').map((x) => <option key={x} value={x} />)}</datalist>
          </Field>
          <Field label="Ngày mua"><input className="input" type="date" value={f.purchase_date || ''} onChange={set('purchase_date')} /></Field>
          <Field label="Nguyên giá (VNĐ)">{moneyInput(f.price, set('price'))}</Field>
          <Field label="Khấu hao (tháng)" hint="Để trống nếu không khấu hao"><input className="input" type="number" min="1" value={f.depreciation_months || ''} onChange={set('depreciation_months')} /></Field>
          <Field label="Bảo hành đến"><input className="input" type="date" value={f.warranty_until || ''} onChange={set('warranty_until')} /></Field>
          <Field label="Tình trạng">
            <select className="input" value={f.condition} onChange={set('condition')}>{Object.entries(CONDITION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
          {!asset && <Field label="Số lượng" hint="Tạo nhiều đơn vị giống nhau, mỗi đơn vị một mã"><input className="input" type="number" min="1" max="200" value={f.quantity} onChange={set('quantity')} /></Field>}
          {!asset && (
            <div className="span-2"><Field label="Giao ngay cho" hint="Tuỳ chọn — hệ thống lập biên bản bàn giao và gửi nhân viên xác nhận">
              <UserPicker users={users} value={f.holder_id} onChange={set('holder_id')} placeholder="Chưa giao (để trong kho)" />
            </Field></div>
          )}
          <div className="span-2"><Field label="Ghi chú"><textarea className="input" rows={2} value={f.note || ''} onChange={set('note')} /></Field></div>
        </div>
      )}
    </Modal>
  );
}

/**
 * Lập biên bản bàn giao (issue) hoặc thu hồi (return) cho một nhân viên.
 * Bàn giao: chọn trong các tài sản đang sẵn sàng; thu hồi: chọn trong tài sản nhân viên đang giữ (mặc định chọn hết).
 */
export function HandoverModal({ kind: kind0 = 'issue', employeeId, assetIds, reason: reason0, procedureId, lockKind, onClose, onSaved }) {
  const { users } = useApp();
  const toast = useToast();
  const [kind, setKind] = useState(kind0);
  const [emp, setEmp] = useState(employeeId || null);
  const [reason, setReason] = useState(reason0 || 'adhoc');
  const [note, setNote] = useState('');
  const [paper, setPaper] = useState(false);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(assetIds || []);
  const [items, setItems] = useState({});
  const [busy, setBusy] = useState(false);
  const [pool, , loading] = useFetch(() => (kind === 'issue' ? api.get('/assets', { status: 'available' })
    : emp ? api.get('/assets', { holder_id: emp }) : Promise.resolve([])), [kind, emp]);
  useEffect(() => {
    if (kind === 'return' && pool && !assetIds) setPicked(pool.map((a) => a.id)); // thu hồi: mặc định chọn tất cả
    if (kind === 'issue' && !assetIds) setPicked([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, kind]);
  const shown = useMemo(() => (pool || []).filter((a) => !q || `${a.code} ${a.name} ${a.type || ''} ${a.serial || ''}`.toLowerCase().includes(q.toLowerCase())), [pool, q]);
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const save = async () => {
    setBusy(true);
    try {
      const h = await api.post('/asset/handovers', { kind, employee_id: emp, asset_ids: picked, items, reason, note, procedure_id: procedureId, auto_confirm: paper });
      toast(`Đã lập biên bản ${h.code}${paper ? '' : ' — đã gửi nhân viên xác nhận'}`);
      onSaved(h);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title={kind === 'issue' ? 'Lập biên bản bàn giao tài sản' : 'Lập biên bản thu hồi tài sản'} onClose={onClose} width={760}
      footer={<><small className="muted grow">{picked.length} tài sản được chọn</small><button className="btn" onClick={onClose}>Hủy</button>
        <button className="btn btn-primary" disabled={busy || !emp || !picked.length} onClick={save}>{kind === 'issue' ? 'Bàn giao' : 'Thu hồi'} {picked.length} tài sản</button></>}>
      {!lockKind && (
        <div className="hr-seg">
          <button className={cx('tone-blue', kind === 'issue' && 'active')} onClick={() => setKind('issue')}><PackagePlus size={15} /> Bàn giao (cấp phát)</button>
          <button className={cx('tone-violet', kind === 'return' && 'active')} onClick={() => setKind('return')}><PackageMinus size={15} /> Thu hồi</button>
        </div>
      )}
      <div className="form-grid">
        <Field label={kind === 'issue' ? 'Bàn giao cho' : 'Thu hồi từ'} required>
          <UserPicker users={users} value={emp} onChange={(v) => { setEmp(v); if (kind === 'return') setPicked([]); }} placeholder="Chọn nhân viên" />
        </Field>
        <Field label="Lý do">
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>{Object.entries(REASON_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
      </div>
      <div className="ww-search mv-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Lọc theo mã, tên, loại, serial" /></div>
      <div className="as-pick">
        {loading && !pool ? <Spinner /> : !shown.length ? (
          <p className="muted small">{kind === 'issue' ? 'Không có tài sản sẵn sàng trong kho.' : emp ? 'Nhân viên không giữ tài sản nào.' : 'Chọn nhân viên để xem tài sản đang giữ.'}</p>
        ) : shown.map((a) => {
          const on = picked.includes(a.id);
          return (
            <div key={a.id} className={cx('as-pick-row', on && 'on')}>
              <label className="as-pick-main">
                <input type="checkbox" checked={on} onChange={() => toggle(a.id)} />
                <span className="hr-code">{a.code}</span>
                <span className="grow ellipsis"><b>{a.name}</b><small className="muted block">{a.type || '—'}{a.serial ? ` · ${a.serial}` : ''}{a.location ? ` · ${a.location}` : ''}</small></span>
              </label>
              {on && (
                <select className="input input-sm" value={items[a.id]?.condition || a.condition} aria-label="Tình trạng"
                  onChange={(e) => setItems({ ...items, [a.id]: { ...items[a.id], condition: e.target.value } })}>
                  {Object.entries(CONDITION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              )}
            </div>
          );
        })}
      </div>
      <Field label="Ghi chú biên bản"><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Kèm sạc, túi chống sốc" /></Field>
      <label className="check"><input type="checkbox" checked={paper} onChange={(e) => setPaper(e.target.checked)} /> Đã ký biên bản giấy — ghi nhận luôn là đã xác nhận (không cần nhân viên xác nhận trên hệ thống)</label>
    </Modal>
  );
}
