import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Hash, Lock, Plus, Send, Paperclip, Search, Pencil, Trash2, Users, ArrowLeft, MessageCircle, X } from 'lucide-react';
import { api, toFormData } from '../api.js';
import { useApp, useToast } from '../context.jsx';
import { Avatar, Spinner, Modal, Field, UserPicker, Empty } from '../components/ui.jsx';
import { AppSwitcher, NotificationBell, UserMenu, useDebounced } from '../components/shell.jsx';
import { parseDate, fmtDate, fileSize, cx } from '../utils.js';

const POLL_MS = 6000;

function hhmm(v) {
  const d = parseDate(v);
  return d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
}
function dayLabel(v) {
  const d = parseDate(v);
  const today = new Date();
  const y = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return 'Hôm nay';
  if (d.toDateString() === y.toDateString()) return 'Hôm qua';
  return fmtDate(d);
}

/** Render text with @mentions and links highlighted (no HTML injection). */
function RichText({ text }) {
  const parts = String(text || '').split(/(@[\w.]+|https?:\/\/[^\s]+)/g);
  return parts.map((p, i) => {
    if (p.startsWith('@')) return <span key={i} className="mention">{p}</span>;
    if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a>;
    return p;
  });
}

function NewChannel({ onClose }) {
  const { users } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [f, setF] = useState({ name: '', description: '', kind: 'public', members: [] });
  const save = async () => {
    try { const ch = await api.post('/chat/channels', f); onClose(true); navigate(`/message/${ch.id}`); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title="Tạo kênh mới" onClose={() => onClose(false)} width={520}
      footer={<><button className="btn" onClick={() => onClose(false)}>Huỷ</button><button className="btn btn-primary" disabled={!f.name.trim()} onClick={save}>Tạo kênh</button></>}>
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
  const start = async (u) => {
    try { const r = await api.post('/chat/direct', { user_id: u.id }); onClose(true); navigate(`/message/${r.id}`); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title="Nhắn tin trực tiếp" onClose={() => onClose(false)} width={440}>
      <input className="input" autoFocus placeholder="Tìm đồng nghiệp" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="move-list mt">
        {list.map((u) => (
          <button key={u.id} className="drive-row plain" onClick={() => start(u)}><Avatar name={u.name} color={u.color} size={28} /><span className="grow">{u.name}<small className="muted block">{u.title}</small></span></button>
        ))}
      </div>
    </Modal>
  );
}

function ChannelMembers({ channel, onClose, onSaved }) {
  const { users, user } = useApp();
  const toast = useToast();
  const [ids, setIds] = useState(channel.members.map((m) => m.id));
  const canEdit = channel.kind === 'private' && (channel.created_by === user.id || user.role === 'admin');
  const save = async () => {
    try { await api.put(`/chat/channels/${channel.id}`, { members: ids }); toast('Đã cập nhật thành viên'); onSaved(); onClose(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title={`Thành viên #${channel.name}`} onClose={onClose} width={480}
      footer={canEdit ? <><button className="btn" onClick={onClose}>Đóng</button><button className="btn btn-primary" onClick={save}>Lưu</button></> : null}>
      {canEdit ? <UserPicker users={users} multiple value={ids} onChange={setIds} /> : (
        channel.kind === 'public' ? <p className="muted">Kênh công khai — mọi nhân viên đều xem được. Thành viên đã tham gia trò chuyện:</p> : null
      )}
      <div className="mt">{channel.members.map((m) => <div key={m.id} className="user-row"><Avatar name={m.name} color={m.color} size={26} /><span className="grow">{m.name}</span><small className="muted">@{m.username}</small></div>)}</div>
    </Modal>
  );
}

function Conversation({ channelId, onActivity }) {
  const { user } = useApp();
  const toast = useToast();
  const [channel, setChannel] = useState(null);
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showMembers, setShowMembers] = useState(false);
  const [more, setMore] = useState(true);
  const [error, setError] = useState('');
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

  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden || msgs === null) return;
      try {
        const rows = await api.get(`/chat/channels/${channelId}/messages`, { after_id: lastId.current || undefined, limit: 100 });
        if (rows.length) {
          const el = listRef.current;
          stick.current = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 80 : true;
          setMsgs((m) => { const ids = new Set((m || []).map((x) => x.id)); return [...(m || []), ...rows.filter((x) => !ids.has(x.id))]; });
          lastId.current = rows[rows.length - 1].id;
          markRead(lastId.current);
        }
      } catch { /* bỏ qua lỗi mạng tạm thời */ }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [channelId, markRead, msgs]);

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
    if (!text.trim() && !file) return;
    try {
      const m = await api.post(`/chat/channels/${channelId}/messages`, toFormData({ content: text }, file ? [file] : []));
      stick.current = true;
      setMsgs((x) => [...(x || []), m]);
      lastId.current = Math.max(lastId.current, m.id);
      setText(''); setFile(null);
      onActivity();
    } catch (err) { toast(err.message, 'error'); }
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
  let lastDay = '';
  return (
    <div className="chat-main">
      <div className="chat-head">
        <Link to="/message" className="icon-btn mobile-only" aria-label="Quay lại"><ArrowLeft size={18} /></Link>
        {peer ? <Avatar name={peer.name} color={peer.color} size={30} /> : channel.kind === 'private' ? <Lock size={18} /> : <Hash size={18} />}
        <div className="grow"><b>{title}</b>{channel.description && <small className="muted block ellipsis">{channel.description}</small>}{peer && <small className="muted block">@{peer.username}</small>}</div>
        {!peer && <button className="btn btn-sm" onClick={() => setShowMembers(true)}><Users size={14} /> {channel.members.length}</button>}
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
              <div className={cx('chat-msg', grouped && 'grouped')}>
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
                      {m.original_name && (
                        m.mime?.startsWith('image/')
                          ? <a href={api.url(`/chat/messages/${m.id}/file`, { inline: 1 })} target="_blank" rel="noopener noreferrer"><img className="chat-img" src={api.url(`/chat/messages/${m.id}/file`, { inline: 1 })} alt={m.original_name} /></a>
                          : <a className="chat-file" href={api.url(`/chat/messages/${m.id}/file`)}><Paperclip size={14} /> {m.original_name} <small className="muted">{fileSize(m.size)}</small></a>
                      )}
                    </>
                  )}
                </div>
                {mine && !m.deleted_at && editing?.id !== m.id && (
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
          <textarea className="input grow" rows={1} value={text} placeholder={`Nhắn tin tới ${peer ? peer.name : `#${channel.name}`} · gõ @tên_tài_khoản để nhắc tên`}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }} />
          <button className="btn btn-primary" disabled={!text.trim() && !file} aria-label="Gửi"><Send size={16} /></button>
        </div>
      </form>
      {showMembers && <ChannelMembers channel={channel} onClose={() => setShowMembers(false)} onSaved={loadChannel} />}
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

  const loadChannels = useCallback(() => api.get('/chat/channels').then(setChannels).catch(() => {}), []);
  useEffect(() => { loadChannels(); const t = setInterval(() => { if (!document.hidden) loadChannels(); }, POLL_MS * 2); return () => clearInterval(t); }, [loadChannels]);
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
        <span className="topbar-app">Base Message</span>
        <div className="grow" />
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
                  {ch.kind === 'direct' ? <Avatar name={ch.display_name} color={ch.peer?.color} size={20} /> : ch.kind === 'private' ? <Lock size={14} /> : <Hash size={14} />}
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
