import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  X, Star, Eye, Trash2, Link2, Paperclip, Plus, CheckSquare, GitBranch, Calendar, User, Flag, Repeat, FolderKanban,
  MessageSquare, History, Download, Target,
} from 'lucide-react';
import { api, toFormData } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Drawer, Spinner, Avatar, UserPicker, SafeHtml, RichEditor, FileChip, Tabs, Progress, Empty } from '../components/ui.jsx';
import { TASK_STATUS, RECURRING, fmtDateTime, timeAgo, cx } from '../utils.js';
import { useWework } from './WeworkLayout.jsx';
import { StatusCircle, TaskTags, useAssignable, createTaskList } from './taskParts.jsx';
import TaskResults from './TaskResults.jsx';
import FileViewer from '../components/FileViewer.jsx';

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
  const [tab, setTab] = useState('comments');
  const [comment, setComment] = useState('');
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
  const sendComment = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    await api.post(`/tasks/${id}/comments`, { content: comment });
    setComment('');
    reloadComments();
    onChanged?.();
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
  const checklistPct = t.checklist.length ? Math.round((t.checklist.filter((c) => c.done).length / t.checklist.length) * 100) : 0;

  return (
    <div className="task-detail">
      <div className="td-head">
        <StatusCircle task={t} size={30} onChange={(s) => update({ status: s }, s === 'done' ? 'Đã hoàn thành công việc' : null)} />
        <select className="status-select" disabled={ro} value={t.status} onChange={(e) => update({ status: e.target.value })}
          style={{ color: TASK_STATUS[t.status].color, borderColor: TASK_STATUS[t.status].color }}>
          {Object.entries(TASK_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
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

      <div className="td-scroll">
        {t.parent && (
          <button className="link-btn small" onClick={() => openTask(t.parent.id)}><GitBranch size={13} /> {t.parent.title}</button>
        )}
        <textarea className="td-title" rows={1} value={title} readOnly={ro} onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== t.title && update({ title })}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} />
        <div className="task-meta"><TaskTags t={t} /></div>

        <div className="td-fields">
          <div className="td-field"><span><User size={14} /> Người thực hiện</span>
            {ro ? <b>{t.assignee_name}</b> : <UserPicker users={assignable} value={t.assignee_id} onChange={(v) => update({ assignee_id: v })} placeholder="Chưa giao" />}
          </div>
          <div className="td-field"><span><Eye size={14} /> Người theo dõi</span>
            <UserPicker users={users} multiple value={t.followers.map((f) => f.id)} onChange={(v) => update({ followers: v })} placeholder="Thêm người theo dõi" />
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
          <div className="td-section-head"><b>Công việc con ({t.subtasks.length})</b>
            <button className="link-btn" onClick={() => openCreate({ parent_id: t.id, project_id: t.project_id, assignee_id: t.assignee_id, openAfter: false })}>
              <Plus size={14} /> Thêm công việc con
            </button>
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
            <label className="link-btn"><Paperclip size={14} /> Tải lên
              <input type="file" multiple hidden onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} />
            </label>
          </div>
          <div className="attach-list">
            {t.attachments.map((a, i) => (
              <div key={a.id} className="attach-row">
                <FileChip file={a} onOpen={() => setViewing(i)} />
                <small className="muted grow">{a.user_name} · {timeAgo(a.created_at)}</small>
                <a className="icon-btn sm" href={api.url(`/tasks/${id}/attachments/${a.id}`)} aria-label="Tải về"><Download size={14} /></a>
                <button className="icon-btn sm" onClick={async () => { await api.del(`/tasks/${id}/attachments/${a.id}`); reload(); }} aria-label="Xóa"><X size={14} /></button>
              </div>
            ))}
          </div>
          {viewing != null && (
            <FileViewer files={t.attachments} index={viewing} urlOf={(f) => api.url(`/tasks/${id}/attachments/${f.id}`)} onClose={() => setViewing(null)}
              publicUrlOf={async (f) => (await api.post(`/tasks/${id}/attachments/${f.id}/link`)).url} />
          )}
        </section>

        <section className="td-section">
          <Tabs value={tab} onChange={setTab} tabs={[
            { value: 'comments', label: 'Thảo luận', count: comments?.length },
            { value: 'activity', label: 'Lịch sử' },
          ]} />
          {tab === 'comments' ? (
            <>
              <div className="comments">
                {comments?.map((c) => (
                  <div key={c.id} className="comment">
                    <Avatar name={c.user_name} color={c.user_color} size={30} />
                    <div className="grow">
                      <div><b>{c.user_name}</b> <small className="muted">{timeAgo(c.created_at)}</small></div>
                      <div className="pre">{c.content}</div>
                    </div>
                  </div>
                ))}
                {comments && !comments.length && <Empty icon={MessageSquare} title="Chưa có thảo luận" />}
              </div>
              <form className="comment-form" onSubmit={sendComment}>
                <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)}
                  placeholder="Viết bình luận... (gõ @tên_đăng_nhập để nhắc tới)"
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendComment(e); }} />
                <button className="btn btn-primary" disabled={!comment.trim()}>Gửi</button>
              </form>
            </>
          ) : (
            <ul className="timeline">
              {activity?.map((a) => (
                <li key={a.id}><History size={13} /> <b>{a.user_name}</b> — {a.detail || a.action}
                  <small className="muted block">{fmtDateTime(a.created_at)}</small></li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

export default function TaskDrawer({ id, onClose, onChanged }) {
  return (
    <Drawer onClose={onClose}>
      <TaskDetail id={id} onClose={onClose} onChanged={onChanged} />
    </Drawer>
  );
}
