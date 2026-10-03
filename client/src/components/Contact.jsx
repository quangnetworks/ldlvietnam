/**
 * Liên hệ nhanh: chọn thành viên → nhắn tin qua LDL Message (trò chuyện trực tiếp / nhóm) hoặc gọi di động (nếu có số).
 * - useContact(): message(u), group(users), phoneHref(u)
 * - ContactButtons: cặp nút "Nhắn tin" + "Gọi" cho một người
 * - ContactsButton: nút trên thanh trên cùng, mở danh bạ liên hệ nhanh
 */
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookUser, MessageCircle, Phone, Search, Users, Check, X } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useToast } from '../context.jsx';
import { Avatar, Modal } from './ui.jsx';
import { cx } from '../utils.js';

const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

/** Số điện thoại → liên kết tel: (giữ dấu + và chữ số). */
export const phoneHref = (u) => {
  const n = String(u?.phone || '').replace(/[^\d+]/g, '');
  return n.length >= 6 ? `tel:${n}` : null;
};

/** "Nguyễn Minh Trang" → "Minh Trang" */
const shortName = (u) => String(u.name || '').trim().split(/\s+/).slice(-2).join(' ');

export function useContact() {
  const { user, apps } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const busy = useRef(false);
  const canMessage = (apps || []).includes('message');
  // bấm liên tục chỉ gửi một yêu cầu
  const once = async (fn) => {
    if (busy.current) return;
    busy.current = true;
    try { await fn(); } catch (e) { toast(e.message, 'error'); } finally { busy.current = false; }
  };
  const message = (u) => once(async () => {
    const r = await api.post('/chat/direct', { user_id: u.id });
    navigate(`/message/${r.id}`);
  });
  const group = (list) => once(async () => {
    const names = [user, ...list].slice(0, 4).map(shortName).join(', ');
    const ch = await api.post('/chat/channels', {
      name: `${names}${list.length > 3 ? ` +${list.length - 3}` : ''}`.slice(0, 80), kind: 'private', members: list.map((u) => u.id),
    });
    navigate(`/message/${ch.id}`);
  });
  return { canMessage, message, group, me: user };
}

/** Nút nhắn tin / gọi cho một người (ẩn "Nhắn tin" với chính mình, ẩn "Gọi" khi chưa có số). */
export function ContactButtons({ user: u, compact = false, className }) {
  const { canMessage, message, me } = useContact();
  const tel = phoneHref(u);
  if (!u || u.id === me.id) return null;
  return (
    <div className={cx('contact-btns', compact && 'compact', className)}>
      {canMessage && (
        <button type="button" className={compact ? 'icon-btn sm contact-msg' : 'btn btn-sm contact-msg'} title={`Nhắn tin cho ${u.name}`}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); message(u); }}>
          <MessageCircle size={15} />{!compact && ' Nhắn tin'}
        </button>
      )}
      {tel && (
        <a className={compact ? 'icon-btn sm contact-call' : 'btn btn-sm contact-call'} href={tel} title={`Gọi ${u.phone}`}
          onClick={(e) => e.stopPropagation()}>
          <Phone size={15} />{!compact && ' Gọi'}
        </a>
      )}
    </div>
  );
}

/** Danh bạ liên hệ nhanh: tìm theo tên / chức danh / phòng ban / số điện thoại; chọn nhiều người để nhắn nhóm. */
export function ContactsModal({ onClose }) {
  const { users, user, departments } = useApp();
  const { canMessage, message, group } = useContact();
  const [q, setQ] = useState('');
  const [dep, setDep] = useState('');
  const [picked, setPicked] = useState([]);
  const depName = useMemo(() => Object.fromEntries((departments || []).map((d) => [d.id, d.name])), [departments]);
  const list = useMemo(() => {
    const s = strip(q.trim());
    const digits = q.replace(/\D/g, '');
    return users.filter((u) => u.id !== user.id && u.active !== 0)
      .filter((u) => !dep || String(u.department_id) === dep || String(u.extra_departments || '').split(',').includes(dep))
      .filter((u) => !s || strip(u.name).includes(s) || strip(u.username).includes(s) || strip(u.title).includes(s)
        || strip(depName[u.department_id]).includes(s) || (digits.length >= 3 && String(u.phone || '').replace(/\D/g, '').includes(digits)));
  }, [users, user.id, q, dep, depName]);
  const toggle = (u) => setPicked((p) => (p.some((x) => x.id === u.id) ? p.filter((x) => x.id !== u.id) : [...p, u]));
  const act = (fn) => { fn(); onClose(); };
  return (
    <Modal title={<span className="row gap-sm"><BookUser size={18} /> Liên hệ nhanh</span>} onClose={onClose} width={520} className="contacts-modal"
      footer={picked.length > 0 ? (
        <div className="contacts-foot">
          <div className="contacts-picked">
            {picked.map((u) => (
              <button key={u.id} type="button" className="chip" onClick={() => toggle(u)} title="Bỏ chọn">{shortName(u)} <X size={12} /></button>
            ))}
          </div>
          {canMessage && (
            <button className="btn btn-primary" onClick={() => act(() => (picked.length === 1 ? message(picked[0]) : group(picked)))}>
              {picked.length === 1 ? <><MessageCircle size={15} /> Nhắn tin</> : <><Users size={15} /> Nhắn nhóm ({picked.length + 1} người)</>}
            </button>
          )}
        </div>
      ) : null}>
      <div className="contacts-tools">
        <div className="input-icon grow"><Search size={15} className="muted" />
          <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tên, chức danh, phòng ban hoặc số điện thoại" /></div>
        <select className="input contacts-dep" value={dep} onChange={(e) => setDep(e.target.value)} aria-label="Phòng ban">
          <option value="">Mọi phòng ban</option>
          {(departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      <small className="muted block contacts-hint">Chạm vào ô tròn để chọn nhiều người và nhắn nhóm.</small>
      <div className="contacts-list">
        {list.map((u) => {
          const on = picked.some((x) => x.id === u.id);
          const tel = phoneHref(u);
          return (
            <div key={u.id} className={cx('contact-row', on && 'on')}>
              {canMessage && (
                <button type="button" className={cx('contact-check', on && 'on')} onClick={() => toggle(u)} aria-pressed={on} aria-label={`Chọn ${u.name}`}>
                  {on && <Check size={13} />}
                </button>
              )}
              <Avatar name={u.name} color={u.color} uid={u.id} size={38} />
              <div className="grow contact-info" onClick={() => canMessage && toggle(u)}>
                <b className="ellipsis block">{u.name}</b>
                <small className="muted ellipsis block">{[u.title, depName[u.department_id]].filter(Boolean).join(' · ') || `@${u.username}`}</small>
                {u.phone && <small className="contact-phone">{u.phone}</small>}
              </div>
              {canMessage && (
                <button type="button" className="round-btn msg" title={`Nhắn tin cho ${u.name}`} onClick={() => act(() => message(u))}><MessageCircle size={17} /></button>
              )}
              {tel ? <a className="round-btn call" href={tel} title={`Gọi ${u.phone}`}><Phone size={17} /></a>
                : <span className="round-btn off" title="Chưa có số điện thoại"><Phone size={17} /></span>}
            </div>
          );
        })}
        {!list.length && <div className="empty-small">Không tìm thấy thành viên</div>}
      </div>
    </Modal>
  );
}

export function ContactsButton({ dark }) {
  const { user } = useApp();
  const [open, setOpen] = useState(false);
  if (user.role === 'guest') return null;
  return (
    <>
      <button className={cx('icon-btn', dark && 'on-dark')} onClick={() => setOpen(true)} title="Liên hệ nhanh: nhắn tin hoặc gọi điện" aria-label="Liên hệ nhanh">
        <BookUser size={18} />
      </button>
      {open && <ContactsModal onClose={() => setOpen(false)} />}
    </>
  );
}
