/**
 * Bình luận có đính kèm ảnh / tệp — dùng chung cho Wework, Request, Office.
 *  - CommentBox: ô nhập (@nhắc tên) + nút đính kèm tệp / ảnh, dán ảnh (Ctrl+V) hoặc kéo thả tệp vào ô; xem trước trước khi gửi
 *  - CommentFiles: ảnh / video hiện dạng hình thu nhỏ, tệp khác dạng thẻ; bấm để xem ngay (FileViewer)
 *  - CommentItem: một bình luận (tên, thời gian, nhãn "đã sửa", nội dung, tệp) kèm menu Sửa (người viết) / Xoá (người viết, quản trị viên)
 * base: đường dẫn API của bản ghi, ví dụ `/tasks/12` → gửi POST `${base}/comments`, sửa PUT / xoá DELETE `${base}/comments/:cid`,
 * tệp ở `${base}/comment-files/:fid`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Paperclip, ImagePlus, Play, X, Send, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { api, toFormData } from '../api.js';
import { useApp, useToast } from '../context.jsx';
import { Avatar, Dropdown, FileChip } from './ui.jsx';
import { MentionTextarea } from './Mention.jsx';
import FileViewer, { fileKind } from './FileViewer.jsx';
import { cx, timeAgo, fmtDateTime } from '../utils.js';
import { MentionText } from './Mention.jsx';

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

/** Ô bình luận; khi truyền `editing` (bình luận đang sửa) → sửa nội dung, bỏ tệp cũ, thêm tệp mới (PUT). */
export default function CommentBox({ base, onSent, placeholder = 'Viết bình luận… gõ @ để nhắc tên đồng nghiệp', editing = null, onCancel }) {
  const toast = useToast();
  const [text, setText] = useState(editing?.content || '');
  const [files, setFiles] = useState([]);
  const [removed, setRemoved] = useState([]); // id tệp cũ bị bỏ khi sửa
  const kept = (editing?.files || []).filter((f) => !removed.includes(f.id));
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
      const room = MAX_FILES - kept.length;
      const next = [...cur, ...incoming.filter((f) => f.size <= MAX_SIZE)];
      if (next.length > room) toast(`Tối đa ${MAX_FILES} tệp mỗi bình luận`, 'error');
      return next.slice(0, Math.max(room, 0));
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
    if ((!text.trim() && !files.length && !kept.length) || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      let c;
      if (editing) {
        c = await api.put(`${base}/comments/${editing.id}`, toFormData({ content: text, remove_files: removed.length ? removed : undefined }, files));
      } else {
        c = await api.post(`${base}/comments`, files.length ? toFormData({ content: text }, files) : { content: text });
        setText(''); setFiles([]);
      }
      onSent?.(c);
    } catch (err) { toast(err.message, 'error'); } finally { busyRef.current = false; setBusy(false); }
  };
  const images = files.filter((f) => /^image\//.test(f.type));
  const others = files.filter((f) => !images.includes(f));

  return (
    <form className={cx('comment-form cmt-box', editing && 'editing', drag && 'dragging')} onSubmit={send}
      onKeyDown={(e) => { if (editing && e.key === 'Escape') { e.stopPropagation(); onCancel?.(); } }}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); }}
      onDrop={(e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); } }}>
      <div className="cmt-input">
        <MentionTextarea className="input" rows={2} value={text} onChange={setText} onSubmit={() => send()} onPaste={onPaste} autoFocus={!!editing}
          placeholder={placeholder} title="Có thể dán (Ctrl+V) hoặc kéo thả ảnh, tệp vào đây" />
        {(files.length > 0 || kept.length > 0) && (
          <div className="cmt-pending">
            {kept.map((f) => (fileKind(f) === 'image'
              ? <span key={`k${f.id}`} className="cmt-pending-thumb" title={f.original_name}>
                <img src={`${api.url(`${base}/comment-files/${f.id}`)}?inline=1`} alt={f.original_name} />
                <button type="button" className="res-thumb-x" onClick={() => setRemoved((r) => [...r, f.id])} aria-label="Bỏ ảnh"><X size={12} /></button>
              </span>
              : <FileChip key={`k${f.id}`} file={f} onRemove={() => setRemoved((r) => [...r, f.id])} />))}
            {images.map((f) => <PendingThumb key={`${f.name}-${f.size}-${f.lastModified}`} file={f} onRemove={() => setFiles((c) => c.filter((x) => x !== f))} />)}
            {others.map((f) => <FileChip key={`${f.name}-${f.size}-${f.lastModified}`} file={f} onRemove={() => setFiles((c) => c.filter((x) => x !== f))} />)}
          </div>
        )}
        <div className="cmt-tools">
          <button type="button" className="icon-btn sm" onClick={() => imgRef.current?.click()} title="Đính kèm ảnh / video (hoặc dán, kéo thả vào ô)" aria-label="Đính kèm ảnh"><ImagePlus size={16} /></button>
          <button type="button" className="icon-btn sm" onClick={() => fileRef.current?.click()} title="Đính kèm tệp: Word, Excel, PDF… (hoặc kéo thả vào ô)" aria-label="Đính kèm tệp"><Paperclip size={16} /></button>
          {files.length + kept.length > 0 && <small className="muted">{files.length + kept.length} tệp đính kèm</small>}
          <input ref={imgRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        </div>
      </div>
      {editing ? (
        <div className="cmt-edit-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Huỷ</button>
          <button className="btn btn-primary" disabled={(!text.trim() && !files.length && !kept.length) || busy}>Lưu</button>
        </div>
      ) : <button className="btn btn-primary" disabled={(!text.trim() && !files.length) || busy}><Send size={14} /> Gửi</button>}
      {drag && <div className="cmt-drop">Thả tệp để đính kèm vào bình luận</div>}
    </form>
  );
}

/** Một bình luận: người viết được sửa; người viết hoặc quản trị viên (Quản trị cấp cao / Chủ doanh nghiệp) được xoá. */
export function CommentItem({ base, c, onChanged, size = 30 }) {
  const { user } = useApp();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const mine = c.user_id === user.id;
  const canDelete = mine || user.role === 'admin';
  const remove = async () => {
    if (!window.confirm(mine ? 'Xoá bình luận này? Ảnh, tệp đính kèm cũng bị xoá.' : `Xoá bình luận của ${c.user_name}? Ảnh, tệp đính kèm cũng bị xoá.`)) return;
    try { await api.del(`${base}/comments/${c.id}`); toast('Đã xoá bình luận'); onChanged?.(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className={cx('comment', editing && 'is-editing')}>
      <Avatar name={c.user_name} color={c.user_color} uid={c.user_id} size={size} />
      <div className="grow">
        <div className="cmt-head">
          <b>{c.user_name}</b> <small className="muted" title={fmtDateTime(c.created_at)}>{timeAgo(c.created_at)}</small>
          {c.updated_at && <small className="muted cmt-edited" title={`Sửa lúc ${fmtDateTime(c.updated_at)}`}>· đã sửa</small>}
          {!editing && (mine || canDelete) && (
            <Dropdown align="right" className="cmt-more" width={180} trigger={(open, toggle) => (
              <button type="button" className={cx('icon-btn sm', open && 'active')} onClick={toggle} aria-label="Tuỳ chọn bình luận" title="Sửa / xoá"><MoreHorizontal size={15} /></button>
            )}>
              {(close) => (
                <>
                  {mine && <button type="button" className="menu-item" onClick={() => { close(); setEditing(true); }}><Pencil size={14} /> Sửa bình luận</button>}
                  {canDelete && <button type="button" className="menu-item danger" onClick={() => { close(); remove(); }}><Trash2 size={14} /> Xoá bình luận</button>}
                </>
              )}
            </Dropdown>
          )}
        </div>
        {editing ? (
          <CommentBox base={base} editing={c} placeholder="Sửa bình luận… gõ @ để nhắc tên"
            onCancel={() => setEditing(false)} onSent={() => { setEditing(false); toast('Đã lưu bình luận'); onChanged?.(); }} />
        ) : (
          <>
            {c.content && <div className="pre comment-text"><MentionText text={c.content} /></div>}
            <CommentFiles base={base} files={c.files} />
          </>
        )}
      </div>
    </div>
  );
}
