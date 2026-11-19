export const vnd = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString('vi-VN')}đ`);
export const num = (n: number | null | undefined, d = 0) => (n == null || Number.isNaN(n) ? '—' : n.toLocaleString('vi-VN', { maximumFractionDigits: d, minimumFractionDigits: d }));
export const pct = (n: number | null | undefined, d = 2) => (n == null || Number.isNaN(n) ? '—' : `${(n * 100).toLocaleString('vi-VN', { maximumFractionDigits: d, minimumFractionDigits: d })}%`);
export const pv = (p: number | null | undefined) => (p == null ? '—' : p < 0.0001 ? '< 0,0001' : p.toLocaleString('vi-VN', { maximumFractionDigits: 4 }));
export const oneIn = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `1 / ${Math.round(n).toLocaleString('vi-VN')}`);
export const two = (n: number) => n.toString().padStart(2, '0');
export const dateTime = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }) : '—');
export const dateOnly = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? `${s}T00:00:00+07:00` : s).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—');
export const todayVn = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
