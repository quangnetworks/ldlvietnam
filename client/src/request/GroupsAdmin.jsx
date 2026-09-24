import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Search, ChevronDown, Pencil, Plus, Trash2, ArrowUp, ArrowDown, User, Users, Copy, BookOpen, Upload, FileText, Workflow } from 'lucide-react';
import { api, toFormData } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Field, UserPicker, Spinner, Dropdown, MenuItem, Empty, Avatar, Modal, RichEditor, FileChip } from '../components/ui.jsx';
import FileViewer from '../components/FileViewer.jsx';
import { useDebounced } from '../components/shell.jsx';
import { fmtDateTime, cx } from '../utils.js';
import { useRequestApp, groupByCategory } from './RequestLayout.jsx';
import { FIELD_TYPES, FieldInput } from './fields.jsx';

const FlowLabel = ({ flow }) => (
  <span className="rq-flow">{flow === 'any' ? <><User size={12} /> Chỉ cần một người duyệt</> : <><Users size={12} /> Duyệt lần lượt</>}</span>
);

export function GroupsAdmin({ bulk = false }) {
  const { reloadGroups } = useRequestApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [groups, reload, loading] = useFetch(() => api.get('/request-groups', { manage: 1, status, q: dq }), [status, dq]);
  const [selected, setSelected] = useState([]);
  const [closed, setClosed] = useState({});
  const [moveOpen, setMoveOpen] = useState(false);
  const [cat, setCat] = useState('');
  const refresh = () => { reload(); reloadGroups(); setSelected([]); };
  const bulkAct = async (action, extra = {}) => {
    if (action === 'delete' && !window.confirm(`Xoá ${selected.length} nhóm đề xuất? Các đề xuất đã tạo vẫn được giữ lại.`)) return;
    try {
      const r = await api.post('/request-groups/bulk', { ids: selected, action, ...extra });
      toast(`Đã cập nhật ${r.affected} nhóm đề xuất`);
      refresh();
    } catch (e) { toast(e.message, 'error'); }
  };
  const toggleOne = async (g) => {
    await api.post('/request-groups/bulk', { ids: [g.id], action: g.active ? 'disable' : 'enable' });
    refresh();
  };
  const all = groups || [];
  const allSelected = all.length > 0 && selected.length === all.length;
  const sel = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="rq-page">
      <div className="rq-head">
        <div className="grow">
          <h1>{bulk ? 'Tác vụ hàng loạt' : 'Quản lý nhóm đề xuất'}</h1>
          <div className="rq-tabs">
            {[['', 'TẤT CẢ'], ['active', 'ĐANG KHẢ DỤNG'], ['paused', 'ĐANG TẠM ĐÓNG']].map(([k, l]) => (
              <button key={k} className={cx(status === k && 'active')} onClick={() => setStatus(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="rq-actions">
          <div className="rq-searchbox"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm nhóm đề xuất" /><Search size={15} /></div>
          <Dropdown align="right" trigger={(o, t) => <button className="btn btn-primary" onClick={t}>Tạo nhóm đề xuất <ChevronDown size={14} /></button>}>
            <MenuItem icon={Plus} onClick={() => navigate('/request/settings/group/new')}>Tạo nhóm mới</MenuItem>
            <MenuItem icon={Copy} onClick={() => navigate('/request/settings/templates')}>Tạo từ mẫu</MenuItem>
          </Dropdown>
        </div>
      </div>
      <div className="rq-card rq-selectall">
        <label className="check"><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : all.map((g) => g.id))} /> Chọn tất cả nhóm</label>
        {selected.length > 0 && (
          <div className="row gap-sm wrap">
            <b>Đã chọn {selected.length}</b>
            <button className="btn btn-sm" onClick={() => bulkAct('enable')}>Mở</button>
            <button className="btn btn-sm" onClick={() => bulkAct('disable')}>Tạm đóng</button>
            <button className="btn btn-sm" onClick={() => setMoveOpen(true)}>Chuyển danh mục</button>
            <button className="btn btn-sm btn-danger-ghost" onClick={() => bulkAct('delete')}><Trash2 size={14} /> Xoá</button>
          </div>
        )}
      </div>
      {loading && !groups ? <Spinner /> : groupByCategory(all).map(({ category, items }) => (
        <div key={category} className="rq-card">
          <button className="rq-card-head" onClick={() => setClosed({ ...closed, [category]: !closed[category] })}>
            <ChevronDown size={16} style={{ transform: closed[category] ? 'rotate(-90deg)' : '' }} />
            <span><b>{category}</b><small className="muted block">{items.length} nhóm đề xuất</small></span>
          </button>
          {!closed[category] && (
            <table className="rq-table">
              <thead><tr><th style={{ width: 36 }} /><th>TÊN NHÓM ĐỀ XUẤT</th><th>QUY TRÌNH</th><th>SLA(H)</th><th>TRẠNG THÁI</th><th /></tr></thead>
              <tbody>
                {items.map((g) => (
                  <tr key={g.id}>
                    <td><input type="checkbox" checked={selected.includes(g.id)} onChange={() => sel(g.id)} /></td>
                    <td><Link to={`/request/settings/group/${g.id}`} className="rq-gname">{g.name}</Link>
                      <small className="muted block">{g.description || 'Không có mô tả'} · {g.request_count} đề xuất{g.file_count ? ` · ${g.file_count} biểu mẫu / quy trình` : ''}</small></td>
                    <td><FlowLabel flow={g.flow} /></td>
                    <td>{g.sla_hours ? <b>{g.sla_hours} <span className="muted">(h)</span></b> : '—'}</td>
                    <td><label className="switch"><input type="checkbox" checked={g.active} onChange={() => toggleOne(g)} /><span /></label></td>
                    <td><Link to={`/request/settings/group/${g.id}`} className="btn btn-sm"><Pencil size={13} /> Sửa</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
      {groups && !groups.length && <Empty title="Không có nhóm đề xuất nào" />}
      {moveOpen && (
        <Modal title="Chuyển danh mục" onClose={() => setMoveOpen(false)} width={420}
          footer={<><button className="btn" onClick={() => setMoveOpen(false)}>Hủy</button>
            <button className="btn btn-primary" disabled={!cat.trim()} onClick={() => { bulkAct('category', { category: cat }); setMoveOpen(false); }}>Chuyển</button></>}>
          <Field label="Tên danh mục"><input className="input" list="rq-cats" autoFocus value={cat} onChange={(e) => setCat(e.target.value)} /></Field>
          <datalist id="rq-cats">{[...new Set(all.map((g) => g.category))].map((c) => <option key={c} value={c} />)}</datalist>
        </Modal>
      )}
    </div>
  );
}

const TEMPLATES = [
  { name: 'Đề xuất nghỉ phép', category: 'Hành chính - Nhân sự', flow: 'sequential', sla_hours: 24, fields: [
    { label: 'Nghỉ từ ngày', type: 'date', required: true }, { label: 'Đến ngày', type: 'date', required: true },
    { label: 'Loại nghỉ', type: 'select', options: ['Nghỉ phép năm', 'Nghỉ không lương', 'Nghỉ ốm'], required: true }, { label: 'Lý do', type: 'textarea', required: true }] },
  { name: 'Đề xuất làm thêm giờ', category: 'Hành chính - Nhân sự', flow: 'sequential', sla_hours: 12, fields: [
    { label: 'Ngày làm thêm', type: 'date', required: true }, { label: 'Số giờ', type: 'number', required: true }, { label: 'Nội dung công việc', type: 'textarea', required: true }] },
  { name: 'Đề xuất đi công tác', category: 'Hành chính - Nhân sự', flow: 'sequential', sla_hours: 24, fields: [
    { label: 'Nơi công tác', type: 'text', required: true }, { label: 'Từ ngày', type: 'date', required: true }, { label: 'Đến ngày', type: 'date', required: true },
    { label: 'Dự trù chi phí', type: 'money' }] },
  { name: 'Đề nghị tạm ứng', category: 'Tài chính - Kế toán', flow: 'sequential', sla_hours: 48, fields: [
    { label: 'Số tiền', type: 'money', required: true }, { label: 'Mục đích', type: 'textarea', required: true }, { label: 'Ngày hoàn ứng', type: 'date' }] },
  { name: 'Đề nghị thanh toán', category: 'Tài chính - Kế toán', flow: 'sequential', sla_hours: 48, fields: [
    { label: 'Số tiền', type: 'money', required: true }, { label: 'Người thụ hưởng', type: 'text', required: true },
    { label: 'Hình thức', type: 'select', options: ['Chuyển khoản', 'Tiền mặt'] }, { label: 'Diễn giải', type: 'textarea' }] },
  { name: 'Đề xuất mua hàng', category: 'Mua hàng', flow: 'any', sla_hours: 24, fields: [
    { label: 'Danh sách hàng hoá', type: 'textarea', required: true }, { label: 'Tổng giá trị dự kiến', type: 'money', required: true }, { label: 'Nhà cung cấp', type: 'text' }] },
  { name: 'Đề xuất chính sách bán hàng cho NPP', category: 'Kinh doanh', flow: 'sequential', sla_hours: 48, fields: [
    { label: 'Nhà phân phối', type: 'text', required: true }, { label: 'Khu vực', type: 'select', options: ['Miền Bắc', 'Miền Trung', 'Miền Nam'], required: true },
    { label: 'Mức chiết khấu đề xuất (%)', type: 'number', required: true }, { label: 'Doanh số cam kết', type: 'money' }, { label: 'Lý do', type: 'textarea' }] },
  { name: 'Đề xuất cấp tài khoản / thiết bị IT', category: 'IT', flow: 'any', sla_hours: 8, fields: [
    { label: 'Người sử dụng', type: 'user', required: true }, { label: 'Hạng mục', type: 'select', options: ['Tài khoản phần mềm', 'Máy tính', 'Điện thoại', 'Khác'], required: true },
    { label: 'Mô tả chi tiết', type: 'textarea' }] },
];

export function TemplatesPage() {
  const navigate = useNavigate();
  return (
    <div className="rq-page">
      <div className="rq-head"><div className="grow"><h1>Tạo nhóm từ mẫu</h1><p className="muted">Chọn một mẫu có sẵn biểu mẫu, sau đó chỉnh người duyệt và lưu.</p></div></div>
      <div className="rq-choose-grid">
        {TEMPLATES.map((t) => (
          <button key={t.name} className="rq-choose" onClick={() => navigate('/request/settings/group/new', { state: { template: t } })}>
            <b>{t.name}</b>
            <small className="muted">{t.category} · {t.fields.length} trường · {t.flow === 'any' ? 'Chỉ cần một người duyệt' : 'Duyệt lần lượt'}</small>
            <small className="muted">{t.fields.map((f) => f.label).join(', ')}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

export function GroupEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { users } = useApp();
  const { groups, reloadGroups } = useRequestApp();
  const location = useLocation();
  const [g, setG] = useState(null);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState({});
  const [pending, setPending] = useState([]); // [{ file, kind }] tải lên sau khi lưu nhóm
  const [viewing, setViewing] = useState(null);
  useEffect(() => {
    if (id && id !== 'new') {
      api.get(`/request-groups/${id}`).then((x) => setG({ ...x, approvers: x.approvers.map((a) => a.user_id), followers: x.followers.map((f) => f.user_id) }))
        .catch((e) => setErr(e.message));
    } else {
      const t = location.state?.template;
      setG({ name: t?.name || '', description: '', category: t?.category || 'Chung', flow: t?.flow || 'sequential', sla_hours: t?.sla_hours || '',
        custom_approvers: true, active: true, fields: (t?.fields || [{ label: 'Nội dung', type: 'textarea', required: true }]).map((f, i) => ({ key: `f${i + 1}`, ...f })),
        approvers: [], followers: [] });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!g) return <div className="rq-page">{err ? <div className="alert alert-error">{err}</div> : <Spinner />}</div>;
  const set = (k) => (e) => setG({ ...g, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e });
  const setField = (i, patch) => setG({ ...g, fields: g.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const move = (i, d) => {
    const list = [...g.fields];
    [list[i], list[i + d]] = [list[i + d], list[i]];
    setG({ ...g, fields: list });
  };
  const save = async () => {
    setErr('');
    try {
      const body = { ...g, fields: g.fields.map((f) => ({ ...f, options: f.type === 'select' ? (Array.isArray(f.options) ? f.options : String(f.options || '').split('\n')) : undefined })) };
      const gid = id && id !== 'new' ? (await api.put(`/request-groups/${id}`, body), id) : (await api.post('/request-groups', body)).id;
      for (const kind of ['form', 'process']) {
        const list = pending.filter((p) => p.kind === kind).map((p) => p.file);
        if (list.length) await api.post(`/request-groups/${gid}/files`, toFormData({ kind }, list));
      }
      toast('Đã lưu nhóm đề xuất');
      reloadGroups();
      navigate('/request/settings');
    } catch (e) { setErr(e.message); }
  };
  const categories = [...new Set(groups.map((x) => x.category))];
  return (
    <div className="rq-page">
      <div className="rq-head">
        <div className="grow"><small className="muted">QUẢN LÝ NHÓM ĐỀ XUẤT</small><h1>{id === 'new' ? 'Tạo nhóm đề xuất' : g.name}</h1></div>
        <button className="btn" onClick={() => navigate('/request/settings')}>Hủy</button>
        <button className="btn btn-primary" onClick={save}>Lưu nhóm đề xuất</button>
      </div>
      {err && <div className="alert alert-error">{err}</div>}
      <div className="form-layout">
        <div>
          <div className="card">
            <h3 className="card-title">Thông tin chung</h3>
            <div className="form-grid">
              <div className="span-2"><Field label="Tên nhóm đề xuất" required><input className="input" value={g.name} onChange={set('name')} /></Field></div>
              <div className="span-2"><Field label="Mô tả"><input className="input" value={g.description || ''} onChange={set('description')} /></Field></div>
              <Field label="Danh mục" hint="Nhóm các đề xuất trên menu trái, ví dụ: ADMIN, FINANCE">
                <input className="input" list="rq-cat-list" value={g.category} onChange={set('category')} />
                <datalist id="rq-cat-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
              </Field>
              <Field label="SLA (giờ)" hint="Thời hạn xử lý; để trống nếu không giới hạn"><input type="number" min="1" className="input" value={g.sla_hours || ''} onChange={set('sla_hours')} /></Field>
              <label className="check"><input type="checkbox" checked={g.active} onChange={set('active')} /> Đang khả dụng</label>
            </div>
          </div>
          <div className="card">
            <div className="row between"><h3 className="card-title">Biểu mẫu ({g.fields.length} trường)</h3>
              <button className="btn btn-sm" onClick={() => setG({ ...g, fields: [...g.fields, { key: `f${Date.now() % 100000}`, label: '', type: 'text', required: false }] })}><Plus size={14} /> Thêm trường</button></div>
            {g.fields.map((f, i) => (
              <div key={f.key + i} className="field-row">
                <div className="field-row-main">
                  <input className="input" placeholder="Tên trường" value={f.label} onChange={(e) => setField(i, { label: e.target.value })} />
                  <select className="input" value={f.type} onChange={(e) => setField(i, { type: e.target.value })}>
                    {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <label className="check small"><input type="checkbox" checked={!!f.required} onChange={(e) => setField(i, { required: e.target.checked })} /> Bắt buộc</label>
                  <button className="icon-btn sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Lên"><ArrowUp size={14} /></button>
                  <button className="icon-btn sm" disabled={i === g.fields.length - 1} onClick={() => move(i, 1)} aria-label="Xuống"><ArrowDown size={14} /></button>
                  <button className="icon-btn sm" onClick={() => setG({ ...g, fields: g.fields.filter((_, j) => j !== i) })} aria-label="Xoá"><Trash2 size={14} /></button>
                </div>
                {f.type === 'select' && (
                  <textarea className="input" rows={3} placeholder="Mỗi dòng một lựa chọn" value={Array.isArray(f.options) ? f.options.join('\n') : f.options || ''}
                    onChange={(e) => setField(i, { options: e.target.value })} />
                )}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="card">
            <h3 className="card-title"><BookOpen size={16} /> Biểu mẫu & quy trình hướng dẫn</h3>
            <p className="muted small">Đính kèm biểu mẫu (mẫu đơn, bảng kê…) và tài liệu quy trình để người làm đề xuất đọc, xem trước, tải về và thực hiện theo.
              Hiển thị ngay khi tạo đề xuất và trong trang chi tiết đề xuất.</p>
            <Field label="Hướng dẫn thực hiện">
              <RichEditor value={g.guide || ''} onChange={set('guide')} minHeight={100} placeholder="Ví dụ: Bước 1 — tải biểu mẫu, điền đầy đủ; Bước 2 — đính kèm chứng từ; Bước 3 — gửi trước 3 ngày…" />
            </Field>
            {[['form', 'Biểu mẫu', FileText], ['process', 'Quy trình / hướng dẫn', Workflow]].map(([kind, label, Icon]) => {
              const saved = (g.files || []).filter((f) => f.kind === kind);
              const staged = pending.filter((p) => p.kind === kind);
              return (
                <div key={kind} className="rq-guide-group">
                  <div className="row between"><small className="muted rq-guide-label"><Icon size={13} /> {label}</small>
                    <label className="link-btn small"><Upload size={13} /> Tải lên
                      <input type="file" multiple hidden onChange={(e) => { setPending([...pending, ...[...e.target.files].map((file) => ({ file, kind }))]); e.target.value = ''; }} /></label>
                  </div>
                  <div className="attach-list">
                    {saved.map((f) => (
                      <FileChip key={f.id} file={f} onOpen={() => setViewing(g.files.indexOf(f))} onRemove={async () => {
                        if (!window.confirm(`Xoá "${f.original_name}"?`)) return;
                        try { setG({ ...g, files: await api.del(`/request-groups/${g.id}/files/${f.id}`) }); } catch (e) { toast(e.message, 'error'); }
                      }} />
                    ))}
                    {staged.map((p) => <FileChip key={`${p.file.name}${pending.indexOf(p)}`} file={p.file} onRemove={() => setPending(pending.filter((x) => x !== p))} />)}
                    {!saved.length && !staged.length && <small className="muted">Chưa có tệp</small>}
                  </div>
                </div>
              );
            })}
            {pending.length > 0 && <small className="muted">{pending.length} tệp sẽ được tải lên khi bấm “Lưu nhóm đề xuất”.</small>}
            {viewing != null && (
              <FileViewer files={g.files} index={viewing} urlOf={(f) => api.url(`/request-groups/${g.id}/files/${f.id}`)} onClose={() => setViewing(null)}
                publicUrlOf={async (f) => (await api.post(`/request-groups/${g.id}/files/${f.id}/link`)).url} />
            )}
          </div>
          <div className="card">
            <h3 className="card-title">Quy trình duyệt</h3>
            <div className="seg-choice">
              <label className={cx(g.flow === 'sequential' && 'on')}><input type="radio" checked={g.flow === 'sequential'} onChange={() => setG({ ...g, flow: 'sequential' })} />
                <b><Users size={14} /> Duyệt lần lượt</b><small className="muted">Từng người duyệt theo thứ tự; tất cả đồng ý mới được chấp thuận.</small></label>
              <label className={cx(g.flow === 'any' && 'on')}><input type="radio" checked={g.flow === 'any'} onChange={() => setG({ ...g, flow: 'any' })} />
                <b><User size={14} /> Chỉ cần một người duyệt</b><small className="muted">Một trong các người duyệt đồng ý là đề xuất được chấp thuận.</small></label>
            </div>
            <Field label="Người duyệt mặc định (theo thứ tự)"><UserPicker users={users} multiple value={g.approvers} onChange={set('approvers')} placeholder="Chọn người duyệt" /></Field>
            <label className="check mt"><input type="checkbox" checked={g.custom_approvers} onChange={set('custom_approvers')} /> Cho phép người tạo chọn / thêm người duyệt</label>
            <h3 className="card-title">Người theo dõi mặc định</h3>
            <UserPicker users={users} multiple value={g.followers} onChange={set('followers')} placeholder="Ví dụ: kế toán, HCNS" />
          </div>
          <div className="card">
            <h3 className="card-title">Xem trước biểu mẫu</h3>
            <div className="form-grid one">
              {g.fields.filter((f) => f.label).map((f) => (
                <Field key={f.key} label={f.label} required={f.required}>
                  <FieldInput field={{ ...f, options: Array.isArray(f.options) ? f.options : String(f.options || '').split('\n').filter(Boolean) }}
                    value={preview[f.key]} onChange={(v) => setPreview({ ...preview, [f.key]: v })} users={users} />
                </Field>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GroupHistory() {
  const [items] = useFetch(() => api.get('/request-groups/history'), []);
  return (
    <div className="rq-page">
      <div className="rq-head"><h1>Lịch sử chỉnh sửa nhóm</h1></div>
      {!items ? <Spinner /> : !items.length ? <Empty title="Chưa có lịch sử" /> : (
        <ul className="timeline">
          {items.map((a) => <li key={a.id}><Avatar name={a.user_name} color={a.user_color} size={22} /> <b>{a.user_name}</b> — {a.detail}
            <small className="muted block">{fmtDateTime(a.created_at)}</small></li>)}
        </ul>
      )}
    </div>
  );
}

export function RequestGuide() {
  const steps = [
    ['Tạo đề xuất', 'Bấm "Tạo đề xuất", chọn loại (nghỉ phép, tạm ứng, thanh toán…), điền biểu mẫu, đính kèm chứng từ và gửi.'],
    ['Duyệt', 'Người duyệt nhận thông báo, vào tab "Đến lượt duyệt" để Chấp thuận, Từ chối hoặc Trả lại (kèm lý do).'],
    ['Trả lại & gửi lại', 'Đề xuất bị trả lại có thể sửa và gửi lại; quy trình duyệt bắt đầu lại từ đầu.'],
    ['SLA', 'Mỗi nhóm có thể đặt thời hạn xử lý; đề xuất quá hạn hiển thị ở tab "Quá hạn".'],
    ['Quản trị', 'Quản trị viên tạo nhóm đề xuất, dựng biểu mẫu, chọn quy trình "duyệt lần lượt" hoặc "chỉ cần một người".'],
  ];
  return (
    <div className="rq-page">
      <div className="rq-head"><h1>Hướng dẫn sử dụng LDL Request</h1></div>
      <div className="guide-grid">{steps.map(([t, d], i) => <div key={t} className="card"><h3>{i + 1}. {t}</h3><p className="muted">{d}</p></div>)}</div>
    </div>
  );
}
