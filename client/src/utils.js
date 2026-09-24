export const DOC_STATUS = {
  draft: { label: 'Đã lưu', cls: 'badge-gray' },
  pending: { label: 'Chờ duyệt', cls: 'badge-orange' },
  issued: { label: 'Đã ban hành', cls: 'badge-green' },
  rejected: { label: 'Không thông qua', cls: 'badge-red' },
  archived: { label: 'Cất giữ', cls: 'badge-purple' },
};

export const DOC_KINDS = {
  notice: 'Thông báo',
  incoming: 'Văn bản đến',
  outgoing: 'Văn bản đi',
  internal: 'Văn bản nội bộ',
};

export const TASK_STATUS = {
  todo: { label: 'Cần làm', color: '#868e96' },
  doing: { label: 'Đang làm', color: '#2d7ff9' },
  review: { label: 'Chờ đánh giá', color: '#f59f00' },
  done: { label: 'Hoàn thành', color: '#37b24d' },
  failed: { label: 'Thất bại', color: '#e03131' },
};

export const PRIORITY = {
  normal: { label: 'Bình thường', cls: '' },
  important: { label: 'Quan trọng', cls: 'tag-orange' },
  urgent: { label: 'Khẩn cấp', cls: 'tag-red' },
};

export const RECURRING = { daily: 'Hằng ngày', weekly: 'Hằng tuần', monthly: 'Hằng tháng' };

const pad = (n) => String(n).padStart(2, '0');

export function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  // SQLite datetime('now') is UTC without zone: "YYYY-MM-DD HH:MM:SS"
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(v)) return new Date(v.replace(' ', 'T') + 'Z');
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(v);
}

export function fmtDate(v) {
  const d = parseDate(v);
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function fmtDateTime(v) {
  const d = parseDate(v);
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${fmtDate(d)}`;
}

export function timeAgo(v) {
  const d = parseDate(v);
  if (!d) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} ngày trước`;
  return fmtDate(d);
}

export function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  return x;
}

export function weekLabel(v) {
  const d = parseDate(v) || new Date();
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  return `TUẦN ${pad(s.getDate())}/${pad(s.getMonth() + 1)} - ${pad(e.getDate())}/${pad(e.getMonth() + 1)}/${String(e.getFullYear()).slice(2)}`;
}

export function fileSize(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/);
  if (!parts[0]) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function fileIcon(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return { label: 'PDF', color: '#e03131' };
  if (['doc', 'docx'].includes(ext)) return { label: 'DOC', color: '#1c7ed6' };
  if (['xls', 'xlsx', 'csv'].includes(ext)) return { label: 'XLS', color: '#2b8a3e' };
  if (['ppt', 'pptx'].includes(ext)) return { label: 'PPT', color: '#e8590c' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic'].includes(ext)) return { label: 'IMG', color: '#7048e8' };
  if (['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', 'ogv', '3gp'].includes(ext)) return { label: 'VID', color: '#c2255c' };
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'].includes(ext)) return { label: 'AUD', color: '#0c8599' };
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return { label: 'ZIP', color: '#5c940d' };
  return { label: ext.slice(0, 3).toUpperCase() || 'FILE', color: '#868e96' };
}

export function buildTree(items) {
  const map = new Map(items.map((i) => [i.id, { ...i, children: [] }]));
  const roots = [];
  for (const n of map.values()) {
    if (n.parent_id && map.has(n.parent_id)) map.get(n.parent_id).children.push(n);
    else roots.push(n);
  }
  return roots;
}

export function stripHtml(html = '') {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || '';
}

export function cx(...args) {
  return args.filter(Boolean).join(' ');
}
