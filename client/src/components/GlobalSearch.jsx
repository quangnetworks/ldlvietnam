/**
 * Tìm kiếm toàn hệ thống LDL (Ctrl/⌘ + K, hoặc nút kính lúp trên thanh công cụ của mọi module).
 * Gọi song song API tìm kiếm của từng ứng dụng người dùng được dùng — mỗi API tự kiểm quyền xem,
 * máy chủ dùng chỉ mục toàn văn (không dấu, mọi thứ tự từ, xếp theo liên quan). Kết quả nhóm theo ứng dụng,
 * di chuyển bằng ↑ ↓, Enter để mở, Esc để đóng; lưu 6 lượt tìm gần đây trên máy.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, X, FileText, CheckSquare, FolderKanban, GitPullRequestArrow, FolderOpen, File, MessageCircle, Users, Clock, CornerDownLeft } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Avatar } from './ui.jsx';
import { Hl, snippet } from './Highlight.jsx';
import { fmtDate, cx } from '../utils.js';
import './search.css';

export const openGlobalSearch = () => window.dispatchEvent(new Event('ldl:search'));
const RECENT_KEY = 'ldl_recent_search';
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 6); } catch { return []; } };
const saveRecent = (q) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...readRecent().filter((x) => x !== q)].slice(0, 6))); } catch { /* bỏ qua */ } };

/** Nguồn tìm kiếm: ứng dụng cần có, lời gọi API, chuyển kết quả thành dòng hiển thị. */
const SOURCES = [
  { key: 'docs', label: 'Văn bản', icon: FileText, app: 'office',
    load: (q) => api.get('/documents', { q, limit: 5 }).then((r) => r.items.map((d) => ({
      id: `d${d.id}`, title: d.title, sub: [d.code, d.type_name, fmtDate(d.issued_at || d.created_at)].filter(Boolean).join(' · '), to: `/office/doc/${d.id}` }))) },
  { key: 'tasks', label: 'Công việc & dự án', icon: CheckSquare, app: 'wework',
    load: (q) => api.get('/search', { q }).then((r) => [
      ...r.projects.map((p) => ({ id: `p${p.id}`, title: p.name, sub: p.kind === 'department' ? 'Phòng ban' : 'Dự án', icon: FolderKanban, to: `/wework/project/${p.id}` })),
      ...r.tasks.map((t) => ({ id: `t${t.id}`, title: t.title, sub: t.project_name || 'Công việc cá nhân', to: `/wework/task/${t.id}` })),
    ]) },
  { key: 'requests', label: 'Đề xuất', icon: GitPullRequestArrow, app: 'request',
    load: (q) => api.get('/requests', { q, limit: 5 }).then((r) => r.items.map((x) => ({
      id: `r${x.id}`, title: x.title, sub: [`#${x.id}`, x.group_name, x.creator_name].filter(Boolean).join(' · '), to: `/request/${x.id}` }))) },
  { key: 'drive', label: 'Tài liệu', icon: FolderOpen, app: 'drive',
    load: (q) => api.get('/drive/search', { q }).then((r) => r.map((f) => ({
      id: `f${f.id}`, title: f.name, sub: f.path || (f.space === 'company' ? 'Tài liệu công ty' : 'Tài liệu của tôi'), icon: f.kind === 'folder' ? FolderOpen : File,
      to: f.kind === 'folder' ? `/drive/folder/${f.id}` : f.parent_id ? `/drive/folder/${f.parent_id}` : `/drive/${f.space === 'company' ? 'company' : 'personal'}` }))) },
  { key: 'chat', label: 'Tin nhắn', icon: MessageCircle, app: 'message',
    load: (q) => api.get('/chat/search', { q }).then((r) => r.slice(0, 5).map((m) => ({
      id: `m${m.id}`, title: snippet(m.content || m.original_name, q), sub: `${m.user_name || ''} · ${fmtDate(m.created_at)}`, to: `/message/${m.channel_id}` }))) },
  { key: 'people', label: 'Mọi người', icon: Users, app: null,
    load: (q, apps) => api.get('/users', { q }).then((r) => r.slice(0, 5).map((u) => ({
      id: `u${u.id}`, title: u.name, sub: [u.title, u.department_name].filter(Boolean).join(' · '), user: u,
      to: apps.includes('hrm') ? `/hrm/employees/${u.id}` : null, chat: apps.includes('message') ? u.id : null }))) },
];

function Palette({ onClose }) {
  const { apps } = useApp();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [res, setRes] = useState({});
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [recent] = useState(readRecent);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const sources = useMemo(() => SOURCES.filter((s) => !s.app || (apps || []).includes(s.app)), [apps]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  // Gõ → chờ 180ms → gọi song song; kết quả về tới đâu hiện tới đó; bỏ kết quả của lượt gõ cũ
  useEffect(() => {
    const text = q.trim();
    if (!text) { setRes({}); setLoading(false); return undefined; }
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      let left = sources.length;
      for (const s of sources) {
        s.load(text, apps || []).catch(() => []).then((items) => {
          if (!alive) return;
          setRes((r) => ({ ...r, [s.key]: items }));
          if (--left === 0) setLoading(false);
        });
      }
    }, 180);
    return () => { alive = false; clearTimeout(t); };
  }, [q, sources, apps]);
  useEffect(() => setActive(0), [q]);

  const groups = sources.map((s) => ({ ...s, items: res[s.key] || [] })).filter((g) => g.items.length);
  const flat = groups.flatMap((g) => g.items.map((it) => ({ ...it, group: g })));
  const go = useCallback(async (it) => {
    if (!it) return;
    saveRecent(q.trim());
    onClose();
    if (it.to) navigate(it.to);
    else if (it.chat) { try { const ch = await api.post('/chat/direct', { user_id: it.chat }); navigate(`/message/${ch.id}`); } catch { /* bỏ qua */ } }
  }, [q, navigate, onClose]);
  useEffect(() => { listRef.current?.querySelector('.gs-item.active')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); go(flat[active]); }
  };

  let idx = -1;
  const text = q.trim();
  return createPortal(
    <div className="gs-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gs" role="dialog" aria-modal="true" aria-label="Tìm kiếm toàn hệ thống" onKeyDown={onKey}>
        <div className="gs-bar">
          <Search size={18} className="muted" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm văn bản, công việc, đề xuất, tài liệu, tin nhắn, mọi người…"
            aria-label="Từ khoá tìm kiếm" enterKeyHint="search" />
          {loading && <span className="gs-spin" aria-hidden />}
          {q && <button type="button" className="icon-btn sm" onClick={() => { setQ(''); inputRef.current?.focus(); }} aria-label="Xoá"><X size={15} /></button>}
          <button type="button" className="gs-esc" onClick={onClose}>Esc</button>
        </div>
        <div className="gs-body" ref={listRef}>
          {!text && (
            <div className="gs-empty">
              {recent.length > 0 && (
                <>
                  <div className="gs-group-title">Tìm gần đây</div>
                  <div className="gs-recent">{recent.map((r) => <button key={r} type="button" onClick={() => setQ(r)}><Clock size={13} /> {r}</button>)}</div>
                </>
              )}
              <p className="muted small">Gõ không dấu cũng được, các từ không cần đúng thứ tự — ví dụ <b>quyet dinh bo nhiem</b>, <b>#125</b>, <b>LDL006</b>.</p>
            </div>
          )}
          {text && !loading && !groups.length && <div className="gs-none">Không tìm thấy kết quả cho “{text}”</div>}
          {groups.map((g) => (
            <section key={g.key} className="gs-group">
              <div className="gs-group-title"><g.icon size={13} /> {g.label}</div>
              {g.items.map((it) => {
                idx += 1;
                const i = idx;
                const Icon = it.icon || g.icon;
                return (
                  <button key={it.id} type="button" className={cx('gs-item', i === active && 'active')} onMouseMove={() => setActive(i)} onClick={() => go(it)}>
                    {it.user ? <Avatar name={it.user.name} color={it.user.color} uid={it.user.id} size={28} /> : <span className="gs-icon"><Icon size={15} /></span>}
                    <span className="gs-text">
                      <b><Hl text={it.title} q={text} /></b>
                      {it.sub && <small><Hl text={it.sub} q={text} /></small>}
                    </span>
                    {i === active && <CornerDownLeft size={14} className="muted gs-enter" />}
                  </button>
                );
              })}
            </section>
          ))}
        </div>
        <div className="gs-foot"><span><kbd>↑</kbd><kbd>↓</kbd> chọn</span><span><kbd>Enter</kbd> mở</span><span><kbd>Esc</kbd> đóng</span><span className="grow" /><span><kbd>Ctrl</kbd><kbd>K</kbd> mở nhanh</span></div>
      </div>
    </div>,
    document.body,
  );
}

/** Gắn một lần ở gốc ứng dụng: phím tắt Ctrl/⌘ + K và sự kiện "ldl:search" mở bảng tìm kiếm. */
export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('ldl:search', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('ldl:search', onOpen); };
  }, []);
  return open ? <Palette onClose={() => setOpen(false)} /> : null;
}
