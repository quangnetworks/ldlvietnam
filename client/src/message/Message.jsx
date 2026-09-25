import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Hash, Lock, Plus, Send, Paperclip, Search, Pencil, Trash2, Users, ArrowLeft, MessageCircle, X, EyeOff, Phone } from 'lucide-react';
import { api, toFormData } from '../api.js';
import { useApp, useToast } from '../context.jsx';
import { Avatar, Spinner, Modal, Field, UserPicker, Empty } from '../components/ui.jsx';
import { AppSwitcher, NotificationBell, UserMenu, useDebounced } from '../components/shell.jsx';
import { ContactsButton, phoneHref } from '../components/Contact.jsx';
import { parseDate, fmtDate, fileSize, cx } from '../utils.js';
import FileViewer from '../components/FileViewer.jsx';
import EmojiPicker, { insertAtCursor } from '../components/EmojiPicker.jsx';
import { MentionTextarea, MentionText } from '../components/Mention.jsx';

/** Enter để gửi: bỏ qua khi đang gõ dấu tiếng Việt (IME), khi giữ phím, hoặc Shift+Enter xuống dòng. */
export function isSendKey(e) {
  return e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey
    && !e.nativeEvent?.isComposing && e.keyCode !== 229;
}

/** Thêm tin nhắn vào danh sách, không trùng id (tin vừa gửi có thể về lại qua lượt cập nhật định kỳ). */
export function mergeMessages(list, rows) {
  const cur = list || [];
  const ids = new Set(cur.map((x) => x.id));
  const fresh = rows.filter((x) => !ids.has(x.id));
  if (!fresh.length) return cur;
  // tin đang gửi (id tạm) luôn nằm cuối danh sách
  const sent = [...cur.filter((x) => typeof x.id === 'number'), ...fresh].sort((a, b) => a.id - b.id);
  return [...sent, ...cur.filter((x) => typeof x.id !== 'number')];
}

const HISTORY_OPTS = [
  { value: 'all', label: 'Xem toàn bộ tin nhắn trước đó' },
  { value: 'days7', label: 'Chỉ xem tin nhắn 7 ngày gần đây' },
  { value: 'none', label: 'Không xem tin nhắn cũ — chỉ từ lúc được thêm' },
];

// Cuộc trò chuyện đang mở: hỏi tin mới mỗi 2,5 giây (nhẹ — chỉ lấy tin sau id cuối); danh sách kênh: 10 giây
const POLL_MS = 2500;
const LIST_POLL_MS = 10000;

export function hhmm(v) {
  const d = parseDate(v);
  return d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
}
export function dayLabel(v) {
  const d = parseDate(v);
  const today = new Date();
  const y = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return 'Hôm nay';
  if (d.toDateString() === y.toDateString()) return 'Hôm qua';
  return fmtDate(d);
}

/** Tin nhắn: @tên_đăng_nhập hiển thị thành "@Họ tên" nổi bật, liên kết bấm được (không chèn HTML). */
export const RichText = ({ text }) => <MentionText text={text} />;

/** Người có thể được nhắc tên trong kênh: thành viên (riêng tư / 1-1), nhân sự phòng ban, hoặc mọi người (công khai). */
export function mentionableUsers(channel, users) {
  if (!channel) return users;
  if (channel.kind === 'public') return users.filter((u) => u.role !== 'guest');
  if (channel.kind === 'department') {
    const d = String(channel.department_id);
    return users.filter((u) => u.role !== 'guest' && (String(u.department_id) === d || String(u.extra_departments || '').split(',').includes(d)));
  }
  const ids = new Set((channel.members || []).map((m) => m.id));
  return users.filter((u) => ids.has(u.id));
}

function NewChannel({ onClose }) {
  const { users } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [f, setF] = useState({ name: '', description: '', kind: 'public', members: [] });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try { const ch = await api.post('/chat/channels', f); onClose(true); navigate(`/message/${ch.id}`); } catch (e) { toast(e.message, 'error'); setBusy(false); }
  };
  return (
    <Modal title="Tạo kênh mới" onClose={() => onClose(false)} width={520}
      footer={<><button className="btn" onClick={() => onClose(false)}>Huỷ</button><button className="btn btn-primary" disabled={!f.name.trim() || busy} onClick={save}>{busy ? 'Đang tạo…' : 'Tạo kênh'}</button></>}>
      <Field label="Tên kênh" required><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="vd: du-an-mien-bac" /></Field>
      <Field label="Mô tả"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <label className="check"><input type="radio" checked={f.kind === 'public'} onChange={() => setF({ ...f, kind: 'public' })} /> Công khai — mọi nhân viên đều xem và tham gia được</label>
      <label className="check"><input type="radio" checked={f.kind === 'private'} onChange={() => setF({ ...f, kind: 'private' })} /> Riêng tư — chỉ thành viên được mời</label>
      <Field label="Thành viên"><UserPicker users={users} multiple value={f.members} onChange={(members) => setF({ ...f, members })} placeholder="Thêm thành viên" /></Field>
    </Modal>
  );
}

function NewDirect({ onClose }) {
  const { users, user } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const list = users.filter((u) => u.id !== user.id && u.name.toLowerCase().includes(q.toLowerCase()));
  const [busy, setBusy] = useState(null);
  // bấm liên tục chỉ gửi một yêu cầu (máy chủ cũng đảm bảo mỗi cặp người chỉ có một cuộc trò chuyện)
  const start = async (u) => {
    if (busy) return;
    setBusy(u.id);
    try { const r = await api.post('/chat/direct', { user_id: u.id }); onClose(true); navigate(`/message/${r.id}`); } catch (e) { toast(e.message, 'error'); setBusy(null); }
  };
  return (
    <Modal title="Nhắn tin trực tiếp" onClose={() => onClose(false)} width={440}>
      <input className="input" autoFocus placeholder="Tìm đồng nghiệp" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="move-list mt">
        {list.map((u) => (
          <div key={u.id} className="row gap-sm">
            <button className="drive-row plain grow" disabled={!!busy} onClick={() => start(u)}><Avatar name={u.name} color={u.color} size={28} /><span className="grow">{u.name}<small className="muted block">{u.title}</small></span><MessageCircle size={16} className="muted" /></button>
            {phoneHref(u) && <a className="icon-btn" href={phoneHref(u)} title={`Gọi ${u.phone}`} aria-label={`Gọi ${u.name}`}><Phone size={16} /></a>}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ChannelMembers({ channel, onClose, onSaved }) {
  const { users, user } = useApp();
  const toast = useToast();
  const [ids, setIds] = useState(channel.members.map((m) => m.id));
  const [history, setHistory] = useState('all');
  const canEdit = channel.kind === 'private' && (channel.created_by === user.id || user.role === 'admin');
  const added = ids.filter((x) => !channel.members.some((m) => m.id === x));
  const save = async () => {
    try { await api.put(`/chat/channels/${channel.id}`, { members: ids, history }); toast('Đã cập nhật thành viên'); onSaved(); onClose(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title={`Thành viên #${channel.name}`} onClose={onClose} width={500}
      footer={canEdit ? <><button className="btn" onClick={onClose}>Đóng</button><button className="btn btn-primary" onClick={save}>Lưu</button></> : null}>
      {canEdit ? <UserPicker users={users} multiple value={ids} onChange={setIds} /> : (
        channel.kind === 'public' ? <p className="muted">Kênh công khai — mọi nhân viên đều xem được. Thành viên đã tham gia trò chuyện:</p> : null
      )}
      {canEdit && added.length > 0 && (
        <div className="chat-history-opt" role="radiogroup" aria-label="Quyền xem tin nhắn cũ">
          <b className="small">Quyền xem tin nhắn cũ cho {added.length} người mới thêm</b>
          {HISTORY_OPTS.map((o) => (
            <label key={o.value} className="check small"><input type="radio" name="history" checked={history === o.value} onChange={() => setHistory(o.value)} /> {o.label}</label>
          ))}
        </div>
      )}
      <div className="mt">{channel.members.map((m) => (
        <div key={m.id} className="user-row"><Avatar name={m.name} color={m.color} size={26} /><span className="grow">{m.name}</span>
          {m.history_from_id > 0 && <span className="chat-history-tag" title="Được thêm với quyền xem giới hạn"><EyeOff size={10} /> giới hạn lịch sử</span>}
          <small className="muted">@{m.username}</small></div>
      ))}</div>
    </Modal>
  );
}

function Conversation({ channelId, onActivity }) {
  const { user, users } = useApp();
  const toast = useToast();
  const [channel, setChannel] = useState(null);
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showMembers, setShowMembers] = useState(false);
  const [more, setMore] = useState(true);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState(null);
  const navigate = useNavigate();
  const sendingRef = useRef(false);
  const inputRef = useRef();
  const listRef = useRef();
  const fileRef = useRef();
  const lastId = useRef(0);
  const stick = useRef(true);

  const loadChannel = useCallback(() => api.get(`/chat/channels/${channelId}`).then(setChannel).catch((e) => setError(e.message)), [channelId]);
  const markRead = useCallback((id) => { if (id) api.post(`/chat/channels/${channelId}/read`, { last_id: id }).then(onActivity).catch(() => {}); }, [channelId, onActivity]);

  useEffect(() => {
    setMsgs(null); setChannel(null); setError(''); setMore(true); lastId.current = 0; stick.current = true;
    loadChannel();
    api.get(`/chat/channels/${channelId}/messages`, { limit: 50 }).then((rows) => {
      setMsgs(rows); setMore(rows.length === 50);
      lastId.current = rows.length ? rows[rows.length - 1].id : 0;
      markRead(lastId.current);
    }).catch((e) => setError(e.message));
  }, [channelId, loadChannel, markRead]);

  const loaded = msgs !== null;
  useEffect(() => {
    if (!loaded) return undefined;
    let busy = false;
    const poll = async () => {
      if (document.hidden || busy) return;
      busy = true; // không chồng nhiều lượt hỏi khi mạng chậm
      try {
        const rows = await api.get(`/chat/channels/${channelId}/messages`, { after_id: lastId.current || undefined, limit: 100 });
        if (rows.length) {
          const el = listRef.current;
          stick.current = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 80 : true;
          setMsgs((m) => mergeMessages(m, rows));
          lastId.current = Math.max(lastId.current, rows[rows.length - 1].id);
          markRead(lastId.current);
        }
      } catch { /* bỏ qua lỗi mạng tạm thời */ } finally { busy = false; }
    };
    const t = setInterval(poll, POLL_MS);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [channelId, markRead, loaded]);

  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const loadOlder = async () => {
    if (!msgs?.length) return;
    const el = listRef.current;
    const h = el.scrollHeight;
    const rows = await api.get(`/chat/channels/${channelId}/messages`, { before_id: msgs[0].id, limit: 50 });
    setMore(rows.length === 50);
    stick.current = false;
    setMsgs([...rows, ...msgs]);
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - h; });
  };

  const send = async (e) => {
    e?.preventDefault();
    // chặn gửi trùng: Enter lặp / bấm nhanh / gõ dấu tiếng Việt khi request trước chưa xong
    if (sendingRef.current || (!text.trim() && !file)) return;
    sendingRef.current = true;
    const body = toFormData({ content: text }, file ? [file] : []);
    const prev = { text, file };
    // hiện tin ngay (đang gửi…), thay bằng tin thật khi máy chủ trả về
    const tmpId = `tmp-${Date.now()}`;
    stick.current = true;
    setMsgs((x) => [...(x || []), { id: tmpId, pending: true, user_id: user.id, user_name: user.name, user_color: user.color,
      content: text.trim() || null, original_name: file?.name || null, created_at: new Date().toISOString() }]);
    setText(''); setFile(null);
    try {
      const m = await api.post(`/chat/channels/${channelId}/messages`, body);
      setMsgs((x) => mergeMessages((x || []).filter((y) => y.id !== tmpId), [m]));
      lastId.current = Math.max(lastId.current, m.id);
      onActivity();
    } catch (err) {
      setMsgs((x) => (x || []).filter((y) => y.id !== tmpId));
      setText(prev.text); setFile(prev.file);
      toast(err.message, 'error');
    } finally {
      sendingRef.current = false;
      inputRef.current?.focus();
    }
  };
  const deleteChannel = async () => {
    if (!window.confirm(`Xoá kênh #${channel.name}? Toàn bộ tin nhắn và tệp trong kênh sẽ bị xoá vĩnh viễn.`)) return;
    try { await api.del(`/chat/channels/${channelId}`); toast('Đã xoá kênh'); onActivity(); navigate('/message'); } catch (err) { toast(err.message, 'error'); }
  };
  const saveEdit = async () => {
    try {
      const m = await api.put(`/chat/messages/${editing.id}`, { content: editing.content });
      setMsgs(msgs.map((x) => (x.id === m.id ? m : x))); setEditing(null);
    } catch (err) { toast(err.message, 'error'); }
  };
  const del = async (m) => {
    if (!window.confirm('Xoá tin nhắn này?')) return;
    try { await api.del(`/chat/messages/${m.id}`); setMsgs(msgs.map((x) => (x.id === m.id ? { ...x, deleted_at: 'now', content: null, original_name: null } : x))); } catch (err) { toast(err.message, 'error'); }
  };

  if (error) return <div className="chat-main"><div className="alert alert-error m">{error}</div></div>;
  if (!channel || !msgs) return <div className="chat-main"><Spinner /></div>;
  const peer = channel.kind === 'direct' ? channel.members.find((m) => m.id !== user.id) : null;
  const title = peer ? peer.name : channel.name;
  const canDelete = ['public', 'private'].includes(channel.kind) && (user.role === 'admin' || channel.created_by === user.id) && !(channel.name === 'chung' && !channel.created_by);
  const fileMsgs = msgs.filter((m) => m.original_name && !m.deleted_at);
  const openFile = (m) => setViewing(fileMsgs.findIndex((x) => x.id === m.id));
  let lastDay = '';
  return (
    <div className="chat-main">
      <div className="chat-head">
        <Link to="/message" className="icon-btn mobile-only" aria-label="Quay lại"><ArrowLeft size={18} /></Link>
        {peer ? <Avatar name={peer.name} color={peer.color} size={30} /> : channel.kind === 'department' ? <Users size={18} /> : channel.kind === 'private' ? <Lock size={18} /> : <Hash size={18} />}
        <div className="grow"><b>{title}</b>{channel.description && <small className="muted block ellipsis">{channel.description}</small>}{peer && <small className="muted block">@{peer.username}</small>}</div>
        {peer && phoneHref(users.find((u) => u.id === peer.id)) && (
          <a className="icon-btn" href={phoneHref(users.find((u) => u.id === peer.id))} title={`Gọi ${users.find((u) => u.id === peer.id).phone}`} aria-label="Gọi điện"><Phone size={17} /></a>
        )}
        {!peer && <button className="btn btn-sm" onClick={() => setShowMembers(true)}><Users size={14} /> {channel.members.length}</button>}
        {canDelete && <button className="icon-btn" title={user.role === 'admin' ? 'Xoá kênh (quản trị viên)' : 'Xoá kênh'} onClick={deleteChannel}><Trash2 size={16} /></button>}
      </div>
      <div className="chat-list" ref={listRef}>
        {more && msgs.length > 0 && <div className="center"><button className="link-btn" onClick={loadOlder}>Xem tin nhắn cũ hơn</button></div>}
        {!msgs.length && <Empty icon={MessageCircle} title="Chưa có tin nhắn">Hãy gửi lời chào đầu tiên 👋</Empty>}
        {msgs.map((m, i) => {
          const day = dayLabel(m.created_at);
          const showDay = day !== lastDay;
          lastDay = day;
          const prev = msgs[i - 1];
          const grouped = !showDay && prev && prev.user_id === m.user_id && parseDate(m.created_at) - parseDate(prev.created_at) < 5 * 60e3;
          const mine = m.user_id === user.id;
          return (
            <div key={m.id}>
              {showDay && <div className="chat-day"><span>{day}</span></div>}
              <div className={cx('chat-msg', grouped && 'grouped', m.pending && 'pending')}>
                <div className="chat-avatar">{!grouped && <Avatar name={m.user_name || 'Hệ thống'} color={m.user_color} size={34} />}</div>
                <div className="grow">
                  {!grouped && <div className="chat-meta"><b>{m.user_name || 'Hệ thống'}</b> <small className="muted">{hhmm(m.created_at)}</small></div>}
                  {m.deleted_at ? <i className="muted small">Tin nhắn đã bị xoá</i> : editing?.id === m.id ? (
                    <div className="chat-edit">
                      <textarea className="input" rows={2} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') setEditing(null); }} />
                      <div className="row gap-sm"><button className="btn btn-sm btn-primary" onClick={saveEdit}>Lưu</button><button className="btn btn-sm" onClick={() => setEditing(null)}>Huỷ</button></div>
                    </div>
                  ) : (
                    <>
                      {m.content && <div className="chat-text"><RichText text={m.content} />{m.edited_at && <small className="muted"> (đã sửa)</small>}</div>}
                      {m.original_name && m.pending && <span className="chat-file"><Paperclip size={14} /> {m.original_name} <small className="muted">đang tải lên…</small></span>}
                      {m.original_name && !m.pending && (
                        m.mime?.startsWith('image/')
                          ? <button type="button" className="chat-img-btn" onClick={() => openFile(m)} title="Xem ảnh"><img className="chat-img" src={api.url(`/chat/messages/${m.id}/file`, { inline: 1 })} alt={m.original_name} loading="lazy" /></button>
                          : <button type="button" className="chat-file as-btn" onClick={() => openFile(m)} title="Xem trước tệp"><Paperclip size={14} /> {m.original_name} <small className="muted">{fileSize(m.size)}</small></button>
                      )}
                    </>
                  )}
                </div>
                {m.pending && <small className="muted chat-sending">Đang gửi…</small>}
                {mine && !m.deleted_at && !m.pending && editing?.id !== m.id && (
                  <div className="chat-actions">
                    {m.content && <button className="icon-btn" title="Sửa" onClick={() => setEditing({ id: m.id, content: m.content })}><Pencil size={13} /></button>}
                    <button className="icon-btn" title="Xoá" onClick={() => del(m)}><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <form className="chat-compose" onSubmit={send}>
        {file && <div className="chat-attach"><Paperclip size={13} /> {file.name} <button type="button" className="icon-btn" onClick={() => setFile(null)} aria-label="Bỏ tệp"><X size={13} /></button></div>}
        <div className="row gap-sm">
          <button type="button" className="icon-btn" title="Đính kèm tệp" onClick={() => fileRef.current.click()}><Paperclip size={18} /></button>
          <input ref={fileRef} type="file" hidden onChange={(e) => { setFile(e.target.files[0] || null); e.target.value = ''; }} />
          <EmojiPicker onPick={(em) => setText((t) => insertAtCursor(inputRef.current, t, em))} />
          <MentionTextarea ref={inputRef} className="input grow" rows={1} value={text} placement="top" users={mentionableUsers(channel, users)}
            placeholder={`Nhắn tin tới ${peer ? peer.name : `#${channel.name}`} · @ để nhắc tên · Enter để gửi`}
            onChange={setText} onKeyDown={(e) => { if (isSendKey(e)) { e.preventDefault(); if (!e.repeat) send(); } }} />
          <button className="btn btn-primary" disabled={!text.trim() && !file} aria-label="Gửi"><Send size={16} /></button>
        </div>
      </form>
      {showMembers && <ChannelMembers channel={channel} onClose={() => setShowMembers(false)} onSaved={loadChannel} />}
      {viewing != null && viewing >= 0 && (
        <FileViewer files={fileMsgs.map((m) => ({ ...m, id: m.id }))} index={viewing} urlOf={(f) => api.url(`/chat/messages/${f.id}/file`)} onClose={() => setViewing(null)}
          publicUrlOf={async (f, share) => (await api.post(`/chat/messages/${f.id}/file/link${share ? '?share=1' : ''}`)).url} />
      )}
    </div>
  );
}

export default function MessagePage() {
  const { channelId } = useParams();
  const { company, user } = useApp();
  const [channels, setChannels] = useState(null);
  const [modal, setModal] = useState(null);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 400);
  const [results, setResults] = useState(null);
  const navigate = useNavigate();

  // gộp các lần làm mới danh sách kênh dồn dập (đọc tin, gửi tin, cập nhật định kỳ) — tối đa 1 lần / 1,5 giây
  const lastLoad = useRef(0);
  const pendingLoad = useRef(null);
  const loadChannels = useCallback(() => {
    const wait = 1500 - (Date.now() - lastLoad.current);
    if (wait > 0) {
      if (!pendingLoad.current) pendingLoad.current = setTimeout(() => { pendingLoad.current = null; loadChannels(); }, wait);
      return Promise.resolve();
    }
    lastLoad.current = Date.now();
    return api.get('/chat/channels').then(setChannels).catch(() => {});
  }, []);
  useEffect(() => { loadChannels(); const t = setInterval(() => { if (!document.hidden) loadChannels(); }, LIST_POLL_MS); return () => clearInterval(t); }, [loadChannels]);
  useEffect(() => { if (!dq.trim()) { setResults(null); return; } api.get('/chat/search', { q: dq }).then(setResults); }, [dq]);
  useEffect(() => {
    if (!channelId && channels?.length && window.innerWidth > 800) navigate(`/message/${channels.find((c) => c.kind !== 'direct')?.id || channels[0].id}`, { replace: true });
  }, [channelId, channels, navigate]);

  const groups = [
    ['Kênh', (channels || []).filter((c) => c.kind !== 'direct')],
    ['Tin nhắn trực tiếp', (channels || []).filter((c) => c.kind === 'direct')],
  ];
  return (
    <div className="office chat-app">
      <header className="topbar">
        <Link to="/" className="brand"><img className="brand-logo" src="/logo-192.png" alt="LDL" /><span className="brand-name">{company}</span></Link>
        <span className="topbar-app">LDL Message</span>
        <div className="grow" />
        <ContactsButton dark />
        <NotificationBell app="message" dark />
        <AppSwitcher dark />
        <UserMenu dark />
      </header>
      <div className={cx('chat-body', channelId && 'has-channel')}>
        <aside className="chat-side">
          <div className="chat-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tin nhắn" /></div>
          {results ? (
            <div className="chat-results">
              <div className="chat-side-title">Kết quả ({results.length}) <button className="link-btn" onClick={() => setQ('')}>Đóng</button></div>
              {results.map((m) => (
                <Link key={m.id} to={`/message/${m.channel_id}`} className="chat-result" onClick={() => setQ('')}>
                  <b>{m.user_name}</b> <small className="muted">{fmtDate(m.created_at)}</small><div className="ellipsis">{m.content}</div>
                </Link>
              ))}
            </div>
          ) : !channels ? <Spinner /> : groups.map(([label, list], gi) => (
            <div key={label} className="chat-group">
              <div className="chat-side-title">{label}
                {user.role !== 'guest' || gi === 1 ? (
                  <button className="icon-btn" title={gi ? 'Nhắn tin mới' : 'Tạo kênh'} onClick={() => setModal(gi ? 'dm' : 'channel')}><Plus size={14} /></button>
                ) : null}
              </div>
              {list.map((ch) => (
                <Link key={ch.id} to={`/message/${ch.id}`} className={cx('chat-channel', String(ch.id) === channelId && 'active', ch.unread > 0 && 'unread')}>
                  {ch.kind === 'direct' ? <Avatar name={ch.display_name} color={ch.peer?.color} size={20} /> : ch.kind === 'department' ? <Users size={14} /> : ch.kind === 'private' ? <Lock size={14} /> : <Hash size={14} />}
                  <span className="grow ellipsis">{ch.display_name}</span>
                  {ch.unread > 0 && <span className="count">{ch.unread > 99 ? '99+' : ch.unread}</span>}
                </Link>
              ))}
              {!list.length && <small className="muted pad-sm">{gi ? 'Chưa có cuộc trò chuyện' : 'Chưa có kênh'}</small>}
            </div>
          ))}
        </aside>
        {channelId ? <Conversation key={channelId} channelId={channelId} onActivity={loadChannels} />
          : <div className="chat-main"><Empty icon={MessageCircle} title="Chọn một kênh hoặc cuộc trò chuyện" /></div>}
      </div>
      {modal === 'channel' && <NewChannel onClose={(ok) => { setModal(null); if (ok) loadChannels(); }} />}
      {modal === 'dm' && <NewDirect onClose={(ok) => { setModal(null); if (ok) loadChannels(); }} />}
    </div>
  );
}
