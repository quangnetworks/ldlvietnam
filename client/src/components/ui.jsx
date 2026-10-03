import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Check, Search, Bold, Italic, Underline, List, ListOrdered } from 'lucide-react';
import DOMPurify from 'dompurify';
import { initials, fileIcon, fileSize, cx } from '../utils.js';
import { useApp } from '../context.jsx';

/**
 * Danh sách dài (hàng trăm nhân sự): chỉ vẽ `step` dòng đầu, tự vẽ thêm khi cuộn tới cuối (hoặc bấm "Hiển thị thêm").
 * Trả về [các dòng đang hiện, phần chân danh sách]. Đổi bộ lọc (resetKey) → quay về trang đầu.
 */
export function useShowMore(items, step = 60, resetKey = '') {
  const [n, setN] = useState(step);
  const ref = useRef(null);
  const total = items?.length || 0;
  useEffect(() => { setN(step); }, [resetKey, step]);
  useEffect(() => {
    const el = ref.current;
    if (!el || n >= total || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setN((x) => x + step); }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [n, total, step]);
  const footer = n < total ? (
    <div ref={ref} className="show-more">
      <button type="button" className="btn btn-sm" onClick={() => setN((x) => x + step)}>Hiển thị thêm {Math.min(step, total - n)} · còn {total - n}</button>
    </div>
  ) : null;
  return [items ? items.slice(0, n) : [], footer];
}

/** So khớp tìm kiếm không phân biệt hoa thường / dấu tiếng Việt ("nguyen van a" khớp "Nguyễn Văn A"). */
export const foldVi = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');

export function avatarUrl(id, version) {
  return `/api/account/users/${id}/avatar?v=${version}`;
}

/**
 * Ảnh đại diện: dùng ảnh đã tải lên nếu có (tra theo `uid`, hoặc theo tên nếu tên là duy nhất), ngược lại hiện chữ viết tắt.
 * `src` dùng để xem trước ảnh chưa lưu.
 */
export function Avatar({ name, color, size = 28, title, uid, src }) {
  const idx = useApp()?.avatarIndex;
  const [broken, setBroken] = useState('');
  const hit = uid != null ? idx?.byId.get(uid) : idx?.byName.get(name);
  const url = src || (hit ? avatarUrl(hit.id, hit.avatar_version) : '');
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.4), background: color || '#adb5bd' };
  if (url && broken !== url) {
    return (
      <span className="avatar has-img" title={title ?? name} style={style}>
        <img src={url} alt="" loading="lazy" onError={() => setBroken(url)} />
      </span>
    );
  }
  return (
    <span className="avatar" title={title ?? name} style={style}>
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ users = [], max = 4, size = 24 }) {
  const shown = users.slice(0, max);
  return (
    <span className="avatar-stack">
      {shown.map((u) => (
        <Avatar key={u.id} name={u.name} color={u.color} size={size} />
      ))}
      {users.length > max && <span className="avatar more" style={{ width: size, height: size }}>+{users.length - max}</span>}
    </span>
  );
}

export function Modal({ title, onClose, children, footer, width = 640, className }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={cx('modal', className)} style={{ width }} role="dialog" aria-modal="true">
        {title && (
          <div className="modal-head">
            <h3>{title}</h3>
            <button className="icon-btn" onClick={onClose} aria-label="Đóng"><X size={18} /></button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function Drawer({ onClose, children, width = 760 }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return createPortal(
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="drawer" style={{ width }}>{children}</div>
    </div>,
    document.body
  );
}

export function useClickOutside(ref, onOutside, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onOutside();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, onOutside, active]);
}

/** Dropdown: trigger is a render prop receiving (open, toggle). */
export function Dropdown({ trigger, children, align = 'left', className, width }) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState(align);
  const [up, setUp] = useState(false);
  const [fixed, setFixed] = useState(null); // {left, top}: khung chứa quá hẹp → menu nổi theo màn hình
  const [sheet, setSheet] = useState(false); // điện thoại: menu là bảng trượt từ đáy (mobile.css)
  const ref = useRef(null);
  const menuRef = useRef(null);
  // Menu nổi (bảng trượt / nổi theo màn hình) được đưa ra <body>: khung cha có backdrop-filter / transform
  // (vd. thanh lọc "kính mờ") sẽ làm position: fixed bám theo khung đó thay vì màn hình.
  const portal = sheet || !!fixed;
  useEffect(() => {
    if (!open) return undefined;
    setSheet(window.matchMedia('(max-width: 800px)').matches);
    const h = (e) => {
      if (ref.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  // Menu nổi theo màn hình không đi theo nội dung khi cuộn → đóng lại
  useEffect(() => {
    if (!open || !fixed) return undefined;
    const close = (e) => { if (!menuRef.current?.contains(e.target)) setOpen(false); };
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [open, fixed]);
  // Đổi hướng mở nếu menu tràn ra ngoài vùng nhìn thấy: màn hình VÀ khung cuộn chứa nó
  // (vd. bộ lọc sát mép trái nội dung — menu canh phải sẽ lấn sang thanh bên và bị khung cuộn cắt mất).
  useLayoutEffect(() => {
    if (!open) { setSide(align); setUp(false); setFixed(null); setSheet(false); return; }
    if (sheet || window.matchMedia('(max-width: 800px)').matches) return; // bảng trượt: vị trí do CSS quyết định
    const r = menuRef.current?.getBoundingClientRect();
    if (!r || !ref.current) return;
    const clip = { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight };
    for (let el = ref.current.parentElement; el && el !== document.body; el = el.parentElement) {
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) { clip.left = Math.max(clip.left, b.left); clip.right = Math.min(clip.right, b.right); }
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowY)) { clip.top = Math.max(clip.top, b.top); clip.bottom = Math.min(clip.bottom, b.bottom); }
    }
    // Chọn hướng theo vị trí nút + bề rộng menu (không phụ thuộc hướng hiện tại → không lật qua lật lại)
    const t = ref.current.getBoundingClientRect();
    const fitsLeft = t.left + r.width <= clip.right - 8;   // canh trái: menu trải sang phải
    const fitsRight = t.right - r.width >= clip.left + 8;  // canh phải: menu trải sang trái
    let next = align;
    if (align === 'left' && !fitsLeft && fitsRight) next = 'right';
    else if (align === 'right' && !fitsRight && fitsLeft) next = 'left';
    else if (!fitsLeft && !fitsRight) next = clip.right - t.left >= t.right - clip.left ? 'left' : 'right';
    if (next !== side) setSide(next);
    const fitsBelow = t.bottom + 4 + r.height <= clip.bottom;
    const fitsAbove = t.top - 4 - r.height >= clip.top;
    // Không hướng nào vừa khung chứa (vd. menu tài khoản trên thanh bên hẹp, menu trong thanh tab cuộn ngang
    // chỉ cao một dòng) → nổi theo màn hình để không bị cắt
    if (((!fitsLeft && !fitsRight) || (!fitsBelow && !fitsAbove)) && r.width <= window.innerWidth - 16) {
      const vw = window.innerWidth; const vh = window.innerHeight;
      const left = Math.max(8, Math.min(next === 'right' ? t.right - r.width : t.left, vw - r.width - 8));
      const top = t.bottom + 4 + r.height > vh - 8 && t.top - r.height - 4 > 8 ? t.top - r.height - 4 : Math.min(t.bottom + 4, vh - r.height - 8);
      if (!fixed || Math.abs(fixed.left - left) > 1 || Math.abs(fixed.top - top) > 1) setFixed({ left, top: Math.max(8, top) });
      return;
    }
    if (!up) {
      // tràn đáy màn hình hoặc đáy khung cuộn chứa nó → mở lên trên nếu phía trên đủ chỗ
      if (!fitsBelow && fitsAbove) setUp(true);
    }
  }, [open, side, align, up, sheet]);
  const menu = open && (
    <div ref={menuRef} className={cx('dropdown-menu', side === 'right' && 'right', up && 'up', fixed && 'floating', sheet && 'sheet-menu')}
      style={{
        ...(width && { width }),
        ...(fixed && !sheet && { position: 'fixed', left: fixed.left, top: fixed.top, right: 'auto', bottom: 'auto' }),
        ...(portal && { zIndex: 1300 }), // trên cả popup / trình xem tệp
      }}
      onClick={(e) => { if (e.target.closest('[data-close]')) setOpen(false); }}>
      {typeof children === 'function' ? children(() => setOpen(false)) : children}
    </div>
  );
  return (
    <div className={cx('dropdown', className)} ref={ref}>
      {trigger(open, () => { setSheet(window.matchMedia('(max-width: 800px)').matches); setOpen((o) => !o); })}
      {portal && menu ? createPortal(menu, document.body) : menu}
    </div>
  );
}

export function MenuItem({ icon: Icon, children, onClick, danger, active, right }) {
  return (
    <button type="button" data-close className={cx('menu-item', danger && 'danger', active && 'active')} onClick={onClick}>
      {Icon && <Icon size={15} />}
      <span className="grow">{children}</span>
      {active && !right && <Check size={14} />}
      {right}
    </button>
  );
}

/** Select dropdown styled like Base's inline filter ("Tất cả trạng thái ▾"). */
export function FilterSelect({ value, options, onChange, placeholder }) {
  const current = options.find((o) => String(o.value) === String(value ?? ''));
  return (
    <Dropdown
      align="right"
      trigger={(open, toggle) => (
        <button type="button" className={cx('filter-select', open && 'open')} onClick={toggle}>
          {current?.label ?? placeholder}
          <span className="caret" />
        </button>
      )}
    >
      <div className="menu-scroll">
        {options.map((o) =>
          o.group ? (
            <div key={o.group} className="menu-group">{o.group}</div>
          ) : (
            <MenuItem key={String(o.value)} active={String(o.value) === String(value ?? '')} onClick={() => onChange(o.value)}>
              {o.label}
            </MenuItem>
          )
        )}
      </div>
    </Dropdown>
  );
}

/**
 * Field wraps its children in a <label>. After any click inside a custom widget the browser re-dispatches the
 * click to the first button in the label — the chip's × — which silently removed the value just picked.
 * Widgets cancel that label activation on their root (their own buttons have no default action to lose).
 */
export const stopLabelActivation = (e) => e.preventDefault();

/** Pick one or many users with search. */
export function UserPicker({ users, value, onChange, multiple = false, placeholder = 'Chọn người', exclude = [] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false), open);
  const selected = multiple ? value || [] : value ? [value] : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  const fq = foldVi(q.trim());
  const all = users
    .filter((u) => !exclude.includes(u.id))
    .filter((u) => !fq || foldVi(`${u.name} ${u.username || ''} ${u.title || ''} ${u.department_name || ''}`).includes(fq));
  // công ty lớn: chỉ vẽ 80 kết quả đầu, gõ để thu hẹp
  const list = all.slice(0, 80);
  const toggle = (id) => {
    if (multiple) onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    else {
      onChange(id === value ? null : id);
      setOpen(false);
    }
  };
  return (
    <div className="picker" ref={ref} onClick={stopLabelActivation}>
      <div className="picker-control" onClick={() => setOpen((o) => !o)} tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setOpen((o) => !o)}>
        {selected.length === 0 && <span className="muted">{placeholder}</span>}
        {selected.length > 12 && <span className="chip">{selected.length} người đã chọn</span>}
        {selected.length <= 12 && selected.map((id) => {
          const u = byId.get(id);
          if (!u) return null;
          return (
            <span key={id} className="chip">
              <Avatar name={u.name} color={u.color} size={18} /> {u.name}
              <button type="button" className="chip-x" onClick={(e) => { e.stopPropagation(); toggle(id); }}>
                <X size={12} />
              </button>
            </span>
          );
        })}
      </div>
      {open && (
        <div className="picker-menu">
          <div className="picker-search">
            <Search size={14} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm kiếm..." />
          </div>
          <div className="menu-scroll">
            {list.map((u) => (
              <button type="button" key={u.id} className={cx('menu-item', selected.includes(u.id) && 'active')} onClick={() => toggle(u.id)}>
                <Avatar name={u.name} color={u.color} size={22} />
                <span className="grow">
                  {u.name}
                  <small className="muted block">{u.title || u.department_name || `@${u.username}`}</small>
                </span>
                {selected.includes(u.id) && <Check size={14} />}
              </button>
            ))}
            {!list.length && <div className="empty-small">Không có kết quả nào</div>}
            {all.length > list.length && <div className="empty-small">Còn {all.length - list.length} người — gõ tên, chức danh hoặc phòng ban để tìm</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export function MultiSelect({ options, value = [], onChange, placeholder = 'Chọn' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false), open);
  const byId = new Map(options.map((o) => [o.value, o]));
  return (
    <div className="picker" ref={ref} onClick={stopLabelActivation}>
      <div className="picker-control" onClick={() => setOpen((o) => !o)}>
        {!value.length && <span className="muted">{placeholder}</span>}
        {value.map((v) => (
          <span key={v} className="chip">
            {byId.get(v)?.label}
            <button type="button" className="chip-x" onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x !== v)); }}>
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      {open && (
        <div className="picker-menu">
          <div className="menu-scroll">
            {options.map((o) => (
              <button type="button" key={o.value} className={cx('menu-item', value.includes(o.value) && 'active')}
                onClick={() => onChange(value.includes(o.value) ? value.filter((x) => x !== o.value) : [...value, o.value])}>
                <span className="grow" style={{ paddingLeft: (o.depth || 0) * 14 }}>{o.label}</span>
                {value.includes(o.value) && <Check size={14} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Pagination({ page, total, limit, onChange }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total ? (page - 1) * limit + 1 : 0;
  const to = Math.min(total, page * limit);
  const nums = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) nums.push(i);
  return (
    <div className="pagination">
      <div className="pages">
        <button className="page-btn" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Trang trước"><ChevronLeft size={16} /></button>
        {nums.map((n) => (
          <button key={n} className={cx('page-btn', n === page && 'active')} onClick={() => onChange(n)}>{n}</button>
        ))}
        <button className="page-btn" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Trang sau"><ChevronRight size={16} /></button>
      </div>
      <div className="muted">Hiển thị kết quả {from} - {to} của {total}</div>
    </div>
  );
}

export function Empty({ icon: Icon, title = 'Không có dữ liệu', children }) {
  return (
    <div className="empty">
      {Icon && <Icon size={42} strokeWidth={1.2} />}
      <div className="empty-title">{title}</div>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" aria-label="Đang tải" />;
}

export function FileChip({ file, href, onRemove, onOpen, extra }) {
  const ic = fileIcon(file.original_name || file.name);
  const content = (
    <>
      <span className="file-ic" style={{ background: ic.color }}>{ic.label}</span>
      <span className="file-name">{file.original_name || file.name}</span>
      {file.size ? <span className="muted small">{fileSize(file.size)}</span> : null}
    </>
  );
  return (
    <span className="file-chip">
      {onOpen ? <button type="button" className="file-open" onClick={onOpen} title="Xem nội dung">{content}</button>
        : href ? <a href={href} target="_blank" rel="noreferrer">{content}</a> : content}
      {extra}
      {onRemove && (
        <button type="button" className="chip-x" onClick={onRemove} aria-label="Bỏ tệp"><X size={12} /></button>
      )}
    </span>
  );
}

export function SafeHtml({ html, className }) {
  return <div className={cx('rich', className)} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html || '') }} />;
}

/** Minimal rich-text editor (contentEditable + execCommand). */
export function RichEditor({ value, onChange, placeholder, minHeight = 160 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value || '')) ref.current.innerHTML = DOMPurify.sanitize(value || '');
    // only sync from outside when value changes externally
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const cmd = (c) => {
    document.execCommand(c);
    ref.current.focus();
    onChange(ref.current.innerHTML);
  };
  return (
    <div className="rich-editor" onClick={stopLabelActivation}>
      <div className="rich-toolbar">
        <button type="button" onMouseDown={(e) => { e.preventDefault(); cmd('bold'); }} title="In đậm"><Bold size={14} /></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); cmd('italic'); }} title="In nghiêng"><Italic size={14} /></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); cmd('underline'); }} title="Gạch chân"><Underline size={14} /></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); cmd('insertUnorderedList'); }} title="Danh sách"><List size={14} /></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); cmd('insertOrderedList'); }} title="Danh sách số"><ListOrdered size={14} /></button>
      </div>
      <div
        ref={ref}
        className="rich rich-input"
        contentEditable
        data-placeholder={placeholder}
        style={{ minHeight }}
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
      />
    </div>
  );
}

export function Field({ label, required, children, hint }) {
  return (
    // Khi ô bên trong là widget tuỳ biến (control đầu tiên là <button>), bấm vào nhãn không được "bấm hộ" nút đó
    <label className="field" onClick={(e) => { if (e.currentTarget.control?.tagName === 'BUTTON') e.preventDefault(); }}>
      <span className="field-label">{label}{required && <b className="req"> *</b>}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={cx('tabs', className)}>
      {tabs.map((t) => (
        <button key={t.value} type="button" className={cx('tab', value === t.value && 'active')} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count ? <span className="tab-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function ConfirmButton({ message, onConfirm, children, className, title }) {
  return (
    <button type="button" className={className} title={title} onClick={() => { if (window.confirm(message)) onConfirm(); }}>
      {children}
    </button>
  );
}

export function Progress({ value, color }) {
  return (
    <div className="progress"><div className="progress-bar" style={{ width: `${Math.min(100, value || 0)}%`, background: color }} /></div>
  );
}
