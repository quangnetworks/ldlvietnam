import { useState } from 'react';
import { useApp } from '../context.jsx';

export default function Login() {
  const { login } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [otp, setOtp] = useState('');
  const [needOtp, setNeedOtp] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password, needOtp ? otp : undefined);
    } catch (err) {
      if (err.data?.need_otp) {
        if (needOtp) setError(err.message);
        setNeedOtp(true);
      } else setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">
          <img className="login-logo-img" src="/logo-192.png" alt="LDL Vietnam Distribution Center" />
          <div>
            <b>Công ty LDL Việt Nam</b>
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
        {needOtp && (
          <label className="field">
            <span className="field-label">Mã xác thực 2 lớp (6 số trong ứng dụng Authenticator)</span>
            <input className="input otp-input" autoFocus inputMode="numeric" maxLength={6} value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code" />
          </label>
        )}
        <button className="btn btn-primary btn-block" disabled={busy || !username || !password || (needOtp && otp.length !== 6)}>
          {busy ? 'Đang đăng nhập...' : 'Đăng nhập'}
        </button>
      </form>
    </div>
  );
}
