import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users2, Settings, Fingerprint, UsersRound, Plane, CalendarDays, Scale, FolderOpen, Building2, Share2, Clock3,
  Trash2, Menu, FileSignature, TrendingUp, BarChart3, Package, Boxes, UserCheck, Users, UserCog, Network,
} from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch } from '../context.jsx';
import { AppSwitcher, NotificationBell, UserMenu } from './shell.jsx';
import { ContactsButton } from './Contact.jsx';
import { ECOSYSTEM, AppIcon } from '../apps.jsx';
import { cx } from '../utils.js';

const NAV = {
  hrm: [
    { to: '/hrm', end: true, label: 'Tổng quan', icon: LayoutDashboard },
    { to: '/hrm/employees', label: 'Danh sách nhân sự', icon: Users2, hr: true },
    { to: '/hrm/sales', label: 'Cơ cấu kinh doanh', icon: Network },
    { to: '/hrm/contracts', label: 'Hợp đồng', icon: FileSignature, hr: true },
    { to: '/hrm/careers', label: 'Phát triển sự nghiệp', icon: TrendingUp, hr: true },
    { to: '/hrm/reports', label: 'Báo cáo nhân sự', icon: BarChart3, hr: true },
    { to: '/asset/procedures', label: 'Nhận việc / nghỉ việc', icon: UserCheck, hr: true },
    { to: '/hrm/settings', label: 'Cài đặt', icon: Settings, hr: true },
  ],
  checkin: [
    { to: '/checkin', end: true, label: 'Chấm công của tôi', icon: Fingerprint },
    { to: '/checkin/team', label: 'Bảng công nhân viên', icon: UsersRound },
    { to: '/checkin/settings', label: 'Cài đặt', icon: Settings, admin: true },
  ],
  timeoff: [
    { to: '/timeoff', end: true, label: 'Nghỉ phép của tôi', icon: Plane },
    { to: '/timeoff/calendar', label: 'Lịch nghỉ công ty', icon: CalendarDays },
    { to: '/timeoff/balances', label: 'Quỹ phép nhân viên', icon: Scale },
  ],
  asset: [
    { to: '/asset', end: true, label: 'Tài sản của tôi', icon: Package },
    { to: '/asset/overview', label: 'Tổng quan', icon: LayoutDashboard, mgr: true },
    { to: '/asset/list', label: 'Tài sản & công cụ', icon: Boxes, mgr: true },
    { to: '/asset/people', label: 'Theo người sử dụng', icon: Users, mgr: true },
    { to: '/asset/handovers', label: 'Bàn giao & thu hồi', icon: FileSignature, mgr: true },
    { to: '/asset/procedures', label: 'Nhận việc / nghỉ việc', icon: UserCog, mgr: true },
    { to: '/asset/settings', label: 'Cài đặt', icon: Settings, mgr: true },
  ],
  drive: [
    { to: '/drive', end: true, label: 'Tài liệu của tôi', icon: FolderOpen },
    { to: '/drive/company', label: 'Tài liệu công ty', icon: Building2 },
    { to: '/drive/shared', label: 'Được chia sẻ với tôi', icon: Share2 },
    { to: '/drive/recent', label: 'Gần đây', icon: Clock3 },
    { to: '/drive/trash', label: 'Thùng rác', icon: Trash2 },
  ],
};

export default function ModuleShell({ app }) {
  const { user, company } = useApp();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [location.key]);
  const meta = ECOSYSTEM.find((a) => a.key === app);
  // mục chỉ dành cho quản lý nhân sự (HRM)
  const [hrMeta] = useFetch(() => (app === 'hrm' ? api.get('/hrm/meta') : Promise.resolve(null)), [app]);
  const [assetMeta] = useFetch(() => (app === 'asset' ? api.get('/asset/meta') : Promise.resolve(null)), [app]);
  return (
    <div className="office">
      <header className="topbar">
        <button className="icon-btn on-dark mobile-only" onClick={() => setOpen(!open)} aria-label="Menu"><Menu size={20} /></button>
        <Link to="/" className="brand"><img className="brand-logo" src="/logo-rect.png" alt="LDL" /><span className="brand-name">{company}</span></Link>
        <div className="grow" />
        <ContactsButton dark />
        <NotificationBell app={app} dark />
        <AppSwitcher dark />
        <UserMenu dark />
      </header>
      <div className="office-body">
        {open && <div className="side-backdrop" onClick={() => setOpen(false)} />}
        <aside className={cx('office-side', open && 'open')}>
          <div className="mod-title"><AppIcon app={meta} size={30} /><span><b>{meta.name}</b><small className="muted block">{meta.desc}</small></span></div>
          {NAV[app].filter((n) => (!n.admin || user.role === 'admin') && (!n.hr || hrMeta?.is_manager) && (!n.mgr || assetMeta?.is_manager)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('side-link', isActive && 'active')}>
              <n.icon size={15} /> {n.label}
            </NavLink>
          ))}
        </aside>
        <main className="office-main"><Outlet /></main>
      </div>
    </div>
  );
}
