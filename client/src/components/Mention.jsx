/**
 * Nhắc tên trong bình luận: gõ "@" để hiện danh sách người dùng (lọc theo tên / tên đăng nhập),
 * chọn bằng chuột hoặc ↑ ↓ Enter / Tab → chèn "@tên_đăng_nhập ". MentionText hiển thị lại thành "@Họ tên" nổi bật.
 */
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useApp } from '../context.jsx';
import { Avatar } from './ui.jsx';
import { cx } from '../utils.js';

const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

/** Tìm đoạn "@..." ngay trước con trỏ. */
function mentionAt(value, caret) {
  const before = value.slice(0, caret);
  const m = /(^|[\s(])@([\p{L}\p{N}._-]{0,30})$/u.exec(before);
  return m ? { start: caret - m[2].length - 1, query: m[2] } : null;
}

export const MentionTextarea = forwardRef(function MentionTextarea({ value, onChange, onSubmit, users: only, className, ...rest }, ref) {
  const { users: all } = useApp();
  const users = only || all;
  const el = useRef(null);
  const [state, setState] = useState(null); // { start, query }
  const [active, setActive] = useState(0);
  useImperativeHandle(ref, () => el.current);
  const list = useMemo(() => {
    if (!state) return [];
    const q = strip(state.query);
    return users.filter((u) => u.username && (!q || strip(u.name).includes(q) || strip(u.username).includes(q))).slice(0, 8);
  }, [state, users]);

  const update = (v, caret) => {
    onChange(v);
    setState(mentionAt(v, caret));
    setActive(0);
  };
  const pick = (u) => {
    const caret = el.current.selectionStart;
    const text = `@${u.username} `;
    const next = value.slice(0, state.start) + text + value.slice(caret);
    onChange(next);
    setState(null);
    requestAnimationFrame(() => { el.current.focus(); const p = state.start + text.length; el.current.setSelectionRange(p, p); });
  };
  return (
    <div className="mention-box">
      <textarea ref={el} className={className} value={value} {...rest}
        onChange={(e) => update(e.target.value, e.target.selectionStart)}
        onClick={(e) => setState(mentionAt(value, e.currentTarget.selectionStart))}
        onBlur={() => setTimeout(() => setState(null), 150)}
        onKeyDown={(e) => {
          if (state && list.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % list.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + list.length) % list.length); return; }
            if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) { e.preventDefault(); pick(list[active]); return; }
            if (e.key === 'Escape') { e.preventDefault(); setState(null); return; }
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); onSubmit?.(); }
        }} />
      {state && list.length > 0 && (
        <div className="mention-menu" role="listbox" aria-label="Chọn người để nhắc tên">
          {list.map((u, i) => (
            <button type="button" key={u.id} role="option" aria-selected={i === active} className={cx('mention-item', i === active && 'active')}
              onMouseDown={(e) => { e.preventDefault(); pick(u); }} onMouseEnter={() => setActive(i)}>
              <Avatar name={u.name} color={u.color} uid={u.id} size={22} />
              <span className="grow ellipsis"><b>{u.name}</b> <small className="muted">@{u.username}{u.title ? ` · ${u.title}` : ''}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

/** Hiển thị bình luận: "@tên_đăng_nhập" → "@Họ tên" nổi bật, liên kết bấm được. */
export function MentionText({ text }) {
  const { users } = useApp();
  const byName = useMemo(() => Object.fromEntries(users.map((u) => [String(u.username).toLowerCase(), u])), [users]);
  const parts = String(text || '').split(/(@[\w.-]+|https?:\/\/[^\s]+)/g);
  return parts.map((p, i) => {
    if (p.startsWith('@')) {
      const u = byName[p.slice(1).replace(/[.-]+$/, '').toLowerCase()];
      return u ? <span key={i} className="mention" title={`@${u.username}`}>@{u.name}</span> : p;
    }
    if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a>;
    return p;
  });
}
