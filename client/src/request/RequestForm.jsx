import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Paperclip, Search, Star } from 'lucide-react';
import { api, toFormData } from '../api.js';
import { useApp, useToast } from '../context.jsx';
import { Field, UserPicker, FileChip, Spinner, Avatar } from '../components/ui.jsx';
import { useRequestApp, groupByCategory } from './RequestLayout.jsx';
import GroupGuide from './GroupGuide.jsx';
import { FieldInput } from './fields.jsx';
import { cx } from '../utils.js';

function GroupChooser({ onPick }) {
  const { groups } = useRequestApp();
  const [q, setQ] = useState('');
  const list = groups.filter((g) => !q || `${g.name} ${g.category}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="rq-page">
      <div className="rq-head"><div className="grow"><h1>Tạo đề xuất</h1><p className="muted">Chọn loại đề xuất bạn muốn gửi</p></div>
        <div className="rq-searchbox"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm nhóm đề xuất" /><Search size={15} /></div>
      </div>
      {groupByCategory(list).map(({ category, items }) => (
        <div key={category} className="rq-choose-cat">
          <h4>{category.toUpperCase()}</h4>
          <div className="rq-choose-grid">
            {items.map((g) => (
              <button key={g.id} className="rq-choose" onClick={() => onPick(g.id)}>
                <b>{g.starred && <Star size={13} className="starred" fill="currentColor" />} {g.name}</b>
                <small className="muted">{g.description || 'Không có mô tả'}</small>
                <small className="muted">{g.flow === 'any' ? 'Chỉ cần một người duyệt' : 'Duyệt lần lượt'}{g.sla_hours ? ` · SLA ${g.sla_hours}h` : ''}</small>
                {(g.file_count > 0 || g.has_guide) && <small className="rq-choose-guide">📎 Có biểu mẫu / quy trình hướng dẫn{g.file_count ? ` (${g.file_count} tệp)` : ''}</small>}
              </button>
            ))}
          </div>
        </div>
      ))}
      {!list.length && <p className="muted">Không có nhóm đề xuất nào đang mở. Liên hệ quản trị viên.</p>}
    </div>
  );
}

export default function RequestForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { users, user } = useApp();
  const { bump } = useRequestApp();
  const [groupId, setGroupId] = useState(params.get('group_id') ? Number(params.get('group_id')) : null);
  const [group, setGroup] = useState(null);
  const [form, setForm] = useState({ title: '', content: '', data: {}, approvers: [], followers: [] });
  const [existing, setExisting] = useState(null);
  const [files, setFiles] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.get(`/requests/${id}`).then((q) => {
      setExisting(q);
      setGroupId(q.group_id);
      setForm({
        title: q.title, content: q.content || '', data: q.data || {},
        approvers: q.approvers.map((a) => a.user_id), followers: q.followers.map((f) => f.id),
      });
    }).catch((e) => setErr(e.message));
  }, [id]);
  useEffect(() => {
    if (!groupId) return;
    api.get(`/request-groups/${groupId}`).then((g) => {
      setGroup(g);
      if (!id) setForm((f) => ({ ...f, title: f.title || g.name, followers: g.followers.map((x) => x.user_id) }));
    }).catch((e) => setErr(e.message));
  }, [groupId, id]);

  if (!groupId) return <GroupChooser onPick={setGroupId} />;
  if (!group || (id && !existing)) return <div className="rq-page">{err ? <div className="alert alert-error">{err}</div> : <Spinner />}</div>;

  const fixed = group.approvers.map((a) => a.user_id);
  const extra = form.approvers.filter((x) => !fixed.includes(x));
  const setData = (k, v) => setForm({ ...form, data: { ...form.data, [k]: v } });
  const submit = async (draft) => {
    setErr('');
    for (const f of group.fields) {
      const v = form.data[f.key];
      if (!draft && f.required && (v === undefined || v === '' || v === null || v === false)) return setErr(`Vui lòng nhập "${f.label}"`);
    }
    if (!draft && !fixed.length && !extra.length) return setErr('Vui lòng chọn ít nhất một người duyệt');
    setBusy(true);
    try {
      const body = { group_id: group.id, title: form.title, content: form.content, data: JSON.stringify(form.data),
        approvers: extra, followers: form.followers };
      let q;
      if (id) q = await api.put(`/requests/${id}`, toFormData({ ...body, approvers: [...fixed, ...extra], submit: draft ? '' : 1 }, files));
      else q = await api.post('/requests', toFormData({ ...body, draft: draft ? 1 : '' }, files));
      toast(draft ? 'Đã lưu nháp đề xuất' : 'Đã gửi đề xuất');
      bump();
      navigate(`/request/${q.id}`);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="rq-page">
      <div className="rq-head">
        <button className="icon-btn" onClick={() => (id ? navigate(-1) : setGroupId(null))} aria-label="Quay lại"><ArrowLeft size={18} /></button>
        <div className="grow"><small className="muted">{group.category}</small><h1>{id ? 'Sửa đề xuất' : group.name}</h1></div>
        <button className="btn" disabled={busy} onClick={() => submit(true)}>Lưu nháp</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => submit(false)}>{existing?.status === 'returned' ? 'Gửi lại' : 'Gửi đề xuất'}</button>
      </div>
      {err && <div className="alert alert-error">{err}</div>}
      {existing?.status === 'returned' && (
        <div className="alert">Đề xuất bị trả lại: {existing.approvers.find((a) => a.status === 'returned')?.comment}</div>
      )}
      <div className="form-layout">
        <div className="card">
          {group.description && <p className="muted">{group.description}</p>}
          <GroupGuide groupId={group.id} guide={group.guide} files={group.files} className="rq-guide-inline" title="Đọc trước khi làm đề xuất: biểu mẫu & quy trình" />
          <div className="form-grid one">
            <Field label="Tên đề xuất" required><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            {group.fields.map((f) => (
              <Field key={f.key} label={f.label} required={f.required}>
                <FieldInput field={f} value={form.data[f.key]} onChange={(v) => setData(f.key, v)} users={users} />
              </Field>
            ))}
            <Field label="Nội dung / ghi chú thêm"><textarea className="input" rows={4} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></Field>
            <div>
              <span className="field-label">Tệp đính kèm</span>
              <div className="file-list">
                {existing?.attachments.map((a) => <FileChip key={a.id} file={a} />)}
                {files.map((f, i) => <FileChip key={i} file={f} onRemove={() => setFiles(files.filter((_, j) => j !== i))} />)}
                <label className="btn btn-sm"><Paperclip size={14} /> Đính kèm tệp
                  <input type="file" multiple hidden onChange={(e) => { setFiles([...files, ...e.target.files]); e.target.value = ''; }} /></label>
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <h3 className="card-title">Người duyệt · {group.flow === 'any' ? 'Chỉ cần một người duyệt' : 'Duyệt lần lượt'}</h3>
          {group.approvers.length > 0 && (
            <ol className="approval-flow">
              {group.approvers.map((a) => (
                <li key={a.user_id} className="pending"><Avatar name={a.name} color={a.color} size={28} />
                  <div className="grow"><b>{a.name}</b><small className="muted block">Bước {a.step} · {a.title || 'Người duyệt mặc định'}</small></div></li>
              ))}
            </ol>
          )}
          {group.custom_approvers ? (
            <Field label={group.approvers.length ? 'Thêm người duyệt' : 'Chọn người duyệt (theo thứ tự)'} required={!group.approvers.length}>
              <UserPicker users={users} multiple exclude={[...fixed, user.id]} value={extra}
                onChange={(v) => setForm({ ...form, approvers: [...fixed, ...v] })} placeholder="Chọn người duyệt" />
            </Field>
          ) : !group.approvers.length && <p className="text-red small">Nhóm chưa cấu hình người duyệt.</p>}
          {group.sla_hours && <p className="muted small">Thời hạn xử lý (SLA): {group.sla_hours} giờ kể từ khi gửi.</p>}
          <h3 className="card-title">Người theo dõi</h3>
          <UserPicker users={users} multiple value={form.followers} onChange={(v) => setForm({ ...form, followers: v })} placeholder="Thêm người theo dõi" />
        </div>
      </div>
    </div>
  );
}

export function StatusSteps({ approvers, flow }) {
  return (
    <ol className="approval-flow">
      {approvers.map((a) => (
        <li key={a.user_id} className={cx(a.status)}>
          <Avatar name={a.name} color={a.color} size={30} />
          <div className="grow"><b>{a.name}</b><small className="muted block">{flow === 'any' ? 'Người duyệt' : `Bước ${a.step}`}{a.title ? ` · ${a.title}` : ''}</small>
            {a.comment && <div className="small pre">“{a.comment}”</div>}</div>
          <span className={cx('small', { approved: 'text-green', rejected: 'text-red', returned: 'text-red' }[a.status] || 'muted')}>
            {{ approved: 'Đã chấp thuận', rejected: 'Từ chối', returned: 'Trả lại', skipped: 'Không cần duyệt', pending: 'Chờ duyệt' }[a.status]}
          </span>
        </li>
      ))}
    </ol>
  );
}
