import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Home, CheckSquare, FolderKanban, Building2, Users, BarChart3, PlusSquare, Copy, ListChecks, Settings, PlayCircle,
  Search, ChevronDown, Menu, FileText,
} from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Avatar, useClickOutside } from '../components/ui.jsx';
import { NotificationBell, AppSwitcher, UserMenu, useDebounced } from '../components/shell.jsx';
import { ContactsButton } from '../components/Contact.jsx';
import { cx } from '../utils.js';
import TaskDrawer from './TaskDrawer.jsx';
import TaskCreateModal from './TaskCreateModal.jsx';
import ProjectFormModal from './ProjectFormModal.jsx';

const WeworkCtx = createContext(null);
export const useWework = () => useContext(WeworkCtx);

function QuickSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const dq = useDebounced(q, 250);
  const { openTask } = useWework();
  const navigate = useNavigate();
  useClickOutside(ref, () => setOpen(false), open);
  useEffect(() => {
    if (!dq.trim()) return setRes(null);
    api.get('/search', { q: dq }).then(setRes);
  }, [dq]);
  return (
    <div className="quick-search" ref={ref}>
      <Search size={15} />
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Tìm nhanh" />
      {open && res && (
        <div className="qs-menu">
          {res.projects.length > 0 && <div className="menu-group">Dự án</div>}
          {res.projects.map((p) => (
            <button key={`p${p.id}`} className="menu-item" onClick={() => { setOpen(false); navigate(`/wework/project/${p.id}`); }}>
              <span className="proj-dot" style={{ background: p.color }}>{p.name[0]}</span> {p.name}
            </button>
          ))}
          {res.tasks.length > 0 && <div className="menu-group">Công việc</div>}
          {res.tasks.map((t) => (
            <button key={`t${t.id}`} className="menu-item" onClick={() => { setOpen(false); openTask(t.id); }}>
              <CheckSquare size={14} /> <span className="grow ellipsis">{t.title}</span><small className="muted">{t.project_name}</small>
            </button>
          ))}
          {res.users.length > 0 && <div className="menu-group">Thành viên</div>}
          {res.users.map((u) => (
            <button key={`u${u.id}`} className="menu-item" onClick={() => { setOpen(false); navigate(`/wework?assignee_id=${u.id}&scope=all`); }}>
              <Avatar name={u.name} color={u.color} size={20} /> {u.name}
            </button>
          ))}
          {!res.projects.length && !res.tasks.length && !res.users.length && <div className="empty-small">Không có kết quả nào</div>}
        </div>
      )}
    </div>
  );
}

export default function WeworkLayout() {
  const { user, company } = useApp();
  const [projects, setProjects] = useState([]);
  const [taskId, setTaskId] = useState(null);
  const [createDefaults, setCreateDefaults] = useState(null);
  const [projectForm, setProjectForm] = useState(null);
  const [version, setVersion] = useState(0);
  const [mobileNav, setMobileNav] = useState(false);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [meta, setMeta] = useState({ can_view_reports: user.role === 'admin' });
  const loadProjects = useCallback(async () => setProjects(await api.get('/projects', { sort: 'name' })), []);
  useEffect(() => { loadProjects(); }, [loadProjects]);
  const loadMeta = useCallback(() => api.get('/wework/meta').then(setMeta).catch(() => {}), []);
  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => setMobileNav(false), [location.key]);
  useEffect(() => {
    if (params.get('create') === '1') {
      setCreateDefaults({});
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const ctx = {
    projects, loadProjects, version, bump,
    canReports: !!meta.can_view_reports, loadMeta,
    openTask: setTaskId,
    openCreate: (defaults = {}) => setCreateDefaults(defaults),
    openProjectForm: (opts) => setProjectForm(opts),
  };
  const [sections, setSections] = useState({ sum: true, proj: true, dep: true, custom: true });
  const toggle = (k) => setSections((s) => ({ ...s, [k]: !s[k] }));
  const link = (to, label, Icon, end = true) => (
    <NavLink to={to} end={end} className={({ isActive }) => cx('ww-link', isActive && 'active')}><Icon size={16} /> {label}</NavLink>
  );
  const projectLink = (p) => (
    <NavLink key={p.id} to={`/wework/project/${p.id}`} className={({ isActive }) => cx('ww-link', isActive && 'active')}>
      <span className="proj-dot" style={{ background: p.color || '#2d7ff9' }}>{p.name.trim()[0]?.toUpperCase()}</span>
      <span className="ellipsis">{p.name}</span>
    </NavLink>
  );
  const onlyProjects = projects.filter((p) => p.kind === 'project');
  const deps = projects.filter((p) => p.kind === 'department');

  return (
    <WeworkCtx.Provider value={ctx}>
      <div className="wework">
        {mobileNav && <div className="side-backdrop" onClick={() => setMobileNav(false)} />}
        <aside className={cx('ww-side', mobileNav && 'open')}>
          <Link to="/" className="brand side-brand" title="Về trang chủ">
            <img className="brand-logo" src="/logo-192.png" alt="LDL" />
            <span className="brand-name">{company}</span>
          </Link>
          <div className="ww-user">
            <UserMenu dark />
            <div className="grow" />
            <ContactsButton dark />
            <NotificationBell app="wework" dark />
            <AppSwitcher dark />
          </div>
          <QuickSearch />
          <div className="ww-scroll">
            <div className="ww-section">
              <button className="ww-title" onClick={() => toggle('sum')}>TỔNG HỢP <ChevronDown size={13} /></button>
              {sections.sum && (
                <>
                  {link('/wework', 'Công việc', Home)}
                  {link('/wework/my', 'Công việc của tôi', CheckSquare)}
                  {link('/wework/projects', 'Dự án', FolderKanban)}
                  {link('/wework/departments', 'Phòng ban', Building2)}
                  {link('/wework/members', 'Thành viên', Users)}
                  {meta.can_view_reports && link('/wework/reports', 'Báo cáo', BarChart3)}
                  <Link to="/office" className="ww-link"><FileText size={16} /> Văn bản (Office)</Link>
                </>
              )}
            </div>
            <div className="ww-section">
              <button className="ww-title" onClick={() => toggle('proj')}>DỰ ÁN <ChevronDown size={13} /></button>
              {sections.proj && onlyProjects.map(projectLink)}
            </div>
            {deps.length > 0 && (
              <div className="ww-section">
                <button className="ww-title" onClick={() => toggle('dep')}>PHÒNG BAN <ChevronDown size={13} /></button>
                {sections.dep && deps.map(projectLink)}
              </div>
            )}
            <div className="ww-section">
              <button className="ww-title" onClick={() => toggle('custom')}>TÙY CHỈNH <ChevronDown size={13} /></button>
              {sections.custom && (
                <>
                  <button className="ww-link" onClick={() => setProjectForm({ kind: 'project' })}><PlusSquare size={16} /> Tạo dự án mới</button>
                  <button className="ww-link" onClick={() => setProjectForm({ kind: 'department' })}><PlusSquare size={16} /> Tạo phòng ban mới</button>
                  {link('/wework/templates', 'Tạo từ mẫu', Copy)}
                  {user.role === 'admin' && link('/wework/bulk', 'Tác vụ hàng loạt', ListChecks)}
                  {user.role === 'admin' && <Link to="/admin" className="ww-link"><Settings size={16} /> Cài đặt hệ thống</Link>}
                  {link('/wework/guide', 'Video hướng dẫn', PlayCircle)}
                </>
              )}
            </div>
          </div>
        </aside>
        <div className="ww-content">
          <header className="topbar ww-mobilebar">
            <button className="icon-btn on-dark" onClick={() => setMobileNav(!mobileNav)} aria-label="Menu Wework"><Menu size={20} /></button>
            <Link to="/" className="brand"><img className="brand-logo" src="/logo-192.png" alt="LDL" /></Link>
            <span className="topbar-title">Wework</span>
            <div className="grow" />
            <button className="icon-btn on-dark" onClick={() => ctx.openCreate({})} aria-label="Tạo công việc"><PlusSquare size={19} /></button>
            <ContactsButton dark />
            <NotificationBell app="wework" dark />
            <UserMenu dark showName={false} />
          </header>
          <Outlet />
        </div>
      </div>
      {taskId && <TaskDrawer id={taskId} onClose={() => setTaskId(null)} onChanged={bump} />}
      {createDefaults && (
        <TaskCreateModal defaults={createDefaults} onClose={() => setCreateDefaults(null)}
          onCreated={(t) => { setCreateDefaults(null); bump(); if (createDefaults.openAfter !== false) setTaskId(t.id); }} />
      )}
      {projectForm && (
        <ProjectFormModal {...projectForm} onClose={() => setProjectForm(null)}
          onSaved={(p) => { setProjectForm(null); loadProjects(); navigate(`/wework/project/${p.id}`); }} />
      )}
    </WeworkCtx.Provider>
  );
}
