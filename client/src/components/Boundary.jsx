import { Component, Suspense, lazy } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Spinner } from './ui.jsx';

/** Tệp JS của phiên bản cũ không còn trên máy chủ (vừa cập nhật phiên bản mới) */
const isChunkError = (e) => /dynamically imported module|Importing a module script failed|error loading dynamically|Loading chunk|ChunkLoadError/i.test(String(e?.message || e));

/** Nạp trang theo nhu cầu: lazyPage(() => import('./x.jsx'), 'TênXuấtRa') — bỏ tên để lấy default. */
export function lazyPage(loader, name = 'default') {
  return lazy(() => loader().then((m) => ({ default: m[name] })));
}

/**
 * Lỗi hiển thị của một trang không làm trắng toàn bộ ứng dụng: chỉ trang đó báo lỗi, menu vẫn dùng được.
 * Lỗi do vừa triển khai phiên bản mới (không tải được tệp JS cũ) → tự tải lại trang một lần.
 */
export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error(error);
    if (isChunkError(error)) {
      let last = 0;
      try { last = Number(sessionStorage.getItem('ldl_chunk_reload')) || 0; } catch { /* ignore */ }
      if (Date.now() - last > 30000) {
        try { sessionStorage.setItem('ldl_chunk_reload', String(Date.now())); } catch { /* ignore */ }
        window.location.reload();
      }
    }
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkError(error);
    return (
      <div className="page-error">
        <h3>{chunk ? 'Đã có phiên bản mới' : 'Trang này gặp lỗi hiển thị'}</h3>
        <p className="muted">{chunk ? 'Tải lại để dùng phiên bản mới nhất.' : 'Các phần khác vẫn dùng bình thường. Thử tải lại trang; nếu vẫn lỗi, báo quản trị viên kèm nội dung bên dưới.'}</p>
        {!chunk && <code className="page-error-msg">{String(error?.message || error)}</code>}
        <div className="row gap">
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Tải lại</button>
          <a className="btn" href="/">Về trang chủ</a>
        </div>
      </div>
    );
  }
}

/** Nội dung trang trong khung của từng phân hệ: chờ tải + chặn lỗi theo từng đường dẫn. */
export function PageOutlet(props) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={<Spinner />}>
        <Outlet {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}

/** Khung ngoài cùng (trang không nằm trong phân hệ nào). */
export function RootBoundary({ children }) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={<div className="center-screen"><Spinner /></div>}>{children}</Suspense>
    </ErrorBoundary>
  );
}
