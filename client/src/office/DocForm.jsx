import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { Paperclip, ArrowLeft, Replace, X, Search } from 'lucide-react';
import { api, toFormData } from '../api.js';
import { useApp, useToast } from '../context.jsx';
import { Field, UserPicker, MultiSelect, RichEditor, FileChip, Spinner } from '../components/ui.jsx';
import { DOC_KINDS, fmtDate } from '../utils.js';
import { useDebounced } from '../components/shell.jsx';
import { treeOptions } from './DocList.jsx';

const EMPTY = {
  title: '', code: '', description: '', content: '', kind: 'notice', type_id: '', folder_id: '', category_id: '',
  department_id: '', sender_department_id: '', sender_org: '', issuer_id: null, effective_date: '', expire_date: '',
  need_numbering: false, approvers: [], recipient_users: [], recipient_departments: [], followers: [], replaces_id: null,
};

/** Chọn văn bản / chính sách cũ đã ban hành mà văn bản này thay thế. */
function ReplacePicker({ value, selected, onChange, selfId }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const dq = useDebounced(q, 250);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    api.get('/documents', { box: 'system', q: dq.trim() || undefined, limit: 20 })
      .then((r) => setItems((r.items || []).filter((d) => d.id !== selfId && (!d.superseded_by || d.id === value)))).catch(() => setItems([]));
  }, [dq, open, selfId, value]);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  if (value && selected) {
    return (
      <div className="replace-picked">
        <Replace size={15} className="text-blue" />
        <span className="grow"><b>{selected.code && `[${selected.code}] `}{selected.title}</b>
          <small className="muted block">Ban hành {fmtDate(selected.issued_at) || '—'} · sẽ chuyển sang “Đã bị thay thế” khi văn bản này có hiệu lực</small></span>
        <button type="button" className="icon-btn sm" onClick={() => onChange(null, null)} aria-label="Bỏ chọn"><X size={14} /></button>
      </div>
    );
  }
  return (
    <div className="replace-picker" ref={ref}>
      <div className="input-icon"><Search size={14} className="muted" />
        <input className="input" value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          placeholder="Tìm văn bản / chính sách đang áp dụng theo tên hoặc số hiệu…" /></div>
      {open && (
        <div className="replace-menu">
          {items.map((d) => (
            <button type="button" key={d.id} className="menu-item" onClick={() => { onChange(d.id, d); setOpen(false); setQ(''); }}>
              <span className="grow ellipsis">{d.code && <b>[{d.code}] </b>}{d.title}</span><small className="muted">{fmtDate(d.issued_at)}</small>
            </button>
          ))}
          {!items.length && <div className="empty-small">Không tìm thấy văn bản đang áp dụng</div>}
        </div>
      )}
    </div>
  );
}

export default function DocForm() {
  const { id } = useParams();
  const { meta, reloadMeta } = useOutletContext();
  const { users, user } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState(id ? null : { ...EMPTY, issuer_id: user.id });
  const [existing, setExisting] = useState([]);
  const [removed, setRemoved] = useState([]);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('draft');
  const [replacing, setReplacing] = useState(null);
  const [params] = useSearchParams();

  // "Ban hành bản thay thế" từ trang văn bản cũ: điền sẵn thông tin phân loại & người nhận
  useEffect(() => {
    const rid = params.get('replaces');
    if (id || !rid) return;
    api.get(`/documents/${rid}`).then((d) => {
      setReplacing(d);
      setForm((f) => ({
        ...f, replaces_id: d.id, title: d.title, kind: d.kind, type_id: d.type_id || '', folder_id: d.folder_id || '', category_id: d.category_id || '',
        department_id: d.department_id || '', need_numbering: !!d.need_numbering,
        recipient_users: d.recipients.filter((r) => r.user_id).map((r) => r.user_id),
        recipient_departments: d.recipients.filter((r) => r.department_id).map((r) => r.department_id),
        followers: d.followers.map((x) => x.id),
      }));
    }).catch(() => {});
  }, [id, params]);

  useEffect(() => {
    if (!id) return;
    api.get(`/documents/${id}`).then((d) => {
      setStatus(d.status);
      setExisting(d.attachments);
      setForm({
        title: d.title, code: d.code || '', description: d.description || '', content: d.content || '', kind: d.kind,
        type_id: d.type_id || '', folder_id: d.folder_id || '', category_id: d.category_id || '',
        department_id: d.department_id || '', sender_department_id: d.sender_department_id || '', sender_org: d.sender_org || '',
        issuer_id: d.issuer_id, effective_date: d.effective_date || '', expire_date: d.expire_date || '',
        need_numbering: !!d.need_numbering, approvers: d.approvers.map((a) => a.user_id),
        recipient_users: d.recipients.filter((r) => r.user_id).map((r) => r.user_id),
        recipient_departments: d.recipients.filter((r) => r.department_id).map((r) => r.department_id),
        followers: d.followers.map((f) => f.id), replaces_id: d.replaces_id || null,
      });
      setReplacing(d.replaces || null);
    }).catch((e) => setError(e.message));
  }, [id]);

  if (!form) return <div className="page">{error ? <div className="alert alert-error">{error}</div> : <Spinner />}</div>;
  const set = (k) => (e) => setForm({ ...form, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e });

  const save = async (mode) => {
    setError('');
    if (!form.title.trim()) return setError('Vui lòng nhập tiêu đề văn bản');
    setBusy(true);
    try {
      const body = { ...form, need_numbering: form.need_numbering ? 1 : 0, replaces_id: form.replaces_id || '' };
      let doc;
      if (id) {
        body.remove_attachments = removed;
        if (mode === 'submit') body.submit = 1;
        doc = await api.put(`/documents/${id}`, toFormData(body, files));
      } else {
        if (mode === 'draft') body.draft = 1;
        doc = await api.post('/documents', toFormData(body, files));
      }
      toast(mode === 'draft' ? 'Đã lưu nháp văn bản' : doc.status === 'pending' ? 'Đã gửi văn bản đi duyệt' : doc.status === 'issued' ? 'Văn bản đã được ban hành' : 'Đã lưu văn bản');
      reloadMeta();
      navigate(`/office/doc/${doc.id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const isDraftish = !id || ['draft', 'rejected'].includes(status);
  return (
    <div className="page">
      <div className="page-head">
        <div className="row gap">
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Quay lại"><ArrowLeft size={18} /></button>
          <h1>{id ? 'Chỉnh sửa văn bản' : 'Tạo văn bản'}</h1>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => navigate(-1)}>Hủy</button>
          {isDraftish && <button className="btn" disabled={busy} onClick={() => save('draft')}>Lưu nháp</button>}
          <button className="btn btn-success" disabled={busy} onClick={() => save('submit')}>
            {isDraftish ? (form.approvers.length ? 'Gửi duyệt' : 'Ban hành') : 'Lưu thay đổi'}
          </button>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="form-layout">
        <div className="card">
          <div className="form-grid">
            <Field label="Tiêu đề văn bản" required>
              <input className="input" value={form.title} onChange={set('title')} placeholder="VD: Quyết định ban hành chính sách..." autoFocus />
            </Field>
            <Field label="Số hiệu văn bản" hint="Để trống và bật 'Cần cấp số' nếu muốn văn thư cấp số sau">
              <input className="input" value={form.code} onChange={set('code')} placeholder="VD: 125/QĐ-LDL" />
            </Field>
            <Field label="Trích yếu">
              <input className="input" value={form.description} onChange={set('description')} placeholder="Tóm tắt nội dung văn bản" />
            </Field>
            <Field label="Nhóm văn bản">
              <select className="input" value={form.kind} onChange={set('kind')}>
                {Object.entries(DOC_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <div className="span-2">
              <Field label="Nội dung">
                <RichEditor value={form.content} onChange={set('content')} placeholder="Nhập nội dung văn bản..." />
              </Field>
            </div>
            <div className="span-2">
              <span className="field-label">Tệp đính kèm</span>
              <div className="file-list">
                {existing.filter((a) => !removed.includes(a.id)).map((a) => (
                  <FileChip key={a.id} file={a} onRemove={() => setRemoved([...removed, a.id])} />
                ))}
                {files.map((f, i) => <FileChip key={`n${i}`} file={f} onRemove={() => setFiles(files.filter((_, j) => j !== i))} />)}
                <label className="btn btn-sm">
                  <Paperclip size={14} /> Đính kèm tệp
                  <input type="file" multiple hidden onChange={(e) => { setFiles([...files, ...e.target.files]); e.target.value = ''; }} />
                </label>
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <h3 className="card-title">Thông tin phân loại</h3>
          <div className="form-grid one">
            <Field label="Loại văn bản">
              <select className="input" value={form.type_id} onChange={set('type_id')}>
                <option value="">— Chọn loại —</option>
                {meta?.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Kho lưu trữ">
              <select className="input" value={form.folder_id} onChange={set('folder_id')}>
                <option value="">— Không chọn —</option>
                {treeOptions(meta?.folders).map((o) => <option key={o.value} value={o.value}>{'   '.repeat(o.depth)}{o.label}</option>)}
              </select>
            </Field>
            <Field label="Thư mục">
              <select className="input" value={form.category_id} onChange={set('category_id')}>
                <option value="">— Không chọn —</option>
                {treeOptions(meta?.categories).map((o) => <option key={o.value} value={o.value}>{'   '.repeat(o.depth)}{o.label}</option>)}
              </select>
            </Field>
            <Field label="Phòng ban liên quan">
              <select className="input" value={form.department_id} onChange={set('department_id')}>
                <option value="">— Không chọn —</option>
                {meta?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            {form.kind === 'incoming' ? (
              <Field label="Cơ quan gửi"><input className="input" value={form.sender_org} onChange={set('sender_org')} placeholder="Tên đơn vị gửi văn bản đến" /></Field>
            ) : (
              <Field label="Gửi bởi (phòng ban)">
                <select className="input" value={form.sender_department_id} onChange={set('sender_department_id')}>
                  <option value="">— Không chọn —</option>
                  {meta?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Người ban hành"><UserPicker users={users} value={form.issuer_id} onChange={set('issuer_id')} /></Field>
            <div className="form-grid">
              <Field label="Ngày hiệu lực"><input type="date" className="input" value={form.effective_date} onChange={set('effective_date')} /></Field>
              <Field label="Ngày hết hạn"><input type="date" className="input" value={form.expire_date} onChange={set('expire_date')} /></Field>
            </div>
            <label className="check"><input type="checkbox" checked={form.need_numbering} onChange={set('need_numbering')} /> Cần cấp số văn bản</label>
          </div>
          <h3 className="card-title">Thay thế văn bản / chính sách cũ</h3>
          <div className="field">
            <ReplacePicker value={form.replaces_id} selected={replacing} selfId={id ? Number(id) : null}
              onChange={(rid, d) => { setForm({ ...form, replaces_id: rid }); setReplacing(d); }} />
            <small className="muted">Khi văn bản này được ban hành và đến ngày hiệu lực, văn bản cũ tự chuyển sang “Đã bị thay thế”, hiện biểu ngữ dẫn sang văn bản mới và người liên quan được thông báo.</small>
          </div>
          <h3 className="card-title">Luồng duyệt & phân phối</h3>
          <div className="form-grid one">
            <Field label="Người duyệt (theo thứ tự)" hint="Để trống để ban hành ngay không cần duyệt">
              <UserPicker users={users} multiple value={form.approvers} onChange={set('approvers')} placeholder="Chọn người duyệt" />
            </Field>
            <Field label="Người nhận" hint="Để trống người nhận và phòng ban nhận = gửi toàn công ty">
              <UserPicker users={users} multiple value={form.recipient_users} onChange={set('recipient_users')} placeholder="Toàn công ty" />
            </Field>
            <Field label="Phòng ban nhận">
              <MultiSelect options={(meta?.departments || []).map((d) => ({ value: d.id, label: d.name }))}
                value={form.recipient_departments} onChange={set('recipient_departments')} placeholder="Chọn phòng ban" />
            </Field>
            <Field label="Người theo dõi"><UserPicker users={users} multiple value={form.followers} onChange={set('followers')} placeholder="Chọn người theo dõi" /></Field>
          </div>
        </div>
      </div>
    </div>
  );
}
