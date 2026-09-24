import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Building2, Users, ExternalLink, MessagesSquare } from 'lucide-react';
import { api, toFormData } from '../api.js';
import { useApp, useToast } from '../context.jsx';
import { Avatar, Spinner } from '../components/ui.jsx';
import { hhmm, dayLabel, RichText, isSendKey, mergeMessages, mentionableUsers } from '../message/Message.jsx';
import { MentionTextarea } from '../components/Mention.jsx';
import EmojiPicker, { insertAtCursor } from '../components/EmojiPicker.jsx';
import FileViewer from '../components/FileViewer.jsx';
import { cx } from '../utils.js';

const POLL_MS = 4000;

/** Khung chat nhóm trên Home: kênh toàn công ty và kênh phòng ban. */
export default function HomeChat() {
  const { user, users } = useApp();
  const toast = useToast();
  const [channels, setChannels] = useState(null);
  const [active, setActive] = useState(null);
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef();
  const inputRef = useRef();
  const sendingRef = useRef(false);
  const lastId = useRef(0);
  const [viewing, setViewing] = useState(null);

  const loadChannels = useCallback(() => api.get('/home/chat').then((r) => {
    setChannels(r.channels);
    setActive((a) => a ?? r.channels[0]?.id ?? null);
  }).catch(() => setChannels([])), []);
  useEffect(() => { loadChannels(); }, [loadChannels]);

  const markRead = useCallback((id) => {
    if (!id || !active) return;
    api.post(`/chat/channels/${active}/read`, { last_id: id }).then(() => {
      setChannels((list) => list?.map((c) => (c.id === active ? { ...c, unread: 0 } : c)));
    }).catch(() => {});
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    setMsgs(null);
    lastId.current = 0;
    api.get(`/chat/channels/${active}/messages`, { limit: 30 }).then((rows) => {
      if (!alive) return;
      setMsgs(rows);
      lastId.current = rows.length ? rows[rows.length - 1].id : 0;
      markRead(lastId.current);
    }).catch(() => alive && setMsgs([]));
    let tick = 0;
    let busy = false;
    const t = setInterval(async () => {
      if (document.hidden || busy) return;
      busy = true;
      try {
        const rows = await api.get(`/chat/channels/${active}/messages`, lastId.current ? { after_id: lastId.current } : { limit: 30 });
        const fresh = rows.filter((x) => x.id > lastId.current);
        if (alive && fresh.length) {
          setMsgs((m) => mergeMessages(m, fresh));
          lastId.current = Math.max(lastId.current, fresh[fresh.length - 1].id);
          markRead(lastId.current);
        }
        if (alive && ++tick % 4 === 0) loadChannels(); // số tin chưa đọc của kênh khác: ~16 giây / lần
      } catch { /* bỏ qua lỗi mạng tạm thời */ } finally { busy = false; }
    }, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [active, markRead, loadChannels]);

  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs]);

  const send = async (e) => {
    e?.preventDefault();
    // khoá đồng bộ bằng ref: hai lần Enter liên tiếp (hoặc Enter khi gõ dấu) không gửi trùng
    if (!text.trim() || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    const content = text;
    setText('');
    try {
      const m = await api.post(`/chat/channels/${active}/messages`, toFormData({ content }));
      setMsgs((x) => mergeMessages(x, [m]));
      lastId.current = Math.max(lastId.current, m.id);
    } catch (err) { setText(content); toast(err.message, 'error'); } finally { sendingRef.current = false; setSending(false); inputRef.current?.focus(); }
  };

  if (channels && !channels.length) return null;
  const ch = channels?.find((c) => c.id === active);
  let lastDay = '';
  return (
    <section className="hcard hchat">
      <div className="hcard-head">
        <h3><MessagesSquare size={16} /> Chat nhóm</h3>
        <Link to={active ? `/message/${active}` : '/message'} className="icon-btn sm" title="Mở LDL Message"><ExternalLink size={14} /></Link>
      </div>
      <div className="hchat-tabs">
        {(channels || []).map((c) => (
          <button key={c.id} className={cx(c.id === active && 'active')} onClick={() => setActive(c.id)} title={c.name}>
            {c.kind === 'department' ? <Users size={14} /> : <Building2 size={14} />}
            <span className="ellipsis">{c.kind === 'department' ? c.name : 'Toàn công ty'}</span>
            {c.unread > 0 && c.id !== active && <span className="count">{c.unread > 99 ? '99+' : c.unread}</span>}
          </button>
        ))}
      </div>
      <div className="hchat-list" ref={listRef}>
        {!msgs ? <Spinner /> : !msgs.length ? <div className="agenda-empty"><MessagesSquare size={26} /><span>Chưa có tin nhắn — hãy gửi lời chào!</span></div> : msgs.map((m, i) => {
          const day = dayLabel(m.created_at);
          const showDay = day !== lastDay;
          lastDay = day;
          const mine = m.user_id === user.id;
          const grouped = !showDay && msgs[i - 1]?.user_id === m.user_id;
          return (
            <div key={m.id}>
              {showDay && <div className="hchat-day">{day}</div>}
              <div className={cx('hchat-msg', mine && 'mine', grouped && 'grouped')}>
                {!mine && <span className="hchat-av">{!grouped && <Avatar name={m.user_name || 'Hệ thống'} color={m.user_color} size={28} />}</span>}
                <div className="hchat-bubble">
                  {!mine && !grouped && <b className="hchat-name">{m.user_name}</b>}
                  {m.deleted_at ? <i className="muted">Tin nhắn đã bị xoá</i> : (
                    <>
                      {m.content && <span className="hchat-text"><RichText text={m.content} /></span>}
                      {m.original_name && (m.mime?.startsWith('image/')
                        ? <button type="button" className="chat-img-btn" onClick={() => setViewing(m)}><img className="hchat-img" src={api.url(`/chat/messages/${m.id}/file`, { inline: 1 })} alt={m.original_name} loading="lazy" /></button>
                        : <button type="button" className="hchat-file as-btn" onClick={() => setViewing(m)}>📎 {m.original_name}</button>)}
                    </>
                  )}
                  <small className="hchat-time">{hhmm(m.created_at)}</small>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <form className="hchat-compose" onSubmit={send}>
        <EmojiPicker onPick={(em) => setText((t) => insertAtCursor(inputRef.current, t, em))} align="left" />
        <MentionTextarea as="input" ref={inputRef} className="input" value={text} onChange={setText} maxLength={5000} placement="top"
          users={mentionableUsers(ch, users)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (!isSendKey(e) || e.repeat)) e.preventDefault(); }}
          placeholder={ch ? `Nhắn tới ${ch.kind === 'department' ? ch.name : 'toàn công ty'}…` : 'Nhắn tin…'} />
        <button className="btn btn-primary" disabled={!text.trim() || sending} aria-label="Gửi"><Send size={15} /></button>
      </form>
      {viewing && (
        <FileViewer files={[viewing]} urlOf={(f) => api.url(`/chat/messages/${f.id}/file`)} onClose={() => setViewing(null)}
          publicUrlOf={async (f) => (await api.post(`/chat/messages/${f.id}/file/link`)).url} />
      )}
    </section>
  );
}
