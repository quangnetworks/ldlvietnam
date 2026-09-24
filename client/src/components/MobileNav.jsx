/**
 * Thanh tab dưới đáy màn hình cho iPhone / điện thoại (chỉ hiện khi màn hình ≤ 800px, xem mobile.css).
 * Trang chủ · Công việc · Tin nhắn (số chưa đọc) · Văn bản · Thêm (mọi ứng dụng + liên hệ nhanh).
 * Tự ẩn trong cuộc trò chuyện (ô soạn tin nằm sát đáy) và khi bàn phím đang mở.
 */
import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Home, CheckSquare, MessageCircle, FileText, LayoutGrid, BookUser, User, X } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { ECOSYSTEM, canOpen, AppIcon } from '../apps.jsx';
import { ContactsModal } from './Contact.jsx';
import { cx } from '../utils.js';

function useUnread(enabled) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const load = () => { if (!document.hidden) api.get('/chat/unread').then((r) => setN(r?.unread || 0)).catch(() => {}); };
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [enabled]);
  return n;
}

function MoreSheet({ onClose, onContacts }) {
  const { apps, user } = useApp();
  const list = ECOSYSTEM.filter((a) => canOpen(a, apps));
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Tất cả ứng dụng" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <div className="sheet-head"><b>Ứng dụng</b><button className="icon-btn" onClick={onClose} aria-label="Đóng"><X size={18} /></button></div>
        <div className="sheet-apps">
          {list.map((a) => (
            <Link key={a.key} to={a.path} className="sheet-app" onClick={onClose}>
              <AppIcon app={a} size={46} />
              <span>{a.name.replace(/^LDL\s*/, '')}</span>
            </Link>
          ))}
        </div>
        <div className="sheet-links">
          {user.role !== 'guest' && <button className="sheet-link" onClick={onContacts}><BookUser size={18} /> Liên hệ nhanh — nhắn tin, gọi điện</button>}
          <Link className="sheet-link" to="/account" onClick={onClose}><User size={18} /> Tài khoản của tôi</Link>
        </div>
      </div>
    </div>
  );
}

const MQ = '(max-width: 800px)';
function useIsMobile() {
  const [m, setM] = useState(() => window.matchMedia(MQ).matches);
  useEffect(() => {
    const mq = window.matchMedia(MQ);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return m;
}

export default function MobileTabBar() {
  return useIsMobile() ? <TabBar /> : null;
}

function TabBar() {
  const { apps } = useApp();
  const location = useLocation();
  const [more, setMore] = useState(false);
  const [contacts, setContacts] = useState(false);
  const has = (k) => (apps || []).includes(k);
  const unread = useUnread(has('message'));
  const inChat = /^\/message\/\d+/.test(location.pathname);
  useEffect(() => setMore(false), [location.pathname]);

  // bàn phím ảo mở → ẩn thanh tab để không che ô nhập
  const [kb, setKb] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const h = () => setKb(window.innerHeight - vv.height > 150);
    vv.addEventListener('resize', h);
    return () => vv.removeEventListener('resize', h);
  }, []);

  const hidden = inChat || kb;
  useEffect(() => {
    document.body.classList.toggle('has-tabbar', !hidden);
    return () => document.body.classList.remove('has-tabbar');
  }, [hidden]);
  if (hidden) return null;

  const tab = (to, label, Icon, opts = {}) => (
    <NavLink to={to} end={opts.end} className={({ isActive }) => cx('tb-item', isActive && 'active')}>
      <span className="tb-icon"><Icon size={22} strokeWidth={1.9} />{opts.badge > 0 && <i className="tb-badge">{opts.badge > 99 ? '99+' : opts.badge}</i>}</span>
      <span className="tb-label">{label}</span>
    </NavLink>
  );
  return (
    <>
      <nav className="tabbar" aria-label="Điều hướng chính">
        {tab('/', 'Trang chủ', Home, { end: true })}
        {has('wework') && tab('/wework', 'Công việc', CheckSquare)}
        {has('message') && tab('/message', 'Tin nhắn', MessageCircle, { badge: unread })}
        {has('office') && tab('/office', 'Văn bản', FileText)}
        <button type="button" className={cx('tb-item', more && 'active')} onClick={() => setMore(true)}>
          <span className="tb-icon"><LayoutGrid size={22} strokeWidth={1.9} /></span>
          <span className="tb-label">Thêm</span>
        </button>
      </nav>
      {more && <MoreSheet onClose={() => setMore(false)} onContacts={() => { setMore(false); setContacts(true); }} />}
      {contacts && <ContactsModal onClose={() => setContacts(false)} />}
    </>
  );
}
