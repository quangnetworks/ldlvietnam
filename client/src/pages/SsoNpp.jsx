import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { Spinner } from '../components/ui.jsx';

/**
 * /sso/npp — hands the signed-in Workspace account over to Distribution Control Tower (see server/src/routes/sso.js).
 * Reached from NPP's "Đăng nhập bằng LDL Workspace" button (with ?state=…) or from the app tile (no state).
 */
export default function SsoNpp() {
  const { search } = useLocation();
  const [err, setErr] = useState('');
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const state = new URLSearchParams(search).get('state') || '';
    api.post('/sso/npp', { state })
      .then(({ url }) => window.location.replace(url))
      .catch((e) => setErr(e.message || 'Không mở được Distribution Control Tower'));
  }, [search]);
  return (
    <div className="center-screen">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <h2>Distribution Control Tower</h2>
        {err ? (
          <>
            <p className="muted">{err}</p>
            <a className="btn btn-primary" href="/">Về trang chủ</a>
          </>
        ) : (
          <>
            <Spinner />
            <p className="muted">Đang đăng nhập bằng tài khoản LDL Workspace…</p>
          </>
        )}
      </div>
    </div>
  );
}
