/**
 * LDL HRM — thêm trực tiếp một nhân sự (tạo tài khoản đăng nhập + hồ sơ), theo hình thức hợp tác:
 *  - Nhân viên: hợp đồng lao động (có thể nhập luôn hợp đồng đầu tiên)
 *  - Cộng tác viên: thỏa thuận hợp tác, hưởng % theo thỏa thuận (thay cho hợp đồng lao động)
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Handshake, KeyRound, Copy, Check, RefreshCw, UserPlus, Percent, RotateCcw } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Field, Modal, UserPicker } from '../components/ui.jsx';
import { cx } from '../utils.js';

export const ENGAGEMENT = { employee: 'Nhân viên', collaborator: 'Cộng tác viên' };
export const PAYMENT_CYCLES = { monthly: 'Hàng tháng', quarterly: 'Hàng quý', per_deal: 'Theo từng giao dịch' };
export const fmtRate = (v) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`);

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
/** "Trần Văn An" → "an.tran" (tên.họ), gợi ý cho ô tài khoản. */
const suggestUsername = (name) => {
  const w = fold(name).replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  return w.length > 1 ? `${w[w.length - 1]}.${w[0]}` : w[0] || '';
};
const randomPassword = () => {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = crypto.getRandomValues(new Uint8Array(8));
  return [...b].map((x) => abc[x % abc.length]).join('');
};

const INDENT = { national: '', region: '— ', area: '—— ', province: '——— ' };
/** Địa bàn theo thứ tự cây (toàn quốc → miền → khu vực → tỉnh). */
function territoryTree(list) {
  const out = [];
  const walk = (pid) => list.filter((t) => (t.parent_id ?? null) === pid).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)).forEach((t) => { out.push(t); walk(t.id); });
  walk(null);
  return out;
}

/** Các ô của thỏa thuận hợp tác (dùng chung cho thêm cộng tác viên, quay lại làm cộng tác viên và Thêm / sửa thỏa thuận). */
export function AgreementFields({ f, set, cat, territoryRequired }) {
  const [sales] = useFetch(() => api.get('/sales/structure'), []);
  return (
    <>
      <div className="span-2">
        <Field label="Khu vực cộng tác" required={territoryRequired} hint="Miền / khu vực / tỉnh do công ty quy định (theo Cơ cấu kinh doanh)">
          <select className="input" value={f.territory_id || ''} onChange={set('territory_id')}>
            <option value="">{territoryRequired ? '— Chọn khu vực —' : '— Không giới hạn khu vực —'}</option>
            {territoryTree(sales?.territories || []).map((t) => <option key={t.id} value={t.id}>{INDENT[t.level] || ''}{t.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Tỷ lệ hưởng (%)" required hint="Theo thỏa thuận, VD 5 hoặc 7,5">
        <div className="hr-rate-input">
          <input className="input" inputMode="decimal" value={f.commission_rate ?? ''} placeholder="VD: 5"
            onChange={(e) => set('commission_rate')(e.target.value.replace(/[^\d.,]/g, ''))} />
          <Percent size={14} />
        </div>
      </Field>
      <Field label="Cơ sở tính" hint="Tỷ lệ % được tính trên">
        <input className="input" list="hr-collab-bases" value={f.commission_basis || ''} onChange={set('commission_basis')} placeholder="VD: Doanh số bán hàng" />
        <datalist id="hr-collab-bases">{(cat?.collab_bases || []).map((o) => <option key={o} value={o} />)}</datalist>
      </Field>
      <Field label="Kỳ thanh toán">
        <select className="input" value={f.payment_cycle || ''} onChange={set('payment_cycle')}>
          <option value="">— Chọn —</option>
          {Object.entries(PAYMENT_CYCLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <div className="span-2">
        <Field label="Phạm vi / nội dung hợp tác">
          <textarea className="input" rows={2} value={f.scope || ''} onChange={set('scope')} placeholder="VD: Giới thiệu khách hàng, bán hàng khu vực Hà Nội; điều kiện thanh toán…" />
        </Field>
      </div>
    </>
  );
}

export default function AddEmployeeModal({ cat, onClose, onCreated }) {
  const { departments, users } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    engagement: 'employee', name: '', username: '', password: randomPassword(), employee_code: '', email: '', phone: '', birthday: '', gender: '',
    title: '', department_id: '', office: '', job_position: '', employee_type: '', manager_id: null, hire_date: today, work_status: 'probation',
  });
  const [a, setA] = useState({ contract_type: '', code: '', end_date: '', salary: '', commission_rate: '', commission_basis: '', payment_cycle: 'monthly', scope: '' });
  const [userTouched, setUserTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [copied, setCopied] = useState(false);
  const collab = f.engagement === 'collaborator';
  const set = (k) => (e) => {
    const v = e?.target ? e.target.value : e;
    setF((x) => ({ ...x, [k]: v, ...(k === 'name' && !userTouched ? { username: suggestUsername(v) } : {}) }));
  };
  const setAg = (k) => (e) => setA((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const ok = f.name.trim() && /^[\w.@-]{2,64}$/.test(f.username) && f.password.length >= 6 && (!collab || Number(String(a.commission_rate).replace(',', '.')) > 0);

  const save = async () => {
    setBusy(true);
    try {
      const agreement = collab
        ? { code: a.code, start_date: f.hire_date, end_date: a.end_date, territory_id: a.territory_id, commission_rate: a.commission_rate, commission_basis: a.commission_basis, payment_cycle: a.payment_cycle, scope: a.scope }
        : a.contract_type ? { contract_type: a.contract_type, code: a.code, start_date: f.hire_date, end_date: a.end_date, salary: a.salary } : null;
      const r = await api.post('/hrm/employees', { ...f, work_status: collab ? 'working' : f.work_status, agreement });
      setDone(r);
      onCreated?.(r);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  if (done) {
    const creds = `Tài khoản: ${done.username}\nMật khẩu: ${f.password}\nĐăng nhập: ${window.location.origin}`;
    return (
      <Modal title="Đã thêm nhân sự" onClose={onClose} width={480}
        footer={<><button className="btn" onClick={onClose}>Đóng</button><button className="btn btn-primary" onClick={() => navigate(`/hrm/employees/${done.id}`)}>Mở hồ sơ</button></>}>
        <div className="hr-added">
          <span className={cx('hr-added-icon', collab && 'collab')}>{collab ? <Handshake size={22} /> : <UserPlus size={22} />}</span>
          <b>{done.name}</b>
          <span className="muted small">{collab ? `Cộng tác viên · hưởng ${fmtRate(done.commission_rate)}${done.commission_basis ? ` ${done.commission_basis.toLowerCase()}` : ''}` : 'Nhân viên'}</span>
        </div>
        <div className="hr-creds">
          <div><span className="muted small">Tài khoản</span><b>{done.username}</b></div>
          <div><span className="muted small">Mật khẩu</span><b>{f.password}</b></div>
        </div>
        <button className="btn btn-sm mt" onClick={async () => { try { await navigator.clipboard.writeText(creds); setCopied(true); } catch { toast('Không sao chép được', 'error'); } }}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Đã sao chép' : 'Sao chép thông tin đăng nhập'}
        </button>
        <p className="muted small mt">Gửi thông tin này cho {done.name}. Nên đổi mật khẩu ở lần đăng nhập đầu tiên.</p>
      </Modal>
    );
  }

  return (
    <Modal title="Thêm nhân sự" onClose={onClose} width={720} className="hr-add-modal"
      footer={<><button className="btn" onClick={onClose}>Huỷ</button>
        <button className="btn btn-primary" disabled={busy || !ok} onClick={save}><UserPlus size={15} /> {collab ? 'Thêm cộng tác viên' : 'Thêm nhân sự'}</button></>}>
      <div className="hr-engage" role="radiogroup" aria-label="Hình thức hợp tác">
        {[['employee', Briefcase, 'Nhân viên', 'Ký hợp đồng lao động, hưởng lương'], ['collaborator', Handshake, 'Cộng tác viên', 'Thỏa thuận hợp tác, hưởng % theo thỏa thuận']].map(([k, Icon, l, d]) => (
          <button key={k} type="button" role="radio" aria-checked={f.engagement === k} className={cx('hr-engage-opt', k, f.engagement === k && 'active')} onClick={() => set('engagement')(k)}>
            <span className="hr-engage-icon"><Icon size={18} /></span>
            <span><b>{l}</b><small>{d}</small></span>
          </button>
        ))}
      </div>

      <h4 className="hr-form-title">Thông tin cá nhân</h4>
      <div className="form-grid">
        <div className="span-2"><Field label="Họ và tên" required><input className="input" autoFocus value={f.name} onChange={set('name')} placeholder="VD: Trần Văn An" /></Field></div>
        <Field label="Điện thoại"><input className="input" inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Ngày sinh"><input className="input" type="date" value={f.birthday} onChange={set('birthday')} /></Field>
        <Field label="Giới tính">
          <select className="input" value={f.gender} onChange={set('gender')}><option value="">—</option>{['Nam', 'Nữ', 'Khác'].map((g) => <option key={g}>{g}</option>)}</select>
        </Field>
      </div>

      <h4 className="hr-form-title"><KeyRound size={14} /> Tài khoản đăng nhập LDL</h4>
      <div className="form-grid">
        <Field label="Tài khoản" required hint="Chữ không dấu, số, . _ - @">
          <input className="input" value={f.username} onChange={(e) => { setUserTouched(true); set('username')(e.target.value.trim().toLowerCase()); }} placeholder="VD: an.tran" />
        </Field>
        <Field label="Mật khẩu" required hint="Ít nhất 6 ký tự">
          <div className="row gap-xs">
            <input className="input grow" value={f.password} onChange={set('password')} />
            <button type="button" className="icon-btn" title="Tạo mật khẩu khác" aria-label="Tạo mật khẩu khác" onClick={() => set('password')(randomPassword())}><RefreshCw size={15} /></button>
          </div>
        </Field>
      </div>

      <h4 className="hr-form-title">Công việc</h4>
      <div className="form-grid">
        <Field label="Mã nhân viên"><input className="input" value={f.employee_code} onChange={set('employee_code')} placeholder={collab ? 'VD: CTV001' : 'VD: LDL120'} /></Field>
        <Field label="Chức danh"><input className="input" value={f.title} onChange={set('title')} placeholder={collab ? 'VD: Cộng tác viên kinh doanh' : ''} /></Field>
        <Field label="Phòng ban">
          <select className="input" value={f.department_id} onChange={set('department_id')}>
            <option value="">— Chưa có phòng ban —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Văn phòng">
          <select className="input" value={f.office} onChange={set('office')}><option value="">—</option>{(cat?.offices || []).map((o) => <option key={o}>{o}</option>)}</select>
        </Field>
        <Field label="Vị trí công việc">
          <select className="input" value={f.job_position} onChange={set('job_position')}><option value="">—</option>{(cat?.positions || []).map((o) => <option key={o}>{o}</option>)}</select>
        </Field>
        <Field label="Phân loại nhân sự" hint={collab ? 'Để trống: Cộng tác viên' : ''}>
          <select className="input" value={f.employee_type} onChange={set('employee_type')}><option value="">—</option>{(cat?.employee_types || []).map((o) => <option key={o}>{o}</option>)}</select>
        </Field>
        <Field label={collab ? 'Ngày bắt đầu hợp tác' : 'Ngày bắt đầu'}><input className="input" type="date" value={f.hire_date} onChange={set('hire_date')} /></Field>
        {!collab && (
          <Field label="Trạng thái">
            <select className="input" value={f.work_status} onChange={set('work_status')}><option value="probation">Thử việc</option><option value="working">Chính thức</option></select>
          </Field>
        )}
        <div className="span-2"><Field label={collab ? 'Người phụ trách / quản lý trực tiếp' : 'Quản lý trực tiếp'}>
          <UserPicker users={users.filter((u) => u.role !== 'guest')} value={f.manager_id} onChange={set('manager_id')} placeholder="Chọn người" />
        </Field></div>
      </div>

      {collab ? (
        <section className="hr-agree-box collab">
          <h4 className="hr-form-title"><Handshake size={14} /> Thỏa thuận hợp tác</h4>
          <p className="muted small">Cộng tác viên không ký hợp đồng lao động; quyền lợi theo tỷ lệ % đã thỏa thuận.</p>
          <div className="form-grid">
            <AgreementFields f={a} set={setAg} cat={cat} />
            <Field label="Số thỏa thuận"><input className="input" value={a.code} onChange={setAg('code')} placeholder="VD: 05/2026/TTHT" /></Field>
            <Field label="Ngày kết thúc" hint="Để trống: không thời hạn"><input className="input" type="date" value={a.end_date} onChange={setAg('end_date')} /></Field>
          </div>
        </section>
      ) : (
        <section className="hr-agree-box">
          <h4 className="hr-form-title"><Briefcase size={14} /> Hợp đồng lao động <small className="muted">(có thể thêm sau)</small></h4>
          <div className="form-grid">
            <Field label="Loại hợp đồng">
              <select className="input" value={a.contract_type} onChange={setAg('contract_type')}>
                <option value="">— Chưa có hợp đồng —</option>
                {(cat?.contract_types || []).map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            {a.contract_type && (
              <>
                <Field label="Số hợp đồng"><input className="input" value={a.code} onChange={setAg('code')} placeholder="VD: 12/2026/HĐLĐ" /></Field>
                <Field label="Ngày kết thúc" hint="Để trống: không xác định thời hạn"><input className="input" type="date" value={a.end_date} onChange={setAg('end_date')} /></Field>
                <Field label="Mức lương (VNĐ)">
                  <input className="input" inputMode="numeric" value={a.salary === '' ? '' : Number(a.salary).toLocaleString('vi-VN')} onChange={(e) => setAg('salary')(e.target.value.replace(/\D/g, ''))} />
                </Field>
              </>
            )}
          </div>
        </section>
      )}
    </Modal>
  );
}

/**
 * Nhân sự đã nghỉ việc quay lại làm cộng tác viên cho một khu vực công ty quy định:
 * mở lại tài khoản, thêm thỏa thuận hợp tác hưởng %, giữ nguyên hồ sơ và lịch sử cũ.
 */
export function RejoinModal({ person, cat, onClose, onDone }) {
  const { users } = useApp();
  const toast = useToast();
  const [f, setF] = useState({ start_date: new Date().toISOString().slice(0, 10), territory_id: '', commission_rate: '', commission_basis: '', payment_cycle: 'monthly',
    scope: '', code: '', end_date: '', title: '', manager_id: person.manager_id || null, note: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const ok = f.territory_id && Number(String(f.commission_rate).replace(',', '.')) > 0;
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/hrm/employees/${person.id}/rejoin`, f);
      toast(`${person.name} đã quay lại làm cộng tác viên khu vực ${r.collab_territory} — tài khoản đã được mở lại`);
      onDone(r);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Quay lại làm cộng tác viên" onClose={onClose} width={640}
      footer={<><button className="btn" onClick={onClose}>Huỷ</button><button className="btn btn-primary" disabled={busy || !ok} onClick={save}><RotateCcw size={15} /> Xác nhận quay lại</button></>}>
      <div className="hr-rejoin-head">
        <span className="hr-engage-icon"><Handshake size={18} /></span>
        <span><b>{person.name}</b><small className="muted block">Nhân sự cũ{person.resign_date ? ` · nghỉ việc từ ${new Date(`${person.resign_date}T00:00:00`).toLocaleDateString('vi-VN')}` : ''}</small></span>
      </div>
      <ul className="hr-rejoin-notes muted small">
        <li>Tài khoản LDL được mở lại, đăng nhập bằng mật khẩu cũ.</li>
        <li>Hồ sơ chuyển sang <b>Cộng tác viên</b>; hợp đồng, giấy tờ và lịch sử công tác trước đây được giữ nguyên.</li>
        <li>Lịch sử công tác ghi nhận "Quay lại làm việc".</li>
      </ul>
      <div className="form-grid">
        <Field label="Ngày bắt đầu hợp tác" required><input className="input" type="date" value={f.start_date} onChange={set('start_date')} /></Field>
        <Field label="Chức danh mới" hint="Để trống: giữ chức danh cũ"><input className="input" value={f.title} onChange={set('title')} placeholder="VD: Cộng tác viên kinh doanh" /></Field>
        <AgreementFields f={f} set={set} cat={cat} territoryRequired />
        <Field label="Số thỏa thuận"><input className="input" value={f.code} onChange={set('code')} placeholder="VD: 05/2026/TTHT" /></Field>
        <Field label="Ngày kết thúc" hint="Để trống: không thời hạn"><input className="input" type="date" value={f.end_date} onChange={set('end_date')} /></Field>
        <div className="span-2"><Field label="Người phụ trách / quản lý trực tiếp">
          <UserPicker users={users.filter((u) => u.role !== 'guest' && u.id !== person.id)} value={f.manager_id} onChange={set('manager_id')} placeholder="Chọn người" />
        </Field></div>
      </div>
    </Modal>
  );
}
