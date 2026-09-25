import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  X, Star, Eye, Trash2, Link2, Paperclip, Plus, CheckSquare, GitBranch, Calendar, User, Flag, Repeat, FolderKanban,
  MessageSquare, History, Download, Target, CheckCircle2, RotateCcw, ShieldCheck, Undo2, Send,
} from 'lucide-react';
import { api, toFormData } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Drawer, Spinner, Avatar, UserPicker, SafeHtml, RichEditor, FileChip, Progress, Empty } from '../components/ui.jsx';
import { TASK_STATUS, RECURRING, fmtDateTime, timeAgo, cx } from '../utils.js';
import { useWework } from './WeworkLayout.jsx';
import { StatusCircle, TaskTags, useAssignable, createTaskList } from './taskParts.jsx';
import TaskResults from './TaskResults.jsx';
import FileViewer from '../components/FileViewer.jsx';
import CommentBox, { CommentItem } from '../components/CommentBox.jsx';

export function TaskDetail({ id, onClose, onChanged, standalone }) {
  const { users } = useApp();
  const { projects, openTask, openCreate, version } = useWework();
  const toast = useToast();
  const [t, reload, loading, error] = useFetch(() => api.get(`/tasks/${id}`), [id, version]);
  const [lists, setLists] = useState([]);
  const [title, setTitle] = useState('');
  const [editDesc, setEditDesc] = useState(false);
  const [desc, setDesc] = useState('');
  const [newItem, setNewItem] = useState('');
  const [comments, reloadComments] = useFetch(() => api.get(`/tasks/${id}/comments`), [id]);
  const [activity, reloadActivity] = useFetch(() => api.get(`/tasks/${id}/activity`), [id]);
  const [viewing, setViewing] = useState(null);
  const assignable = useAssignable(users, t?.project_id, [t?.assignee_id]);
  const [goals, reloadGoals] = useFetch(() => api.get('/goals'), []);

  useEffect(() => { if (t) { setTitle(t.title); setDesc(t.description || ''); } }, [t]);
  useEffect(() => {
    if (t?.project_id) api.get(`/projects/${t.project_id}`).then((p) => setLists(p.lists)).catch(() => setLists([]));
    else setLists([]);
  }, [t?.project_id]);

  if (error) return <div className="drawer-pad"><div className="alert alert-error">{error.message}</div></div>;
  if (loading && !t) return <div className="drawer-pad"><Spinner /></div>;
  if (!t) return null;
  const ro = !t.can_edit;
  // người chỉ được giao việc: không đổi thời gian, mô tả, dự án, lặp lại; không xoá
  const locked = ro || !t.can_manage;
  const lockHint = !ro && !t.can_manage ? 'Chỉ người giao việc / quản lý dự án được thay đổi' : undefined;

  const update = async (patch, msg) => {
    try {
      await api.put(`/tasks/${id}`, patch);
      if (msg) toast(msg);
      reload();
      reloadActivity();
      onChanged?.();
    } catch (e) {
      toast(e.message, 'error');
      reload();
    }
  };
  const addCheck = async (e) => {
    e.preventDefault();
    if (!newItem.trim()) return;
    await api.post(`/tasks/${id}/checklist`, { content: newItem });
    setNewItem('');
    reload();
  };
  const upload = async (files) => {
    if (!files.length) return;
    await api.post(`/tasks/${id}/attachments`, toFormData({}, files));
    reload();
    reloadActivity();
  };
  const del = async () => {
    if (!window.confirm('Xóa công việc này cùng các công việc con?')) return;
    try {
      await api.del(`/tasks/${id}`);
      toast('Đã xóa công việc');
      onChanged?.();
      onClose?.();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  // Phòng ban bật duyệt hoàn thành: nhân viên chọn "Hoàn thành" → máy chủ chuyển sang "Chờ đánh giá" cho quản lý duyệt
  const needApprove = t.requires_approval && !t.can_approve;
  const setStatus = (s) => update({ status: s }, s === 'done' ? (needApprove ? 'Đã gửi quản lý duyệt hoàn thành' : 'Đã hoàn thành công việc') : null);
  const review = async (decision) => {
    let comment = '';
    if (decision === 'reject') {
      comment = window.prompt('Lý do trả lại (nhân viên sẽ nhận được thông báo):', '') || '';
      if (!comment.trim()) return;
    }
    try {
      await api.post(`/tasks/${id}/review`, { decision, comment });
      toast(decision === 'approve' ? 'Đã duyệt hoàn thành công việc' : 'Đã trả lại công việc');
      reload(); reloadActivity(); reloadComments(); onChanged?.();
    } catch (e) { toast(e.message, 'error'); }
  };
  const checklistPct = t.checklist.length ? Math.round((t.checklist.filter((c) => c.done).length / t.checklist.length) * 100) : 0;

  return (
    <div className="task-detail">
      <div className="td-head">
        <StatusCircle task={t} size={30} onChange={(s) => (t.locked ? null : setStatus(s))} />
        <select className="status-select" disabled={ro} value={t.status} onChange={(e) => setStatus(e.target.value)}
          style={{ color: TASK_STATUS[t.status].color, borderColor: TASK_STATUS[t.status].color }}>
          {Object.entries(TASK_STATUS).map(([k, s]) => (
            <option key={k} value={k} disabled={k === 'done' && needApprove}>{k === 'done' && needApprove ? `${s.label} (cần quản lý duyệt)` : s.label}</option>
          ))}
        </select>
        <div className="grow" />
        <button className={cx('icon-btn', t.starred && 'starred')} title="Đánh dấu sao" onClick={async () => { await api.post(`/tasks/${id}/star`); reload(); onChanged?.(); }}>
          <Star size={18} fill={t.starred ? 'currentColor' : 'none'} />
        </button>
        <button className={cx('icon-btn', t.following && 'text-blue')} title={t.following ? 'Bỏ theo dõi' : 'Theo dõi'} onClick={async () => { await api.post(`/tasks/${id}/follow`); reload(); }}>
          <Eye size={18} />
        </button>
        <button className="icon-btn" title="Sao chép liên kết" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/wework/task/${id}`); toast('Đã sao chép liên kết'); }}>
          <Link2 size={18} />
        </button>
        {t.can_delete && <button className="icon-btn" title="Xóa công việc" onClick={del}><Trash2 size={18} /></button>}
        {!standalone && <button className="icon-btn" onClick={onClose} aria-label="Đóng"><X size={20} /></button>}
      </div>

      {t.locked ? (
        <div className="td-banner done">
          <CheckCircle2 size={18} />
          <div className="grow"><b>Đã hoàn thành{t.completed_at ? ` · ${fmtDateTime(t.completed_at)}` : ''}</b>
            <small className="block">Công việc đã khoá: không cập nhật thông tin, tệp hay kết quả — chỉ bình luận.</small></div>
          {t.can_reopen && <button className="btn btn-sm" onClick={() => update({ status: 'doing' }, 'Đã mở lại công việc')}><RotateCcw size={14} /> Mở lại</button>}
        </div>
      ) : t.requires_approval && t.status === 'review' && t.can_approve ? (
        <div className="td-banner review">
          <ShieldCheck size={18} />
          <div className="grow"><b>Chờ bạn duyệt hoàn thành</b>
            <small className="block">{t.assignee_name || 'Nhân viên'} đã gửi duyệt. Kiểm tra kết quả rồi duyệt hoặc trả lại kèm lý do.</small></div>
          <button className="btn btn-sm btn-danger-ghost" onClick={() => review('reject')}><Undo2 size={14} /> Trả lại</button>
          <button className="btn btn-sm btn-success" onClick={() => review('approve')}><CheckCircle2 size={14} /> Duyệt hoàn thành</button>
        </div>
      ) : needApprove ? (
        <div className="td-banner info">
          <ShieldCheck size={18} />
          <div className="grow"><b>{t.status === 'review' ? 'Đang chờ quản lý duyệt hoàn thành' : 'Phòng ban yêu cầu quản lý duyệt khi hoàn thành'}</b>
            <small className="block">Người duyệt: {(t.approvers || []).map((a) => a.name).join(', ') || 'quản lý trực tiếp'}.</small></div>
          {!ro && ['todo', 'doing', 'failed'].includes(t.status) && (
            <button className="btn btn-sm btn-primary" onClick={() => update({ status: 'review' }, 'Đã gửi quản lý duyệt hoàn thành')}><Send size={14} /> Gửi duyệt hoàn thành</button>
          )}
        </div>
      ) : null}

      <div className="td-body">
      <div className="td-scroll">
        {t.parent ? (
          <button type="button" className="td-parent" onClick={() => openTask(t.parent.id)} title="Mở công việc cha">
            <span className="lvl-tag child"><GitBranch size={11} /> Công việc con</span>
            <span className="muted">thuộc</span> <b className="ellipsis">{t.parent.title}</b>
          </button>
        ) : t.subtasks.length > 0 && (
          <div className="td-parent is-parent"><span className="lvl-tag parent"><GitBranch size={11} /> Công việc cha</span>
            <span className="muted">{t.subtasks.filter((x) => x.status === 'done').length}/{t.subtasks.length} việc con hoàn thành</span></div>
        )}
        <textarea className="td-title" rows={1} value={title} readOnly={ro} onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== t.title && update({ title })}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} />
        <div className="task-meta"><TaskTags t={t} /></div>

        <div className="td-fields">
          <div className="td-field"><span><User size={14} /> Người thực hiện</span>
            {ro ? <b>{t.assignee_name}</b> : <UserPicker users={assignable} value={t.assignee_id} onChange={(v) => update({ assignee_id: v })} placeholder="Chưa giao" />}
          </div>
          <div className="td-field"><span><Eye size={14} /> Người theo dõi / phối hợp</span>
            <UserPicker users={users} multiple value={t.followers.map((f) => f.id)} onChange={(v) => update({ followers: v })} placeholder="Mời người theo dõi / phối hợp (kể cả ngoài phòng ban)" />
          </div>
          <div className="td-field"><span><Calendar size={14} /> Ngày bắt đầu</span>
            <input type="date" className="input" disabled={locked} title={lockHint} value={t.start_date?.slice(0, 10) || ''} onChange={(e) => update({ start_date: e.target.value })} />
          </div>
          <div className="td-field"><span><Calendar size={14} /> Thời hạn</span>
            <input type="date" className={cx('input', t.is_overdue && 'text-red')} disabled={locked} title={lockHint} value={t.due_date?.slice(0, 10) || ''} onChange={(e) => update({ due_date: e.target.value })} />
          </div>
          <div className="td-field"><span><Flag size={14} /> Ưu tiên</span>
            <select className="input" disabled={ro} value={t.priority} onChange={(e) => update({ priority: e.target.value })}>
              <option value="normal">Bình thường</option><option value="important">Quan trọng</option><option value="urgent">Khẩn cấp</option><option value="critical">Quan trọng & khẩn cấp</option>
            </select>
          </div>
          <div className="td-field"><span><Repeat size={14} /> Lặp lại</span>
            <select className="input" disabled={locked} title={lockHint} value={t.recurring || ''} onChange={(e) => update({ recurring: e.target.value || null })}>
              <option value="">Không lặp lại</option>
              {Object.entries(RECURRING).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div className="td-field"><span><FolderKanban size={14} /> Dự án</span>
            <select className="input" disabled={locked || !!t.parent_id} title={lockHint} value={t.project_id || ''} onChange={(e) => update({ project_id: e.target.value || null })}>
              <option value="">— Công việc cá nhân —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              {t.project_id && !projects.some((p) => p.id === t.project_id) && <option value={t.project_id}>{t.project_name}</option>}
            </select>
          </div>
          <div className="td-field"><span><CheckSquare size={14} /> Nhóm công việc</span>
            <select className="input" disabled={ro || !t.project_id} title={!t.project_id ? 'Chọn dự án trước' : undefined} value={t.list_id || ''}
              onChange={async (e) => {
                if (e.target.value === '__new') {
                  const r = await createTaskList(t.project_id, toast);
                  if (r) { setLists(r.lists); update({ list_id: r.id }); }
                  return;
                }
                update({ list_id: e.target.value || null });
              }}>
              <option value="">— Không chọn —</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              <option value="__new">＋ Tạo nhóm công việc mới…</option>
            </select>
          </div>
          <div className="td-field span-2"><span><Target size={14} /> Mục tiêu</span>
            <select className="input" disabled={ro} value={t.goal_id || ''} onChange={async (e) => {
              if (e.target.value === '__new') {
                const title = window.prompt('Tên mục tiêu mới');
                if (!title?.trim()) return;
                try { await api.post('/goals', { title: title.trim(), task_ids: [t.id] }); reloadGoals(); reload(); onChanged?.(); toast('Đã tạo mục tiêu và gắn công việc'); } catch (err) { toast(err.message, 'error'); }
                return;
              }
              update({ goal_id: e.target.value || null }, e.target.value ? 'Đã gắn công việc vào mục tiêu' : null);
            }}>
              <option value="">— Không gắn mục tiêu —</option>
              {(goals || []).map((g) => <option key={g.id} value={g.id}>{g.title} ({g.progress}%)</option>)}
              {t.goal && !(goals || []).some((g) => g.id === t.goal.id) && <option value={t.goal.id}>{t.goal.title} — của {t.goal.owner_name}</option>}
              <option value="__new">＋ Tạo mục tiêu mới…</option>
            </select>
          </div>
        </div>
        {t.outside_project && <div className="td-outside small">👥 Bạn tham gia riêng công việc này của <b>{t.project_name}</b> (không cần là thành viên): xem, thảo luận, đính kèm tệp và cập nhật kết quả.</div>}
        {lockHint && <div className="td-lock small">🔒 Bạn là người được giao việc: cập nhật trạng thái, kết quả, checklist, tệp và thảo luận; thời gian, mô tả, dự án và lặp lại do người giao việc quản lý.</div>}
        <div className="small muted">Tạo bởi <b>{t.creator_name}</b> · {fmtDateTime(t.created_at)} · cập nhật {timeAgo(t.updated_at)}
          {t.project_id && <> · <Link to={`/wework/project/${t.project_id}`} onClick={onClose}>{t.project_name}</Link></>}
        </div>

        <section className="td-section">
          <div className="td-section-head"><b>Mô tả</b>
            {!locked && !editDesc && <button className="link-btn" onClick={() => setEditDesc(true)}>Chỉnh sửa</button>}
          </div>
          {editDesc ? (
            <>
              <RichEditor value={desc} onChange={setDesc} minHeight={120} />
              <div className="row gap mt">
                <button className="btn btn-primary btn-sm" onClick={() => { update({ description: desc }); setEditDesc(false); }}>Lưu</button>
                <button className="btn btn-sm" onClick={() => { setDesc(t.description || ''); setEditDesc(false); }}>Hủy</button>
              </div>
            </>
          ) : t.description ? <SafeHtml html={t.description} /> : <p className="muted">Chưa có mô tả</p>}
        </section>

        <TaskResults task={t} onChanged={() => { reload(); reloadActivity(); onChanged?.(); }} />

        <section className="td-section">
          <div className="td-section-head"><b>Danh sách kiểm tra</b>{t.checklist.length > 0 && <span className="muted">{checklistPct}%</span>}</div>
          {t.checklist.length > 0 && <Progress value={checklistPct} color="#37b24d" />}
          {t.checklist.map((c) => (
            <div key={c.id} className="check-item">
              <input type="checkbox" disabled={ro} checked={!!c.done} onChange={async () => { await api.put(`/tasks/${id}/checklist/${c.id}`, { done: !c.done }); reload(); }} />
              <span className={cx('grow', c.done && 'strike')}>{c.content}</span>
              {!ro && <button className="icon-btn sm" onClick={async () => { await api.del(`/tasks/${id}/checklist/${c.id}`); reload(); }} aria-label="Xóa"><X size={14} /></button>}
            </div>
          ))}
          {!ro && (
            <form onSubmit={addCheck} className="row gap mt">
              <input className="input" value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Thêm mục kiểm tra..." />
              <button className="btn btn-sm" disabled={!newItem.trim()}><Plus size={14} /></button>
            </form>
          )}
        </section>

        <section className="td-section">
          <div className="td-section-head"><b><GitBranch size={15} /> Công việc con ({t.subtasks.length})</b>
            {!t.locked && (
              <button className="link-btn" onClick={() => openCreate({ parent_id: t.id, project_id: t.project_id, assignee_id: t.assignee_id, openAfter: false })}>
                <Plus size={14} /> Thêm công việc con
              </button>
            )}
          </div>
          {t.subtasks.map((s) => (
            <div key={s.id} className="subtask" onClick={() => openTask(s.id)}>
              <StatusCircle task={s} size={20} onChange={async (st) => { await api.put(`/tasks/${s.id}`, { status: st }); reload(); onChanged?.(); }} />
              <span className={cx('grow', s.status === 'done' && 'strike')}>{s.title}</span>
              {s.assignee_name && <Avatar name={s.assignee_name} color={s.assignee_color} size={20} />}
            </div>
          ))}
        </section>

        <section className="td-section">
          <div className="td-section-head"><b>Tệp đính kèm ({t.attachments.length})</b>
            {!t.locked && (
              <label className="link-btn"><Paperclip size={14} /> Tải lên
                <input type="file" multiple hidden onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} />
              </label>
            )}
          </div>
          <div className="attach-list">
            {t.attachments.map((a, i) => (
              <div key={a.id} className="attach-row">
                <FileChip file={a} onOpen={() => setViewing(i)} />
                <small className="muted grow">{a.user_name} · {timeAgo(a.created_at)}</small>
                <a className="icon-btn sm" href={api.url(`/tasks/${id}/attachments/${a.id}`)} aria-label="Tải về"><Download size={14} /></a>
                {!t.locked && <button className="icon-btn sm" onClick={async () => { await api.del(`/tasks/${id}/attachments/${a.id}`); reload(); }} aria-label="Xóa"><X size={14} /></button>}
              </div>
            ))}
          </div>
          {viewing != null && (
            <FileViewer files={t.attachments} index={viewing} urlOf={(f) => api.url(`/tasks/${id}/attachments/${f.id}`)} onClose={() => setViewing(null)}
              publicUrlOf={async (f) => (await api.post(`/tasks/${id}/attachments/${f.id}/link`)).url} />
          )}
        </section>

        <section className="td-section">
          <div className="td-section-head"><b><MessageSquare size={15} /> Thảo luận ({comments?.length || 0})</b></div>
          <div className="comments">
            {comments?.map((c) => <CommentItem key={c.id} base={`/tasks/${id}`} c={c} onChanged={() => { reloadComments(); onChanged?.(); }} />)}
            {comments && !comments.length && <Empty icon={MessageSquare} title="Chưa có thảo luận" />}
          </div>
          <CommentBox base={`/tasks/${id}`} onSent={() => { reloadComments(); reloadActivity(); onChanged?.(); }}
            placeholder="Viết bình luận… gõ @ để nhắc tên · Ctrl+Enter để gửi" />
        </section>
      </div>

      <aside className="td-aside" aria-label="Lịch sử công việc">
        <div className="td-aside-head"><History size={15} /> <b>Lịch sử</b>{activity && <small className="muted">{activity.length}</small>}</div>
        <ul className="timeline td-timeline">
          {activity?.map((a) => (
            <li key={a.id}>
              <Avatar name={a.user_name || 'Hệ thống'} color={a.user_color} uid={a.user_id} size={22} />
              <div className="grow">
                <div><b>{a.user_name || 'Hệ thống'}</b> <span className="muted">{a.detail || a.action}</span></div>
                <small className="muted">{fmtDateTime(a.created_at)}</small>
              </div>
            </li>
          ))}
          {activity && !activity.length && <li className="muted small">Chưa có hoạt động</li>}
        </ul>
      </aside>
      </div>
    </div>
  );
}

export default function TaskDrawer({ id, onClose, onChanged }) {
  return (
    <Drawer onClose={onClose} width={1140}>
      <TaskDetail id={id} onClose={onClose} onChanged={onChanged} />
    </Drawer>
  );
}
