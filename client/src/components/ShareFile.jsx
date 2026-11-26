/**
 * Chia sẻ tệp (bình luận, kết quả công việc, tệp đính kèm…) sang ứng dụng khác:
 *  - "Chia sẻ qua ứng dụng": gửi chính tệp qua bảng chia sẻ của thiết bị (Web Share API) → Zalo, Viber, Messenger,
 *    Telegram, Mail, AirDrop… (iPhone / Android; Edge, Chrome trên Windows / macOS)
 *  - Zalo / Viber / Telegram / Email: gửi liên kết tải tệp có hạn 7 ngày (người nhận không cần tài khoản LDL)
 *  - Sao chép liên kết, tải về
 * Liên kết chia sẻ do máy chủ ký sau khi đã kiểm tra quyền xem của người chia sẻ.
 */
import { useRef, useState } from 'react';
import { Share2, Mail, Link2, Download, Smartphone, Send, Loader2 } from 'lucide-react';
import { useToast } from '../context.jsx';
import { Dropdown } from './ui.jsx';
import { cx } from '../utils.js';

const MAX_SHARE_SIZE = 50 * 1024 * 1024;
const blobCache = new Map(); // url → Promise<Blob>

let fileShareOk;
/** Trình duyệt có gửi được tệp qua bảng chia sẻ của thiết bị không. */
export function canShareFiles() {
  if (fileShareOk === undefined) {
    try {
      fileShareOk = !!(navigator.share && navigator.canShare?.({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] }));
    } catch { fileShareOk = false; }
  }
  return fileShareOk;
}

function loadBlob(url) {
  if (!blobCache.has(url)) {
    const p = fetch(url, { credentials: 'same-origin' }).then((r) => {
      if (!r.ok) throw new Error('Không tải được tệp để chia sẻ');
      return r.blob();
    });
    p.catch(() => blobCache.delete(url));
    blobCache.set(url, p);
    // giữ bộ nhớ gọn: chỉ nhớ vài tệp gần nhất
    if (blobCache.size > 6) blobCache.delete(blobCache.keys().next().value);
  }
  return blobCache.get(url);
}

/**
 * file: { original_name, mime, size }; url: đường dẫn tải (đã đăng nhập);
 * getShareLink(): Promise<url> liên kết chia sẻ 7 ngày (không bắt buộc — thiếu thì ẩn các mục gửi liên kết).
 */
export default function ShareFileButton({ file, url, getShareLink, className, size = 18, align = 'right', label = false }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const linkRef = useRef(null);
  const nativeFiles = canShareFiles() && (!file.size || file.size <= MAX_SHARE_SIZE);
  const name = file.original_name || 'tệp';

  const link = async () => {
    if (!linkRef.current) linkRef.current = getShareLink().catch((e) => { linkRef.current = null; throw e; });
    return linkRef.current;
  };
  // chuẩn bị sẵn tệp khi mở menu để lúc bấm "Chia sẻ" gọi được ngay (iOS yêu cầu gọi trong thao tác bấm)
  const prepare = () => { if (nativeFiles) loadBlob(url).catch(() => {}); };

  const shareNative = async () => {
    setBusy(true);
    try {
      const blob = await loadBlob(url);
      const f = new File([blob], name, { type: file.mime || blob.type || 'application/octet-stream' });
      if (!navigator.canShare?.({ files: [f] })) throw Object.assign(new Error('unsupported'), { name: 'TypeError' });
      await navigator.share({ files: [f], title: name });
    } catch (e) {
      if (e.name === 'AbortError') return; // người dùng đóng bảng chia sẻ
      if (e.name === 'NotAllowedError') { toast('Tệp đã sẵn sàng — bấm "Chia sẻ qua ứng dụng" lần nữa'); return; }
      if (getShareLink && navigator.share) {
        // loại tệp không gửi trực tiếp được → chia sẻ liên kết tải
        try { await navigator.share({ title: name, text: `${name} (liên kết tải có hạn 7 ngày)`, url: await link() }); return; } catch (e2) { if (e2.name === 'AbortError') return; }
      }
      toast(e.message === 'unsupported' ? 'Thiết bị không hỗ trợ chia sẻ loại tệp này — dùng "Sao chép liên kết" hoặc "Tải về"' : e.message, 'error');
    } finally { setBusy(false); }
  };
  const withLink = (fn) => async () => {
    setBusy(true);
    try { await fn(await link()); } catch (e) { toast(e.message || 'Không tạo được liên kết chia sẻ', 'error'); } finally { setBusy(false); }
  };
  const text = (u) => `${name}\n${u}\n(Liên kết tải tệp, có hạn 7 ngày)`;
  const copy = withLink(async (u) => {
    try { await navigator.clipboard.writeText(u); } catch { window.prompt('Sao chép liên kết chia sẻ (có hạn 7 ngày):', u); return; }
    toast('Đã sao chép liên kết tải tệp (có hạn 7 ngày)');
  });
  const email = withLink((u) => { window.location.href = `mailto:?subject=${encodeURIComponent(`Gửi tệp: ${name}`)}&body=${encodeURIComponent(`Chào bạn,\n\nMình gửi tệp "${name}":\n${u}\n\n(Liên kết tải có hạn 7 ngày.)`)}`; });
  const zalo = withLink(async (u) => {
    // Zalo chưa có trang chia sẻ web công khai → sao chép nội dung rồi mở Zalo để dán gửi
    try { await navigator.clipboard.writeText(text(u)); } catch { /* bỏ qua */ }
    toast('Đã sao chép liên kết — dán vào cuộc trò chuyện Zalo để gửi');
    window.open('https://chat.zalo.me/', '_blank', 'noopener');
  });
  const viber = withLink((u) => { window.location.href = `viber://forward?text=${encodeURIComponent(text(u))}`; });
  const telegram = withLink((u) => { window.open(`https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(name)}`, '_blank', 'noopener'); });

  return (
    <Dropdown align={align} width={250} className={cx('share-file', className)} trigger={(open, toggle) => (
      <button type="button" className={cx(label ? 'btn btn-sm' : 'icon-btn', open && 'active')} title="Chia sẻ tệp qua Zalo, Viber, email…"
        aria-label="Chia sẻ tệp" onClick={() => { if (!open) prepare(); toggle(); }}>
        {busy ? <Loader2 size={size} className="spin" /> : <Share2 size={size} />}{label && ' Chia sẻ'}
      </button>
    )}>
      {(close) => {
        const run = (fn) => () => { close(); fn(); };
        return (
          <>
            {nativeFiles && (
              <button type="button" className="menu-item" onClick={run(shareNative)}>
                <Smartphone size={15} /> <span className="grow">Chia sẻ qua ứng dụng<small className="block muted">Zalo, Viber, Messenger, Mail… (gửi kèm tệp)</small></span>
              </button>
            )}
            {getShareLink && <>
              <button type="button" className="menu-item" onClick={run(zalo)}><span className="share-ic zalo">Z</span> Gửi qua Zalo</button>
              <button type="button" className="menu-item" onClick={run(viber)}><span className="share-ic viber">V</span> Gửi qua Viber</button>
              <button type="button" className="menu-item" onClick={run(telegram)}><Send size={15} /> Gửi qua Telegram</button>
              <button type="button" className="menu-item" onClick={run(email)}><Mail size={15} /> Gửi qua email</button>
              <button type="button" className="menu-item" onClick={run(copy)}><Link2 size={15} /> Sao chép liên kết tải</button>
            </>}
            <a className="menu-item" href={url} download={name} onClick={() => close()}><Download size={15} /> Tải về máy</a>
            {getShareLink && <small className="share-note muted">Liên kết tải có hạn 7 ngày, người nhận không cần tài khoản LDL.</small>}
          </>
        );
      }}
    </Dropdown>
  );
}
