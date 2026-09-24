import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, Search, UserX, UserCheck } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Avatar, Modal, Field, Tabs, UserPicker, Spinner } from '../components/ui.jsx';
import { AppSwitcher, NotificationBell, UserMenu } from '../components/shell.jsx';

function UserModal({ user: editing, onClose, onSaved }) {
  const { users, departments } = useApp();
  const toast = useToast();
  const [f, setF] = useState(editing ? { ...editing, password: '' } : {
    username: '', password: '', name: '', email: '', phone: '', title: '', department_id: '', manager_id: null, role: 'member',
  });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const save = async () => {
    setErr('');
    try {
      const body = { ...f, department_id: f.department_id || null };
      if (editing) await api.put(`/users/${editing.id}`, body);
      else await api.post('/users', body);
      toast('Đã lưu người dùng');
      onSaved();
    } catch (e) {
      setErr(e.message);
    }
  };
  return (
    <Modal title={editing ? 'Sửa người dùng' : 'Thêm người dùng'} onClose={onClose} width={620}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" onClick={save}>Lưu</button></>}>
      {err && <div className="alert alert-error">{err}</div>}
      <div className="form-grid">
        <Field label="Tên đăng nhập" required><input className="input" disabled={!!editing} value={f.username} onChange={set('username')} /></Field>
        <Field label={editing ? 'Mật khẩu mới (bỏ trống nếu không đổi)' : 'Mật khẩu'} required={!editing}>
          <input className="input" type="password" value={f.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
        <Field label="Họ tên" required><input className="input" value={f.name} onChange={set('name')} /></Field>
        <Field label="Chức danh"><input className="input" value={f.title || ''} onChange={set('title')} /></Field>
        <Field label="Email"><input className="input" value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="Điện thoại"><input className="input" value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Phòng ban">
          <select className="input" value={f.department_id || ''} onChange={set('department_id')}>
            <option value="">— Không chọn —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Quản lý trực tiếp"><UserPicker users={users} exclude={editing ? [editing.id] : []} value={f.manager_id} onChange={set('manager_id')} placeholder="Không có" /></Field>
        <Field label="Vai trò">
          <select className="input" value={f.role} onChange={set('role')}>
            <option value="member">Thành viên</option>
            <option value="admin">Quản trị viên</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}

function DeptModal({ dept, onClose, onSaved }) {
  const { departments } = useApp();
  const toast = useToast();
  const [f, setF] = useState(dept || { name: '', code: '', parent_id: '' });
  const save = async () => {
    try {
      if (dept?.id) await api.put(`/departments/${dept.id}`, f);
      else await api.post('/departments', f);
      onSaved();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <Modal title={dept?.id ? 'Sửa phòng ban' : 'Thêm phòng ban'} onClose={onClose} width={440}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" onClick={save}>Lưu</button></>}>
      <div className="form-grid one">
        <Field label="Tên phòng ban" required><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Mã"><input className="input" value={f.code || ''} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="Trực thuộc">
          <select className="input" value={f.parent_id || ''} onChange={(e) => setF({ ...f, parent_id: e.target.value })}>
            <option value="">— Cấp gốc —</option>
            {departments.filter((d) => d.id !== dept?.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

export default function AdminPage() {
  const { user, company, setCompany, departments, loadDirectory } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState('users');
  const [q, setQ] = useState('');
  const [editUser, setEditUser] = useState(null);
  const [editDept, setEditDept] = useState(null);
  const [companyName, setCompanyName] = useState(company);
  const [allUsers, reloadUsers] = useFetch(() => (user.role === 'admin' ? api.get('/users', { all: 1 }) : Promise.resolve([])), []);

  const refresh = () => { reloadUsers(); loadDirectory(); };
  const list = (allUsers || []).filter((u) => !q || `${u.name} ${u.username} ${u.email}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="office">
      <header className="topbar">
        <Link to="/" className="brand"><img className="brand-logo" src="/logo-192.png" alt="LDL" /><span className="brand-name">{company}</span></Link>
        <div className="grow" />
        <NotificationBell app="admin" dark />
        <AppSwitcher dark />
        <UserMenu dark />
      </header>
      <main className="admin-main">
        {user.role !== 'admin' ? <div className="alert alert-error">Chỉ quản trị viên mới truy cập được trang này.</div> : (
          <div className="page">
            <div className="page-head"><h1>Quản trị hệ thống</h1></div>
            <Tabs className="page-tabs" value={tab} onChange={setTab} tabs={[
              { value: 'users', label: 'Người dùng', count: allUsers?.length },
              { value: 'departments', label: 'Phòng ban', count: departments.length },
              { value: 'company', label: 'Thông tin công ty' },
            ]} />
            {tab === 'users' && (
              <>
                <div className="toolbar">
                  <div className="ww-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm người dùng" /></div>
                  <div className="grow" />
                  <button className="btn btn-primary" onClick={() => setEditUser({})}><Plus size={15} /> Thêm người dùng</button>
                </div>
                {!allUsers ? <Spinner /> : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>Người dùng</th><th>Tên đăng nhập</th><th>Phòng ban</th><th>Quản lý</th><th>Vai trò</th><th>Trạng thái</th><th /></tr></thead>
                      <tbody>
                        {list.map((u) => (
                          <tr key={u.id} className={u.active ? '' : 'inactive'}>
                            <td><span className="row gap-sm"><Avatar name={u.name} color={u.color} size={28} /><span>{u.name}<small className="muted block">{u.title}</small></span></span></td>
                            <td>@{u.username}</td>
                            <td>{u.department_name}</td>
                            <td>{u.manager_name}</td>
                            <td>{u.role === 'admin' ? <span className="badge badge-purple">QUẢN TRỊ</span> : 'Thành viên'}</td>
                            <td>{u.active ? <span className="text-green">Hoạt động</span> : <span className="muted">Đã khóa</span>}</td>
                            <td className="nowrap">
                              <button className="icon-btn sm" onClick={() => setEditUser(u)} aria-label="Sửa"><Pencil size={15} /></button>
                              {u.id !== user.id && (u.active ? (
                                <button className="icon-btn sm" title="Khóa tài khoản" onClick={async () => { if (window.confirm(`Khóa tài khoản ${u.name}?`)) { await api.del(`/users/${u.id}`); refresh(); } }}><UserX size={15} /></button>
                              ) : (
                                <button className="icon-btn sm" title="Mở khóa" onClick={async () => { await api.put(`/users/${u.id}`, { active: true }); refresh(); }}><UserCheck size={15} /></button>
                              ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            {tab === 'departments' && (
              <>
                <div className="toolbar"><div className="grow" /><button className="btn btn-primary" onClick={() => setEditDept({})}><Plus size={15} /> Thêm phòng ban</button></div>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Phòng ban</th><th>Mã</th><th>Trực thuộc</th><th>Số nhân sự</th><th /></tr></thead>
                    <tbody>
                      {departments.map((d) => (
                        <tr key={d.id}>
                          <td>{d.name}</td><td>{d.code}</td>
                          <td>{departments.find((x) => x.id === d.parent_id)?.name}</td>
                          <td>{d.member_count}</td>
                          <td className="nowrap">
                            <button className="icon-btn sm" onClick={() => setEditDept(d)} aria-label="Sửa"><Pencil size={15} /></button>
                            <button className="icon-btn sm" onClick={async () => { if (window.confirm(`Xóa phòng ban ${d.name}?`)) { await api.del(`/departments/${d.id}`); loadDirectory(); } }} aria-label="Xóa"><Trash2 size={15} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {tab === 'company' && (
              <div className="card" style={{ maxWidth: 520 }}>
                <Field label="Tên công ty (hiển thị trên thanh tiêu đề)">
                  <input className="input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
                </Field>
                <button className="btn btn-primary mt" onClick={async () => {
                  const r = await api.put('/settings', { company_name: companyName });
                  setCompany(r.company_name);
                  toast('Đã lưu thông tin công ty');
                }}>Lưu</button>
              </div>
            )}
          </div>
        )}
      </main>
      {editUser && <UserModal user={editUser.id ? editUser : null} onClose={() => setEditUser(null)} onSaved={() => { setEditUser(null); refresh(); }} />}
      {editDept && <DeptModal dept={editDept.id ? editDept : null} onClose={() => setEditDept(null)} onSaved={() => { setEditDept(null); loadDirectory(); }} />}
    </div>
  );
}
