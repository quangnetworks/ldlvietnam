import { useState } from 'react';
import { Award, Link2, Paperclip, Plus, X, Pencil, Trash2, ExternalLink, Play, Upload } from 'lucide-react';
import { api, toFormData } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Avatar, SafeHtml, RichEditor, FileChip, Empty } from '../components/ui.jsx';
import FileViewer, { fileKind } from '../components/FileViewer.jsx';
import { fmtDateTime, timeAgo, fileSize, cx } from '../utils.js';

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/** Ô chọn tệp: bấm hoặc kéo thả nhiều tệp. */
function DropFiles({ files, onChange }) {
  const [over, setOver] = useState(false);
  const add = (list) => onChange([...files, ...list].slice(0, 20));
  return (
    <div className={cx('res-drop', over && 'over')} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); add([...e.dataTransfer.files]); }}>
      <label className="link-btn"><Upload size={14} /> Chọn tệp hoặc kéo thả vào đây
        <input type="file" multiple hidden onChange={(e) => { add([...e.target.files]); e.target.value = ''; }} />
      </label>
      <small className="muted">Văn bản, Word, Excel, PowerPoint, PDF, ảnh, video, âm thanh... tối đa 50MB mỗi tệp</small>
      {files.length > 0 && (
        <div className="attach-list">
          {files.map((f, i) => <FileChip key={`${f.name}${i}`} file={f} onRemove={() => onChange(files.filter((_, j) => j !== i))} />)}
        </div>
      )}
    </div>
  );
}

function LinkInputs({ links, onChange }) {
  const set = (i, v) => onChange(links.map((l, j) => (j === i ? v : l)));
  return (
    <div className="res-links-edit">
      {links.map((l, i) => (
        <div key={i} className="row gap-sm">
          <Link2 size={15} className="muted" />
          <input className="input" type="url" value={l} placeholder="https://… (Google Drive, OneDrive, YouTube, website…)" onChange={(e) => set(i, e.target.value)} />
          <button type="button" className="icon-btn sm" onClick={() => onChange(links.filter((_, j) => j !== i))} aria-label="Bỏ liên kết"><X size={14} /></button>
        </div>
      ))}
      <button type="button" className="link-btn" onClick={() => onChange([...links, ''])}><Plus size={14} /> Thêm liên kết</button>
    </div>
  );
}

/** Biểu mẫu cập nhật / chỉnh sửa kết quả. */
function ResultForm({ taskId, initial, onDone, onCancel }) {
  const toast = useToast();
  const [content, setContent] = useState(initial?.content || '');
  const [links, setLinks] = useState(initial?.links?.map((l) => l.url) || []);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = toFormData({ content, links: JSON.stringify(links.map((l) => l.trim()).filter(Boolean)) }, files);
      const res = initial ? await api.put(`/tasks/${taskId}/results/${initial.id}`, body) : await api.post(`/tasks/${taskId}/results`, body);
      toast(initial ? 'Đã lưu kết quả' : 'Đã cập nhật kết quả công việc');
      setContent(''); setLinks([]); setFiles([]);
      onDone(res);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="res-form" onSubmit={submit}>
      <RichEditor value={content} onChange={setContent} minHeight={90} placeholder="Mô tả kết quả đạt được, số liệu, nội dung bàn giao…" />
      <LinkInputs links={links} onChange={setLinks} />
      <DropFiles files={files} onChange={setFiles} />
      <div className="row gap">
        <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Đang lưu…' : initial ? 'Lưu thay đổi' : 'Cập nhật kết quả'}</button>
        {onCancel && <button type="button" className="btn btn-sm" onClick={onCancel}>Hủy</button>}
      </div>
    </form>
  );
}

/** Lưới tệp của một kết quả: ảnh / video có hình thu nhỏ, các tệp khác dạng thẻ; bấm để xem ngay. */
function ResultFiles({ taskId, files, canEdit, onRemoved }) {
  const [open, setOpen] = useState(null);
  const url = (f) => api.url(`/tasks/${taskId}/attachments/${f.id}`);
  const media = files.filter((f) => ['image', 'video'].includes(fileKind(f)));
  const others = files.filter((f) => !media.includes(f));
  const order = [...media, ...others];
  const remove = async (f) => {
    if (!window.confirm(`Xoá tệp "${f.original_name}"?`)) return;
    await api.del(`/tasks/${taskId}/attachments/${f.id}`);
    onRemoved();
  };
  return (
    <>
      {media.length > 0 && (
        <div className="res-thumbs">
          {media.map((f) => (
            <button key={f.id} type="button" className="res-thumb" onClick={() => setOpen(order.indexOf(f))} title={f.original_name}>
              {fileKind(f) === 'image' ? <img src={`${url(f)}?inline=1`} alt={f.original_name} loading="lazy" />
                : <><video src={`${url(f)}?inline=1#t=0.5`} preload="metadata" muted /><span className="res-play"><Play size={18} fill="currentColor" /></span></>}
              {canEdit && <span className="res-thumb-x" role="button" tabIndex={0} aria-label="Xoá tệp" onClick={(e) => { e.stopPropagation(); remove(f); }}><X size={12} /></span>}
            </button>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="attach-list">
          {others.map((f) => <FileChip key={f.id} file={f} onOpen={() => setOpen(order.indexOf(f))} onRemove={canEdit ? () => remove(f) : undefined} />)}
        </div>
      )}
      {open != null && (
        <FileViewer files={order} index={open} urlOf={url} onClose={() => setOpen(null)}
          publicUrlOf={async (f) => (await api.post(`/tasks/${taskId}/attachments/${f.id}/link`)).url} />
      )}
    </>
  );
}

export default function TaskResults({ task, onChanged }) {
  const { user } = useApp();
  const [results, reload] = useFetch(() => api.get(`/tasks/${task.id}/results`), [task.id]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const changed = () => { reload(); onChanged?.(); };
  const del = async (r) => {
    if (!window.confirm('Xoá kết quả này cùng các tệp đính kèm?')) return;
    await api.del(`/tasks/${task.id}/results/${r.id}`);
    changed();
  };
  const list = results || [];
  return (
    <section className="td-section res">
      <div className="td-section-head"><b><Award size={15} className="text-blue" /> Kết quả công việc ({list.length})</b>
        {task.can_edit && !adding && <button className="link-btn" onClick={() => setAdding(true)}><Plus size={14} /> Cập nhật kết quả</button>}
      </div>
      {adding && <ResultForm taskId={task.id} onDone={() => { setAdding(false); changed(); }} onCancel={() => setAdding(false)} />}
      {results && !list.length && !adding && (
        <Empty icon={Award} title="Chưa có kết quả">
          {task.can_edit ? 'Cập nhật kết quả cụ thể: nội dung, liên kết, tệp văn bản, hình ảnh, video…' : 'Người thực hiện chưa cập nhật kết quả.'}
        </Empty>
      )}
      <div className="res-list">
        {list.map((r) => {
          const mine = r.user_id === user.id || user.role === 'admin';
          if (editing === r.id) {
            return <ResultForm key={r.id} taskId={task.id} initial={r} onDone={() => { setEditing(null); changed(); }} onCancel={() => setEditing(null)} />;
          }
          return (
            <article key={r.id} className="res-item">
              <header className="row gap-sm">
                <Avatar name={r.user_name} color={r.user_color} uid={r.user_id} size={28} />
                <div className="grow"><b>{r.user_name}</b> <small className="muted" title={fmtDateTime(r.created_at)}>đã cập nhật kết quả · {timeAgo(r.created_at)}
                  {r.updated_at && r.updated_at !== r.created_at && ' · đã sửa'}</small></div>
                {mine && <button className="icon-btn sm" title="Chỉnh sửa" onClick={() => setEditing(r.id)}><Pencil size={14} /></button>}
                {mine && <button className="icon-btn sm" title="Xoá" onClick={() => del(r)}><Trash2 size={14} /></button>}
              </header>
              {r.content && <SafeHtml html={r.content} className="res-content" />}
              {r.links.length > 0 && (
                <div className="res-links">
                  {r.links.map((l) => (
                    <a key={l.url} href={l.url} target="_blank" rel="noreferrer noopener" className="res-link" title={l.url}>
                      <ExternalLink size={14} /><span className="ellipsis">{l.title || l.url}</span><small className="muted">{hostOf(l.url)}</small>
                    </a>
                  ))}
                </div>
              )}
              {r.files.length > 0 && (
                <>
                  <small className="muted"><Paperclip size={12} /> {r.files.length} tệp · {fileSize(r.files.reduce((s, f) => s + (f.size || 0), 0))}</small>
                  <ResultFiles taskId={task.id} files={r.files} canEdit={mine} onRemoved={changed} />
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
