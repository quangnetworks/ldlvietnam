/**
 * Bảng "Tất cả ứng dụng": mở từ bất kỳ module nào để chuyển sang ứng dụng khác.
 * - Máy tính / máy tính bảng: bảng nổi neo theo nút bấm (dưới thanh trên cùng, hoặc cạnh thanh bên trái).
 * - Điện thoại (≤ 800px): bảng trượt từ đáy màn hình.
 * Tìm nhanh theo tên / mô tả, nhóm theo danh mục, đánh dấu ứng dụng đang mở; Enter mở kết quả đầu tiên, Esc để đóng.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Search, X, Home } from 'lucide-react';
import { useApp } from '../context.jsx';
import { ECOSYSTEM, CATEGORIES, canOpen, AppIcon } from '../apps.jsx';
import { foldVi } from './ui.jsx';
import { cx } from '../utils.js';
import { openGlobalSearch } from './GlobalSearch.jsx';

const MOBILE = '(max-width: 800px)';
const GAP = 8;

/** Ứng dụng đang mở = đường dẫn khớp dài nhất (trang chủ chỉ khi đúng "/"). */
function currentKey(list, pathname) {
  let best = null;
  for (const a of list) {
    const hit = a.path === '/' ? pathname === '/' : pathname === a.path || pathname.startsWith(`${a.path}/`);
    if (hit && (!best || a.path.length > best.path.length)) best = a;
  }
  return best?.key;
}

/** Vị trí bảng nổi theo nút bấm, luôn nằm trọn trong màn hình. */
function place(anchor, panel) {
  const vw = window.innerWidth; const vh = window.innerHeight;
  const r = anchor.getBoundingClientRect();
  const w = panel.offsetWidth; const h = panel.offsetHeight;
  const clamp = (v, min, max) => Math.max(min, Math.min(v, max));
  // Nút nằm trên thanh dọc bên trái → mở sang phải, canh theo nút
  if (r.right < 160 && r.height < vh / 2) {
    return { left: r.right + GAP, top: clamp(r.top + r.height / 2 - h / 2, GAP, vh - h - GAP) };
  }
  const below = r.bottom + GAP;
  const top = below + h <= vh - GAP || r.top - h - GAP < GAP ? clamp(below, GAP, vh - h - GAP) : r.top - h - GAP;
  return { left: clamp(r.right - w, GAP, vw - w - GAP), top };
}

function LauncherPanel({ anchor, onClose }) {
  const { apps } = useApp();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState(null);
  const [mobile] = useState(() => window.matchMedia(MOBILE).matches);

  const list = useMemo(() => ECOSYSTEM.filter((a) => canOpen(a, apps)), [apps]);
  const current = currentKey(list, pathname);
  const fq = foldVi(q.trim());
  const found = fq ? list.filter((a) => foldVi(`${a.name} ${a.desc}`).includes(fq)) : list;
  const groups = CATEGORIES.filter((c) => c.key !== 'all')
    .map((c) => ({ ...c, items: list.filter((a) => a.cat === c.key) })).filter((g) => g.items.length);

  useLayoutEffect(() => {
    if (mobile || !panelRef.current || !anchor) return undefined;
    const update = () => setPos(place(anchor, panelRef.current));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [anchor, mobile, q]);

  useEffect(() => {
    // Trên điện thoại không tự mở bàn phím; trên máy tính gõ ngay để tìm
    if (!mobile) inputRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || anchor?.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [anchor, mobile, onClose]);

  const tile = (a) => (
    <Link key={a.key} to={a.path} className={cx('al-tile', a.key === current && 'current')} onClick={onClose}
      aria-current={a.key === current ? 'page' : undefined} title={`${a.name} — ${a.desc}`}>
      <AppIcon app={a} size={mobile ? 44 : 40} />
      <b>{a.name.replace(/^LDL\s+/, '')}</b>
      <small>{a.desc}</small>
    </Link>
  );

  return createPortal(
    <>
      {mobile && <div className="al-backdrop" onClick={onClose} />}
      <div ref={panelRef} className={cx('al-panel', mobile ? 'sheet-mode' : 'pop-mode')} role="dialog" aria-modal={mobile} aria-label="Tất cả ứng dụng"
        style={mobile ? undefined : { left: pos?.left ?? -9999, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}>
        {mobile && <div className="sheet-grab" />}
        <div className="al-head">
          <b>Tất cả ứng dụng</b>
          <button type="button" className="icon-btn sm" onClick={onClose} aria-label="Đóng"><X size={16} /></button>
        </div>
        <button type="button" className="al-global" onClick={() => { onClose(); openGlobalSearch(); }}>
          <Search size={15} /> <span className="grow">Tìm văn bản, công việc, tài liệu, mọi người…</span><kbd>Ctrl K</kbd>
        </button>
        <label className="al-search">
          <Search size={15} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Lọc ứng dụng…" aria-label="Lọc ứng dụng"
            onKeyDown={(e) => { if (e.key === 'Enter' && found[0]) { navigate(found[0].path); onClose(); } }} />
          {q && <button type="button" className="al-clear" onClick={() => { setQ(''); inputRef.current?.focus(); }} aria-label="Xoá tìm kiếm"><X size={14} /></button>}
        </label>
        <div className="al-body">
          {fq ? (
            found.length ? <div className="al-grid">{found.map(tile)}</div> : <div className="empty-small">Không tìm thấy ứng dụng “{q}”</div>
          ) : groups.map((g) => (
            <section key={g.key} className="al-group">
              <h4>{g.label}</h4>
              <div className="al-grid">{g.items.map(tile)}</div>
            </section>
          ))}
        </div>
        <div className="al-foot">
          <Link to="/" onClick={onClose}><Home size={14} /> Trang chủ · toàn bộ hệ sinh thái</Link>
        </div>
      </div>
    </>,
    document.body,
  );
}

/**
 * Nút mở bảng ứng dụng. `trigger(open, toggle, ref)` để tuỳ biến hình dạng nút (vd. trên thanh dọc);
 * mặc định là nút biểu tượng lưới.
 */
export function AppLauncher({ trigger }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  const toggle = () => setOpen((o) => !o);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      {trigger(open, toggle, ref)}
      {open && <LauncherPanel anchor={ref.current} onClose={close} />}
    </>
  );
}
