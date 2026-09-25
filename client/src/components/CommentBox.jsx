/**
 * Bình luận có đính kèm ảnh / tệp — dùng chung cho Wework, Request, Office.
 *  - CommentBox: ô nhập (@nhắc tên) + nút đính kèm tệp / ảnh, dán ảnh (Ctrl+V) hoặc kéo thả tệp vào ô; xem trước trước khi gửi
 *  - CommentFiles: ảnh / video hiện dạng hình thu nhỏ, tệp khác dạng thẻ; bấm để xem ngay (FileViewer)
 * base: đường dẫn API của bản ghi, ví dụ `/tasks/12` → gửi POST `${base}/comments`, tệp ở `${base}/comment-files/:fid`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Paperclip, ImagePlus, Play, X, Send } from 'lucide-react';
import { api, toFormData } from '../api.js';
import { useToast } from '../context.jsx';
import { FileChip } from './ui.jsx';
import { MentionTextarea } from './Mention.jsx';
import FileViewer, { fileKind } from './FileViewer.jsx';
import { cx } from '../utils.js';

const MAX_FILES = 10;
const MAX_SIZE = 50 * 1024 * 1024;

export function CommentFiles({ base, files }) {
  const [open, setOpen] = useState(null);
  if (!files?.length) return null;
  const url = (f) => api.url(`${base}/comment-files/${f.id}`);
  const media = files.filter((f) => ['image', 'video'].includes(fileKind(f)));
  const others = files.filter((f) => !media.includes(f));
  const order = [...media, ...others];
  return (
    <div className="cmt-files">
      {media.length > 0 && (
        <div className="cmt-thumbs">
          {media.map((f) => (
            <button key={f.id} type="button" className="res-thumb" onClick={() => setOpen(order.indexOf(f))} title={f.original_name}>
              {fileKind(f) === 'image' ? <img src={`${url(f)}?inline=1`} alt={f.original_name} loading="lazy" />
                : <><video src={`${url(f)}?inline=1#t=0.5`} preload="metadata" muted /><span className="res-play"><Play size={16} fill="currentColor" /></span></>}
            </button>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="attach-list">
          {others.map((f) => <FileChip key={f.id} file={f} onOpen={() => setOpen(order.indexOf(f))} />)}
        </div>
      )}
      {open != null && (
        <FileViewer files={order} index={open} urlOf={url} onClose={() => setOpen(null)}
          publicUrlOf={async (f) => (await api.post(`${base}/comment-files/${f.id}/link`)).url} />
      )}
    </div>
  );
}

/** Ảnh chờ gửi: hiện hình thu nhỏ bằng object URL (thu hồi khi bỏ). */
function PendingThumb({ file, onRemove }) {
  const src = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(src), [src]);
  return (
    <span className="cmt-pending-thumb" title={file.name}>
      <img src={src} alt={file.name} />
      <button type="button" className="res-thumb-x" onClick={onRemove} aria-label="Bỏ ảnh"><X size={12} /></button>
    </span>
  );
}

export default function CommentBox({ base, onSent, placeholder = 'Viết bình luận… gõ @ để nhắc tên đồng nghiệp' }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  const imgRef = useRef(null);
  const busyRef = useRef(false);

  const add = (list) => {
    const incoming = [...list].filter((f) => f && f.size > 0);
    const big = incoming.find((f) => f.size > MAX_SIZE);
    if (big) toast(`"${big.name}" quá lớn (tối đa 50MB)`, 'error');
    setFiles((cur) => {
      const next = [...cur, ...incoming.filter((f) => f.size <= MAX_SIZE)];
      if (next.length > MAX_FILES) toast(`Tối đa ${MAX_FILES} tệp mỗi bình luận`, 'error');
      return next.slice(0, MAX_FILES);
    });
  };
  const onPaste = (e) => {
    const pasted = [...(e.clipboardData?.files || [])];
    if (!pasted.length) return;
    e.preventDefault();
    // ảnh chụp màn hình dán vào thường tên "image.png" → đặt tên theo thời gian cho dễ phân biệt
    add(pasted.map((f, i) => (f.name && f.name !== 'image.png' ? f
      : new File([f], `anh-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}${i ? `-${i}` : ''}.png`, { type: f.type || 'image/png' }))));
  };
  const send = async (e) => {
    e?.preventDefault?.();
    if ((!text.trim() && !files.length) || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const body = files.length ? toFormData({ content: text }, files) : { content: text };
      const c = await api.post(`${base}/comments`, body);
      setText(''); setFiles([]);
      onSent?.(c);
    } catch (err) { toast(err.message, 'error'); } finally { busyRef.current = false; setBusy(false); }
  };
  const images = files.filter((f) => /^image\//.test(f.type));
  const others = files.filter((f) => !images.includes(f));

  return (
    <form className={cx('comment-form cmt-box', drag && 'dragging')} onSubmit={send}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); }}
      onDrop={(e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); } }}>
      <div className="cmt-input">
        <MentionTextarea className="input" rows={2} value={text} onChange={setText} onSubmit={() => send()} onPaste={onPaste}
          placeholder={placeholder} title="Có thể dán (Ctrl+V) hoặc kéo thả ảnh, tệp vào đây" />
        {files.length > 0 && (
          <div className="cmt-pending">
            {images.map((f) => <PendingThumb key={`${f.name}-${f.size}-${f.lastModified}`} file={f} onRemove={() => setFiles((c) => c.filter((x) => x !== f))} />)}
            {others.map((f) => <FileChip key={`${f.name}-${f.size}-${f.lastModified}`} file={f} onRemove={() => setFiles((c) => c.filter((x) => x !== f))} />)}
          </div>
        )}
        <div className="cmt-tools">
          <button type="button" className="icon-btn sm" onClick={() => imgRef.current?.click()} title="Đính kèm ảnh / video (hoặc dán, kéo thả vào ô)" aria-label="Đính kèm ảnh"><ImagePlus size={16} /></button>
          <button type="button" className="icon-btn sm" onClick={() => fileRef.current?.click()} title="Đính kèm tệp: Word, Excel, PDF… (hoặc kéo thả vào ô)" aria-label="Đính kèm tệp"><Paperclip size={16} /></button>
          {files.length > 0 && <small className="muted">{files.length} tệp đính kèm</small>}
          <input ref={imgRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        </div>
      </div>
      <button className="btn btn-primary" disabled={(!text.trim() && !files.length) || busy}><Send size={14} /> Gửi</button>
      {drag && <div className="cmt-drop">Thả tệp để đính kèm vào bình luận</div>}
    </form>
  );
}
