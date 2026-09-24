import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Star, Eye, Pencil, Send, Ban, Trash2, CheckCircle2, XCircle, Undo2, Clock, Paperclip, Link2, History, MessageSquare, Printer } from 'lucide-react';
import { api, toFormData } from '../api.js';
import { useFetch, useToast } from '../context.jsx';
import { Avatar, Spinner, FileChip, Modal, Field, Tabs, Empty } from '../components/ui.jsx';
import { fmtDateTime, timeAgo, cx } from '../utils.js';
import { useRequestApp } from './RequestLayout.jsx';
import { STATUS, fieldDisplay } from './fields.jsx';
import { StatusSteps } from './RequestForm.jsx';

const DECIDE = {
  approve: { title: 'Chấp thuận đề xuất', btn: 'Chấp thuận', cls: 'btn-success', need: false },
  reject: { title: 'Từ chối đề xuất', btn: 'Từ chối', cls: 'btn-danger', need: true },
  return: { title: 'Trả lại đề xuất', btn: 'Trả lại', cls: 'btn-primary', need: true },
};

export default function RequestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { bump } = useRequestApp();
  const [q, reload, loading, error] = useFetch(() => api.get(`/requests/${id}`), [id]);
  const [comments, reloadComments] = useFetch(() => api.get(`/requests/${id}/comments`), [id]);
  const [activity, reloadActivity] = useFetch(() => api.get(`/requests/${id}/activity`), [id]);
  const [decide, setDecide] = useState(null);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [tab, setTab] = useState('comments');

  if (error) return <div className="rq-page"><div className="alert alert-error">{error.message}</div></div>;
  if (loading && !q) return <div className="rq-page"><Spinner /></div>;
  const act = async (fn, msg) => {
    try {
      await fn();
      if (msg) toast(msg);
      reload(); reloadActivity(); bump();
    } catch (e) { toast(e.message, 'error'); }
  };
  const usersById = Object.fromEntries((q.users || []).map((u) => [u.id, u.name]));
  const s = STATUS[q.status];

  return (
    <div className="rq-page">
      <div className="rq-head">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Quay lại"><ArrowLeft size={18} /></button>
        <div className="grow">
          <small className="muted">{q.group_name} · #{q.id}</small>
          <h1>{q.title} <span className={cx('badge', s.cls)}>{s.label.toUpperCase()}</span></h1>
        </div>
        <button className={cx('icon-btn', q.starred && 'starred')} title="Đánh dấu" onClick={() => act(() => api.post(`/requests/${id}/star`))}><Star size={18} fill={q.starred ? 'currentColor' : 'none'} /></button>
        <button className={cx('icon-btn', q.following && 'text-blue')} title={q.following ? 'Bỏ theo dõi' : 'Theo dõi'} onClick={() => act(() => api.post(`/requests/${id}/follow`))}><Eye size={18} /></button>
        <button className="icon-btn" title="Sao chép liên kết" onClick={() => { navigator.clipboard?.writeText(window.location.href); toast('Đã sao chép liên kết'); }}><Link2 size={18} /></button>
        <button className="icon-btn" title="In" onClick={() => window.print()}><Printer size={18} /></button>
      </div>

      {q.my_turn && (
        <div className="approve-bar">
          <Clock size={18} /><span className="grow">Đề xuất đang chờ bạn duyệt{q.deadline_at && ` · hạn ${fmtDateTime(q.deadline_at)}`}</span>
          <button className="btn btn-primary" onClick={() => setDecide('return')}><Undo2 size={15} /> Trả lại</button>
          <button className="btn btn-danger" onClick={() => setDecide('reject')}><XCircle size={15} /> Từ chối</button>
          <button className="btn btn-success" onClick={() => setDecide('approve')}><CheckCircle2 size={15} /> Chấp thuận</button>
        </div>
      )}
      {(q.can_edit || q.can_cancel) && (
        <div className="row gap mt wrap">
          {q.can_edit && <Link className="btn" to={`/request/${id}/edit`}><Pencil size={15} /> Sửa</Link>}
          {q.can_edit && <button className="btn btn-primary" onClick={() => act(() => api.post(`/requests/${id}/submit`), 'Đã gửi đề xuất')}><Send size={15} /> {q.status === 'returned' ? 'Gửi lại' : 'Gửi đề xuất'}</button>}
          {q.can_cancel && <button className="btn" onClick={() => window.confirm('Huỷ đề xuất này?') && act(() => api.post(`/requests/${id}/cancel`), 'Đã huỷ đề xuất')}><Ban size={15} /> Huỷ đề xuất</button>}
          {q.status === 'draft' && <button className="btn btn-danger-ghost" onClick={async () => { if (window.confirm('Xoá đề xuất nháp?')) { await api.del(`/requests/${id}`); bump(); navigate('/request'); } }}><Trash2 size={15} /> Xoá</button>}
        </div>
      )}

      <div className="detail-grid mt">
        <div>
          <div className="card">
            <div className="rq-creator">
              <Avatar name={q.creator_name} color={q.creator_color} size={40} />
              <div><b>{q.creator_name}</b><small className="muted block">{q.creator_title || ''}{q.creator_department ? ` · ${q.creator_department}` : ''} · {fmtDateTime(q.created_at)}</small></div>
            </div>
            <dl className="rq-data">
              {q.fields.map((f) => (<div key={f.key}><dt>{f.label}</dt><dd className="pre">{fieldDisplay(f, q.data[f.key], usersById)}</dd></div>))}
            </dl>
            {q.content && <><h3 className="card-title">Nội dung</h3><div className="pre">{q.content}</div></>}
            <h3 className="card-title">Tệp đính kèm ({q.attachments.length})</h3>
            <div className="attach-list">
              {q.attachments.map((a) => <FileChip key={a.id} file={a} href={api.url(`/requests/${id}/attachments/${a.id}`, { inline: 1 })} />)}
              <label className="btn btn-sm" style={{ width: 'fit-content' }}><Paperclip size={14} /> Thêm tệp
                <input type="file" multiple hidden onChange={(e) => { const fs = [...e.target.files]; e.target.value = ''; act(() => api.post(`/requests/${id}/attachments`, toFormData({}, fs)), 'Đã tải tệp lên'); }} /></label>
            </div>
          </div>
          <div className="card">
            <Tabs value={tab} onChange={setTab} tabs={[{ value: 'comments', label: 'Thảo luận', count: comments?.length }, { value: 'activity', label: 'Lịch sử' }]} />
            {tab === 'comments' ? (
              <>
                <div className="comments">
                  {comments?.map((c) => (
                    <div key={c.id} className="comment"><Avatar name={c.user_name} color={c.user_color} size={30} />
                      <div className="grow"><div><b>{c.user_name}</b> <small className="muted">{timeAgo(c.created_at)}</small></div><div className="pre">{c.content}</div></div></div>
                  ))}
                  {comments && !comments.length && <Empty icon={MessageSquare} title="Chưa có thảo luận" />}
                </div>
                <form className="comment-form" onSubmit={async (e) => {
                  e.preventDefault();
                  if (!comment.trim()) return;
                  await api.post(`/requests/${id}/comments`, { content: comment });
                  setComment(''); reloadComments();
                }}>
                  <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Viết bình luận..." />
                  <button className="btn btn-primary" disabled={!comment.trim()}>Gửi</button>
                </form>
              </>
            ) : (
              <ul className="timeline">
                {activity?.map((a) => <li key={a.id}><History size={13} /> <b>{a.user_name}</b> — {a.detail}<small className="muted block">{fmtDateTime(a.created_at)}</small></li>)}
              </ul>
            )}
          </div>
        </div>
        <aside>
          <div className="card">
            <h3 className="card-title">Tiến trình duyệt · {q.flow === 'any' ? 'Chỉ cần một người duyệt' : 'Duyệt lần lượt'}</h3>
            <StatusSteps approvers={q.approvers} flow={q.flow} />
            {q.deadline_at && q.status === 'pending' && <p className={cx('small', q.is_overdue ? 'text-red' : 'muted')}>Hạn xử lý: {fmtDateTime(q.deadline_at)}</p>}
            {q.completed_at && <p className="small muted">Hoàn tất: {fmtDateTime(q.completed_at)}</p>}
          </div>
          <div className="card">
            <h3 className="card-title">Người theo dõi</h3>
            <div className="chips">{q.followers.map((f) => <span key={f.id} className="chip"><Avatar name={f.name} color={f.color} size={18} /> {f.name}</span>)}</div>
            {!q.followers.length && <p className="muted small">Chưa có người theo dõi</p>}
          </div>
        </aside>
      </div>

      {decide && (
        <Modal title={DECIDE[decide].title} onClose={() => { setDecide(null); setReason(''); }} width={480}
          footer={<><button className="btn" onClick={() => setDecide(null)}>Hủy</button>
            <button className={cx('btn', DECIDE[decide].cls)} disabled={DECIDE[decide].need && !reason.trim()} onClick={() => {
              const d = decide;
              setDecide(null);
              act(() => api.post(`/requests/${id}/decide`, { action: d, comment: reason }), `${DECIDE[d].btn} thành công`);
              setReason('');
            }}>{DECIDE[decide].btn}</button></>}>
          <Field label={DECIDE[decide].need ? 'Lý do' : 'Ý kiến (không bắt buộc)'} required={DECIDE[decide].need}>
            <textarea className="input" rows={4} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  );
}
