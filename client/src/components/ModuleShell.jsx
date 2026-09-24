import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users2, Settings, Fingerprint, UsersRound, Plane, CalendarDays, Scale, FolderOpen, Building2, Share2, Clock3,
  Trash2, Menu,
} from 'lucide-react';
import { useApp } from '../context.jsx';
import { AppSwitcher, NotificationBell, UserMenu } from './shell.jsx';
import { ECOSYSTEM, AppIcon } from '../apps.jsx';
import { cx } from '../utils.js';

const NAV = {
  hrm: [
    { to: '/hrm', end: true, label: 'Tổng quan', icon: LayoutDashboard },
    { to: '/hrm/employees', label: 'Hồ sơ nhân sự', icon: Users2 },
    { to: '/hrm/settings', label: 'Cài đặt', icon: Settings, admin: true },
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
  return (
    <div className="office">
      <header className="topbar">
        <button className="icon-btn on-dark mobile-only" onClick={() => setOpen(!open)} aria-label="Menu"><Menu size={20} /></button>
        <Link to="/" className="brand"><img className="brand-logo" src="/logo-192.png" alt="LDL" /><span className="brand-name">{company}</span></Link>
        <div className="grow" />
        <NotificationBell app={app} dark />
        <AppSwitcher dark />
        <UserMenu dark />
      </header>
      <div className="office-body">
        <aside className={cx('office-side', open && 'open')}>
          <div className="mod-title"><AppIcon app={meta} size={30} /><span><b>{meta.name}</b><small className="muted block">{meta.desc}</small></span></div>
          {NAV[app].filter((n) => !n.admin || user.role === 'admin').map((n) => (
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
