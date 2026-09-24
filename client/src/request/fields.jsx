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
