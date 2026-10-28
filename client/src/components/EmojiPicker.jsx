/** Bảng chọn biểu tượng cảm xúc (không phụ thuộc thư viện), chèn vào vị trí con trỏ của ô nhập. */
import { useEffect, useRef, useState } from 'react';
import { Smile } from 'lucide-react';
import { cx } from '../utils.js';

const GROUPS = [
  { key: 'recent', label: '🕘', title: 'Dùng gần đây', list: [] },
  { key: 'smile', label: '😀', title: 'Cảm xúc', list: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😋 😛 😜 🤪 😝 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷 🤒 🤕 🥵 🥶 😵 🤯 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬'.split(' ') },
  { key: 'hand', label: '👍', title: 'Cử chỉ', list: '👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 🙏 👏 🙌 👐 🤲 💪 ✍️ 🫶 🫡 💯 ✅ ☑️ ❌ ❗ ❓ ⚠️ 🔥 ⭐ 🌟 ✨ ⚡ 💥 🎉 🎊 🎁 🏆 🥇 🎯 🚀'.split(' ') },
  { key: 'heart', label: '❤️', title: 'Trái tim', list: '❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 😻 💋'.split(' ') },
  { key: 'work', label: '💼', title: 'Công việc', list: '💼 📁 📂 📄 📃 📑 📊 📈 📉 📋 📌 📍 📎 🖇️ ✏️ 📝 🗂️ 🗓️ 📅 ⏰ ⏳ ⌛ 🕐 💻 🖥️ 🖨️ ⌨️ 📱 ☎️ 📞 📧 📨 📩 📦 🚚 🏭 🏢 🏬 💰 💵 💳 🧾 🔑 🔒 🔓 🔔 📣 📢 💡 🔧 🛠️ ⚙️ 🧮'.split(' ') },
  { key: 'food', label: '☕', title: 'Ăn uống & khác', list: '☕ 🍵 🧋 🍺 🍻 🥂 🍷 🍰 🎂 🍕 🍜 🍲 🍚 🍱 🥗 🍎 🍉 🍌 🥭 🌞 🌤️ ⛅ 🌧️ ⛈️ 🌈 ❄️ 🌸 🌹 🌻 🍀 🐶 🐱 🐼 🐯 🦁 🐧 ✈️ 🚗 🛵 🏖️ ⛰️ 🏠 🇻🇳'.split(' ') },
];
const RECENT_KEY = 'ldl.emoji.recent';
const loadRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };

/** Chèn chuỗi vào ô nhập tại vị trí con trỏ, trả về giá trị mới. */
export function insertAtCursor(el, value, text) {
  if (!el) return value + text;
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const next = value.slice(0, start) + text + value.slice(end);
  requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + text.length, start + text.length); });
  return next;
}

export default function EmojiPicker({ onPick, align = 'left', up = true }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('smile');
  const [recent, setRecent] = useState(loadRecent);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const k = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  const pick = (e) => {
    onPick(e);
    const next = [e, ...recent.filter((x) => x !== e)].slice(0, 24);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* bỏ qua */ }
  };
  const groups = GROUPS.map((g) => (g.key === 'recent' ? { ...g, list: recent } : g)).filter((g) => g.list.length);
  const cur = groups.find((g) => g.key === tab) || groups[0];
  return (
    <div className="emoji" ref={ref}>
      <button type="button" className={cx('icon-btn', open && 'active')} title="Biểu tượng cảm xúc" aria-label="Biểu tượng cảm xúc" onClick={() => setOpen(!open)}>
        <Smile size={18} />
      </button>
      {open && (
        <div className={cx('emoji-pop glass', align, up ? 'up' : 'down')} role="dialog" aria-label="Chọn biểu tượng">
          <div className="emoji-tabs">
            {groups.map((g) => (
              <button type="button" key={g.key} className={cx(cur.key === g.key && 'active')} title={g.title} onClick={() => setTab(g.key)}>{g.label}</button>
            ))}
          </div>
          <small className="muted emoji-title">{cur.title}</small>
          <div className="emoji-grid">
            {cur.list.map((e) => <button type="button" key={e} onClick={() => pick(e)} aria-label={e}>{e}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}
