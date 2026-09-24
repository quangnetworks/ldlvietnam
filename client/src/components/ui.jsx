import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Check, Search, Bold, Italic, Underline, List, ListOrdered } from 'lucide-react';
import DOMPurify from 'dompurify';
import { initials, fileIcon, fileSize, cx } from '../utils.js';
import { useApp } from '../context.jsx';

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
  const ref = useRef(null);
  const menuRef = useRef(null);
  useClickOutside(ref, () => setOpen(false), open);
  // Đổi hướng mở nếu menu tràn ra ngoài màn hình (vd. avatar nằm sát mép trái ở thanh bên)
  useLayoutEffect(() => {
    if (!open) { setSide(align); return; }
    const r = menuRef.current?.getBoundingClientRect();
    if (!r) return;
    if (side === 'right' && r.left < 8) setSide('left');
    else if (side === 'left' && r.right > window.innerWidth - 8) setSide('right');
  }, [open, side, align]);
  return (
    <div className={cx('dropdown', className)} ref={ref}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div ref={menuRef} className={cx('dropdown-menu', side === 'right' && 'right')} style={width ? { width } : undefined}
          onClick={(e) => { if (e.target.closest('[data-close]')) setOpen(false); }}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
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
  const list = users
    .filter((u) => !exclude.includes(u.id))
    .filter((u) => !q || u.name.toLowerCase().includes(q.toLowerCase()) || u.username?.toLowerCase().includes(q.toLowerCase()));
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
        {selected.map((id) => {
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

export function FileChip({ file, href, onRemove }) {
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
      {href ? <a href={href} target="_blank" rel="noreferrer">{content}</a> : content}
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
