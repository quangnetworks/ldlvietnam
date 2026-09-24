import { useState } from 'react';
import { useApp } from '../context.jsx';

export default function Login() {
  const { login } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">
          <span className="logo-mark">L</span>
          <div>
            <b>LDL Workspace</b>
            <small>Văn bản · Công việc · Dự án</small>
          </div>
        </div>
        <h2>Đăng nhập</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <label className="field">
          <span className="field-label">Tên đăng nhập hoặc email</span>
          <input className="input" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label className="field">
          <span className="field-label">Mật khẩu</span>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        <button className="btn btn-primary btn-block" disabled={busy || !username || !password}>
          {busy ? 'Đang đăng nhập...' : 'Đăng nhập'}
        </button>
        <p className="muted small center">Tài khoản mẫu: <b>admin</b> / <b>123456</b> hoặc <b>demo</b> / <b>123456</b></p>
      </form>
    </div>
  );
}
