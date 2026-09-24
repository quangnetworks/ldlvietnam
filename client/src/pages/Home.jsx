import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, StickyNote, Palette, Users, Lock, X, Plus, Trash2, Cake } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { NotificationBell, UserMenu } from '../components/shell.jsx';
import { Avatar, Drawer, Empty } from '../components/ui.jsx';
import { ECOSYSTEM, CATEGORIES, canOpen, AppIcon } from '../apps.jsx';
import { fmtDate, timeAgo, cx } from '../utils.js';

const BACKGROUNDS = [
  'linear-gradient(135deg, #1b2a33 0%, #0e3b43 45%, #11242c 100%)',
  'linear-gradient(135deg, #2b1d1d 0%, #5a1f1f 50%, #1e1414 100%)',
  'linear-gradient(135deg, #1a1f36 0%, #283593 50%, #121630 100%)',
  'linear-gradient(135deg, #1d2b1f 0%, #2e5e3a 50%, #142018 100%)',
  'linear-gradient(135deg, #2d2d2d 0%, #444 50%, #1c1c1c 100%)',
  'linear-gradient(135deg, #3b2412 0%, #8a4b14 50%, #26170c 100%)',
];
const DAYS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function greeting(h) {
  if (h < 11) return 'Chào buổi sáng';
  if (h < 14) return 'Chào buổi trưa';
  if (h < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

function NotesDrawer({ onClose }) {
  const [notes, reload] = useFetch(() => api.get('/notes'), []);
  const [text, setText] = useState('');
  const add = async () => {
    if (!text.trim()) return;
    await api.post('/notes', { content: text });
    setText('');
    reload();
  };
  return (
    <Drawer onClose={onClose} width={420}>
      <div className="td-head"><b className="grow">Ghi chú</b><button className="icon-btn" onClick={onClose} aria-label="Đóng"><X size={18} /></button></div>
      <div className="td-scroll">
        <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Viết ghi chú nhanh..."
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add(); }} />
        <button className="btn btn-primary btn-sm mt" disabled={!text.trim()} onClick={add}><Plus size={14} /> Tạo mới</button>
        <div className="notes">
          {notes?.map((n) => (
            <div key={n.id} className="note">
              <div className="pre grow">{n.content}</div>
              <div className="row between">
                <small className="muted">{timeAgo(n.updated_at)}</small>
                <button className="icon-btn sm" onClick={async () => { await api.del(`/notes/${n.id}`); reload(); }} aria-label="Xoá"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
          {notes && !notes.length && <Empty icon={StickyNote} title="Chưa có ghi chú" />}
        </div>
      </div>
    </Drawer>
  );
}

export default function Home() {
  const { user, company, apps } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const now = useNow();
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);
  const [prefs, reloadPrefs] = useFetch(() => api.get('/me/prefs'), []);
  const [summary] = useFetch(() => api.get('/home/summary'), []);
  const bg = BACKGROUNDS[Number(prefs?.home_bg_index) || 0] || BACKGROUNDS[0];

  const list = useMemo(() => ECOSYSTEM
    .filter((a) => cat === 'all' || a.cat === cat)
    .filter((a) => !q || `${a.name} ${a.desc}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(canOpen(b, apps)) - Number(canOpen(a, apps))), [cat, q, apps]);

  const open = (a) => {
    if (canOpen(a, apps)) navigate(a.path);
    else if (!a.path) toast(`${a.name} sắp ra mắt trong hệ sinh thái LDL`, 'info');
    else toast(`Bạn chưa được cấp quyền sử dụng ${a.name}. Liên hệ quản trị viên.`, 'error');
  };
  const c = summary?.counters || {};
  const chips = [
    c.requests_to_approve > 0 && { label: `${c.requests_to_approve} đề xuất chờ bạn duyệt`, to: '/request?tab=my_turn' },
    c.documents_to_approve > 0 && { label: `${c.documents_to_approve} văn bản chờ bạn duyệt`, to: '/office?box=pending_me' },
    c.tasks_active > 0 && { label: `${c.tasks_active} công việc đang thực hiện`, to: '/wework/my' },
    c.tasks_overdue > 0 && { label: `${c.tasks_overdue} công việc quá hạn`, to: '/wework/my?status=overdue', danger: true },
  ].filter(Boolean);
  const pad = (n) => String(n).padStart(2, '0');
  const session = now.getHours() < 12 ? 'Sáng' : now.getHours() < 18 ? 'Chiều' : 'Tối';

  return (
    <div className="home" style={{ background: bg }}>
      <header className="home-top">
        <Link to="/" className="brand"><img className="brand-logo" src="/logo-192.png" alt="LDL" /><span className="brand-name">{company}</span></Link>
        <div className="grow" />
        <Link to="/account/members" className="icon-btn on-dark" title="Thành viên"><Users size={18} /></Link>
        <button className="icon-btn on-dark" title="Ghi chú" onClick={() => setNotesOpen(true)}><StickyNote size={18} /></button>
        <button className="icon-btn on-dark" title="Cấu hình hình nền" onClick={() => setBgOpen((o) => !o)}><Palette size={18} /></button>
        <NotificationBell app="home" dark />
        <UserMenu dark />
      </header>
      {bgOpen && (
        <div className="bg-picker">
          <b>Chọn màu nền</b>
          <div className="row gap">
            {BACKGROUNDS.map((b, i) => (
              <button key={i} className={cx('bg-swatch', bg === b && 'active')} style={{ background: b }} aria-label={`Nền ${i + 1}`}
                onClick={async () => { await api.put('/me/prefs', { home_bg_index: i }); reloadPrefs(); }} />
            ))}
          </div>
        </div>
      )}

      <div className="home-body">
        <nav className="home-cats">
          {CATEGORIES.map((ct) => (
            <button key={ct.key} className={cx(cat === ct.key && 'active')} onClick={() => setCat(ct.key)}>{ct.label.toUpperCase()}</button>
          ))}
        </nav>
        <div className="home-main">
          <div className="home-search">
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm kiếm ứng dụng" />
          </div>
          <div className="home-apps">
            {list.map((a) => {
              const ok = canOpen(a, apps);
              return (
                <button key={a.key} className={cx('home-app', !ok && 'disabled')} onClick={() => open(a)} title={a.desc}>
                  <span className="home-app-icon"><AppIcon app={a} size={64} />{a.path && !ok && <span className="lock"><Lock size={12} /></span>}</span>
                  <b>{a.name}</b>
                  <small>{a.path ? a.desc : 'Sắp ra mắt'}</small>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <footer className="home-foot">
        <div className="home-clock">
          <div className="clock">{pad(now.getHours())}:{pad(now.getMinutes())}<small>:{pad(now.getSeconds())}</small></div>
          <div className="clock-date">{session.toUpperCase()} {DAYS[now.getDay()].toUpperCase()}, {fmtDate(now)}</div>
        </div>
        <div className="home-news">
          <h2>{greeting(now.getHours())}, {user.name}</h2>
          {chips.length > 0 && (
            <div className="home-chips">
              {chips.map((ch) => <Link key={ch.label} to={ch.to} className={cx('home-chip', ch.danger && 'danger')}>{ch.label}</Link>)}
            </div>
          )}
          {summary?.birthdays?.length > 0 && (
            <div className="home-bday"><Cake size={15} /> Sinh nhật hôm nay: {summary.birthdays.map((b) => b.name).join(', ')} 🎉</div>
          )}
          <div className="home-news-title">THÔNG BÁO TOÀN CÔNG TY</div>
          {summary?.announcements?.map((a) => (
            <Link key={a.id} to={`/office/doc/${a.id}`} className="home-news-item">
              <Avatar name={a.issuer_name || 'LDL'} size={20} />
              <span className="grow ellipsis">{a.title}</span>
              <small>{a.issuer_name}, {fmtDate(a.issued_at)}</small>
            </Link>
          ))}
          {summary && !summary.announcements.length && <div className="muted small">Chưa có thông báo mới</div>}
        </div>
      </footer>
      {notesOpen && <NotesDrawer onClose={() => setNotesOpen(false)} />}
    </div>
  );
}
