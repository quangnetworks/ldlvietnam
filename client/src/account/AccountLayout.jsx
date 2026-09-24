import { NavLink, Outlet, Link } from 'react-router-dom';
import {
  UserCircle2, Bell, Users, Network, LayoutGrid, Power, Settings, Pencil, KeyRound, Palette, History, Building2, AppWindow,
  ScrollText, FileText, GitPullRequestArrow, Home, LockKeyhole,
} from 'lucide-react';
import { useApp } from '../context.jsx';
import { Avatar } from '../components/ui.jsx';
import { cx } from '../utils.js';

function RailLink({ to, icon: Icon, label, end }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cx('acc-rail-link', isActive && 'active')}>
      <Icon size={22} />
      <span>{label}</span>
    </NavLink>
  );
}

function SideLink({ to, icon: Icon, children, end = true }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cx('acc-side-link', isActive && 'active')}>
      <Icon size={16} /> {children}
    </NavLink>
  );
}

export default function AccountLayout() {
  const { user, logout } = useApp();
  const admin = user.role === 'admin';
  return (
    <div className="acc">
      <nav className="acc-rail">
        <Link to="/" className="acc-rail-avatar" title="Trang chủ"><Avatar name={user.name} color={user.color} size={36} /></Link>
        <RailLink to="/account" end icon={UserCircle2} label="Cá nhân" />
        <RailLink to="/account/notifications" icon={Bell} label="Thông báo" />
        <RailLink to="/account/members" icon={Users} label="Thành viên" />
        <RailLink to="/account/groups" icon={Network} label="Nhóm" />
        <RailLink to="/account/apps" icon={LayoutGrid} label="Ứng dụng" />
        <div className="grow" />
        <Link to="/" className="acc-rail-link"><Home size={22} /><span>Trang chủ</span></Link>
        <button className="acc-rail-link" onClick={logout}><Power size={22} /><span>Đăng xuất</span></button>
      </nav>
      <main className="acc-main"><Outlet /></main>
      <aside className="acc-side">
        <div className="acc-side-head">
          <h2 className="ellipsis">{user.name}</h2>
          <small className="muted ellipsis block">@{user.username} · {user.email}</small>
        </div>
        <div className="acc-side-section">
          <div className="acc-side-title">THÔNG TIN TÀI KHOẢN</div>
          <SideLink to="/account" icon={Settings}>Tài khoản</SideLink>
          <SideLink to="/account/edit" icon={Pencil}>Chỉnh sửa</SideLink>
          <SideLink to="/account/password" icon={KeyRound}>Thay đổi mật khẩu</SideLink>
          <SideLink to="/account/color" icon={Palette}>Đổi màu hiển thị</SideLink>
          <SideLink to="/account/logins" icon={History}>Lịch sử đăng nhập cá nhân</SideLink>
        </div>
        {admin && (
          <div className="acc-side-section">
            <div className="acc-side-title">ỨNG DỤNG & AN TOÀN</div>
            <SideLink to="/account/company" icon={Building2}>Chỉnh sửa công ty</SideLink>
            <SideLink to="/account/apps" icon={AppWindow}>Quản lý ứng dụng</SideLink>
            <SideLink to="/account/departments" icon={Network}>Phòng ban</SideLink>
            <SideLink to="/account/audit" icon={ScrollText}>Lịch sử hệ thống</SideLink>
            <SideLink to="/account/bulk-password" icon={LockKeyhole}>Đổi mật khẩu hàng loạt</SideLink>
            <SideLink to="/office/settings" icon={FileText}>Cài đặt Base Office</SideLink>
            <SideLink to="/request/settings" icon={GitPullRequestArrow}>Quản lý nhóm đề xuất</SideLink>
          </div>
        )}
      </aside>
    </div>
  );
}
