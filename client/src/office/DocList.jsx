import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import {
  FileOutput, ScanLine, FilePlus2, List, Table2, Filter, Star, Pin, User, Paperclip, Eye, ChevronDown,
  History, Link2, Bookmark, FileText, RotateCcw, Trash2, X, FolderInput, CheckCheck,
} from 'lucide-react';
import { api, toFormData } from '../api.js';
import { useFetch, useToast } from '../context.jsx';
import { Dropdown, MenuItem, Pagination, Empty, Spinner, Modal, Field, MultiSelect, UserPicker, FileChip, Tabs } from '../components/ui.jsx';
import { useApp } from '../context.jsx';
import { DOC_STATUS, DOC_KINDS, fmtDate, fmtDateTime, cx, buildTree } from '../utils.js';

const TABS = [{ value: '', label: 'Tất cả văn bản' }, ...Object.entries(DOC_KINDS).map(([value, label]) => ({ value, label }))];

const BOX_TITLES = {
  following: 'Đang theo dõi', pending_me: 'Chờ tôi duyệt', starred: 'Yêu thích', mine: 'Tạo bởi tôi',
  numbering: 'Duyệt cấp số văn bản', system: 'Văn bản của hệ thống', drafts: 'Đã lưu', expired: 'Hết hạn',
  rejected: 'Không thông qua', archived: 'Cất giữ', trash: 'Đã tạm xóa',
};

export function StatusBadge({ doc }) {
  if (doc.deleted_at) return <span className="badge badge-gray">ĐÃ TẠM XÓA</span>;
  const s = DOC_STATUS[doc.status] || DOC_STATUS.draft;
  return <span className={cx('badge', s.cls)}>{s.label.toUpperCase()}</span>;
}

function flattenTree(nodes, depth = 0, out = []) {
  for (const n of nodes) {
    out.push({ value: n.id, label: n.name, depth });
    flattenTree(n.children, depth + 1, out);
  }
  return out;
}
export const treeOptions = (items) => flattenTree(buildTree(items || []));

function FilterModal({ meta, params, onApply, onClose }) {
  const { users } = useApp();
  const ids = (k) => (params.get(k) ? params.get(k).split(',').map(Number) : []);
  const [f, setF] = useState({
    status: params.get('status') ? params.get('status').split(',') : [],
    type_id: ids('type_id'),
    issuer_id: ids('issuer_id'),
    department_id: ids('department_id'),
    date_from: params.get('date_from') || '',
    date_to: params.get('date_to') || '',
    sort: params.get('sort') || 'newest',
  });
  const statusOptions = [...Object.entries(DOC_STATUS).map(([value, s]) => ({ value, label: s.label })), { value: 'expired', label: 'Hết hạn' }];
  return (
    <Modal title="Cài đặt bộ lọc và sắp xếp" onClose={onClose} width={620}
      footer={
        <>
          <button className="btn" onClick={() => onApply({ status: [], type_id: [], issuer_id: [], department_id: [], date_from: '', date_to: '', sort: '' })}>Xóa tất cả bộ lọc</button>
          <div className="grow" />
          <button className="btn" onClick={onClose}>Hủy bỏ thay đổi</button>
          <button className="btn btn-primary" onClick={() => onApply(f)}>Áp dụng</button>
        </>
      }>
      <div className="form-grid">
        <Field label="Trạng thái"><MultiSelect options={statusOptions} value={f.status} onChange={(v) => setF({ ...f, status: v })} placeholder="Tất cả trạng thái" /></Field>
        <Field label="Loại văn bản"><MultiSelect options={(meta?.types || []).map((t) => ({ value: t.id, label: t.name }))} value={f.type_id} onChange={(v) => setF({ ...f, type_id: v })} placeholder="Tất cả loại" /></Field>
        <Field label="Người ban hành"><UserPicker users={users} multiple value={f.issuer_id} onChange={(v) => setF({ ...f, issuer_id: v })} placeholder="Tất cả" /></Field>
        <Field label="Phòng ban"><MultiSelect options={(meta?.departments || []).map((d) => ({ value: d.id, label: d.name }))} value={f.department_id} onChange={(v) => setF({ ...f, department_id: v })} placeholder="Tất cả phòng ban" /></Field>
        <Field label="Từ ngày"><input type="date" className="input" value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} /></Field>
        <Field label="Đến ngày"><input type="date" className="input" value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} /></Field>
        <Field label="Sắp xếp theo">
          <select className="input" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })}>
            <option value="newest">Mới nhất</option>
            <option value="oldest">Cũ nhất</option>
            <option value="updated">Cập nhật gần đây</option>
            <option value="title">Tên văn bản (A-Z)</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}

export function ActivityModal({ docId, onClose }) {
  const [items] = useFetch(() => api.get(`/documents/${docId}/activity`), [docId]);
  return (
    <Modal title="Lịch sử hoạt động" onClose={onClose} width={560}>
      {!items ? <Spinner /> : (
        <ul className="timeline">
          {items.map((a) => (
            <li key={a.id}>
              <b>{a.user_name || 'Hệ thống'}</b> — {a.detail || a.action}
              <small className="muted block">{fmtDateTime(a.created_at)}</small>
            </li>
          ))}
          {!items.length && <Empty title="Chưa có hoạt động" />}
        </ul>
      )}
    </Modal>
  );
}

function ScanModal({ onClose }) {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const submit = async () => {
    setBusy(true);
    try {
      const title = files[0].name.replace(/\.[^.]+$/, '');
      const doc = await api.post('/documents', toFormData({ title, kind: 'incoming', draft: 1 }, files));
      toast('Đã tạo văn bản nháp từ tệp quét');
      navigate(`/office/doc/${doc.id}/edit`);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  };
  return (
    <Modal title="Quét văn bản" onClose={onClose} width={520}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" disabled={!files.length || busy} onClick={submit}>Tạo văn bản</button></>}>
      <p className="muted">Tải lên bản scan (PDF, ảnh) của văn bản giấy. Hệ thống sẽ tạo văn bản đến ở trạng thái nháp để bạn bổ sung thông tin.</p>
      <label className="dropzone">
        <ScanLine size={32} strokeWidth={1.3} />
        <span>Chọn tệp hoặc kéo thả vào đây</span>
        <input type="file" multiple accept=".pdf,image/*" onChange={(e) => setFiles([...e.target.files])} hidden />
      </label>
      <div className="file-list">{files.map((f, i) => <FileChip key={i} file={f} onRemove={() => setFiles(files.filter((_, j) => j !== i))} />)}</div>
    </Modal>
  );
}

function DocRow({ d, selected, onSelect, onToggle, onHistory, view }) {
  const toast = useToast();
  const navigate = useNavigate();
  const copyLink = () => {
    navigator.clipboard?.writeText(`${window.location.origin}/office/doc/${d.id}`);
    toast('Đã sao chép liên kết');
  };
  const title = (
    <Link to={`/office/doc/${d.id}`} className={cx('doc-title', !d.viewed && d.status === 'issued' && 'unread')}>
      {d.code && <span className="doc-code">[{d.code}]</span>} {d.title}
    </Link>
  );
  const actions = (
    <div className="split-btn">
      <button className="btn btn-sm" onClick={() => navigate(`/office/doc/${d.id}`)}>Chi tiết</button>
      <Dropdown align="right" trigger={(o, t) => <button className="btn btn-sm" onClick={t} aria-label="Thêm"><ChevronDown size={14} /></button>}>
        <MenuItem icon={FileText} onClick={() => navigate(`/office/doc/${d.id}`)}>Xem văn bản</MenuItem>
        <MenuItem icon={History} onClick={() => onHistory(d.id)}>Lịch sử hoạt động</MenuItem>
        <MenuItem icon={Link2} onClick={copyLink}>Sao chép liên kết</MenuItem>
        <MenuItem icon={Bookmark} onClick={() => onToggle(d, 'star')}>{d.starred ? 'Bỏ đánh dấu' : 'Đánh dấu'}</MenuItem>
      </Dropdown>
    </div>
  );
  if (view === 'table') {
    return (
      <tr className={cx(selected && 'selected')}>
        <td><input type="checkbox" checked={selected} onChange={() => onSelect(d.id)} /></td>
        <td className="nowrap">{d.code || '—'}</td>
        <td>{title}</td>
        <td><StatusBadge doc={d} /></td>
        <td>{d.type_name}</td>
        <td>{d.issuer_name}</td>
        <td>{d.department_name}</td>
        <td className="nowrap">{fmtDate(d.issued_at || d.created_at)}</td>
        <td className="nowrap">{d.view_count}</td>
        <td>{actions}</td>
      </tr>
    );
  }
  return (
    <div className={cx('doc-row', selected && 'selected', d.is_expired && 'expired', d.following && 'pinned')}>
      <div className="doc-check">
        <input type="checkbox" checked={selected} onChange={() => onSelect(d.id)} aria-label="Chọn" />
        <button className={cx('icon-btn sm', d.starred && 'starred')} onClick={() => onToggle(d, 'star')} title="Yêu thích">
          <Star size={16} fill={d.starred ? 'currentColor' : 'none'} />
        </button>
        <button className={cx('icon-btn sm', d.following && 'following')} onClick={() => onToggle(d, 'follow')} title="Theo dõi">
          <Pin size={16} fill={d.following ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="doc-main">
        <div>{title}{d.description && <span className="doc-desc-inline"> {d.description}</span>}</div>
        <div className="doc-meta"><User size={13} /> Ban hành bởi: <span className="dark">{d.issuer_name || d.creator_name}</span>
          {d.issuer_department_name && <> / <span className="dark">{d.issuer_department_name}</span></>}
        </div>
        {d.attachments?.length > 0 && (
          <div className="doc-meta"><Paperclip size={13} /> {d.attachment_count} tệp đính kèm:
            <FileChip file={d.attachments[0]} href={api.url(`/documents/${d.id}/attachments/${d.attachments[0].id}`)} />
            {d.attachment_count > 1 && <span className="muted">+ {d.attachment_count - 1} tệp khác</span>}
          </div>
        )}
      </div>
      <div className="doc-status">
        <StatusBadge doc={d} />
        {d.expire_date && <div className={cx('small', d.is_expired ? 'text-red' : 'muted')}>Hết hạn: {fmtDate(d.expire_date)}</div>}
      </div>
      <div className="doc-kind">
        <b>{d.type_name || DOC_KINDS[d.kind]}</b>
        <div className="muted">{d.department_name}</div>
      </div>
      <div className="doc-date">
        <div>{fmtDate(d.issued_at || d.created_at)}</div>
        <div className="muted small"><Eye size={12} /> {d.view_count} đã xem</div>
      </div>
      <div className="doc-actions">{actions}</div>
    </div>
  );
}

export default function DocList() {
  const { meta, reloadMeta } = useOutletContext();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const [view, setView] = useState(() => localStorage.getItem('office.view') || 'list');
  const [showFilter, setShowFilter] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [history, setHistory] = useState(null);
  const [selected, setSelected] = useState([]);
  const [moveOpen, setMoveOpen] = useState(false);
  const navigate = useNavigate();

  const query = useMemo(() => Object.fromEntries(params.entries()), [params]);
  const [data, reload, loading] = useFetch(() => api.get('/documents', query), [params.toString()]);
  useEffect(() => setSelected([]), [params]);

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v === null || v === undefined || (Array.isArray(v) && !v.length)) next.delete(k);
      else next.set(k, Array.isArray(v) ? v.join(',') : v);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };

  const toggle = async (d, kind) => {
    await api.post(`/documents/${d.id}/${kind}`);
    reload();
  };
  const bulk = async (action, extra = {}) => {
    const r = await api.post('/documents/bulk', { ids: selected, action, ...extra });
    toast(`Đã cập nhật ${r.affected} văn bản`);
    setSelected([]);
    reload();
    reloadMeta();
  };
  const restore = async (id) => { await api.post(`/documents/${id}/restore`); reload(); };
  const destroy = async (id) => {
    if (!window.confirm('Xóa vĩnh viễn văn bản này? Thao tác không thể hoàn tác.')) return;
    await api.del(`/documents/${id}`, { permanent: 1 });
    reload();
  };
  const setViewMode = (v) => { setView(v); localStorage.setItem('office.view', v); };

  const box = params.get('box');
  const contextTitle = (() => {
    if (box && BOX_TITLES[box]) return BOX_TITLES[box];
    const find = (list, key) => list?.find((x) => String(x.id) === params.get(key))?.name;
    return find(meta?.folders, 'folder_id') || find(meta?.types, 'type_id') || find(meta?.categories, 'category_id')
      || find(meta?.departments, 'department_id') || find(meta?.departments, 'sender_department_id')
      || (params.get('q') ? `Kết quả tìm kiếm "${params.get('q')}"` : null);
  })();
  const filterCount = ['status', 'issuer_id', 'date_from', 'date_to', 'sort'].filter((k) => params.get(k)).length;
  const items = data?.items || [];
  const allSelected = items.length > 0 && selected.length === items.length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Văn bản</h1>
          {contextTitle && (
            <div className="crumb">{contextTitle}
              <button className="icon-btn sm" onClick={() => navigate('/office')} title="Bỏ lọc"><X size={14} /></button>
            </div>
          )}
        </div>
        <div className="page-actions">
          <a className="btn" href={api.url('/documents/export', query)}><FileOutput size={16} /> Xuất văn bản</a>
          {meta?.can_create !== false && <button className="btn" onClick={() => setShowScan(true)}><ScanLine size={16} /> Quét văn bản</button>}
          {meta?.can_create !== false && <Link className="btn btn-success" to="/office/new"><FilePlus2 size={16} /> Tạo văn bản</Link>}
        </div>
      </div>
      <Tabs tabs={TABS} value={params.get('tab') || ''} onChange={(v) => setParam({ tab: v })} className="page-tabs" />

      <div className="toolbar">
        <div className="seg">
          <button className={cx(view === 'list' && 'active')} onClick={() => setViewMode('list')} title="Dạng danh sách"><List size={16} /></button>
          <button className={cx(view === 'table' && 'active')} onClick={() => setViewMode('table')} title="Dạng bảng"><Table2 size={16} /></button>
        </div>
        <button className={cx('btn', filterCount && 'btn-outline-primary')} onClick={() => setShowFilter(true)}>
          <Filter size={15} /> Bộ lọc {filterCount > 0 && <span className="tab-count">{filterCount}</span>}
        </button>
        {selected.length > 0 && (
          <div className="bulk-bar">
            <span>Đã chọn <b>{selected.length}</b></span>
            <button className="btn btn-sm" onClick={() => bulk('read')}><CheckCheck size={14} /> Đánh dấu đã xem</button>
            <button className="btn btn-sm" onClick={() => bulk('star')}><Star size={14} /> Yêu thích</button>
            <button className="btn btn-sm" onClick={() => bulk('follow')}><Pin size={14} /> Theo dõi</button>
            <button className="btn btn-sm" onClick={() => setMoveOpen(true)}><FolderInput size={14} /> Chuyển kho</button>
            <button className="btn btn-sm btn-danger-ghost" onClick={() => window.confirm('Tạm xóa các văn bản đã chọn?') && bulk('delete')}><Trash2 size={14} /> Xóa</button>
          </div>
        )}
      </div>

      {loading && !data ? <Spinner /> : !items.length ? (
        <Empty icon={FileText} title="Không có văn bản nào">Hãy thử thay đổi bộ lọc hoặc tạo văn bản mới.</Empty>
      ) : view === 'table' ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : items.map((d) => d.id))} /></th>
                <th>Số hiệu</th><th>Văn bản</th><th>Trạng thái</th><th>Loại</th><th>Ban hành bởi</th><th>Phòng ban</th><th>Ngày</th><th>Lượt xem</th><th />
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <DocRow key={d.id} d={d} view="table" selected={selected.includes(d.id)}
                  onSelect={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
                  onToggle={toggle} onHistory={setHistory} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="doc-list">
          <div className="doc-head">
            <div className="doc-check"><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : items.map((d) => d.id))} aria-label="Chọn tất cả" /></div>
            <div className="doc-main">Văn bản</div>
            <div className="doc-status">Trạng thái</div>
            <div className="doc-kind">Kiểu</div>
            <div className="doc-date">Ngày</div>
            <div className="doc-actions" />
          </div>
          {items.map((d) => (
            <div key={d.id}>
              <DocRow d={d} selected={selected.includes(d.id)}
                onSelect={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
                onToggle={toggle} onHistory={setHistory} />
              {box === 'trash' && (
                <div className="trash-actions">
                  <button className="btn btn-sm" onClick={() => restore(d.id)}><RotateCcw size={14} /> Khôi phục</button>
                  <button className="btn btn-sm btn-danger-ghost" onClick={() => destroy(d.id)}><Trash2 size={14} /> Xóa vĩnh viễn</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {data && data.total > 0 && <Pagination page={data.page} total={data.total} limit={data.limit} onChange={(p) => setParam({ page: p })} />}

      {showFilter && <FilterModal meta={meta} params={params} onClose={() => setShowFilter(false)}
        onApply={(f) => { setParam(f); setShowFilter(false); }} />}
      {showScan && <ScanModal onClose={() => setShowScan(false)} />}
      {history && <ActivityModal docId={history} onClose={() => setHistory(null)} />}
      {moveOpen && (
        <MoveModal meta={meta} onClose={() => setMoveOpen(false)} onMove={(fid) => { bulk('move', { folder_id: fid }); setMoveOpen(false); }} />
      )}
    </div>
  );
}

function MoveModal({ meta, onClose, onMove }) {
  const [fid, setFid] = useState('');
  return (
    <Modal title="Chuyển vào kho lưu trữ" onClose={onClose} width={420}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" onClick={() => onMove(fid || null)}>Chuyển</button></>}>
      <Field label="Kho lưu trữ">
        <select className="input" value={fid} onChange={(e) => setFid(e.target.value)}>
          <option value="">— Không thuộc kho nào —</option>
          {treeOptions(meta?.folders).map((o) => <option key={o.value} value={o.value}>{'  '.repeat(o.depth)}{o.label}</option>)}
        </select>
      </Field>
    </Modal>
  );
}
