import { UserPicker } from '../components/ui.jsx';
import { fmtDate } from '../utils.js';

export const FIELD_TYPES = [
  { value: 'text', label: 'Văn bản ngắn' },
  { value: 'textarea', label: 'Đoạn văn' },
  { value: 'number', label: 'Số' },
  { value: 'money', label: 'Số tiền (VNĐ)' },
  { value: 'date', label: 'Ngày' },
  { value: 'select', label: 'Danh sách chọn' },
  { value: 'checkbox', label: 'Ô tích (Có/Không)' },
  { value: 'user', label: 'Nhân sự' },
];

export const STATUS = {
  draft: { label: 'Lưu nháp', cls: 'badge-gray' },
  pending: { label: 'Chờ duyệt', cls: 'badge-orange' },
  approved: { label: 'Đã chấp thuận', cls: 'badge-green' },
  rejected: { label: 'Đã từ chối', cls: 'badge-red' },
  returned: { label: 'Đã trả lại', cls: 'badge-purple' },
  cancelled: { label: 'Đã huỷ', cls: 'badge-gray' },
};

export const formatMoney = (v) => (v === '' || v === null || v === undefined ? '' : `${Number(v).toLocaleString('vi-VN')} ₫`);

export function FieldInput({ field, value, onChange, users }) {
  const common = { className: 'input', value: value ?? '', onChange: (e) => onChange(e.target.value) };
  switch (field.type) {
    case 'textarea': return <textarea rows={3} {...common} />;
    case 'number': return <input type="number" step="any" {...common} />;
    case 'money': return (
      <input className="input" inputMode="numeric" value={value === undefined || value === '' ? '' : Number(String(value).replace(/\D/g, '') || 0).toLocaleString('vi-VN')}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} placeholder="0" />
    );
    case 'date': return <input type="date" {...common} />;
    case 'select': return (
      <select {...common}><option value="">— Chọn —</option>{(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
    );
    case 'checkbox': return <label className="check"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> Có</label>;
    case 'user': return <UserPicker users={users} value={value ? Number(value) : null} onChange={onChange} placeholder="Chọn nhân sự" />;
    default: return <input {...common} />;
  }
}

export function fieldDisplay(field, value, usersById = {}) {
  if (value === undefined || value === null || value === '') return '—';
  switch (field.type) {
    case 'money': return formatMoney(value);
    case 'number': return Number(value).toLocaleString('vi-VN');
    case 'date': return fmtDate(value);
    case 'checkbox': return value ? 'Có' : 'Không';
    case 'user': return usersById[value] || `#${value}`;
    default: return String(value);
  }
}

/** Quy trình xử lý của nhóm đề xuất (theo Base Request). */
export const FLOWS = [
  { value: 'parallel', label: 'Duyệt đồng thời', hint: 'Tất cả người duyệt nhận đề xuất cùng lúc; tất cả đồng ý mới được chấp thuận.' },
  { value: 'sequential', label: 'Duyệt lần lượt', hint: 'Từng người duyệt theo thứ tự; người sau chỉ nhận khi người trước đã đồng ý.' },
  { value: 'any', label: 'Chỉ cần một người duyệt', hint: 'Tất cả nhận cùng lúc; một người đồng ý là đề xuất được chấp thuận.' },
  { value: 'blocks', label: 'Luồng duyệt trong khối người duyệt', hint: 'Chia người duyệt thành các khối nối tiếp; mỗi khối chọn "tất cả đồng ý" hoặc "chỉ cần một người".' },
];
export const flowLabel = (flow) => FLOWS.find((f) => f.value === flow)?.label || 'Duyệt lần lượt';

/** Ghi chú cho người duyệt trong luồng: bước, và cách duyệt khi nhiều người cùng bước. */
export function stepNote(a, list, flow) {
  if (flow === 'any') return 'Người duyệt';
  const same = list.filter((x) => x.step === a.step).length;
  if (same < 2) return `Bước ${a.step}`;
  return `Bước ${a.step} · ${(a.step_mode || a.mode) === 'any' ? 'một người đồng ý' : 'cùng duyệt'}`;
}
