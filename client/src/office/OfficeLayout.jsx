import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  LayoutGrid, Eye, FileCheck2, Settings2, Star, FilePen, Hash, Server, FileText, Folder, FolderOpen, ChevronDown,
  Search, Save, CalendarX, XCircle, Archive, Trash2, Plus, Building2, Send, Menu,
} from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { AppSwitcher, NotificationBell, UserMenu, QuickCreate } from '../components/shell.jsx';
import { buildTree, cx } from '../utils.js';

function Section({ title, children, defaultOpen = true, action }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="side-section">
      <div className="side-title">
        <button type="button" onClick={() => setOpen(!open)}>{title}</button>
        {action}
        <button type="button" className="side-caret" onClick={() => setOpen(!open)} aria-label="Thu gọn">
          <ChevronDown size={14} style={{ transform: open ? '' : 'rotate(-90deg)' }} />
        </button>
      </div>
      {open && children}
    </div>
  );
}

function TreeItems({ nodes, param, current, depth = 0, icon = 'folder' }) {
  return nodes.map((n) => {
    const active = String(current) === String(n.id);
    const Icon = icon === 'doc' ? FileText : active ? FolderOpen : Folder;
    return (
      <div key={n.id}>
        <Link to={`/office?${param}=${n.id}`} className={cx('side-link', active && 'active', depth > 0 && 'nested')}
          style={{ paddingLeft: 12 + depth * 16 }}>
          <Icon size={15} />
          <span className="grow ellipsis">{n.name}</span>
        </Link>
        {n.children.length > 0 && <TreeItems nodes={n.children} param={param} current={current} depth={depth + 1} icon={icon} />}
      </div>
    );
  });
}

export default function OfficeLayout() {
  const { company, user } = useApp();
  const [meta, setMeta] = useState(null);
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [q, setQ] = useState(params.get('q') || '');
  const [mobileNav, setMobileNav] = useState(false);

  const loadMeta = useCallback(async () => setMeta(await api.get('/office/meta')), []);
  useEffect(() => { loadMeta(); }, [loadMeta, location.key]);
  useEffect(() => setMobileNav(false), [location.key]);

  const isList = location.pathname === '/office';
  const box = isList ? params.get('box') || (params.toString() ? '' : 'home') : '';
  const boxLink = (key, label, Icon, count) => (
    <Link to={key === 'home' ? '/office' : `/office?box=${key}`} className={cx('side-link', isList && box === key && 'active')}>
      <Icon size={15} /> <span className="grow">{label}</span>
      {count ? <span className="side-count">{count}</span> : null}
    </Link>
  );
  const addTaxonomy = async (kind, label) => {
    const name = window.prompt(`Tên ${label} mới`);
    if (!name?.trim()) return;
    await api.post(`/office/${kind}`, { name: name.trim() });
    loadMeta();
  };

  return (
    <div className="office">
      <header className="topbar">
        <button className="icon-btn on-dark mobile-only" onClick={() => setMobileNav(!mobileNav)} aria-label="Menu"><Menu size={20} /></button>
        <Link to="/office" className="brand">
          <img className="brand-logo" src="/logo-192.png" alt="LDL" />
          <span className="brand-name">{company}</span>
        </Link>
        <div className="grow" />
        <form className="top-search" onSubmit={(e) => { e.preventDefault(); navigate(`/office?q=${encodeURIComponent(q)}`); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Gõ và enter để tìm kiếm" />
          <Search size={16} />
        </form>
        <QuickCreate />
        <NotificationBell app="office" dark />
        <AppSwitcher dark />
        <UserMenu dark />
      </header>
      <div className="office-body">
        <aside className={cx('office-side', mobileNav && 'open')}>
          <div className="side-company ellipsis">{company}</div>
          {boxLink('home', 'Trang chủ', LayoutGrid)}
          {boxLink('following', 'Đang theo dõi', Eye)}
          {boxLink('pending_me', 'Chờ tôi duyệt', FileCheck2, meta?.counts.pending_me)}
          {user.role === 'admin' && (
            <NavLink to="/office/settings" className={({ isActive }) => cx('side-link', isActive && 'active')}>
              <Settings2 size={15} /> Tùy chỉnh
            </NavLink>
          )}

          <Section title="CÁ NHÂN">
            {boxLink('starred', 'Yêu thích', Star)}
            {boxLink('mine', 'Tạo bởi tôi', FilePen)}
            {boxLink('numbering', 'Duyệt cấp số văn bản', Hash, meta?.counts.numbering)}
            {boxLink('system', 'Văn bản của hệ thống', Server)}
          </Section>

          <Section title="KHO LƯU TRỮ" action={<button className="side-add" onClick={() => addTaxonomy('folders', 'kho lưu trữ')} title="Thêm kho"><Plus size={13} /></button>}>
            {meta && <TreeItems nodes={buildTree(meta.folders)} param="folder_id" current={isList ? params.get('folder_id') : null} />}
          </Section>

          <Section title="LOẠI VĂN BẢN">
            {meta?.types.map((t) => (
              <Link key={t.id} to={`/office?type_id=${t.id}`} className={cx('side-link', isList && params.get('type_id') === String(t.id) && 'active')}>
                <FileText size={15} /> {t.name}
              </Link>
            ))}
          </Section>

          <Section title="CÂY THƯ MỤC" defaultOpen={false} action={<button className="side-add" onClick={() => addTaxonomy('categories', 'thư mục')} title="Thêm thư mục"><Plus size={13} /></button>}>
            {meta && <TreeItems nodes={buildTree(meta.categories)} param="category_id" current={isList ? params.get('category_id') : null} />}
          </Section>

          <Section title="ĐẾN NỘI BỘ" defaultOpen={false}>
            {meta?.departments.map((d) => (
              <Link key={d.id} to={`/office?department_id=${d.id}`} className={cx('side-link', isList && params.get('department_id') === String(d.id) && 'active')}>
                <Building2 size={15} /> <span className="ellipsis">{d.name}</span>
              </Link>
            ))}
          </Section>

          <Section title="GỬI BỞI" defaultOpen={false}>
            {meta?.departments.map((d) => (
              <Link key={d.id} to={`/office?sender_department_id=${d.id}`} className={cx('side-link', isList && params.get('sender_department_id') === String(d.id) && 'active')}>
                <Send size={15} /> <span className="ellipsis">{d.name}</span>
              </Link>
            ))}
          </Section>

          <Section title="TRẠNG THÁI">
            {boxLink('drafts', 'Đã lưu', Save, meta?.counts.drafts)}
            {boxLink('expired', 'Hết hạn', CalendarX)}
            {boxLink('rejected', 'Không thông qua', XCircle)}
            {boxLink('archived', 'Cất giữ', Archive)}
            {boxLink('trash', 'Đã tạm xóa', Trash2)}
          </Section>
        </aside>
        <main className="office-main">
          <Outlet context={{ meta, reloadMeta: loadMeta }} />
        </main>
      </div>
    </div>
  );
}
