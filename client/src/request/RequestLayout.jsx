import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Home, Bell, BarChart3, Settings, PlusCircle, PlayCircle, LayoutGrid, Inbox, Send, Eye, Star, ChevronLeft, Search, ChevronDown,
  FolderCog, History, ListChecks, Copy, PlusSquare, Webhook,
} from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch } from '../context.jsx';
import { AppSwitcher, UserMenu } from '../components/shell.jsx';
import { cx } from '../utils.js';

const RequestCtx = createContext(null);
export const useRequestApp = () => useContext(RequestCtx);

export function groupByCategory(groups) {
  const map = new Map();
  for (const g of groups || []) {
    if (!map.has(g.category)) map.set(g.category, []);
    map.get(g.category).push(g);
  }
  return [...map.entries()].map(([category, items]) => ({ category, items }));
}

function Rail() {
  const { user } = useApp();
  const link = (to, Icon, title, end) => (
    <NavLink to={to} end={end} className={({ isActive }) => cx('rq-rail-link', isActive && 'active')} title={title}><Icon size={20} /></NavLink>
  );
  return (
    <nav className="rq-rail">
      <Link to="/" title="Về trang chủ"><img src="/logo-192.png" alt="LDL" className="rq-rail-logo" /></Link>
      {link('/request', Home, 'Danh sách đề xuất', true)}
      <Link to="/account/notifications" className="rq-rail-link" title="Thông báo"><Bell size={20} /></Link>
      {link('/request/reports', BarChart3, 'Báo cáo')}
      {user.role === 'admin' && link('/request/settings', Settings, 'Quản lý nhóm đề xuất')}
      <span className="rq-rail-sep" />
      {link('/request/new', PlusCircle, 'Tạo đề xuất')}
      {link('/request/guide', PlayCircle, 'Hướng dẫn')}
      <div className="grow" />
      <AppSwitcher dark />
    </nav>
  );
}

function MainSidebar({ groups, toggleStar }) {
  const [params] = useSearchParams();
  const location = useLocation();
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState({});
  const isList = location.pathname === '/request';
  const box = params.get('box') || '';
  const gid = params.get('group_id');
  const boxLink = (key, label, Icon) => (
    <Link to={key ? `/request?box=${key}` : '/request'} className={cx('rq-link', isList && !gid && box === key && 'active')}><Icon size={16} /> {label}</Link>
  );
  const filtered = (groups || []).filter((g) => !q || g.name.toLowerCase().includes(q.toLowerCase()));
  const starred = filtered.filter((g) => g.starred);
  const groupLink = (g) => (
    <div key={g.id} className={cx('rq-group', isList && gid === String(g.id) && 'active')}>
      <button className={cx('rq-star', g.starred && 'on')} onClick={() => toggleStar(g)} aria-label="Đánh dấu"><Star size={15} fill={g.starred ? 'currentColor' : 'none'} /></button>
      <Link to={`/request?group_id=${g.id}`} className="grow ellipsis" title={g.name}>{g.name}</Link>
    </div>
  );
  return (
    <>
      <div className="rq-user">
        <UserMenu />
      </div>
      <div className="rq-search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm kiếm tất cả" /><Search size={15} /></div>
      <div className="rq-nav">
        {boxLink('', 'Tất cả', LayoutGrid)}
        {boxLink('to_me', 'Gửi đến tôi', Inbox)}
        {boxLink('mine', 'Tôi gửi đi', Send)}
        {boxLink('following', 'Đang theo dõi', Eye)}
      </div>
      {starred.length > 0 && (
        <div className="rq-cat"><div className="rq-cat-title">QUAN TRỌNG</div>{starred.map(groupLink)}</div>
      )}
      {groupByCategory(filtered).map(({ category, items }) => (
        <div key={category} className="rq-cat">
          <button className="rq-cat-title" onClick={() => setClosed({ ...closed, [category]: !closed[category] })}>
            {category.toUpperCase()} <ChevronDown size={13} style={{ transform: closed[category] ? 'rotate(-90deg)' : '' }} />
          </button>
          {!closed[category] && items.map(groupLink)}
        </div>
      ))}
    </>
  );
}

function SettingsSidebar() {
  const link = (to, Icon, label, end = true) => (
    <NavLink to={to} end={end} className={({ isActive }) => cx('rq-link', isActive && 'active')}><Icon size={16} /> {label}</NavLink>
  );
  return (
    <>
      <Link to="/request" className="rq-back"><ChevronLeft size={16} /> Trang chủ</Link>
      <div className="rq-nav">
        {link('/request/settings', LayoutGrid, 'Tất cả nhóm đề xuất')}
        {link('/request/settings/all-requests', FolderCog, 'Tất cả đề xuất hệ thống')}
        {link('/request/settings/history', History, 'Lịch sử chỉnh sửa nhóm')}
        {link('/request/settings/webhooks', Webhook, 'Webhook')}
        {link('/request/settings/bulk', ListChecks, 'Tác vụ hàng loạt')}
        {link('/request/settings/templates', Copy, 'Tạo nhóm từ mẫu')}
        {link('/request/settings/group/new', PlusSquare, 'Tạo nhóm đề xuất')}
      </div>
    </>
  );
}

export default function RequestLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [version, setVersion] = useState(0);
  const [groups, reloadGroups] = useFetch(() => api.get('/request-groups'), [version]);
  const [counts, reloadCounts] = useFetch(() => api.get('/request/counts'), [version, location.key]);
  const settings = location.pathname.startsWith('/request/settings');
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const toggleStar = async (g) => {
    await api.post(`/request-groups/${g.id}/star`);
    reloadGroups();
  };
  const ctx = useMemo(() => ({ groups: groups || [], reloadGroups, counts, reloadCounts, bump, version, navigate }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, counts, version]);
  return (
    <RequestCtx.Provider value={ctx}>
      <div className={cx('rq', collapsed && 'collapsed')}>
        <Rail />
        <aside className="rq-side">
          <button className="rq-collapse" onClick={() => setCollapsed(!collapsed)} aria-label="Thu gọn"><ChevronLeft size={14} /></button>
          {settings ? <SettingsSidebar /> : <MainSidebar groups={groups} toggleStar={toggleStar} />}
        </aside>
        <main className="rq-main"><Outlet /></main>
      </div>
    </RequestCtx.Provider>
  );
}
