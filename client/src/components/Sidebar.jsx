import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cx } from '../utils.js';

/**
 * Thanh bên thu gọn (chỉ hiện biểu tượng) dùng chung cho mọi phân hệ.
 * Trạng thái lưu theo thiết bị (localStorage) và đồng bộ giữa các phân hệ, các tab.
 * Chưa chọn lần nào: màn hình hẹp (tablet, laptop nhỏ < 1200px) mặc định thu gọn.
 * Điện thoại (≤ 800px) vẫn dùng menu trượt như cũ — CSS bỏ qua chế độ thu gọn.
 */
const KEY = 'ldl_side_collapsed';
const listeners = new Set();

function read() {
  let v = null;
  try { v = localStorage.getItem(KEY); } catch { /* ignore */ }
  if (v === '1') return true;
  if (v === '0') return false;
  return typeof window !== 'undefined' && window.innerWidth < 1200;
}

let current = read();
const emit = () => listeners.forEach((l) => l());

export function setSideCollapsed(v) {
  current = v;
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
  emit();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === KEY) { current = read(); emit(); } });
}

export function useSideCollapsed() {
  const collapsed = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => current);
  return [collapsed, () => setSideCollapsed(!current)];
}

/** Nút thu gọn / mở rộng ở chân thanh bên. */
export function SideToggle({ collapsed, onToggle, dark }) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const label = collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên';
  return (
    <div className={cx('side-toggle-bar', dark && 'dark')}>
      <button type="button" className="side-toggle" onClick={onToggle} aria-label={label} aria-expanded={!collapsed} title={collapsed ? undefined : label}>
        <Icon size={17} />
        <span className="nav-label">Thu gọn</span>
      </button>
    </div>
  );
}

/**
 * Nhãn nổi khi rê chuột / di chuyển bàn phím trên thanh bên đang thu gọn.
 * Gắn một lần ở gốc ứng dụng; đọc chữ từ .nav-label (hoặc aria-label) của mục đang trỏ.
 */
export function SideTooltip() {
  const [tip, setTip] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    const target = (e) => {
      const el = e.target.closest?.('a, button, [data-tip]');
      if (!el || !el.closest('.side-collapsed .side-area') || window.innerWidth <= 800) return null;
      const text = el.getAttribute('data-tip') || el.querySelector('.nav-label')?.textContent?.trim() || el.getAttribute('aria-label');
      return text ? { el, text } : null;
    };
    const show = (e) => {
      const t = target(e);
      if (!t) return setTip(null);
      const r = t.el.getBoundingClientRect();
      setTip({ text: t.text, x: r.right + 10, y: r.top + r.height / 2, key: t.text + r.top });
    };
    const hide = (e) => { if (!e.relatedTarget || !target({ target: e.relatedTarget })) setTip(null); };
    document.addEventListener('mouseover', show);
    document.addEventListener('focusin', show);
    document.addEventListener('mouseout', hide);
    document.addEventListener('focusout', hide);
    const clear = () => setTip(null);
    window.addEventListener('scroll', clear, true);
    window.addEventListener('pointerdown', clear);
    return () => {
      document.removeEventListener('mouseover', show);
      document.removeEventListener('focusin', show);
      document.removeEventListener('mouseout', hide);
      document.removeEventListener('focusout', hide);
      window.removeEventListener('scroll', clear, true);
      window.removeEventListener('pointerdown', clear);
    };
  }, []);
  // Không để nhãn tràn khỏi mép dưới màn hình
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const h = el.offsetHeight;
    el.style.top = `${Math.min(Math.max(tip.y - h / 2, 6), window.innerHeight - h - 6)}px`;
  }, [tip]);
  if (!tip) return null;
  return <div ref={ref} key={tip.key} className="side-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>;
}
