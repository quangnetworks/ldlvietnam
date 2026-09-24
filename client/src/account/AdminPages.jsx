import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Search, ChevronDown, MoreHorizontal, ShieldCheck, UserX, UserCheck, Pencil, Eye, FileDown, FileUp, UserPlus, Plus, Trash2,
  Users, KeyRound,
} from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Avatar, Modal, Field, UserPicker, Spinner, Dropdown, MenuItem, Empty, Tabs, Pagination } from '../components/ui.jsx';
import { MODULE_APPS, AppIcon } from '../apps.jsx';
import { fmtDate, fmtDateTime, cx } from '../utils.js';
import { LoginHistory } from './ProfilePages.jsx';
import AvatarEditor from '../components/AvatarEditor.jsx';

const appByKey = Object.fromEntries(MODULE_APPS.map((a) => [a.module, a]));

// ---------------------------------------------------------------- user form
function UserModal({ user: editing, guest = false, onClose, onSaved }) {
  const { users, departments } = useApp();
  const toast = useToast();
  const [f, setF] = useState(editing ? { ...editing, password: '', department_id: editing.department_id || '' } : {
    username: '', password: '', name: '', email: '', phone: '', title: '', department_id: '', manager_id: null, role: guest ? 'guest' : 'member',
    birthday: '', apps: guest ? [] : MODULE_APPS.map((a) => a.module), expires_at: '',
  });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const save = async () => {
    setErr('');
    try {
      const body = { ...f, department_id: f.department_id || null };
      if (editing) await api.put(`/users/${editing.id}`, body);
      else await api.post('/users', body);
      toast(editing ? 'Đã cập nhật tài khoản' : 'Đã tạo tài khoản');
      onSaved();
    } catch (e) { setErr(e.message); }
  };
  const toggleApp = (k) => setF({ ...f, apps: f.apps.includes(k) ? f.apps.filter((x) => x !== k) : [...f.apps, k] });
  return (
    <Modal title={editing ? `Sửa tài khoản @${editing.username}` : 'Tạo tài khoản'} onClose={onClose} width={680}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-success" onClick={save}>Lưu</button></>}>
      {err && <div className="alert alert-error">{err}</div>}
      {editing && (
        <div className="row gap" style={{ marginBottom: 14 }}>
          <AvatarEditor userId={editing.id} name={editing.name} color={editing.color} size={64} />
          <small className="muted">Bấm biểu tượng máy ảnh để đổi ảnh đại diện của thành viên (lưu ngay, không cần bấm Lưu).</small>
        </div>
      )}
      <div className="form-grid">
        <Field label="Tên đăng nhập" required><input className="input" disabled={!!editing} value={f.username} onChange={set('username')} /></Field>
        <Field label={editing ? 'Mật khẩu mới (bỏ trống nếu không đổi)' : 'Mật khẩu'} required={!editing}>
          <input className="input" type="password" value={f.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
        <Field label="Họ tên" required><input className="input" value={f.name} onChange={set('name')} /></Field>
        <Field label="Chức danh"><input className="input" value={f.title || ''} onChange={set('title')} /></Field>
        <Field label="Email"><input className="input" value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="Số điện thoại"><input className="input" value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Ngày sinh"><input type="date" className="input" value={f.birthday || ''} onChange={set('birthday')} /></Field>
        <Field label="Phòng ban">
          <select className="input" value={f.department_id || ''} onChange={set('department_id')}>
            <option value="">— Không chọn —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Quản lý trực tiếp"><UserPicker users={users} exclude={editing ? [editing.id] : []} value={f.manager_id} onChange={set('manager_id')} placeholder="Không có" /></Field>
        <Field label="Vai trò">
          <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value, apps: e.target.value === 'guest' && !editing ? [] : f.apps })}>
            <option value="member">Thành viên</option>
            <option value="admin">Quản trị hệ thống</option>
            <option value="guest">Tài khoản khách (đối tác, NPP…)</option>
          </select>
        </Field>
        {f.role === 'guest' && (
          <Field label="Hạn truy cập" hint="Tài khoản khách tự khoá sau ngày này; chỉ thấy nội dung được chia sẻ trực tiếp">
            <input type="date" className="input" value={f.expires_at || ''} onChange={set('expires_at')} />
          </Field>
        )}
        <div className="span-2">
          <span className="field-label">Ứng dụng được sử dụng {f.role === 'admin' && <small className="muted">(quản trị viên dùng được tất cả)</small>}</span>
          <div className="app-checks">
            {MODULE_APPS.map((a) => (
              <label key={a.key} className={cx('app-check', (f.apps || []).includes(a.module) && 'on')}>
                <input type="checkbox" checked={(f.apps || []).includes(a.module)} onChange={() => toggleApp(a.module)} />
                <AppIcon app={a} size={26} /> {a.name}
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ImportModal({ onClose, onDone }) {
  const toast = useToast();
  const [csv, setCsv] = useState('');
  const [password, setPassword] = useState('');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const run = async () => {
    setErr('');
    try {
      const r = await api.post('/account/members/import', { csv, password });
      setResult(r);
      toast(`Đã nhập: ${r.created} tạo mới, ${r.updated} cập nhật`);
      onDone();
    } catch (e) { setErr(e.message); }
  };
  const sample = 'username,name,email,phone,title,department,manager_username,role,birthday\nnguyenvana,Nguyễn Văn A,a@ldlvietnam.vn,0901000001,Nhân viên kinh doanh,Phòng Kinh doanh,truongkd,member,1995-01-31';
  return (
    <Modal title="Nhập tài khoản từ Excel (CSV)" onClose={onClose} width={640}
      footer={<><button className="btn" onClick={onClose}>Đóng</button><button className="btn btn-success" disabled={!csv || password.length < 6} onClick={run}>Nhập dữ liệu</button></>}>
      <p className="muted small">Trong Excel chọn <b>File → Save As → CSV UTF-8</b>. Cột bắt buộc: <code>username</code>, <code>name</code>.
        Tài khoản đã tồn tại (trùng username) sẽ được cập nhật thông tin.</p>
      <div className="row gap">
        <label className="btn btn-sm"><FileUp size={14} /> Chọn tệp CSV
          <input type="file" accept=".csv,text/csv" hidden onChange={async (e) => { const f = e.target.files[0]; if (f) setCsv(await f.text()); }} />
        </label>
        <a className="btn btn-sm" href={`data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${sample}`)}`} download="mau-nhap-tai-khoan.csv">Xem mẫu excel</a>
      </div>
      <Field label="Nội dung CSV"><textarea className="input mono" rows={7} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={sample} /></Field>
      <Field label="Mật khẩu mặc định cho tài khoản mới" hint="Tối thiểu 6 ký tự, nhân viên nên đổi sau khi đăng nhập"><input className="input" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      {err && <div className="alert alert-error">{err}</div>}
      {result && (
        <div className="alert">{result.created} tạo mới · {result.updated} cập nhật{result.errors.length > 0 && <ul>{result.errors.map((x) => <li key={x}>{x}</li>)}</ul>}</div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- members
export function MembersPage() {
  const { user, loadDirectory } = useApp();
  const toast = useToast();
  const admin = user.role === 'admin';
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'all';
  const [q, setQ] = useState('');
  const [data, reload, loading] = useFetch(() => (tab === 'logins' ? Promise.resolve(null) : api.get('/account/members', { tab, q })), [tab, q]);
  const [edit, setEdit] = useState(null);
  const [importing, setImporting] = useState(false);
  const [resetFor, setResetFor] = useState(null);

  useEffect(() => {
    const id = params.get('edit');
    if (id && data?.items) {
      const u = data.items.find((x) => String(x.id) === id);
      if (u) setEdit(u);
    }
  }, [params, data]);
  const refresh = () => { reload(); loadDirectory(); };
  const setActive = async (u, active) => {
    if (!active && !window.confirm(`Vô hiệu hoá tài khoản ${u.name}? Người này sẽ không đăng nhập được.`)) return;
    try {
      await api.put(`/users/${u.id}`, { active });
      toast(active ? 'Đã kích hoạt lại tài khoản' : 'Đã vô hiệu hoá tài khoản');
      refresh();
    } catch (e) { toast(e.message, 'error'); }
  };
  const tabs = [
    { value: 'all', label: `TẤT CẢ (${data?.counts.all ?? '…'})` },
    { value: 'admins', label: 'QUẢN TRỊ HỆ THỐNG' },
    { value: 'guests', label: `TK KHÁCH (${data?.counts.guests ?? 0})` },
    ...(admin ? [{ value: 'disabled', label: 'VÔ HIỆU HOÁ' }, { value: 'logins', label: 'LỊCH SỬ ĐĂNG NHẬP' }] : []),
  ];

  return (
    <div className="acc-page wide">
      <div className="mem-toolbar">
        <div className="ww-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm kiếm thành viên" /></div>
        <div className="mem-tabs">
          {tabs.map((t) => <button key={t.value} className={cx(tab === t.value && 'active')} onClick={() => setParams(t.value === 'all' ? {} : { tab: t.value })}>{t.label}</button>)}
        </div>
        {admin && (
          <Dropdown align="right" trigger={(o, t) => <button className="btn btn-success" onClick={t}>Thêm tài khoản <ChevronDown size={15} /></button>}>
            <MenuItem icon={UserPlus} onClick={() => setEdit({})}>Tạo tài khoản</MenuItem>
            <MenuItem icon={UserPlus} onClick={() => setEdit({ guest: true })}>Tạo tài khoản khách</MenuItem>
            <MenuItem icon={FileDown} onClick={() => { window.location.href = api.url('/account/members/export'); }}>Xuất ra Excel</MenuItem>
            <MenuItem icon={FileUp} onClick={() => setImporting(true)}>Nhập từ Excel</MenuItem>
          </Dropdown>
        )}
      </div>
      {tab === 'logins' ? <LoginHistory all /> : loading && !data ? <Spinner /> : (
        <div className="mem-list">
          <div className="mem-head"><span>HỌ VÀ TÊN</span><span>THÔNG TIN LIÊN LẠC</span><span>QUẢN LÝ TRỰC TIẾP</span><span /></div>
          {data.items.map((u) => (
            <div key={u.id} className="mem-row">
              <div className="mem-name">
                <Avatar name={u.name} color={u.color} size={48} />
                <div className="grow">
                  <Link to={`/account/u/${u.id}`} className="mem-title">{u.name}</Link>
                  <div className="small"><b>@{u.username}</b> · <i className="muted">{u.title || 'Chưa nhập chức danh'}</i></div>
                  <div className="mem-apps">
                    {u.role === 'admin' && <span className="text-red small">Quản trị cấp cao · </span>}
                    {u.role === 'guest' && <span className="badge badge-gray">KHÁCH{u.expires_at ? ` · HẾT HẠN ${fmtDate(u.expires_at)}` : ''}</span>}
                    {!!u.totp_enabled && <span className="small text-green" title="Đã bật bảo mật hai lớp">2FA · </span>}
                    {u.apps.map((k) => appByKey[k] && <span key={k} title={appByKey[k].name}><AppIcon app={appByKey[k]} size={16} /></span>)}
                  </div>
                </div>
                <ShieldCheck size={16} className={u.role === 'admin' ? 'text-red' : 'text-green'} />
              </div>
              <div className="mem-contact small">
                <div>{u.email || <i className="muted">Chưa nhập email</i>}</div>
                <div>{u.phone || <i className="muted">Chưa nhập số điện thoại</i>}</div>
                <div>{u.birthday ? fmtDate(u.birthday) : <i className="muted">Chưa nhập ngày sinh</i>}</div>
              </div>
              <div className="mem-manager">
                {u.manager_name && (<><Avatar name={u.manager_name} color={u.manager_color} size={40} />
                  <div><b>{u.manager_name}</b><div className="small muted">@{u.manager_username}{u.manager_title ? ` · ${u.manager_title}` : ''}</div></div></>)}
              </div>
              <div className="mem-actions">
                <Dropdown align="right" trigger={(o, t) => <button className="icon-btn sm" onClick={t} aria-label="Thao tác"><MoreHorizontal size={16} /></button>}>
                  <MenuItem icon={Eye} onClick={() => { window.location.href = `/account/u/${u.id}`; }}>Xem hồ sơ</MenuItem>
                  {admin && <MenuItem icon={Pencil} onClick={() => setEdit(u)}>Sửa tài khoản</MenuItem>}
                  {admin && u.id !== user.id && <MenuItem icon={KeyRound} onClick={() => setResetFor(u)}>Đặt lại mật khẩu</MenuItem>}
                  {admin && !!u.totp_enabled && <MenuItem icon={ShieldCheck} onClick={async () => {
                    if (!window.confirm(`Tắt bảo mật hai lớp của ${u.name}? (dùng khi nhân viên mất điện thoại)`)) return;
                    await api.post(`/account/2fa/reset/${u.id}`);
                    toast('Đã đặt lại bảo mật hai lớp');
                    refresh();
                  }}>Đặt lại bảo mật 2 lớp</MenuItem>}
                  {admin && u.id !== user.id && (u.active
                    ? <MenuItem icon={UserX} danger onClick={() => setActive(u, false)}>Vô hiệu hoá</MenuItem>
                    : <MenuItem icon={UserCheck} onClick={() => setActive(u, true)}>Kích hoạt lại</MenuItem>)}
                </Dropdown>
                <small className="muted">{fmtDate(u.created_at)}</small>
              </div>
            </div>
          ))}
          {!data.items.length && <Empty icon={Users} title="Không có thành viên nào" />}
        </div>
      )}
      {edit && <UserModal user={edit.id ? edit : null} guest={!!edit.guest} onClose={() => { setEdit(null); if (params.get('edit')) setParams({}); }} onSaved={() => { setEdit(null); refresh(); }} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={refresh} />}
      {resetFor && <ResetPasswordModal ids={[resetFor.id]} title={`Đặt lại mật khẩu cho ${resetFor.name}`} onClose={() => setResetFor(null)} />}
    </div>
  );
}

function ResetPasswordModal({ ids, title, onClose }) {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const save = async () => {
    try {
      const r = await api.post('/account/members/reset-passwords', { ids, password: pw });
      toast(`Đã đổi mật khẩu cho ${r.affected} tài khoản`);
      onClose();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title={title} onClose={onClose} width={420}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" disabled={pw.length < 6} onClick={save}>Lưu</button></>}>
      <Field label="Mật khẩu mới" hint="Tối thiểu 6 ký tự"><input className="input" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
    </Modal>
  );
}

export function BulkPasswordPage() {
  const { users, user } = useApp();
  const [ids, setIds] = useState([]);
  const [open, setOpen] = useState(false);
  return (
    <div className="acc-page narrow">
      <h1 className="acc-title">Đổi mật khẩu hàng loạt</h1>
      <p className="muted">Chọn các tài khoản cần đặt lại cùng một mật khẩu (ví dụ khi bàn giao hoặc nghi ngờ lộ mật khẩu).</p>
      <UserPicker users={users} exclude={[user.id]} multiple value={ids} onChange={setIds} placeholder="Chọn tài khoản" />
      <div className="row gap mt">
        <button className="btn btn-sm" onClick={() => setIds(users.filter((u) => u.id !== user.id).map((u) => u.id))}>Chọn tất cả</button>
        <button className="btn btn-primary" disabled={!ids.length} onClick={() => setOpen(true)}>Đặt mật khẩu mới ({ids.length})</button>
      </div>
      {open && <ResetPasswordModal ids={ids} title={`Đổi mật khẩu cho ${ids.length} tài khoản`} onClose={() => { setOpen(false); setIds([]); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- groups & departments
function GroupModal({ groupId, onClose, onSaved }) {
  const { users } = useApp();
  const toast = useToast();
  const [f, setF] = useState(groupId ? null : { name: '', description: '', members: [] });
  useEffect(() => {
    if (groupId) api.get(`/account/groups/${groupId}`).then((g) => setF({ name: g.name, description: g.description || '', members: g.members.map((m) => m.id) }));
  }, [groupId]);
  if (!f) return null;
  const save = async () => {
    try {
      if (groupId) await api.put(`/account/groups/${groupId}`, f);
      else await api.post('/account/groups', f);
      toast('Đã lưu nhóm');
      onSaved();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title={groupId ? 'Sửa nhóm người dùng' : 'Tạo nhóm người dùng'} onClose={onClose} width={560}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-success" onClick={save}>Lưu</button></>}>
      <div className="form-grid one">
        <Field label="Tên nhóm" required><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Mô tả"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label={`Thành viên (${f.members.length})`}><UserPicker users={users} multiple value={f.members} onChange={(v) => setF({ ...f, members: v })} placeholder="Thêm thành viên" /></Field>
      </div>
    </Modal>
  );
}

export function GroupsPage() {
  const { user } = useApp();
  const admin = user.role === 'admin';
  const [params, setParams] = useSearchParams();
  const [groups, reload] = useFetch(() => api.get('/account/groups'), []);
  const [edit, setEdit] = useState(null);
  const [view, setView] = useState(null);
  const openId = params.get('open');
  useEffect(() => { if (openId) setView(Number(openId)); }, [openId]);
  const [detail] = useFetch(() => (view ? api.get(`/account/groups/${view}`) : Promise.resolve(null)), [view]);
  return (
    <div className="acc-page wide">
      <div className="page-head">
        <h1>Nhóm người dùng</h1>
        {admin && <button className="btn btn-success" onClick={() => setEdit('new')}><Plus size={15} /> Tạo nhóm</button>}
      </div>
      <p className="muted">Nhóm dùng để phân quyền và gửi văn bản / đề xuất cho nhiều người cùng lúc (ví dụ: Ban lãnh đạo, Văn thư).</p>
      <div className="group-layout">
        <div className="group-list">
          {groups?.map((g) => (
            <button key={g.id} className={cx('group-item', view === g.id && 'active')} onClick={() => { setView(g.id); setParams({ open: g.id }); }}>
              <Users size={18} /><span className="grow"><b>{g.name}</b><small className="muted block">{g.member_count} thành viên{g.description ? ` · ${g.description}` : ''}</small></span>
            </button>
          ))}
          {groups && !groups.length && <Empty title="Chưa có nhóm nào" />}
        </div>
        <div className="group-detail">
          {!detail ? <Empty icon={Users} title="Chọn một nhóm để xem thành viên" /> : (
            <>
              <div className="row between"><h3>{detail.name}</h3>
                {admin && <div className="row gap-sm">
                  <button className="btn btn-sm" onClick={() => setEdit(detail.id)}><Pencil size={14} /> Sửa</button>
                  <button className="btn btn-sm btn-danger-ghost" onClick={async () => {
                    if (!window.confirm(`Xoá nhóm "${detail.name}"?`)) return;
                    await api.del(`/account/groups/${detail.id}`);
                    setView(null); setParams({}); reload();
                  }}><Trash2 size={14} /></button>
                </div>}
              </div>
              {detail.description && <p className="muted">{detail.description}</p>}
              <div className="person-grid">
                {detail.members.map((m) => (
                  <Link key={m.id} to={`/account/u/${m.id}`} className="person-chip">
                    <Avatar name={m.name} color={m.color} size={34} />
                    <span><b>{m.name}</b><small className="muted block">@{m.username}{m.title ? ` · ${m.title}` : ''}</small></span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {edit && <GroupModal groupId={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); setView(null); }} />}
    </div>
  );
}

export function DepartmentsPage() {
  const { departments, loadDirectory } = useApp();
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const save = async () => {
    try {
      if (edit.id) await api.put(`/departments/${edit.id}`, edit);
      else await api.post('/departments', edit);
      setEdit(null);
      loadDirectory();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="acc-page wide">
      <div className="page-head"><h1>Phòng ban</h1><button className="btn btn-success" onClick={() => setEdit({ name: '', code: '', parent_id: '' })}><Plus size={15} /> Thêm phòng ban</button></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Phòng ban</th><th>Mã</th><th>Trực thuộc</th><th>Số nhân sự</th><th /></tr></thead>
          <tbody>
            {departments.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td><td>{d.code}</td><td>{departments.find((x) => x.id === d.parent_id)?.name}</td><td>{d.member_count}</td>
                <td className="nowrap">
                  <button className="icon-btn sm" onClick={() => setEdit({ ...d, parent_id: d.parent_id || '' })} aria-label="Sửa"><Pencil size={15} /></button>
                  <button className="icon-btn sm" aria-label="Xoá" onClick={async () => { if (window.confirm(`Xoá phòng ban ${d.name}?`)) { await api.del(`/departments/${d.id}`); loadDirectory(); } }}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal title={edit.id ? 'Sửa phòng ban' : 'Thêm phòng ban'} onClose={() => setEdit(null)} width={440}
          footer={<><button className="btn" onClick={() => setEdit(null)}>Hủy</button><button className="btn btn-primary" onClick={save}>Lưu</button></>}>
          <div className="form-grid one">
            <Field label="Tên phòng ban" required><input className="input" autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Mã"><input className="input" value={edit.code || ''} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field>
            <Field label="Trực thuộc">
              <select className="input" value={edit.parent_id || ''} onChange={(e) => setEdit({ ...edit, parent_id: e.target.value })}>
                <option value="">— Cấp gốc —</option>
                {departments.filter((d) => d.id !== edit.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- apps
function AppUsersModal({ app, onClose, onSaved }) {
  const { users, departments } = useApp();
  const toast = useToast();
  const [ids, setIds] = useState(null);
  useEffect(() => { api.get(`/account/apps/${app.key}/users`).then(setIds); }, [app.key]);
  if (!ids) return null;
  const save = async () => {
    await api.put(`/account/apps/${app.key}`, { users: ids });
    toast(`Đã cập nhật quyền sử dụng ${app.name}`);
    onSaved();
  };
  return (
    <Modal title={`Phân quyền ${app.name}`} onClose={onClose} width={620}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-success" onClick={save}>Lưu ({ids.length} tài khoản)</button></>}>
      <div className="row gap wrap">
        <button className="btn btn-sm" onClick={() => setIds(users.map((u) => u.id))}>Chọn tất cả</button>
        <button className="btn btn-sm" onClick={() => setIds([])}>Bỏ chọn</button>
        <select className="input input-sm" value="" onChange={(e) => {
          const d = Number(e.target.value);
          if (d) setIds([...new Set([...ids, ...users.filter((u) => u.department_id === d).map((u) => u.id)])]);
        }}>
          <option value="">+ Thêm cả phòng ban...</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      <div className="mt"><UserPicker users={users} multiple value={ids} onChange={setIds} placeholder="Chọn tài khoản được sử dụng" /></div>
      <p className="muted small">Quản trị viên luôn dùng được mọi ứng dụng đang bật.</p>
    </Modal>
  );
}

export function AppsPage() {
  const { user, refreshMe } = useApp();
  const toast = useToast();
  const admin = user.role === 'admin';
  const [apps, reload] = useFetch(() => api.get('/account/apps'), []);
  const [perm, setPerm] = useState(null);
  const toggle = async (a) => {
    await api.put(`/account/apps/${a.key}`, { enabled: !a.enabled });
    toast(`${a.enabled ? 'Đã tắt' : 'Đã bật'} ${a.name}`);
    reload();
    refreshMe();
  };
  const byKey = useMemo(() => Object.fromEntries((apps || []).map((a) => [a.key, a])), [apps]);
  return (
    <div className="acc-page wide">
      <div className="page-head"><h1>Quản lý ứng dụng</h1></div>
      <p className="muted">Bật / tắt ứng dụng cho toàn công ty và chọn những tài khoản được sử dụng từng ứng dụng.
        Các ứng dụng khác của hệ sinh thái hiển thị ở <Link to="/">Trang chủ</Link> với nhãn "Sắp ra mắt".</p>
      {!apps ? <Spinner /> : (
        <div className="app-cards">
          {MODULE_APPS.map((m) => {
            const a = byKey[m.module];
            if (!a) return null;
            return (
              <div key={m.key} className={cx('app-card', !a.enabled && 'off')}>
                <AppIcon app={m} size={52} />
                <div className="grow">
                  <b>{m.name}</b>
                  <div className="muted small">{m.desc}</div>
                  <div className="small mt">{a.user_count} tài khoản được sử dụng</div>
                </div>
                <div className="app-card-actions">
                  <Link to={m.path} className="btn btn-sm">Mở</Link>
                  {admin && <button className="btn btn-sm" onClick={() => setPerm({ key: a.key, name: m.name })}>Phân quyền</button>}
                  {admin && (
                    <label className="switch" title={a.enabled ? 'Đang bật' : 'Đang tắt'}>
                      <input type="checkbox" checked={a.enabled} onChange={() => toggle({ ...a, name: m.name })} /><span />
                    </label>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {perm && <AppUsersModal app={perm} onClose={() => setPerm(null)} onSaved={() => { setPerm(null); reload(); refreshMe(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- company, audit, notifications
export function CompanyPage() {
  const { company, setCompany } = useApp();
  const toast = useToast();
  const [name, setName] = useState(company);
  return (
    <div className="acc-page narrow">
      <h1 className="acc-title">Chỉnh sửa công ty</h1>
      <div className="row gap"><img className="login-logo-img" src="/logo-192.png" alt="LDL" /><div className="muted small">Logo đang dùng cho toàn hệ thống (favicon LDL).</div></div>
      <Field label="Tên công ty (hiển thị trên thanh tiêu đề)"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <button className="btn btn-primary mt" onClick={async () => {
        const r = await api.put('/settings', { company_name: name });
        setCompany(r.company_name);
        toast('Đã lưu thông tin công ty');
      }}>Lưu</button>
    </div>
  );
}

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [data] = useFetch(() => api.get('/account/audit', { page }), [page]);
  return (
    <div className="acc-page wide">
      <h1 className="acc-title">Lịch sử hệ thống</h1>
      {!data ? <Spinner /> : !data.items.length ? <Empty title="Chưa có thay đổi nào" /> : (
        <>
          <ul className="timeline">
            {data.items.map((a) => (
              <li key={a.id}><Avatar name={a.user_name} color={a.user_color} size={22} /> <b>{a.user_name}</b> — {a.detail}
                <small className="muted block">{fmtDateTime(a.created_at)}</small></li>
            ))}
          </ul>
          <Pagination page={data.page} total={data.total} limit={data.limit} onChange={setPage} />
        </>
      )}
    </div>
  );
}

const NOTIF_APPS = [['', 'Tất cả'], ['office', 'Base Office'], ['wework', 'Base Wework'], ['request', 'Base Request']];

export function NotificationsPage() {
  const [app, setApp] = useState('');
  const [unread, setUnread] = useState(false);
  const [data, reload] = useFetch(() => api.get('/notifications', { app, unread: unread ? 1 : '', limit: 100 }), [app, unread]);
  return (
    <div className="acc-page wide">
      <div className="page-head">
        <h1>Thông báo</h1>
        <button className="btn btn-sm" onClick={async () => { await api.put('/notifications/read-all'); reload(); }}>Đánh dấu tất cả đã đọc</button>
      </div>
      <div className="row gap wrap">
        <Tabs tabs={NOTIF_APPS.map(([value, label]) => ({ value, label }))} value={app} onChange={setApp} />
        <label className="check"><input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} /> Chỉ chưa đọc</label>
      </div>
      <div className="notif-full">
        {data?.items.map((n) => (
          <Link key={n.id} to={n.link || '#'} className={cx('notif-item', !n.is_read && 'unread')}
            onClick={() => { if (!n.is_read) api.put(`/notifications/${n.id}/read`); }}>
            <Avatar name={n.actor_name || 'Hệ thống'} color={n.actor_color} size={34} />
            <span className="grow"><span className="notif-title">{n.title}</span>
              <small className="muted">{NOTIF_APPS.find((x) => x[0] === n.app)?.[1] || 'Hệ thống'} · {fmtDateTime(n.created_at)}</small></span>
          </Link>
        ))}
        {data && !data.items.length && <Empty title="Không có thông báo" />}
      </div>
    </div>
  );
}
