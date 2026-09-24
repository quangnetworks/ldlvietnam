import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Grid3x3, FileText, CheckSquare, Settings, LogOut, User, KeyRound, CheckCheck, GitPullRequestArrow, Sun, Moon, Monitor, BellRing } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Avatar, Dropdown, MenuItem } from './ui.jsx';
import { timeAgo, cx } from '../utils.js';
import { ProfileModal } from '../admin/Profile.jsx';
import { ECOSYSTEM, canOpen, AppIcon } from '../apps.jsx';
import { getThemePref, setThemePref, onThemeChange, resolvedTheme } from '../theme.js';
import { setBadge } from '../push.js';

const THEMES = [
  { key: 'light', label: 'Sáng', icon: Sun },
  { key: 'dark', label: 'Tối', icon: Moon },
  { key: 'system', label: 'Hệ thống', icon: Monitor },
];

/** Hook: giao diện đang chọn + đang áp dụng. */
export function useTheme() {
  const [pref, setPref] = useState(getThemePref());
  const [theme, setTheme] = useState(resolvedTheme());
  useEffect(() => onThemeChange((t) => { setTheme(t); setPref(getThemePref()); }), []);
  const change = useCallback((p) => {
    setThemePref(p);
    api.put('/me/prefs', { theme: p }).catch(() => {});
  }, []);
  return { pref, theme, change };
}

/** Chọn giao diện Sáng / Tối / Theo hệ thống. */
export function ThemeSwitch() {
  const { pref, change } = useTheme();
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Giao diện">
      {THEMES.map((t) => (
        <button key={t.key} type="button" role="radio" aria-checked={pref === t.key} className={cx(pref === t.key && 'active')}
          onClick={(e) => { e.stopPropagation(); change(t.key); }}>
          <t.icon size={14} /> {t.label}
        </button>
      ))}
    </div>
  );
}

/** Nút chuyển nhanh sáng ↔ tối. */
export function ThemeToggle({ dark }) {
  const { theme, change } = useTheme();
  return (
    <button className={cx('icon-btn', dark && 'on-dark')} title={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
      aria-label="Đổi giao diện sáng tối" onClick={() => change(theme === 'dark' ? 'light' : 'dark')}>
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

export function AppSwitcher({ dark }) {
  const { apps } = useApp();
  const list = ECOSYSTEM.filter((a) => canOpen(a, apps));
  return (
    <Dropdown
      align="right"
      width={340}
      trigger={(open, toggle) => (
        <button className={cx('icon-btn', dark && 'on-dark')} onClick={toggle} title="Tất cả ứng dụng" aria-label="Tất cả ứng dụng">
          <Grid3x3 size={18} />
        </button>
      )}
    >
      <div className="app-grid">
        {list.map((a) => (
          <Link key={a.key} to={a.path} className="app-tile" data-close>
            <AppIcon app={a} size={40} />
            <b>{a.name}</b>
            <small>{a.desc}</small>
          </Link>
        ))}
      </div>
      <Link to="/" className="menu-item center-link" data-close>Xem toàn bộ hệ sinh thái →</Link>
    </Dropdown>
  );
}

const APP_LABEL = { office: 'LDL Office', wework: 'LDL Wework', request: 'LDL Request', message: 'LDL Message', drive: 'LDL Drive', hrm: 'LDL HRM', checkin: 'LDL Checkin', timeoff: 'LDL Timeoff' };

export function NotificationBell({ app, dark }) {
  const [data, setData] = useState({ items: [], unread: 0 });
  const [filter, setFilter] = useState('all');
  const navigate = useNavigate();
  const load = useCallback(async () => {
    try {
      const d = await api.get('/notifications', { limit: 40 });
      setData(d);
      setBadge(d.unread);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);
  const items = data.items.filter((n) => (filter === 'unread' ? !n.is_read : filter === 'app' ? n.app === app : true));
  const open = async (n) => {
    if (!n.is_read) await api.put(`/notifications/${n.id}/read`);
    load();
    if (n.link) navigate(n.link);
  };
  return (
    <Dropdown
      align="right"
      width={380}
      trigger={(o, toggle) => (
        <button className={cx('icon-btn bell', dark && 'on-dark')} onClick={() => { toggle(); if (!o) load(); }} aria-label="Thông báo">
          <Bell size={18} />
          {data.unread > 0 && <span className="bell-count">{data.unread > 99 ? '99+' : data.unread}</span>}
        </button>
      )}
    >
      {(close) => (
        <div className="notif-panel">
          <div className="notif-head">
            <b>Thông báo</b>
            <button className="link-btn" onClick={async () => { await api.put('/notifications/read-all'); load(); }}>
              <CheckCheck size={14} /> Đánh dấu đã đọc
            </button>
          </div>
          <div className="notif-tabs">
            {[['all', 'Tất cả'], ['unread', 'Chưa đọc'], ['app', 'Ứng dụng này']].map(([k, l]) => (
              <button key={k} className={cx(filter === k && 'active')} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
          <div className="notif-list">
            {items.map((n) => (
              <button key={n.id} className={cx('notif-item', !n.is_read && 'unread')} onClick={() => { close(); open(n); }}>
                <Avatar name={n.actor_name || 'Hệ thống'} color={n.actor_color} size={32} />
                <span className="grow">
                  <span className="notif-title">{n.title}</span>
                  <small className="muted">{APP_LABEL[n.app] || 'Hệ thống'} · {timeAgo(n.created_at)}</small>
                </span>
              </button>
            ))}
            {!items.length && <div className="empty-small">Không có thông báo</div>}
          </div>
        </div>
      )}
    </Dropdown>
  );
}

export function UserMenu({ dark, showName = true }) {
  const { user, logout } = useApp();
  const [profile, setProfile] = useState(null);
  const navigate = useNavigate();
  return (
    <>
      <Dropdown
        align="right"
        width={260}
        trigger={(open, toggle) => (
          <button className={cx('user-btn', dark && 'on-dark')} onClick={toggle}>
            <Avatar name={user.name} color={user.color} size={30} />
            {showName && <span className="user-name">{user.name}</span>}
          </button>
        )}
      >
        <div className="user-card">
          <Avatar name={user.name} color={user.color} size={40} />
          <div>
            <b>{user.name}</b>
            <small className="muted block">@{user.username} · {user.title || user.department_name}</small>
          </div>
        </div>
        <div className="menu-section"><small className="muted">Giao diện</small><ThemeSwitch /></div>
        <MenuItem icon={User} onClick={() => navigate('/account')}>Tài khoản</MenuItem>
        <MenuItem icon={KeyRound} onClick={() => setProfile('password')}>Đổi mật khẩu</MenuItem>
        <MenuItem icon={BellRing} onClick={() => navigate('/account/notifications')}>Thông báo đẩy trên điện thoại</MenuItem>
        {user.role === 'admin' && <MenuItem icon={Settings} onClick={() => navigate('/account/members')}>Quản trị hệ thống</MenuItem>}
        <MenuItem icon={LogOut} danger onClick={logout}>Đăng xuất</MenuItem>
      </Dropdown>
      {profile && <ProfileModal tab={profile} onClose={() => setProfile(null)} />}
    </>
  );
}

/** Global "+" quick-create button. */
export function QuickCreate({ dark }) {
  const navigate = useNavigate();
  return (
    <Dropdown
      align="right"
      trigger={(open, toggle) => (
        <button className={cx('plus-btn', dark && 'on-dark')} onClick={toggle} aria-label="Tạo mới">+</button>
      )}
    >
      <MenuItem icon={FileText} onClick={() => navigate('/office/new')}>Tạo văn bản</MenuItem>
      <MenuItem icon={CheckSquare} onClick={() => navigate('/wework?create=1')}>Tạo công việc</MenuItem>
      <MenuItem icon={GitPullRequestArrow} onClick={() => navigate('/request/new')}>Tạo đề xuất</MenuItem>
    </Dropdown>
  );
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  const t = useRef();
  useEffect(() => {
    clearTimeout(t.current);
    t.current = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t.current);
  }, [value, ms]);
  return v;
}
