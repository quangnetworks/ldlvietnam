import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Field, Spinner } from '../components/ui.jsx';

export function TwoFactorPage() {
  const { user, refreshMe } = useApp();
  const toast = useToast();
  const [setup, setSetup] = useState(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { if (setup) QRCode.toDataURL(setup.url, { width: 220, margin: 1 }).then(setQr); }, [setup]);
  const start = async () => { setErr(''); try { setSetup(await api.post('/account/2fa/setup')); } catch (e) { setErr(e.message); } };
  const enable = async () => {
    setErr('');
    try {
      await api.post('/account/2fa/enable', { code });
      toast('Đã bật bảo mật hai lớp');
      setSetup(null); setCode('');
      refreshMe();
    } catch (e) { setErr(e.message); }
  };
  const disable = async () => {
    setErr('');
    try {
      await api.post('/account/2fa/disable', { password });
      toast('Đã tắt bảo mật hai lớp');
      setPassword('');
      refreshMe();
    } catch (e) { setErr(e.message); }
  };
  return (
    <div className="acc-page narrow">
      <h1 className="acc-title">Bảo mật hai lớp cá nhân</h1>
      <p className="muted">Khi bật, mỗi lần đăng nhập cần thêm mã 6 số từ ứng dụng <b>Google Authenticator</b>, <b>Microsoft Authenticator</b> hoặc tương đương trên điện thoại.</p>
      {err && <div className="alert alert-error">{err}</div>}
      {user.totp_enabled ? (
        <div className="card">
          <div className="row gap"><ShieldCheck size={28} className="text-green" /><b className="grow">Bảo mật hai lớp đang BẬT</b></div>
          <Field label="Nhập mật khẩu để tắt"><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <button className="btn btn-danger mt" disabled={!password} onClick={disable}><ShieldOff size={15} /> Tắt bảo mật hai lớp</button>
        </div>
      ) : !setup ? (
        <div className="card">
          <div className="row gap"><ShieldOff size={28} className="muted" /><b className="grow">Bảo mật hai lớp đang TẮT</b></div>
          <button className="btn btn-primary mt" onClick={start}><Smartphone size={15} /> Thiết lập ngay</button>
        </div>
      ) : (
        <div className="card">
          <ol className="steps">
            <li>Mở ứng dụng Authenticator → <b>Thêm tài khoản</b> → <b>Quét mã QR</b>.</li>
            <li>Quét mã bên dưới (hoặc nhập khoá thủ công).</li>
            <li>Nhập mã 6 số đang hiển thị trong ứng dụng để xác nhận.</li>
          </ol>
          <div className="qr-box">
            {qr ? <img src={qr} alt="Mã QR bảo mật hai lớp" width={220} height={220} /> : <Spinner />}
            <div><small className="muted">Khoá thủ công</small><div className="mono break">{setup.secret.match(/.{1,4}/g).join(' ')}</div></div>
          </div>
          <Field label="Mã xác nhận"><input className="input otp-input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
          <button className="btn btn-success mt" disabled={code.length !== 6} onClick={enable}>Xác nhận & bật</button>
        </div>
      )}
    </div>
  );
}

export function SecuritySettingsPage() {
  const toast = useToast();
  const [data, reload] = useFetch(() => api.get('/account/security'), []);
  const [f, setF] = useState(null);
  useEffect(() => { if (data) setF({ ip_enabled: data.ip_enabled, ip_rules: data.ip_rules.join('\n') }); }, [data]);
  if (!f) return <div className="acc-page"><Spinner /></div>;
  const save = async () => {
    try {
      const r = await api.put('/account/security', f);
      toast(r.ip_enabled ? 'Đã bật giới hạn đăng nhập theo IP' : 'Đã lưu cài đặt');
      if (r.ip_enabled && !r.current_ip_allowed) toast('Lưu ý: IP hiện tại của bạn nằm ngoài danh sách (quản trị viên vẫn được truy cập)', 'info');
      reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="acc-page narrow">
      <h1 className="acc-title">Bảo mật theo dải IP</h1>
      <p className="muted">Chỉ cho phép nhân viên đăng nhập và sử dụng hệ thống từ mạng công ty. Quản trị viên luôn được truy cập để tránh bị khoá ngoài.</p>
      <div className="card">
        <p>IP hiện tại của bạn: <b className="mono">{data.current_ip || 'không xác định'}</b>
          {data.current_ip && <button className="link-btn" onClick={() => setF({ ...f, ip_rules: `${f.ip_rules}${f.ip_rules ? '\n' : ''}${data.current_ip}` })}> + thêm vào danh sách</button>}</p>
        <label className="check"><input type="checkbox" checked={f.ip_enabled} onChange={(e) => setF({ ...f, ip_enabled: e.target.checked })} /> Bật giới hạn theo IP</label>
        <Field label="Danh sách IP / dải IP được phép" hint="Mỗi dòng một địa chỉ, ví dụ 203.0.113.10 hoặc 203.0.113.0/24">
          <textarea className="input mono" rows={6} value={f.ip_rules} onChange={(e) => setF({ ...f, ip_rules: e.target.value })} />
        </Field>
        <button className="btn btn-primary mt" onClick={save}>Lưu</button>
      </div>
    </div>
  );
}
