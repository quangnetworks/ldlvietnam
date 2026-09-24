import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Building2, Users, ExternalLink, MessagesSquare } from 'lucide-react';
import { api, toFormData } from '../api.js';
import { useApp, useToast } from '../context.jsx';
import { Avatar, Spinner } from '../components/ui.jsx';
import { hhmm, dayLabel, RichText } from '../message/Message.jsx';
import { cx } from '../utils.js';

const POLL_MS = 8000;

/** Khung chat nhóm trên Home: kênh toàn công ty và kênh phòng ban. */
export default function HomeChat() {
  const { user } = useApp();
  const toast = useToast();
  const [channels, setChannels] = useState(null);
  const [active, setActive] = useState(null);
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef();
  const lastId = useRef(0);

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
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const rows = await api.get(`/chat/channels/${active}/messages`, lastId.current ? { after_id: lastId.current } : { limit: 30 });
        const fresh = rows.filter((x) => x.id > lastId.current);
        if (alive && fresh.length) {
          setMsgs((m) => [...(m || []), ...fresh]);
          lastId.current = fresh[fresh.length - 1].id;
          markRead(lastId.current);
        }
        if (alive) loadChannels();
      } catch { /* bỏ qua lỗi mạng tạm thời */ }
    }, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [active, markRead, loadChannels]);

  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs]);

  const send = async (e) => {
    e?.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const m = await api.post(`/chat/channels/${active}/messages`, toFormData({ content: text }));
      setMsgs((x) => [...(x || []), m]);
      lastId.current = Math.max(lastId.current, m.id);
      setText('');
    } catch (err) { toast(err.message, 'error'); } finally { setSending(false); }
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
                      {m.original_name && <a className="hchat-file" href={api.url(`/chat/messages/${m.id}/file`)}>📎 {m.original_name}</a>}
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
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={5000}
          placeholder={ch ? `Nhắn tới ${ch.kind === 'department' ? ch.name : 'toàn công ty'}…` : 'Nhắn tin…'} />
        <button className="btn btn-primary" disabled={!text.trim() || sending} aria-label="Gửi"><Send size={15} /></button>
      </form>
    </section>
  );
}
