/**
 * Trình xem tệp dùng chung: ảnh, video, âm thanh, PDF, văn bản / mã nguồn, CSV, Word (.docx), Excel (.xlsx)
 * được hiển thị ngay trong trình duyệt; mọi định dạng Office (doc, docx, xls, xlsx, ppt, pptx) và nhiều định dạng khác
 * còn xem được qua Microsoft Office Online / Google Docs Viewer bằng liên kết tạm có chữ ký (15 phút).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, ChevronLeft, ChevronRight, ExternalLink, Loader2 } from 'lucide-react';
import { fileIcon, fileSize, cx } from '../utils.js';

const EXT = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'],
  video: ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv', '3gp'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus', 'weba'],
  pdf: ['pdf'],
  csv: ['csv', 'tsv'],
  text: ['txt', 'md', 'log', 'json', 'xml', 'yml', 'yaml', 'ini', 'conf', 'sql', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'htm', 'py',
    'java', 'c', 'cpp', 'h', 'cs', 'php', 'rb', 'go', 'sh', 'bat', 'vtt', 'srt'],
  docx: ['docx', 'docm', 'dotx'],
  xlsx: ['xlsx', 'xlsm', 'xltx'],
  // chỉ xem được qua dịch vụ trực tuyến
  office: ['doc', 'xls', 'ppt', 'pptx', 'pps', 'ppsx', 'pptm', 'odt', 'ods', 'odp', 'rtf'],
};
const OFFICE_ONLINE = ['doc', 'docx', 'docm', 'dotx', 'xls', 'xlsx', 'xlsm', 'xltx', 'ppt', 'pptx', 'pps', 'ppsx', 'pptm', 'odt', 'ods', 'odp'];
const GOOGLE_VIEWER = [...OFFICE_ONLINE, 'rtf', 'pdf', 'txt', 'csv', 'tiff', 'tif', 'psd', 'ai', 'eps', 'ps', 'ttf', 'xps', 'pages', 'dxf', 'svg'];

export const fileExt = (name = '') => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

export function fileKind(file) {
  const ext = fileExt(file.original_name || file.name);
  for (const [k, list] of Object.entries(EXT)) if (list.includes(ext)) return k;
  const m = file.mime || '';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('text/')) return 'text';
  return GOOGLE_VIEWER.includes(ext) ? 'office' : 'other';
}

/** Máy chủ nội bộ (localhost / IP LAN) thì dịch vụ xem trực tuyến bên ngoài không tải được tệp. */
const isPrivateHost = () => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(window.location.hostname);

async function fetchBlob(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Không tải được tệp (lỗi ${res.status})`);
  return res.blob();
}

function parseCsv(text, sep) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
      if (rows.length >= 2000) break;
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function Grid({ rows }) {
  if (!rows.length) return <p className="muted center">Trang tính trống</p>;
  const cols = Math.max(...rows.map((r) => r.length));
  const colName = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
  const show = (v) => (v instanceof Date ? v.toLocaleDateString('vi-VN') : v == null ? '' : String(v));
  return (
    <div className="fv-grid">
      <table>
        <thead><tr><th />{Array.from({ length: cols }, (_, i) => <th key={i}>{colName(i)}</th>)}</tr></thead>
        <tbody>{rows.slice(0, 2000).map((r, i) => (
          <tr key={i}><th>{i + 1}</th>{Array.from({ length: cols }, (_, j) => <td key={j}>{show(r[j])}</td>)}</tr>
        ))}</tbody>
      </table>
      {rows.length > 2000 && <p className="muted small center">Chỉ hiển thị 2.000 dòng đầu — tải về để xem đầy đủ.</p>}
    </div>
  );
}

function Loading() {
  return <div className="fv-center muted"><Loader2 size={28} className="spin" /> Đang mở tệp…</div>;
}

function Fallback({ file, url, children }) {
  const ic = fileIcon(file.original_name);
  return (
    <div className="fv-center">
      <span className="fv-bigicon" style={{ background: ic.color }}>{ic.label}</span>
      <b>{file.original_name}</b>
      <p className="muted">{children || 'Định dạng này chưa xem trước được trong trình duyệt.'}</p>
      <a className="btn btn-primary" href={url}><Download size={15} /> Tải về</a>
    </div>
  );
}

/** Nội dung Word / Excel / CSV / văn bản được dựng ngay trên trình duyệt. */
function LocalRender({ file, kind, url }) {
  const box = useRef(null);
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    (async () => {
      try {
        const blob = await fetchBlob(url);
        if (kind === 'docx') {
          const { renderAsync } = await import('docx-preview');
          if (!alive) return;
          box.current.innerHTML = '';
          await renderAsync(blob, box.current, undefined, { inWrapper: true, ignoreLastRenderedPageBreak: true, breakPages: true });
          if (alive) setState({ loading: false });
        } else if (kind === 'xlsx') {
          const { default: readXlsx } = await import('read-excel-file/browser');
          const sheets = await readXlsx(blob);
          if (alive) setState({ loading: false, sheets, sheet: 0 });
        } else {
          if (blob.size > 5 * 1024 * 1024) throw new Error('Tệp văn bản quá lớn để xem trực tiếp (trên 5MB)');
          const text = await blob.text();
          const ext = fileExt(file.original_name);
          if (alive) setState({ loading: false, text, rows: kind === 'csv' ? parseCsv(text, ext === 'tsv' ? '\t' : text.split('\n')[0].split(';').length > text.split('\n')[0].split(',').length ? ';' : ',') : null });
        }
      } catch (e) {
        if (alive) setState({ loading: false, error: e.message || 'Không đọc được tệp' });
      }
    })();
    return () => { alive = false; };
  }, [url, kind, file.original_name]);

  return (
    <>
      {state.loading && <Loading />}
      {state.error && <Fallback file={file} url={url}>{state.error}</Fallback>}
      {kind === 'docx' && <div ref={box} className={cx('fv-docx', (state.loading || state.error) && 'hidden')} />}
      {state.sheets && (
        <div className="fv-sheets">
          {state.sheets.length > 1 && (
            <div className="segmented sm fv-sheet-tabs">
              {state.sheets.map((s, i) => <button key={s.sheet} className={cx(i === state.sheet && 'active')} onClick={() => setState({ ...state, sheet: i })}>{s.sheet}</button>)}
            </div>
          )}
          <Grid rows={state.sheets[state.sheet].data} />
        </div>
      )}
      {state.rows && <Grid rows={state.rows} />}
      {state.text != null && !state.rows && <pre className="fv-text">{state.text}</pre>}
    </>
  );
}

/** Microsoft Office Online / Google Docs Viewer qua liên kết tạm có chữ ký. */
function OnlineRender({ file, url, getPublicUrl, service }) {
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(null);
  const getter = useRef(getPublicUrl);
  getter.current = getPublicUrl;
  useEffect(() => {
    let alive = true;
    setSrc(null); setError(null);
    getter.current().then((pub) => {
      if (!alive) return;
      const enc = encodeURIComponent(pub);
      setSrc(service === 'google' ? `https://docs.google.com/gview?embedded=true&url=${enc}` : `https://view.officeapps.live.com/op/embed.aspx?src=${enc}`);
    }).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [url, service]);
  if (error) return <Fallback file={file} url={url}>{error}</Fallback>;
  if (!src) return <Loading />;
  return (
    <div className="fv-online">
      {isPrivateHost() && <p className="fv-warn">Máy chủ đang chạy nội bộ ({window.location.hostname}) nên dịch vụ xem trực tuyến có thể không tải được tệp. Hãy dùng “Xem nhanh” hoặc tải về.</p>}
      <iframe title={file.original_name} src={src} className="fv-frame" referrerPolicy="no-referrer" />
    </div>
  );
}

function Viewer({ file, url, getPublicUrl }) {
  const kind = fileKind(file);
  const ext = fileExt(file.original_name);
  const inline = `${url}${url.includes('?') ? '&' : '?'}inline=1`;
  const canOnline = !!getPublicUrl && (OFFICE_ONLINE.includes(ext) || GOOGLE_VIEWER.includes(ext));
  const local = ['docx', 'xlsx', 'csv', 'text'].includes(kind);
  const modes = [
    local && { key: 'local', label: 'Xem nhanh' },
    canOnline && OFFICE_ONLINE.includes(ext) && { key: 'office', label: 'Microsoft Office' },
    canOnline && (kind === 'office' || kind === 'other' || local) && GOOGLE_VIEWER.includes(ext) && { key: 'google', label: 'Google Viewer' },
  ].filter(Boolean);
  const [mode, setMode] = useState(modes[0]?.key || null);
  useEffect(() => setMode(modes[0]?.key || null), [url]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mediaError, setMediaError] = useState(false);
  useEffect(() => setMediaError(false), [url]);

  if (kind === 'image') return <div className="fv-media"><img src={inline} alt={file.original_name} /></div>;
  if (kind === 'video') {
    return mediaError ? <Fallback file={file} url={url}>Trình duyệt không phát được định dạng video này. Tải về để xem bằng ứng dụng khác.</Fallback>
      : <div className="fv-media"><video src={inline} controls autoPlay playsInline onError={() => setMediaError(true)} /></div>;
  }
  if (kind === 'audio') {
    return mediaError ? <Fallback file={file} url={url}>Trình duyệt không phát được định dạng âm thanh này.</Fallback>
      : <div className="fv-center"><span className="fv-bigicon" style={{ background: '#0c8599' }}>AUD</span><b>{file.original_name}</b><audio src={inline} controls autoPlay onError={() => setMediaError(true)} /></div>;
  }
  if (kind === 'pdf') return <iframe title={file.original_name} src={inline} className="fv-frame" />;
  if (!modes.length) return <Fallback file={file} url={url} />;
  return (
    <div className="fv-modes">
      {modes.length > 1 && (
        <div className="segmented sm fv-mode-tabs" role="tablist">
          {modes.map((m) => <button key={m.key} role="tab" aria-selected={mode === m.key} className={cx(mode === m.key && 'active')} onClick={() => setMode(m.key)}>{m.label}</button>)}
        </div>
      )}
      {mode === 'local' && <LocalRender key={url} file={file} kind={kind} url={url} />}
      {(mode === 'office' || mode === 'google') && <OnlineRender key={url + mode} file={file} url={url} getPublicUrl={getPublicUrl} service={mode} />}
    </div>
  );
}

/**
 * files: [{ id, original_name, mime, size }], index: tệp đang mở.
 * urlOf(file) → đường dẫn tải (có kiểm tra đăng nhập); publicUrlOf(file) → Promise<liên kết tạm> cho trình xem trực tuyến (tuỳ chọn).
 */
export default function FileViewer({ files, index = 0, urlOf, publicUrlOf, onClose }) {
  const [i, setI] = useState(index);
  const file = files[i];
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
      if (e.key === 'ArrowRight') setI((x) => Math.min(files.length - 1, x + 1));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [files.length, onClose]);
  if (!file) return null;
  const url = urlOf(file);
  const ic = fileIcon(file.original_name);
  return createPortal(
    <div className="fv-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={file.original_name}>
      <div className="fv">
        <header className="fv-head">
          <span className="file-ic" style={{ background: ic.color }}>{ic.label}</span>
          <div className="grow fv-title"><b className="ellipsis block">{file.original_name}</b>
            <small className="muted">{fileSize(file.size)}{files.length > 1 && ` · ${i + 1}/${files.length}`}</small></div>
          <a className="icon-btn" href={`${url}${url.includes('?') ? '&' : '?'}inline=1`} target="_blank" rel="noreferrer" title="Mở trong tab mới"><ExternalLink size={18} /></a>
          <a className="icon-btn" href={url} title="Tải về"><Download size={18} /></a>
          <button className="icon-btn" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
        </header>
        <div className="fv-body">
          {files.length > 1 && i > 0 && <button className="fv-nav prev" onClick={() => setI(i - 1)} aria-label="Tệp trước"><ChevronLeft size={22} /></button>}
          <Viewer key={file.id ?? i} file={file} url={url} getPublicUrl={publicUrlOf ? () => publicUrlOf(file) : null} />
          {files.length > 1 && i < files.length - 1 && <button className="fv-nav next" onClick={() => setI(i + 1)} aria-label="Tệp sau"><ChevronRight size={22} /></button>}
        </div>
      </div>
    </div>,
    document.body
  );
}

