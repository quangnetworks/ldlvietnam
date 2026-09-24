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
