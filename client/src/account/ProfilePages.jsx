import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUp, Plus, Trash2, GraduationCap, Briefcase, Award } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Avatar, Spinner, Field, Pagination } from '../components/ui.jsx';
import { fmtDate, fmtDateTime } from '../utils.js';

const SECTIONS = [
  { key: 'education', label: 'Học vấn', icon: GraduationCap, title: 'Bằng cấp / chuyên ngành', place: 'Trường' },
  { key: 'experience', label: 'Kinh nghiệm làm việc', icon: Briefcase, title: 'Vị trí', place: 'Công ty' },
  { key: 'awards', label: 'Giải thưởng và danh hiệu', icon: Award, title: 'Giải thưởng', place: 'Đơn vị trao' },
];
const COLORS = ['#2d7ff9', '#20c997', '#f59f00', '#e8590c', '#7048e8', '#d6336c', '#0ca678', '#1098ad', '#ae3ec9', '#5c940d', '#e03131', '#495057'];

export const parseProfile = (p) => {
  try { return { education: [], experience: [], awards: [], ...(p ? JSON.parse(p) : {}) }; } catch { return { education: [], experience: [], awards: [] }; }
};

function PersonChip({ u }) {
  return (
    <Link to={`/account/u/${u.id}`} className="person-chip">
      <Avatar name={u.name} color={u.color} size={34} />
      <span><b>{u.name}</b><small className="muted block">@{u.username}{u.title ? ` · ${u.title}` : ''}</small></span>
    </Link>
  );
}

export function ProfileView() {
  const { id } = useParams();
  const { user } = useApp();
  const navigate = useNavigate();
  const uid = id ? Number(id) : user.id;
  const [p, , loading, error] = useFetch(() => api.get(`/account/profile/${uid}`), [uid]);
  if (error) return <div className="acc-page"><div className="alert alert-error">{error.message}</div></div>;
  if (loading && !p) return <div className="acc-page"><Spinner /></div>;
  const profile = parseProfile(p.profile);
  const own = uid === user.id;
  return (
    <div className="acc-page">
      <div className="acc-head">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Quay lại"><ArrowLeft size={18} /></button>
        <div className="grow"><small className="muted">TÀI KHOẢN</small><div className="acc-head-name">{p.name} · <span className="muted">@{p.username}</span></div></div>
        {own && <Link to="/account/edit" className="btn btn-success"><ArrowUp size={15} /> Chỉnh sửa tài khoản của tôi</Link>}
        {!own && user.role === 'admin' && <Link to={`/account/members?edit=${p.id}`} className="btn btn-success">Sửa tài khoản</Link>}
      </div>
      <div className="profile">
        <div className="profile-top">
          <Avatar name={p.name} color={p.color} size={100} />
          <div className="grow">
            <h1>{p.name} {!p.active && <span className="badge badge-gray">VÔ HIỆU HOÁ</span>}</h1>
            <div className="muted">{p.title || 'Chưa nhập chức danh'}{p.role === 'admin' && <span className="text-red"> · Quản trị hệ thống</span>}</div>
            <dl className="profile-dl">
              <dt>Email</dt><dd>{p.email || '—'}</dd>
              <dt>Số điện thoại</dt><dd>{p.phone || 'Chưa nhập số điện thoại'}</dd>
              <dt>Công ty</dt><dd>{p.company}</dd>
              <dt>Phòng ban</dt><dd>{p.department_name || '—'}</dd>
              <dt>Ngày sinh</dt><dd>{p.birthday ? fmtDate(p.birthday) : 'Chưa nhập ngày sinh'}</dd>
              <dt>Quản lý trực tiếp</dt><dd>{p.manager ? <Link to={`/account/u/${p.manager.id}`}>{p.manager.name}</Link> : '—'}</dd>
            </dl>
          </div>
        </div>

        <section className="profile-sec">
          <h4>THÔNG TIN LIÊN HỆ</h4>
          <dl className="profile-dl">
            <dt>Địa chỉ</dt><dd>{p.address || '—'}</dd>
            <dt>Giới thiệu</dt><dd className="pre">{p.bio || '—'}</dd>
            <dt>Đăng nhập gần nhất</dt><dd>{p.last_login_at ? fmtDateTime(p.last_login_at) : '—'}</dd>
          </dl>
        </section>
        <section className="profile-sec">
          <h4>NHÓM NGƯỜI DÙNG ({p.groups.length})</h4>
          <div className="chips">{p.groups.map((g) => <Link key={g.id} to={`/account/groups?open=${g.id}`} className="chip">{g.name}</Link>)}</div>
        </section>
        <section className="profile-sec">
          <h4>NGƯỜI BÁO CÁO TRỰC TIẾP ({p.reports.length})</h4>
          <div className="person-grid">{p.reports.map((u) => <PersonChip key={u.id} u={u} />)}</div>
        </section>
        <section className="profile-sec">
          <h4>ỨNG DỤNG ĐƯỢC SỬ DỤNG</h4>
          <div className="chips">{p.apps.map((a) => <span key={a} className="chip">Base {a[0].toUpperCase() + a.slice(1)}</span>)}</div>
        </section>
        {SECTIONS.map((s) => (
          <section key={s.key} className="profile-sec">
            <h4>{s.label.toUpperCase()} {own && <Link to="/account/edit" className="icon-btn sm" aria-label="Thêm"><Plus size={15} /></Link>}</h4>
            {profile[s.key].length ? profile[s.key].map((x, i) => (
              <div key={i} className="timeline-item">
                <s.icon size={18} className="muted" />
                <div><b>{x.title}</b><div className="muted small">{[x.place, [x.from, x.to].filter(Boolean).join(' – ')].filter(Boolean).join(' · ')}</div>
                  {x.note && <div className="small pre">{x.note}</div>}</div>
              </div>
            )) : <div className="empty-box">Không có thông tin.</div>}
          </section>
        ))}
      </div>
    </div>
  );
}

export function ProfileEdit() {
  const { user, setUser, loadDirectory } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [p] = useFetch(() => api.get(`/account/profile/${user.id}`), [user.id]);
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (p) setF({ name: p.name, title: p.title || '', email: p.email || '', phone: p.phone || '', birthday: p.birthday || '',
      address: p.address || '', bio: p.bio || '', profile: parseProfile(p.profile) });
  }, [p]);
  if (!f) return <div className="acc-page"><Spinner /></div>;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setItem = (sec, i, k, v) => {
    const list = [...f.profile[sec]];
    list[i] = { ...list[i], [k]: v };
    setF({ ...f, profile: { ...f.profile, [sec]: list } });
  };
  const save = async () => {
    setErr('');
    try {
      const r = await api.put('/auth/me', f);
      setUser(r.user);
      loadDirectory();
      toast('Đã lưu thông tin tài khoản');
      navigate('/account');
    } catch (e) {
      setErr(e.message);
    }
  };
  return (
    <div className="acc-page">
      <div className="acc-head">
        <div className="grow"><small className="muted">TÀI KHOẢN</small><div className="acc-head-name">Chỉnh sửa tài khoản</div></div>
        <button className="btn" onClick={() => navigate('/account')}>Hủy</button>
        <button className="btn btn-success" onClick={save}>Lưu thay đổi</button>
      </div>
      {err && <div className="alert alert-error">{err}</div>}
      <div className="profile">
        <section className="profile-sec">
          <h4>THÔNG TIN CƠ BẢN</h4>
          <div className="form-grid">
            <Field label="Họ tên" required><input className="input" value={f.name} onChange={set('name')} /></Field>
            <Field label="Chức danh"><input className="input" value={f.title} onChange={set('title')} /></Field>
            <Field label="Ngày sinh"><input type="date" className="input" value={f.birthday} onChange={set('birthday')} /></Field>
          </div>
        </section>
        <section className="profile-sec">
          <h4>THÔNG TIN LIÊN LẠC</h4>
          <div className="form-grid">
            <Field label="Email"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
            <Field label="Số điện thoại"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
            <div className="span-2"><Field label="Địa chỉ"><input className="input" value={f.address} onChange={set('address')} /></Field></div>
            <div className="span-2"><Field label="Giới thiệu bản thân"><textarea className="input" rows={3} value={f.bio} onChange={set('bio')} /></Field></div>
          </div>
        </section>
        {SECTIONS.map((s) => (
          <section key={s.key} className="profile-sec">
            <h4>{s.label.toUpperCase()}
              <button className="icon-btn sm" aria-label="Thêm" onClick={() => setF({ ...f, profile: { ...f.profile, [s.key]: [...f.profile[s.key], { title: '', place: '', from: '', to: '' }] } })}><Plus size={15} /></button>
            </h4>
            {f.profile[s.key].map((x, i) => (
              <div key={i} className="section-row">
                <input className="input" placeholder={s.title} value={x.title} onChange={(e) => setItem(s.key, i, 'title', e.target.value)} />
                <input className="input" placeholder={s.place} value={x.place} onChange={(e) => setItem(s.key, i, 'place', e.target.value)} />
                <input className="input" placeholder="Từ (năm)" value={x.from} onChange={(e) => setItem(s.key, i, 'from', e.target.value)} />
                <input className="input" placeholder="Đến" value={x.to} onChange={(e) => setItem(s.key, i, 'to', e.target.value)} />
                <button className="icon-btn sm" aria-label="Xoá" onClick={() => setF({ ...f, profile: { ...f.profile, [s.key]: f.profile[s.key].filter((_, j) => j !== i) } })}><Trash2 size={15} /></button>
              </div>
            ))}
            {!f.profile[s.key].length && <div className="empty-box">Không có thông tin. Bấm + để thêm.</div>}
          </section>
        ))}
      </div>
    </div>
  );
}

export function PasswordPage() {
  const toast = useToast();
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [err, setErr] = useState('');
  const save = async () => {
    setErr('');
    if (pw.next !== pw.confirm) return setErr('Mật khẩu nhập lại không khớp');
    try {
      await api.put('/auth/password', { current: pw.current, next: pw.next });
      toast('Đã đổi mật khẩu');
      setPw({ current: '', next: '', confirm: '' });
    } catch (e) { setErr(e.message); }
  };
  return (
    <div className="acc-page narrow">
      <h1 className="acc-title">Thay đổi mật khẩu</h1>
      {err && <div className="alert alert-error">{err}</div>}
      <div className="form-grid one">
        <Field label="Mật khẩu hiện tại"><input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
        <Field label="Mật khẩu mới" hint="Tối thiểu 6 ký tự"><input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
        <Field label="Nhập lại mật khẩu mới"><input className="input" type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
        <div><button className="btn btn-primary" onClick={save} disabled={!pw.current || !pw.next}>Đổi mật khẩu</button></div>
      </div>
    </div>
  );
}

export function ColorPage() {
  const { user, setUser, loadDirectory } = useApp();
  const toast = useToast();
  const pick = async (color) => {
    const r = await api.put('/auth/me', { color });
    setUser(r.user);
    loadDirectory();
    toast('Đã đổi màu hiển thị');
  };
  return (
    <div className="acc-page narrow">
      <h1 className="acc-title">Đổi màu hiển thị</h1>
      <p className="muted">Màu nền ảnh đại diện của bạn trên toàn hệ thống.</p>
      <div className="row gap"><Avatar name={user.name} color={user.color} size={72} />
        <div className="color-row">{COLORS.map((c) => (
          <button key={c} className={`color-dot lg ${user.color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => pick(c)} aria-label={c} />
        ))}</div>
      </div>
    </div>
  );
}

export function LoginHistory({ all = false }) {
  const [page, setPage] = useState(1);
  const [data] = useFetch(() => api.get('/account/login-logs', { page }), [page]);
  return (
    <div className={all ? '' : 'acc-page'}>
      {!all && <h1 className="acc-title">Lịch sử đăng nhập cá nhân</h1>}
      {!data ? <Spinner /> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr>{all && <th>Tài khoản</th>}<th>Thời gian</th><th>Kết quả</th><th>Địa chỉ IP</th><th>Thiết bị / trình duyệt</th></tr></thead>
              <tbody>
                {data.items.map((l) => (
                  <tr key={l.id}>
                    {all && <td>{l.name ? <span className="row gap-sm"><Avatar name={l.name} color={l.color} size={22} /> {l.name}</span> : <span className="muted">@{l.username}</span>}</td>}
                    <td className="nowrap">{fmtDateTime(l.created_at)}</td>
                    <td>{l.success ? <span className="text-green">Thành công</span> : <span className="text-red">Sai mật khẩu</span>}</td>
                    <td>{l.ip || '—'}</td>
                    <td className="small muted">{(l.user_agent || '').slice(0, 90)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} total={data.total} limit={data.limit} onChange={setPage} />
        </>
      )}
    </div>
  );
}
