import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Search, ChevronDown, Pencil, Plus, Trash2, ArrowUp, ArrowDown, User, Users, Copy, BookOpen, Upload, FileText, Workflow, Printer, ListOrdered, Boxes,
  Lock, Globe, X,
} from 'lucide-react';
import { api, toFormData } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Field, UserPicker, Spinner, Dropdown, MenuItem, Empty, Avatar, Modal, RichEditor, FileChip, MultiSelect } from '../components/ui.jsx';
import FileViewer from '../components/FileViewer.jsx';
import { useDebounced } from '../components/shell.jsx';
import { fmtDateTime, cx } from '../utils.js';
import { useRequestApp, groupByCategory } from './RequestLayout.jsx';
import { FIELD_TYPES, FieldInput, FLOWS, flowLabel } from './fields.jsx';
import { GroupTools } from './GroupTools.jsx';

const FLOW_ICON = { any: User, sequential: ListOrdered, parallel: Users, blocks: Boxes };
const FlowLabel = ({ flow }) => {
  const Icon = FLOW_ICON[flow] || ListOrdered;
  return <span className="rq-flow"><Icon size={12} /> {flowLabel(flow)}</span>;
};

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
  const duplicate = async (g) => {
    try {
      const r = await api.post(`/request-groups/${g.id}/duplicate`);
      toast(`Đã nhân bản "${g.name}" (đang tạm đóng)`);
      navigate(`/request/settings/group/${r.id}`);
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
          <GroupTools selected={selected} groups={all} onDone={refresh} />
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
                      {g.visibility === 'private' && <span className="badge badge-gray rq-private" title="Chỉ phòng ban / thành viên được chỉ định"><Lock size={10} /> Riêng tư</span>}
                      <small className="muted block">{g.description || 'Không có mô tả'} · {g.request_count} đề xuất{g.file_count ? ` · ${g.file_count} biểu mẫu / quy trình` : ''}</small></td>
                    <td><FlowLabel flow={g.flow} /></td>
                    <td>{g.sla_hours ? <b>{g.sla_hours} <span className="muted">(h)</span></b> : '—'}</td>
                    <td><label className="switch"><input type="checkbox" checked={g.active} onChange={() => toggleOne(g)} /><span /></label></td>
                    <td><div className="row gap-xs nowrap">
                      <Link to={`/request/settings/group/${g.id}`} className="btn btn-sm"><Pencil size={13} /> Sửa</Link>
                      <button className="icon-btn sm" title="Nhân bản nhóm" aria-label="Nhân bản nhóm" onClick={() => duplicate(g)}><Copy size={14} /></button>
                    </div></td>
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
            <small className="muted">{t.category} · {t.fields.length} trường · {flowLabel(t.flow)}</small>
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
  const { users, departments } = useApp();
  const { groups, reloadGroups } = useRequestApp();
  const location = useLocation();
  const [g, setG] = useState(null);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState({});
  const [pending, setPending] = useState([]); // [{ file, kind }] tải lên sau khi lưu nhóm
  const [viewing, setViewing] = useState(null);
  useEffect(() => {
    if (id && id !== 'new') {
      api.get(`/request-groups/${id}`).then((x) => setG({ ...x, approvers: x.approvers.map((a) => a.user_id), followers: x.followers.map((f) => f.user_id),
        blocks: x.blocks?.length ? x.blocks : [{ mode: 'all', users: x.approvers.map((a) => a.user_id) }] }))
        .catch((e) => setErr(e.message));
    } else {
      const t = location.state?.template;
      setG({ name: t?.name || '', description: '', category: t?.category || 'Chung', flow: t?.flow || 'sequential', sla_hours: t?.sla_hours || '',
        custom_approvers: true, active: true, fields: (t?.fields || [{ label: 'Nội dung', type: 'textarea', required: true }]).map((f, i) => ({ key: `f${i + 1}`, ...f })),
        approvers: [], followers: [], blocks: [{ mode: 'all', users: [] }], visibility: 'public', member_departments: [], member_users: [], notify_manager: false });
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
                publicUrlOf={async (f, share) => (await api.post(`/request-groups/${g.id}/files/${f.id}/link${share ? '?share=1' : ''}`)).url} />
            )}
          </div>
          <div className="card">
            <h3 className="card-title">Quy trình duyệt</h3>
            <div className="stage-setup">
              <div className="stage-setup-row">
                <span className="stage-no">1</span>
                <div className="grow">
                  <label className="check"><input type="checkbox" checked={!!g.manager_approval} onChange={set('manager_approval')} /> <b>Quản lý trực tiếp duyệt trước</b></label>
                  <small className="muted block">Nhân viên gửi đề xuất → quản lý trực tiếp (hoặc trưởng phòng nếu chưa có quản lý) duyệt trước khi chuyển các phòng ban. Người không có cấp trên bỏ qua bước này.</small>
                </div>
              </div>
              <div className="stage-setup-row">
                <span className="stage-no">2</span>
                <div className="grow">
                  <b>Phòng ban / người duyệt liên quan</b>
                  <small className="muted block">Theo quy trình xử lý chọn bên dưới (ví dụ: Kế toán → Hành chính).</small>
                </div>
              </div>
              <div className="stage-setup-row">
                <span className="stage-no">3</span>
                <div className="grow">
                  <b>Người duyệt cuối cùng</b>
                  <UserPicker users={users} value={g.final_approver_id || null} onChange={set('final_approver_id')} placeholder="Không có (tuỳ chọn) — ví dụ: Giám đốc" />
                </div>
              </div>
              {(g.manager_approval || g.final_approver_id) && <small className="muted">Các chặng nối tiếp nhau: 1 → 2 → 3; trong chặng 2 áp dụng quy trình xử lý của nhóm.</small>}
            </div>
            <Field label="Quy trình xử lý" hint={FLOWS.find((f) => f.value === g.flow)?.hint}>
              <select className="input" value={g.flow} onChange={(e) => setG({ ...g, flow: e.target.value })}>
                {FLOWS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </Field>
            {g.flow === 'blocks' ? (
              <BlocksEditor blocks={g.blocks || []} users={users} onChange={(blocks) => setG({ ...g, blocks })}
                label={g.manager_approval || g.final_approver_id ? 'Chặng 2 — Khối người duyệt (các khối nối tiếp nhau)' : 'Khối người duyệt (các khối nối tiếp nhau)'} />
            ) : (
              <Field label={`${g.manager_approval || g.final_approver_id ? 'Chặng 2 — ' : ''}Người xét duyệt${g.flow === 'sequential' ? ' (theo thứ tự)' : ''}`}
                hint={g.flow === 'any' ? 'Một trong các người duyệt đồng ý là đủ' : 'Một đề xuất chỉ được xét duyệt nếu tất cả thành viên đồng ý'}>
                <UserPicker users={users} multiple value={g.approvers} onChange={set('approvers')} placeholder="Sử dụng @ để tag người xét duyệt" />
              </Field>
            )}
            <Field label="Yêu cầu thông báo tới người quản lý trực tiếp?" hint="Nếu chọn Có, mọi đề xuất sẽ được gửi tới người quản lý trực tiếp của người tạo đề xuất (theo dõi đề xuất)">
              <select className="input" value={g.notify_manager ? '1' : ''} onChange={(e) => setG({ ...g, notify_manager: !!e.target.value })}>
                <option value="">Không</option><option value="1">Có</option>
              </select>
            </Field>
            <label className="check mt"><input type="checkbox" checked={g.custom_approvers} onChange={set('custom_approvers')} /> Cho phép người tạo chọn / thêm người duyệt</label>
            <h3 className="card-title">Người theo dõi mặc định</h3>
            <UserPicker users={users} multiple value={g.followers} onChange={set('followers')} placeholder="Ví dụ: kế toán, HCNS" />
            <small className="muted">Thành viên không trực tiếp xử lý đề xuất nhưng có thể theo dõi và trích xuất đề xuất.</small>
          </div>
          <div className="card">
            <h3 className="card-title">Phạm vi sử dụng</h3>
            <div className="seg-choice">
              <label className={cx(g.visibility !== 'private' && 'on')}><input type="radio" checked={g.visibility !== 'private'} onChange={() => setG({ ...g, visibility: 'public' })} />
                <b><Globe size={14} /> Công khai</b><small className="muted">Mọi thành viên đều tạo được đề xuất trong nhóm này.</small></label>
              <label className={cx(g.visibility === 'private' && 'on')}><input type="radio" checked={g.visibility === 'private'} onChange={() => setG({ ...g, visibility: 'private' })} />
                <b><Lock size={14} /> Riêng tư</b><small className="muted">Chỉ phòng ban / thành viên được chỉ định mới tạo được đề xuất.</small></label>
            </div>
            {g.visibility === 'private' && (
              <>
                <Field label="Sử dụng cho phòng ban" hint="Nhóm-bộ phận chức năng có thể tạo đề xuất (tính cả phòng ban kiêm nhiệm)">
                  <MultiSelect options={departments.map((d) => ({ value: d.id, label: d.name }))} value={g.member_departments || []}
                    onChange={set('member_departments')} placeholder="Chọn phòng ban" />
                </Field>
                <Field label="Và các thành viên">
                  <UserPicker users={users} multiple value={g.member_users || []} onChange={set('member_users')} placeholder="Chọn thành viên" />
                </Field>
                {!(g.member_departments?.length || g.member_users?.length) && <small className="text-red">Chưa chọn ai: chỉ quản trị viên tạo được đề xuất.</small>}
              </>
            )}
          </div>
          <div className="card">
            <h3 className="card-title"><Printer size={16} /> Mẫu in (bản cứng / PDF)</h3>
            <p className="muted small">Mỗi đề xuất in ra theo mẫu: tiêu đề, mã biểu mẫu, thông tin người đề nghị, các trường đã điền, thời gian gửi
              và bảng phê duyệt theo luồng (dấu ✓, người duyệt, thời gian, ý kiến) kèm ô ký xác nhận.</p>
            <div className="form-grid">
              <div className="span-2"><Field label="Tiêu đề trên phiếu in" hint="Để trống: dùng tên nhóm đề xuất"><input className="input" value={g.print_title || ''} onChange={set('print_title')} placeholder="VD: GIẤY ĐỀ NGHỊ TẠM ỨNG" /></Field></div>
              <Field label="Mã biểu mẫu"><input className="input" value={g.print_code || ''} onChange={set('print_code')} placeholder="VD: BM-KT-01" /></Field>
              <div className="span-2"><Field label="Ghi chú / cam kết cuối phiếu"><textarea className="input" rows={2} value={g.print_note || ''} onChange={set('print_note')} placeholder="VD: Tôi cam kết hoàn ứng trong vòng 07 ngày kể từ ngày hoàn thành công việc." /></Field></div>
            </div>
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

/** Luồng duyệt trong khối người duyệt: các khối nối tiếp; mỗi khối "tất cả đồng ý" hoặc "chỉ cần một người". */
function BlocksEditor({ blocks, users, onChange, label }) {
  const setBlock = (i, patch) => onChange(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <div className="rq-blocks">
      <small className="muted rq-blocks-label">{label}</small>
      {blocks.map((b, i) => (
        <div key={i} className="rq-block">
          <div className="row gap-sm">
            <span className="stage-no">{i + 1}</span>
            <b className="grow">Khối {i + 1}</b>
            <select className="input input-sm" value={b.mode} onChange={(e) => setBlock(i, { mode: e.target.value })} aria-label="Cách duyệt trong khối">
              <option value="all">Tất cả phải đồng ý</option>
              <option value="any">Chỉ cần một người đồng ý</option>
            </select>
            <button className="icon-btn sm" disabled={blocks.length < 2} onClick={() => onChange(blocks.filter((_, j) => j !== i))} aria-label="Xoá khối"><X size={14} /></button>
          </div>
          <UserPicker users={users} multiple value={b.users} onChange={(v) => setBlock(i, { users: v })} placeholder="Chọn người duyệt trong khối" />
        </div>
      ))}
      <button className="btn btn-sm" onClick={() => onChange([...blocks, { mode: 'all', users: [] }])}><Plus size={14} /> Thêm khối</button>
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
    ['Quy trình xử lý', 'Mỗi nhóm chọn một quy trình: Duyệt đồng thời (tất cả cùng nhận, tất cả đồng ý), Duyệt lần lượt, Chỉ cần một người duyệt, hoặc Luồng duyệt trong khối người duyệt (các khối nối tiếp, mỗi khối "tất cả" hoặc "một người").'],
    ['Quản trị', 'Quản trị viên tạo nhóm đề xuất, dựng biểu mẫu, giới hạn phạm vi sử dụng theo phòng ban; dùng "Công cụ" để cài SLA hàng loạt, thay thế người duyệt, nhập nhóm từ Excel và xuất / nhập thiết lập JSON.'],
  ];
  return (
    <div className="rq-page">
      <div className="rq-head"><h1>Hướng dẫn sử dụng LDL Request</h1></div>
      <div className="guide-grid">{steps.map(([t, d], i) => <div key={t} className="card"><h3>{i + 1}. {t}</h3><p className="muted">{d}</p></div>)}</div>
    </div>
  );
}
