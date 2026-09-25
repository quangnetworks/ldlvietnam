/**
 * Phiếu đề xuất in ra bản cứng / lưu PDF (Ctrl+P → "Lưu dưới dạng PDF").
 * Mẫu theo nhóm đề xuất: tiêu đề + mã biểu mẫu, thông tin người đề nghị, các trường đã điền,
 * mốc thời gian (tạo / gửi / hoàn tất), bảng phê duyệt theo luồng (✓ / ✗ / ↩, người duyệt, thời gian, ý kiến) và ô ký xác nhận.
 */
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch } from '../context.jsx';
import { Spinner } from '../components/ui.jsx';
import { fmtDateTime } from '../utils.js';
import { STATUS, fieldDisplay } from './fields.jsx';
import { STAGE_LABEL } from './RequestForm.jsx';

const SIGN_LABEL = { manager: 'Quản lý trực tiếp', dept: 'Phòng ban liên quan', final: 'Người duyệt cuối cùng' };
const MARK = {
  approved: ['☑', 'Đã duyệt', 'ok'],
  rejected: ['☒', 'Từ chối', 'no'],
  returned: ['↩', 'Trả lại', 'no'],
  skipped: ['—', 'Không cần duyệt', 'skip'],
  pending: ['☐', 'Chờ duyệt', 'wait'],
};

export default function RequestPrint() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { company, user } = useApp();
  const [q, , , error] = useFetch(() => api.get(`/requests/${id}`), [id]);
  useEffect(() => {
    if (q) document.title = `${q.print?.code ? `${q.print.code} - ` : ''}${q.title} #${q.id}`;
    return () => { document.title = 'Công ty LDL Việt Nam'; };
  }, [q]);
  if (error) return <div className="print-shell"><div className="alert alert-error">{error.message}</div></div>;
  if (!q) return <div className="print-shell"><Spinner /></div>;

  const usersById = Object.fromEntries((q.users || []).map((u) => [u.id, u.name]));
  const title = (q.print?.title || q.group_name || 'Phiếu đề xuất').toUpperCase();
  const approved = q.status === 'approved';
  const stamp = { draft: 'BẢN NHÁP', pending: 'ĐANG CHỜ DUYỆT', rejected: 'ĐÃ TỪ CHỐI', returned: 'ĐÃ TRẢ LẠI', cancelled: 'ĐÃ HUỶ' }[q.status];
  // ô ký: người đề nghị + mỗi người duyệt (theo thứ tự luồng)
  const signers = [
    { role: 'Người đề nghị', name: q.creator_name, note: q.submitted_at ? `Đã gửi ${fmtDateTime(q.submitted_at)}` : 'Chưa gửi', ok: !!q.submitted_at },
    ...q.approvers.filter((a) => a.status !== 'skipped').map((a) => ({
      role: a.stage ? SIGN_LABEL[a.stage] : `Người duyệt bước ${a.step}`, name: a.name,
      note: a.status === 'approved' ? `Đã duyệt điện tử ${fmtDateTime(a.acted_at)}` : a.acted_at ? `${MARK[a.status]?.[1]} ${fmtDateTime(a.acted_at)}` : 'Chưa duyệt',
      ok: a.status === 'approved', bad: ['rejected', 'returned'].includes(a.status),
    })),
  ];

  return (
    <div className="print-shell">
      <div className="print-toolbar no-print">
        <button className="btn" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(`/request/${id}`))}><ArrowLeft size={15} /> Quay lại</button>
        <div className="grow" />
        <small className="muted">In ra giấy A4 hoặc chọn “Lưu dưới dạng PDF” trong hộp thoại in.</small>
        <button className="btn btn-primary" onClick={() => window.print()}><Printer size={15} /> In / Lưu PDF</button>
      </div>

      <article className="print-sheet">
        {stamp && <div className="print-watermark">{stamp}</div>}
        <header className="print-head">
          <div className="print-brand">
            <img src="/logo-192.png" alt="" />
            <div><b>{company}</b><small>LDL Request · Hệ thống đề xuất nội bộ</small></div>
          </div>
          <div className="print-meta">
            {q.print?.code && <div>Mã biểu mẫu: <b>{q.print.code}</b></div>}
            <div>Số phiếu: <b>#{String(q.id).padStart(5, '0')}</b></div>
            <div>Trạng thái: <b>{STATUS[q.status]?.label}</b></div>
          </div>
        </header>

        <h1 className="print-title">{title}</h1>
        <p className="print-sub">{q.title !== q.group_name ? q.title : ''}</p>

        <section>
          <h2>I. Thông tin người đề nghị</h2>
          <table className="print-kv">
            <tbody>
              <tr><th>Họ và tên</th><td>{q.creator_name}</td><th>Chức danh</th><td>{q.creator_title || '—'}</td></tr>
              <tr><th>Phòng ban</th><td>{q.creator_department || '—'}</td><th>Nhóm đề xuất</th><td>{q.group_name}</td></tr>
              <tr><th>Ngày tạo</th><td>{fmtDateTime(q.created_at)}</td><th>Ngày gửi</th><td>{q.submitted_at ? fmtDateTime(q.submitted_at) : '—'}</td></tr>
              {(q.completed_at || q.deadline_at) && (
                <tr><th>Hạn xử lý</th><td>{q.deadline_at ? fmtDateTime(q.deadline_at) : '—'}</td><th>Hoàn tất</th><td>{q.completed_at ? fmtDateTime(q.completed_at) : '—'}</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section>
          <h2>II. Nội dung đề xuất</h2>
          <table className="print-kv fields">
            <tbody>
              {q.fields.map((f) => (
                <tr key={f.key}><th>{f.label}</th><td colSpan={3} className="pre">{fieldDisplay(f, q.data[f.key], usersById) || '—'}</td></tr>
              ))}
              {q.content && <tr><th>Ghi chú thêm</th><td colSpan={3} className="pre">{q.content}</td></tr>}
              {q.attachments.length > 0 && (
                <tr><th>Tệp đính kèm</th><td colSpan={3}>{q.attachments.map((a) => a.original_name).join('; ')}</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section>
          <h2>III. Phê duyệt theo luồng {q.flow === 'any' ? '(chỉ cần một người duyệt)' : '(duyệt lần lượt)'}</h2>
          <table className="print-grid">
            <thead><tr><th>Bước</th><th>Chặng</th><th>Người duyệt</th><th>Kết quả</th><th>Thời gian</th><th>Ý kiến</th></tr></thead>
            <tbody>
              {q.approvers.map((a) => {
                const [mark, label, cls] = MARK[a.status] || MARK.pending;
                return (
                  <tr key={a.user_id}>
                    <td className="c">{a.step}</td>
                    <td>{a.stage ? STAGE_LABEL[a.stage] : '—'}</td>
                    <td><b>{a.name}</b>{a.title && <small className="block">{a.title}</small>}</td>
                    <td className={`mark ${cls}`}><span>{mark}</span> {label}</td>
                    <td className="nowrap">{a.acted_at ? fmtDateTime(a.acted_at) : ''}</td>
                    <td className="pre">{a.comment || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="print-signs" style={{ '--cols': Math.min(signers.length, 4) }}>
          {signers.map((s, i) => (
            <div key={i} className="print-sign">
              <b>{s.role}</b>
              <div className={`print-sign-box ${s.ok ? 'ok' : s.bad ? 'bad' : ''}`}>
                {s.ok ? '✓' : s.bad ? '✗' : ''}
                <small>{s.note}</small>
              </div>
              <span>{s.name}</span>
            </div>
          ))}
        </section>

        {q.print?.note && <p className="print-note">{q.print.note}</p>}
        <footer className="print-foot">
          <span>{approved ? 'Phiếu đã được phê duyệt đầy đủ trên hệ thống — có giá trị như bản ký tay theo quy định nội bộ.' : 'Phiếu chưa hoàn tất phê duyệt.'}</span>
          <span>In lúc {fmtDateTime(new Date().toISOString())} bởi {user.name}</span>
        </footer>
      </article>
    </div>
  );
}
