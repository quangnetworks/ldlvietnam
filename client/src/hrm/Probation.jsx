/**
 * LDL HRM — thử việc theo Bộ luật Lao động 2019 (Điều 24–25): thời gian thử việc tự tính theo nhóm công việc,
 * đề xuất gia hạn (cấp quản lý / Quản lý nhân sự) và duyệt (Quản lý nhân sự), không vượt mức tối đa của luật.
 */
import { useState } from 'react';
import { Hourglass, CalendarClock, Check, X, Scale, Plus, Undo2, Wallet, AlertTriangle } from 'lucide-react';
import { api } from '../api.js';
import { useFetch, useToast } from '../context.jsx';
import { Field, Modal, Spinner } from '../components/ui.jsx';
import { HrCard, Pill } from './hrUi.jsx';
import { fmtDate, cx } from '../utils.js';

export const PROBATION_LEVELS = {
  manager: 'Người quản lý doanh nghiệp (≤ 180 ngày)',
  college: 'Chức danh cần trình độ cao đẳng trở lên (≤ 60 ngày)',
  intermediate: 'Trung cấp, công nhân kỹ thuật, nhân viên nghiệp vụ (≤ 30 ngày)',
  other: 'Công việc khác (≤ 6 ngày làm việc)',
};
const EXT_STATUS = { pending: ['amber', 'Chờ duyệt'], approved: ['green', 'Đã duyệt'], rejected: ['red', 'Từ chối'], cancelled: ['gray', 'Đã huỷ'] };
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

function ExtendModal({ userId, info, onClose, onDone }) {
  const toast = useToast();
  const cur = info.end || info.standard_end;
  const [f, setF] = useState({ new_end: info.legal_end || '', reason: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/hrm/employees/${userId}/probation-extensions`, f);
      toast('Đã gửi đề xuất gia hạn — chờ Quản lý nhân sự duyệt');
      onDone();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const add = f.new_end && cur ? dayDiff(cur, f.new_end) : 0;
  return (
    <Modal title="Đề xuất gia hạn thử việc" onClose={onClose} width={520}
      footer={<><button className="btn" onClick={onClose}>Huỷ</button><button className="btn btn-primary" disabled={busy || !f.new_end || !f.reason.trim() || add <= 0} onClick={save}>Gửi đề xuất</button></>}>
      <div className="hr-prob-law small"><Scale size={14} /> Tổng thời gian thử việc không vượt <b>{info.legal_days} {info.workdays ? 'ngày làm việc' : 'ngày'}</b> ({info.label}) — Điều 25 Bộ luật Lao động 2019.
        Hết thử việc chậm nhất <b>{fmtDate(info.legal_end)}</b>.</div>
      <div className="form-grid mt">
        <Field label="Hết thử việc hiện tại"><input className="input" value={fmtDate(cur)} disabled /></Field>
        <Field label="Gia hạn đến ngày" required hint={add > 0 ? `Thêm ${add} ngày` : ''}>
          <input className="input" type="date" min={cur} max={info.legal_end || undefined} value={f.new_end} onChange={(e) => setF({ ...f, new_end: e.target.value })} />
        </Field>
        <div className="span-2"><Field label="Lý do gia hạn" required>
          <textarea className="input" rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="VD: Cần thêm thời gian đánh giá kỹ năng bán hàng tại địa bàn mới" />
        </Field></div>
      </div>
    </Modal>
  );
}

/** Thẻ "Thử việc" trên hồ sơ nhân sự: thời gian, hạn theo luật, gia hạn & duyệt. */
export function ProbationPanel({ userId, onChanged }) {
  const toast = useToast();
  const [info, reload, loading] = useFetch(() => api.get(`/hrm/employees/${userId}/probation`), [userId]);
  const [extending, setExtending] = useState(false);
  if (loading && !info) return <HrCard icon={Hourglass} tone="amber" title="Thử việc"><Spinner /></HrCard>;
  if (!info || (info.work_status !== 'probation' && !info.extensions.length)) return null;
  const end = info.end || info.standard_end;
  const start = info.hire_date;
  const total = start && info.legal_end ? Math.max(1, dayDiff(start, info.legal_end) + 1) : 1;
  const pct = (d) => `${Math.min(100, Math.max(0, ((dayDiff(start, d) + 1) / total) * 100))}%`;
  const left = end ? dayDiff(today(), end) : null;
  const pending = info.extensions.find((x) => x.status === 'pending');
  const decide = async (x, action) => {
    const note = action === 'reject' ? window.prompt('Lý do từ chối gia hạn:') : '';
    if (action === 'reject' && !note) return;
    try {
      await api.post(`/hrm/probation-extensions/${x.id}/${action}`, { note });
      toast(action === 'approve' ? `Đã duyệt gia hạn đến ${fmtDate(x.new_end)}` : action === 'reject' ? 'Đã từ chối đề xuất' : 'Đã huỷ đề xuất');
      reload(); onChanged?.();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <HrCard icon={Hourglass} tone="amber" title="Thử việc"
      action={info.can_request && !pending && end && info.legal_end && end < info.legal_end && (
        <button className="btn btn-sm" onClick={() => setExtending(true)}><Plus size={14} /> Đề xuất gia hạn</button>)}>
      {info.work_status === 'probation' && start && (
        <>
          <div className="hr-prob-head">
            <span><small className="muted">Nhóm công việc</small><b>{info.label}</b></span>
            <span><small className="muted">Bắt đầu</small><b>{fmtDate(start)}</b></span>
            <span><small className="muted">Hết thử việc</small><b>{fmtDate(end)}</b></span>
            <span><small className="muted">Còn lại</small><b className={cx(left != null && left <= 7 && 'text-red')}>{left == null ? '—' : left < 0 ? `Quá hạn ${-left} ngày` : left === 0 ? 'Hôm nay' : `${left} ngày`}</b></span>
          </div>
          <div className="hr-prob-bar" role="img" aria-label={`Thử việc đến ${fmtDate(end)}, tối đa theo luật ${fmtDate(info.legal_end)}`}>
            <span className="std" style={{ width: pct(info.standard_end) }} />
            <span className="cur" style={{ width: pct(end) }} />
            <span className="now" style={{ left: pct(today()) }} title="Hôm nay" />
          </div>
          <div className="hr-prob-legend small muted">
            <span><i className="cur" /> Thời gian thử việc</span>
            <span><i className="std" /> Chuẩn công ty: {info.standard_days} {info.workdays ? 'ngày làm việc' : 'ngày'}</span>
            <span><Scale size={12} /> Tối đa theo luật: {info.legal_days} {info.workdays ? 'ngày làm việc' : 'ngày'} — đến {fmtDate(info.legal_end)}</span>
          </div>
          {end > info.legal_end
            ? <div className="hr-pay-alert mt-xs"><AlertTriangle size={15} /> Ngày hết thử việc vượt mức tối đa theo luật ({fmtDate(info.legal_end)}) — cần điều chỉnh lại trên hồ sơ.</div>
            : end === info.legal_end && <p className="small muted mt-xs">Đã đạt thời gian thử việc tối đa theo luật — không gia hạn thêm được.</p>}
        </>
      )}
      {info.extensions.length > 0 && (
        <div className="hr-prob-ext">
          <h4 className="hr-form-title"><CalendarClock size={14} /> Gia hạn thử việc</h4>
          {info.extensions.map((x) => (
            <div key={x.id} className="hr-prob-ext-row">
              <div className="grow">
                <div><b>{fmtDate(x.old_end)} → {fmtDate(x.new_end)}</b> <Pill tone={(EXT_STATUS[x.status] || ['gray'])[0]}>{(EXT_STATUS[x.status] || ['gray', x.status])[1]}</Pill></div>
                <small className="muted block">{x.requested_by_name} đề xuất {fmtDate(x.created_at)}: {x.reason}</small>
                {x.decided_by_name && <small className="muted block">{x.decided_by_name}{x.decision_note ? `: ${x.decision_note}` : ''}</small>}
              </div>
              {x.status === 'pending' && info.can_approve && (
                <div className="row gap-xs">
                  <button className="btn btn-sm btn-primary" onClick={() => decide(x, 'approve')}><Check size={14} /> Duyệt</button>
                  <button className="btn btn-sm" onClick={() => decide(x, 'reject')}><X size={14} /> Từ chối</button>
                </div>
              )}
              {x.status === 'pending' && !info.can_approve && info.can_request && (
                <button className="btn btn-sm" onClick={() => decide(x, 'cancel')}><Undo2 size={14} /> Huỷ đề xuất</button>
              )}
            </div>
          ))}
        </div>
      )}
      {extending && <ExtendModal userId={userId} info={info} onClose={() => setExtending(false)} onDone={() => { setExtending(false); reload(); }} />}
    </HrCard>
  );
}

/** Cài đặt HRM → Quy định thử việc: thời gian chuẩn của công ty (≤ luật) và nhóm công việc theo vị trí. */
export function ProbationSettings({ cat, setCat, onSave }) {
  const pol = cat.probation || { default_level: 'college', days: {}, by_position: {} };
  const levels = cat.probation_levels || {};
  const set = (next) => setCat({ ...cat, probation: { ...pol, ...next } });
  return (
    <HrCard icon={Hourglass} tone="amber" title="Quy định thử việc" i={3} action={<button className="btn btn-primary btn-sm" onClick={onSave}>Lưu</button>}>
      <p className="muted small"><Scale size={13} /> Theo Điều 24–25 Bộ luật Lao động 2019: mỗi công việc chỉ thử việc một lần, thời gian tối đa theo nhóm công việc.
        Thời gian chuẩn của công ty có thể ngắn hơn mức luật — phần chênh lệch là khoảng có thể duyệt gia hạn. Ngày hết thử việc được tự tính khi nhân sự ở trạng thái Thử việc.</p>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Nhóm công việc</th><th>Tối đa theo luật</th><th>Chuẩn công ty</th></tr></thead>
        <tbody>{Object.entries(levels).map(([k, L]) => (
          <tr key={k}>
            <td>{L.label}</td>
            <td>{L.max} {L.workdays ? 'ngày làm việc' : 'ngày'}</td>
            <td><input className="input input-sm hr-prob-days" type="number" min={1} max={L.max} value={pol.days?.[k] ?? L.max}
              onChange={(e) => set({ days: { ...pol.days, [k]: Math.min(L.max, Math.max(1, Number(e.target.value) || 1)) } })} aria-label={`Thời gian chuẩn: ${L.label}`} /></td>
          </tr>
        ))}</tbody>
      </table></div>
      <div className="form-grid mt">
        <Field label="Nhóm mặc định" hint="Dùng khi vị trí công việc chưa được xếp nhóm">
          <select className="input" value={pol.default_level} onChange={(e) => set({ default_level: e.target.value })}>
            {Object.entries(levels).map(([k, L]) => <option key={k} value={k}>{L.label}</option>)}
          </select>
        </Field>
      </div>
      <h4 className="hr-form-title">Nhóm công việc theo vị trí</h4>
      <div className="hr-prob-map">
        {(cat.positions || []).map((pos) => (
          <label key={pos} className="hr-prob-map-row">
            <span className="grow">{pos}</span>
            <select className="input input-sm" value={pol.by_position?.[pos] || ''} onChange={(e) => {
              const by = { ...pol.by_position };
              if (e.target.value) by[pos] = e.target.value; else delete by[pos];
              set({ by_position: by });
            }}>
              <option value="">— Theo nhóm mặc định —</option>
              {Object.entries(levels).map(([k, L]) => <option key={k} value={k}>{L.label}</option>)}
            </select>
          </label>
        ))}
      </div>
    </HrCard>
  );
}

export const PAYROLL_FIELDS = { id_number: 'Số CCCD', tax_code: 'Mã số thuế TNCN', bank_account: 'Tài khoản ngân hàng', insurance_number: 'Số sổ BHXH' };

/** Hồ sơ nhận lương: nhân sự tự bổ sung CCCD, mã số thuế, tài khoản ngân hàng, sổ BHXH (Quản lý nhân sự được thông báo). */
export function PayrollSelfCard({ e, onSaved }) {
  const toast = useToast();
  const keys = ['id_number', 'id_issue_date', 'id_issue_place', 'tax_code', 'bank_account', ...(e.engagement === 'collaborator' ? [] : ['insurance_number'])];
  const [f, setF] = useState(() => Object.fromEntries(keys.map((k) => [k, e[k] || ''])));
  const [busy, setBusy] = useState(false);
  const missing = e.payroll_missing || [];
  const dirty = keys.some((k) => (f[k] || '') !== (e[k] || ''));
  const save = async () => {
    setBusy(true);
    try {
      const body = Object.fromEntries(keys.filter((k) => (f[k] || '') !== (e[k] || '')).map((k) => [k, f[k]]));
      await api.put('/hrm/me/payroll', body);
      toast('Đã cập nhật hồ sơ nhận lương — phòng Nhân sự đã được thông báo');
      onSaved?.();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const L = { ...PAYROLL_FIELDS, id_issue_date: 'Ngày cấp CCCD', id_issue_place: 'Nơi cấp' };
  return (
    <HrCard icon={Wallet} tone={missing.length ? 'red' : 'green'} title="Hồ sơ nhận lương"
      action={dirty && <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>Lưu</button>}>
      {missing.length > 0
        ? <div className="hr-pay-alert"><AlertTriangle size={15} /> Bổ sung để nhận lương: <b>{missing.map((k) => PAYROLL_FIELDS[k]).join(', ')}</b></div>
        : <p className="muted small">Hồ sơ nhận lương đã đủ thông tin.</p>}
      <div className="hr-field-grid">
        {keys.map((k) => (
          <Field key={k} label={L[k]}>
            <input className={cx('input', missing.includes(k) && 'hr-missing')} type={k === 'id_issue_date' ? 'date' : 'text'} value={f[k]}
              inputMode={['id_number', 'tax_code'].includes(k) ? 'numeric' : undefined}
              placeholder={{ id_number: '12 chữ số', tax_code: '10 chữ số (hoặc số CCCD)', bank_account: 'VD: Vietcombank 0011001234567 – Chi nhánh …', insurance_number: '10 chữ số' }[k] || ''}
              onChange={(ev) => setF({ ...f, [k]: ev.target.value })} />
          </Field>
        ))}
      </div>
    </HrCard>
  );
}
