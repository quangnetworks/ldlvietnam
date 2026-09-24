import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, StickyNote, Palette, Users, Lock, X, Plus, Trash2, Cake, Megaphone, AlertTriangle, CalendarClock, MessageCircle, CalendarCheck2 } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { NotificationBell, UserMenu, ThemeToggle } from '../components/shell.jsx';
import { ContactsButton } from '../components/Contact.jsx';
import HomeAgenda from '../home/HomeAgenda.jsx';
import { BRANDS, applyBrand, getBrandIndex } from '../theme.js';
import HomeChat from '../home/HomeChat.jsx';
import HomeWeather from '../home/HomeWeather.jsx';
import HomeImportant from '../home/HomeImportant.jsx';
import PushCard from '../components/PushCard.jsx';
import HomeQuote from '../home/HomeQuote.jsx';
import { Avatar, Drawer, Empty } from '../components/ui.jsx';
import { ECOSYSTEM, CATEGORIES, canOpen, AppIcon } from '../apps.jsx';
import { fmtDate, timeAgo, cx } from '../utils.js';

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
  const [agenda, reloadAgenda, agendaLoading] = useFetch(() => api.get('/home/agenda'), []);
  const [chat] = useFetch(() => ((apps || []).includes('message') ? api.get('/chat/unread') : Promise.resolve(null)), [apps]);
  const [brand, setBrand] = useState(getBrandIndex());
  useEffect(() => { if (prefs?.home_bg_index != null) setBrand(applyBrand(prefs.home_bg_index)); }, [prefs]);
  const pickBrand = async (i) => {
    setBrand(applyBrand(i));
    await api.put('/me/prefs', { home_bg_index: i });
    reloadPrefs();
  };

  const list = useMemo(() => ECOSYSTEM
    .filter((a) => cat === 'all' || a.cat === cat)
    .filter((a) => !q || `${a.name} ${a.desc}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(canOpen(b, apps)) - Number(canOpen(a, apps))), [cat, q, apps]);

  const open = (a) => {
    if (canOpen(a, apps)) navigate(a.path);
    else if (!a.path) toast(`${a.name} sắp ra mắt trong hệ sinh thái LDL`, 'info');
    else toast(`Bạn chưa được cấp quyền sử dụng ${a.name}. Liên hệ quản trị viên.`, 'error');
  };
  const ac = agenda?.counts || {};
  const stats = [
    { label: 'Quá hạn', value: ac.overdue, icon: AlertTriangle, cls: 'danger' },
    { label: 'Hôm nay', value: ac.today, icon: CalendarCheck2, cls: 'warn' },
    { label: 'Sắp tới', value: ac.upcoming, icon: CalendarClock, cls: '' },
    (apps || []).includes('message') && { label: 'Tin chưa đọc', value: chat?.unread, icon: MessageCircle, cls: '', to: '/message' },
  ].filter(Boolean);
  const pad = (n) => String(n).padStart(2, '0');

  return (
    <div className="home2">
      <header className="home2-hero">
        <div className="home2-top">
          <Link to="/" className="brand"><img className="brand-logo" src="/logo-192.png" alt="LDL" /><span className="brand-name">{company}</span></Link>
          <div className="grow" />
          <Link to="/account/members" className="icon-btn on-dark hide-sm" title="Thành viên"><Users size={18} /></Link>
          <ContactsButton dark />
          <button className="icon-btn on-dark" title="Ghi chú" onClick={() => setNotesOpen(true)}><StickyNote size={18} /></button>
          <button className="icon-btn on-dark" title="Màu thương hiệu" onClick={() => setBgOpen((o) => !o)}><Palette size={18} /></button>
          <ThemeToggle dark />
          <NotificationBell app="home" dark />
          <UserMenu dark />
        </div>
        {bgOpen && (
          <div className="bg-picker">
            <b>Màu thương hiệu</b>
            <small className="muted">Áp dụng cho Home và thanh điều hướng của mọi phân hệ</small>
            <div className="row gap">
              {BRANDS.map((b, i) => (
                <button key={b.name} className={cx('bg-swatch', brand === i && 'active')} style={{ background: b.grad }} title={b.name} aria-label={b.name}
                  onClick={() => pickBrand(i)} />
              ))}
            </div>
          </div>
        )}
        <div className="home2-hero-body">
          <div className="home2-greet">
            <div className="home2-date">{DAYS[now.getDay()]}, {fmtDate(now)}</div>
            <h1>{greeting(now.getHours())}, {user.name} 👋</h1>
            <HomeQuote />
            {summary?.birthdays?.length > 0 && (
              <div className="home2-bday"><Cake size={15} /> Sinh nhật hôm nay: {summary.birthdays.map((b) => b.name).join(', ')} 🎉</div>
            )}
          </div>
          <div className="home2-right">
            <div className="home2-clock">{pad(now.getHours())}:{pad(now.getMinutes())}<small>:{pad(now.getSeconds())}</small></div>
            <HomeWeather />
          </div>
        </div>
        <div className="home2-stats">
          {stats.map((st) => {
            const inner = <><st.icon size={18} /><b>{st.value ?? '–'}</b><span>{st.label}</span></>;
            return st.to
              ? <Link key={st.label} to={st.to} className={cx('home2-stat', st.value > 0 && st.cls)}>{inner}</Link>
              : <div key={st.label} className={cx('home2-stat', st.value > 0 && st.cls)}>{inner}</div>;
          })}
        </div>
      </header>

      <div className="home2-grid">
        <div className="home2-col left">
          <PushCard compact />
          {(apps || []).includes('wework') && <HomeImportant data={agenda} />}
          <HomeAgenda data={agenda} reload={reloadAgenda} loading={agendaLoading} />
        </div>

        <div className="home2-col mid">
          <section className="hcard">
            <div className="hcard-head wrap">
              <h3>Ứng dụng</h3>
              <div className="home2-search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm ứng dụng" /></div>
            </div>
            <nav className="home2-cats">
              {CATEGORIES.map((ct) => (
                <button key={ct.key} className={cx(cat === ct.key && 'active')} onClick={() => setCat(ct.key)}>{ct.label}</button>
              ))}
            </nav>
            <div className="home2-apps">
              {list.map((a) => {
                const ok = canOpen(a, apps);
                return (
                  <button key={a.key} className={cx('home2-app', !ok && 'disabled')} onClick={() => open(a)} title={a.desc}>
                    <span className="home2-app-icon"><AppIcon app={a} size={46} />{a.path && !ok && <span className="lock"><Lock size={11} /></span>}</span>
                    <b className="ellipsis">{a.name.replace(/^LDL /, '')}</b>
                    <small className="ellipsis">{a.path ? a.desc : 'Sắp ra mắt'}</small>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="hcard">
            <div className="hcard-head"><h3><Megaphone size={16} /> Thông báo toàn công ty</h3>{(apps || []).includes('office') && <Link to="/office" className="link small">Xem tất cả</Link>}</div>
            {summary?.announcements?.map((a) => (
              <Link key={a.id} to={`/office/doc/${a.id}`} className="home2-news">
                <Avatar name={a.issuer_name || 'LDL'} size={30} />
                <span className="grow"><span className="ellipsis block">{a.title}</span><small className="muted">{a.issuer_name} · {fmtDate(a.issued_at)}{a.code ? ` · ${a.code}` : ''}</small></span>
              </Link>
            ))}
            {summary && !summary.announcements.length && <div className="agenda-empty"><Megaphone size={24} /><span>Chưa có thông báo mới</span></div>}
          </section>
        </div>

        <div className="home2-col right"><HomeChat /></div>
      </div>
      {notesOpen && <NotesDrawer onClose={() => setNotesOpen(false)} />}
    </div>
  );
}
