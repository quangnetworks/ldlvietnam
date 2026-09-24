/** Giao diện sáng / tối: 'light' | 'dark' | 'system' (theo hệ điều hành). Lưu trên trình duyệt + đồng bộ theo tài khoản. */
const KEY = 'ldl_theme';
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set();

export function getThemePref() {
  try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
}

export function resolvedTheme(pref = getThemePref()) {
  if (pref === 'light' || pref === 'dark') return pref;
  return media?.matches ? 'dark' : 'light';
}

function apply() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0f1216' : '#37404b');
  listeners.forEach((fn) => fn(t));
}

export function setThemePref(pref) {
  try { localStorage.setItem(KEY, pref); } catch { /* chế độ riêng tư: chỉ áp dụng trong phiên */ }
  apply();
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

media?.addEventListener?.('change', () => { if (getThemePref() === 'system') apply(); });
apply();

/**
 * Bảng màu thương hiệu (theo hình nền chọn ở Home) — áp cho thanh trên cùng, thanh bên tối và rail của mọi phân hệ.
 * grad: nền gradient; side: thanh bên; hover / active: trạng thái mục trên thanh bên.
 * Giữ đồng bộ với bảng rút gọn trong index.html (áp trước khi vẽ trang để không nháy màu).
 */
export const BRANDS = [
  { name: 'Xanh ngọc', grad: 'linear-gradient(135deg, #1b2a33 0%, #0e3b43 45%, #11242c 100%)', side: '#10252c', hover: '#173239', active: '#1d3e46' },
  { name: 'Đỏ đô', grad: 'linear-gradient(135deg, #2b1d1d 0%, #5a1f1f 50%, #1e1414 100%)', side: '#261616', hover: '#341d1d', active: '#442424' },
  { name: 'Chàm', grad: 'linear-gradient(135deg, #1a1f36 0%, #283593 50%, #121630 100%)', side: '#161a31', hover: '#1f2546', active: '#283060' },
  { name: 'Xanh rừng', grad: 'linear-gradient(135deg, #1d2b1f 0%, #2e5e3a 50%, #142018 100%)', side: '#152219', hover: '#1c2f22', active: '#243d2c' },
  { name: 'Than chì', grad: 'linear-gradient(135deg, #2d2d2d 0%, #444 50%, #1c1c1c 100%)', side: '#1f1f1f', hover: '#2a2a2a', active: '#363636' },
  { name: 'Hổ phách', grad: 'linear-gradient(135deg, #3b2412 0%, #8a4b14 50%, #26170c 100%)', side: '#27180c', hover: '#352112', active: '#452b17' },
];
const BRAND_KEY = 'ldl_brand';

export function getBrandIndex() {
  try { return Math.min(BRANDS.length - 1, Math.max(0, Number(localStorage.getItem(BRAND_KEY)) || 0)); } catch { return 0; }
}

/** Áp bảng màu thương hiệu cho toàn hệ thống (biến CSS trên <html>). */
export function applyBrand(index = getBrandIndex()) {
  const i = Math.min(BRANDS.length - 1, Math.max(0, Number(index) || 0));
  const b = BRANDS[i];
  const st = document.documentElement.style;
  st.setProperty('--brand-grad', b.grad);
  st.setProperty('--brand-side', b.side);
  st.setProperty('--brand-hover', b.hover);
  st.setProperty('--brand-active', b.active);
  try { localStorage.setItem(BRAND_KEY, String(i)); } catch { /* chế độ riêng tư */ }
  return i;
}
applyBrand();
