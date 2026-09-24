import { useState } from 'react';
import { api } from '../api.js';
import { useApp, useToast } from '../context.jsx';
import { Modal, Field, Tabs, Avatar } from '../components/ui.jsx';

const COLORS = ['#2d7ff9', '#20c997', '#f59f00', '#e8590c', '#7048e8', '#d6336c', '#0ca678', '#1098ad', '#ae3ec9', '#5c940d'];

export function ProfileModal({ tab: initialTab = 'info', onClose }) {
  const { user, setUser, loadDirectory } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState(initialTab);
  const [form, setForm] = useState({ name: user.name, email: user.email || '', phone: user.phone || '', title: user.title || '', color: user.color });
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [err, setErr] = useState('');

  const save = async () => {
    setErr('');
    try {
      if (tab === 'info') {
        const r = await api.put('/auth/me', form);
        setUser(r.user);
        loadDirectory();
        toast('Đã cập nhật thông tin tài khoản');
      } else {
        if (pw.next !== pw.confirm) return setErr('Mật khẩu nhập lại không khớp');
        await api.put('/auth/password', { current: pw.current, next: pw.next });
        toast('Đã đổi mật khẩu');
      }
      onClose();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <Modal title="Tài khoản của tôi" onClose={onClose} width={520}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" onClick={save}>Lưu</button></>}>
      <Tabs tabs={[{ value: 'info', label: 'Thông tin' }, { value: 'password', label: 'Đổi mật khẩu' }]} value={tab} onChange={setTab} />
      {err && <div className="alert alert-error">{err}</div>}
      {tab === 'info' ? (
        <div className="form-grid">
          <div className="span-2 row gap">
            <Avatar name={form.name} color={form.color} size={48} />
            <div className="color-row">
              {COLORS.map((c) => (
                <button key={c} type="button" className={`color-dot ${form.color === c ? 'active' : ''}`} style={{ background: c }}
                  onClick={() => setForm({ ...form, color: c })} aria-label={c} />
              ))}
            </div>
          </div>
          <Field label="Họ tên" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Chức danh"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Email"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Điện thoại"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        </div>
      ) : (
        <div className="form-grid one">
          <Field label="Mật khẩu hiện tại"><input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="Mật khẩu mới" hint="Tối thiểu 6 ký tự"><input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <Field label="Nhập lại mật khẩu mới"><input className="input" type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
        </div>
      )}
    </Modal>
  );
}
