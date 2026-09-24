import { useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import {
  ArrowLeft, Star, Pin, Pencil, Send, Archive, Trash2, Link2, Download, Eye, CheckCircle2, XCircle, Clock, Hash,
  Printer, History, MessageSquare,
} from 'lucide-react';
import { api } from '../api.js';
import { useFetch, useToast } from '../context.jsx';
import { Avatar, Spinner, SafeHtml, FileChip, Modal, Field, Tabs, Empty } from '../components/ui.jsx';
import { DOC_KINDS, fmtDate, fmtDateTime, timeAgo, cx } from '../utils.js';
import { StatusBadge } from './DocList.jsx';

function ApproveModal({ decision, onClose, onSubmit }) {
  const [comment, setComment] = useState('');
  return (
    <Modal title={decision === 'approve' ? 'Duyệt văn bản' : 'Không thông qua văn bản'} onClose={onClose} width={480}
      footer={<>
        <button className="btn" onClick={onClose}>Hủy</button>
        <button className={cx('btn', decision === 'approve' ? 'btn-success' : 'btn-danger')} onClick={() => onSubmit(comment)}>
          {decision === 'approve' ? 'Đồng ý duyệt' : 'Không thông qua'}
        </button>
      </>}>
      <Field label="Ý kiến">
        <textarea className="input" rows={4} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Nhập ý kiến (không bắt buộc)" />
      </Field>
    </Modal>
  );
}

export default function DocDetail() {
  const { id } = useParams();
  const { reloadMeta } = useOutletContext();
  const navigate = useNavigate();
  const toast = useToast();
  const [doc, reload, loading, error] = useFetch(() => api.get(`/documents/${id}`), [id]);
  const [tab, setTab] = useState('comments');
  const [approve, setApprove] = useState(null);
  const [comment, setComment] = useState('');
  const [comments, reloadComments] = useFetch(() => api.get(`/documents/${id}/comments`), [id]);
  const [activity, reloadActivity] = useFetch(() => api.get(`/documents/${id}/activity`), [id]);
  const [viewers] = useFetch(() => api.get(`/documents/${id}/viewers`), [id]);

  if (error) return <div className="page"><div className="alert alert-error">{error.message}</div></div>;
  if (loading && !doc) return <div className="page"><Spinner /></div>;
  if (!doc) return null;

  const act = async (fn, msg) => {
    try {
      await fn();
      if (msg) toast(msg);
      reload();
      reloadActivity();
      reloadMeta();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const sendComment = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    await api.post(`/documents/${id}/comments`, { content: comment });
    setComment('');
    reloadComments();
  };
  const assignNumber = () => {
    const code = window.prompt('Nhập số hiệu văn bản (để trống để hệ thống tự cấp số):', '');
    if (code === null) return;
    act(() => api.post(`/documents/${id}/number`, { code }), 'Đã cấp số văn bản');
  };

  return (
    <div className="page doc-detail">
      <div className="page-head">
        <div className="row gap">
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Quay lại"><ArrowLeft size={18} /></button>
          <div>
            <div className="muted small">{DOC_KINDS[doc.kind]}{doc.type_name && ` · ${doc.type_name}`}</div>
            <h1 className="doc-h1">{doc.code && <span className="doc-code">[{doc.code}]</span>} {doc.title}</h1>
          </div>
        </div>
        <div className="page-actions wrap">
          <button className={cx('btn', doc.starred && 'btn-outline-warning')} onClick={() => act(() => api.post(`/documents/${id}/star`))}>
            <Star size={15} fill={doc.starred ? 'currentColor' : 'none'} /> {doc.starred ? 'Đã đánh dấu' : 'Đánh dấu'}
          </button>
          <button className={cx('btn', doc.following && 'btn-outline-primary')} onClick={() => act(() => api.post(`/documents/${id}/follow`))}>
            <Pin size={15} /> {doc.following ? 'Đang theo dõi' : 'Theo dõi'}
          </button>
          <button className="btn" onClick={() => { navigator.clipboard?.writeText(window.location.href); toast('Đã sao chép liên kết'); }}><Link2 size={15} /></button>
          <button className="btn" onClick={() => window.print()} title="In"><Printer size={15} /></button>
          {doc.can_edit && <Link className="btn" to={`/office/doc/${id}/edit`}><Pencil size={15} /> Sửa</Link>}
          {doc.can_manage && ['draft', 'rejected'].includes(doc.status) && (
            <button className="btn btn-primary" onClick={() => act(() => api.post(`/documents/${id}/submit`), 'Đã gửi văn bản')}>
              <Send size={15} /> {doc.approvers.length ? 'Gửi duyệt' : 'Ban hành'}
            </button>
          )}
          {doc.can_number && doc.need_numbering && !doc.code && doc.status !== 'draft' && (
            <button className="btn" onClick={assignNumber}><Hash size={15} /> Cấp số</button>
          )}
          {doc.can_manage && ['issued', 'archived'].includes(doc.status) && (
            <button className="btn" onClick={() => act(() => api.post(`/documents/${id}/archive`), doc.status === 'archived' ? 'Đã bỏ cất giữ' : 'Đã cất giữ văn bản')}>
              <Archive size={15} /> {doc.status === 'archived' ? 'Bỏ cất giữ' : 'Cất giữ'}
            </button>
          )}
          {doc.can_manage && !doc.deleted_at && (
            <button className="btn btn-danger-ghost" onClick={async () => {
              if (!window.confirm('Chuyển văn bản vào thùng rác?')) return;
              await api.del(`/documents/${id}`);
              reloadMeta();
              toast('Đã tạm xóa văn bản');
              navigate('/office');
            }}><Trash2 size={15} /></button>
          )}
        </div>
      </div>

      {doc.can_approve && (
        <div className="approve-bar">
          <Clock size={18} /> <span className="grow">Văn bản đang chờ bạn duyệt</span>
          <button className="btn btn-danger" onClick={() => setApprove('reject')}><XCircle size={15} /> Không thông qua</button>
          <button className="btn btn-success" onClick={() => setApprove('approve')}><CheckCircle2 size={15} /> Duyệt</button>
        </div>
      )}

      <div className="detail-grid">
        <div>
          <div className="card">
            {doc.description && <p className="lead">{doc.description}</p>}
            {doc.content ? <SafeHtml html={doc.content} /> : <p className="muted">Văn bản không có nội dung soạn thảo — xem tệp đính kèm.</p>}
            {doc.attachments.length > 0 && (
              <>
                <h3 className="card-title">Tệp đính kèm ({doc.attachments.length})</h3>
                <div className="attach-list">
                  {doc.attachments.map((a) => (
                    <div key={a.id} className="attach-row">
                      <FileChip file={a} href={api.url(`/documents/${id}/attachments/${a.id}`, { inline: 1 })} />
                      <a className="btn btn-sm" href={api.url(`/documents/${id}/attachments/${a.id}`)}><Download size={14} /> Tải về</a>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="card">
            <Tabs value={tab} onChange={setTab} tabs={[
              { value: 'comments', label: 'Thảo luận', count: comments?.length },
              { value: 'activity', label: 'Lịch sử hoạt động' },
              { value: 'viewers', label: 'Đã xem', count: viewers?.length },
            ]} />
            {tab === 'comments' && (
              <div>
                <div className="comments">
                  {comments?.map((c) => (
                    <div key={c.id} className="comment">
                      <Avatar name={c.user_name} color={c.user_color} size={32} />
                      <div className="grow">
                        <div><b>{c.user_name}</b> <small className="muted">{timeAgo(c.created_at)}</small></div>
                        <div className="pre">{c.content}</div>
                      </div>
                    </div>
                  ))}
                  {comments && !comments.length && <Empty icon={MessageSquare} title="Chưa có thảo luận" />}
                </div>
                <form className="comment-form" onSubmit={sendComment}>
                  <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Viết bình luận..."
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendComment(e); }} />
                  <button className="btn btn-primary" disabled={!comment.trim()}>Gửi</button>
                </form>
              </div>
            )}
            {tab === 'activity' && (
              <ul className="timeline">
                {activity?.map((a) => (
                  <li key={a.id}><History size={13} /> <b>{a.user_name || 'Hệ thống'}</b> — {a.detail || a.action}
                    <small className="muted block">{fmtDateTime(a.created_at)}</small></li>
                ))}
              </ul>
            )}
            {tab === 'viewers' && (
              <div className="user-list">
                {viewers?.map((v) => (
                  <div key={v.id} className="user-row">
                    <Avatar name={v.name} color={v.color} size={30} />
                    <span className="grow">{v.name}<small className="muted block">{v.department_name}</small></span>
                    <small className="muted">{fmtDateTime(v.viewed_at)}</small>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside>
          <div className="card info-card">
            <div className="info-row"><span>Trạng thái</span><StatusBadge doc={doc} /></div>
            <div className="info-row"><span>Số hiệu</span><b>{doc.code || (doc.need_numbering ? <i className="muted">Chờ cấp số</i> : '—')}</b></div>
            <div className="info-row"><span>Loại văn bản</span><b>{doc.type_name || '—'}</b></div>
            <div className="info-row"><span>Nhóm</span><b>{DOC_KINDS[doc.kind]}</b></div>
            <div className="info-row"><span>Ban hành bởi</span><b>{doc.issuer_name || '—'}</b></div>
            <div className="info-row"><span>Người tạo</span><b>{doc.creator_name}</b></div>
            <div className="info-row"><span>Phòng ban</span><b>{doc.department_name || '—'}</b></div>
            {doc.sender_org && <div className="info-row"><span>Cơ quan gửi</span><b>{doc.sender_org}</b></div>}
            {doc.sender_department_name && <div className="info-row"><span>Gửi bởi</span><b>{doc.sender_department_name}</b></div>}
            <div className="info-row"><span>Kho lưu trữ</span><b>{doc.folder_name || '—'}</b></div>
            <div className="info-row"><span>Thư mục</span><b>{doc.category_name || '—'}</b></div>
            <div className="info-row"><span>Ngày tạo</span><b>{fmtDate(doc.created_at)}</b></div>
            {doc.issued_at && <div className="info-row"><span>Ngày ban hành</span><b>{fmtDate(doc.issued_at)}</b></div>}
            {doc.effective_date && <div className="info-row"><span>Hiệu lực từ</span><b>{fmtDate(doc.effective_date)}</b></div>}
            {doc.expire_date && <div className="info-row"><span>Hết hạn</span><b className={doc.is_expired ? 'text-red' : ''}>{fmtDate(doc.expire_date)}</b></div>}
            <div className="info-row"><span>Lượt xem</span><b><Eye size={13} /> {doc.view_count}</b></div>
          </div>

          {doc.approvers.length > 0 && (
            <div className="card">
              <h3 className="card-title">Luồng duyệt</h3>
              <ol className="approval-flow">
                {doc.approvers.map((a) => (
                  <li key={a.user_id} className={a.status}>
                    <Avatar name={a.name} color={a.color} size={30} />
                    <div className="grow">
                      <b>{a.name}</b>
                      <small className="muted block">Bước {a.step} · {a.title}</small>
                      {a.comment && <div className="small pre">“{a.comment}”</div>}
                    </div>
                    <span className={cx('small', a.status === 'approved' ? 'text-green' : a.status === 'rejected' ? 'text-red' : 'muted')}>
                      {a.status === 'approved' ? 'Đã duyệt' : a.status === 'rejected' ? 'Không thông qua' : 'Chờ duyệt'}
                      {a.acted_at && <small className="block muted">{fmtDate(a.acted_at)}</small>}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="card">
            <h3 className="card-title">Người nhận</h3>
            {doc.is_public ? <p className="muted">Toàn công ty</p> : (
              <div className="chips">
                {doc.recipients.map((r, i) => <span key={i} className="chip">{r.user_name || r.department_name}</span>)}
              </div>
            )}
            <h3 className="card-title">Người theo dõi</h3>
            <div className="chips">
              {doc.followers.map((f) => <span key={f.id} className="chip"><Avatar name={f.name} color={f.color} size={18} /> {f.name}</span>)}
            </div>
          </div>
        </aside>
      </div>

      {approve && (
        <ApproveModal decision={approve} onClose={() => setApprove(null)} onSubmit={(c) => {
          setApprove(null);
          act(() => api.post(`/documents/${id}/approve`, { decision: approve, comment: c }), approve === 'approve' ? 'Đã duyệt văn bản' : 'Đã từ chối văn bản');
        }} />
      )}
    </div>
  );
}
