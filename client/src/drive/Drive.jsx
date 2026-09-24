import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  FolderPlus, Upload, Folder, FileText, Search, MoreHorizontal, Pencil, Trash2, Download, Share2, RotateCcw, FolderInput, ChevronRight, X, Eye,
} from 'lucide-react';
import { api, toFormData } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Avatar, Spinner, Empty, Modal, Dropdown, MenuItem, UserPicker } from '../components/ui.jsx';
import { useDebounced } from '../components/shell.jsx';
import { fmtDateTime, fileSize, cx } from '../utils.js';

const TITLES = { personal: 'Tài liệu của tôi', company: 'Tài liệu công ty', shared: 'Được chia sẻ với tôi', recent: 'Gần đây', trash: 'Thùng rác' };

async function upload(files, target) {
  await api.post('/drive/upload', toFormData(target, [...files]));
}

function ShareModal({ item, onClose }) {
  const { users, departments } = useApp();
  const toast = useToast();
  const [shares] = useFetch(() => api.get(`/drive/items/${item.id}/shares`), [item.id]);
  const [list, setList] = useState(null);
  const [groups] = useFetch(() => api.get('/account/groups'), []);
  const rows = list ?? shares;
  const [pick, setPick] = useState({ kind: 'user', id: null, permission: 'view' });
  if (!rows) return <Modal title="Chia sẻ" onClose={onClose}><Spinner /></Modal>;
  const label = (s) => s.user_name || s.department_name || s.group_name
    || users.find((u) => u.id === s.user_id)?.name || departments.find((d) => d.id === s.department_id)?.name
    || (groups || []).find((g) => g.id === s.group_id)?.name;
  const add = () => {
    if (!pick.id) return;
    const key = `${pick.kind}_id`;
    if (rows.some((s) => s[key] === pick.id)) return;
    setList([...rows, { [key]: pick.id, permission: pick.permission }]);
    setPick({ ...pick, id: null });
  };
  const save = async () => {
    try {
      await api.put(`/drive/items/${item.id}/shares`, { shares: rows.map(({ user_id, department_id, group_id, permission }) => ({ user_id, department_id, group_id, permission })) });
      toast('Đã cập nhật chia sẻ'); onClose(true);
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title={`Chia sẻ “${item.name}”`} onClose={() => onClose(false)} width={560}
      footer={<><button className="btn" onClick={() => onClose(false)}>Huỷ</button><button className="btn btn-primary" onClick={save}>Lưu</button></>}>
      <div className="row gap-sm wrap">
        <select className="input" style={{ width: 130 }} value={pick.kind} onChange={(e) => setPick({ ...pick, kind: e.target.value, id: null })}>
          <option value="user">Thành viên</option><option value="department">Phòng ban</option><option value="group">Nhóm</option>
        </select>
        <div className="grow" style={{ minWidth: 180 }}>
          {pick.kind === 'user' ? <UserPicker users={users} value={pick.id} onChange={(id) => setPick({ ...pick, id })} />
            : (
              <select className="input" value={pick.id || ''} onChange={(e) => setPick({ ...pick, id: Number(e.target.value) || null })}>
                <option value="">— Chọn —</option>
                {(pick.kind === 'department' ? departments : groups || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            )}
        </div>
        <select className="input" style={{ width: 120 }} value={pick.permission} onChange={(e) => setPick({ ...pick, permission: e.target.value })}>
          <option value="view">Xem</option><option value="edit">Chỉnh sửa</option>
        </select>
        <button className="btn" onClick={add} disabled={!pick.id}>Thêm</button>
      </div>
      <div className="mt">
        {!rows.length ? <p className="muted">Chưa chia sẻ với ai.</p> : rows.map((s, i) => (
          <div key={i} className="share-row">
            <span className="badge badge-gray">{s.user_id ? 'Thành viên' : s.department_id ? 'Phòng ban' : 'Nhóm'}</span>
            <span className="grow">{label(s)}</span>
            <select className="input input-sm" style={{ width: 120 }} value={s.permission} onChange={(e) => setList(rows.map((x, j) => (j === i ? { ...x, permission: e.target.value } : x)))}>
              <option value="view">Xem</option><option value="edit">Chỉnh sửa</option>
            </select>
            <button className="icon-btn" aria-label="Bỏ chia sẻ" onClick={() => setList(rows.filter((_, j) => j !== i))}><X size={15} /></button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function MoveModal({ item, onClose }) {
  const toast = useToast();
  const [space, setSpace] = useState(item.space);
  const [parent, setParent] = useState(null);
  const [data] = useFetch(() => api.get('/drive/items', parent ? { parent_id: parent.id } : { space }), [space, parent?.id]);
  const [trail, setTrail] = useState([]);
  const open = (f) => { setTrail([...trail, f]); setParent(f); };
  const back = (i) => { const t = trail.slice(0, i); setTrail(t); setParent(t[t.length - 1] || null); };
  const move = async () => {
    try {
      await api.put(`/drive/items/${item.id}`, parent ? { parent_id: parent.id } : { parent_id: null, space });
      toast('Đã di chuyển'); onClose(true);
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title={`Di chuyển “${item.name}”`} onClose={() => onClose(false)} width={520}
      footer={<><button className="btn" onClick={() => onClose(false)}>Huỷ</button><button className="btn btn-primary" onClick={move}>Chuyển đến đây</button></>}>
      <div className="row gap-sm">
        <select className="input" style={{ width: 200 }} value={space} onChange={(e) => { setSpace(e.target.value); setParent(null); setTrail([]); }}>
          <option value="personal">Tài liệu của tôi</option><option value="company">Tài liệu công ty</option>
        </select>
      </div>
      <div className="crumbs mt">
        <button className="link-btn" onClick={() => back(0)}>{TITLES[space]}</button>
        {trail.map((f, i) => <span key={f.id}><ChevronRight size={13} /><button className="link-btn" onClick={() => back(i + 1)}>{f.name}</button></span>)}
      </div>
      <div className="move-list">
        {!data ? <Spinner /> : data.items.filter((x) => x.kind === 'folder' && x.id !== item.id).map((f) => (
          <button key={f.id} className="drive-row plain" onClick={() => open(f)}><Folder size={18} className="text-blue" /> {f.name}</button>
        ))}
        {data && !data.items.some((x) => x.kind === 'folder' && x.id !== item.id) && <p className="muted small">Không có thư mục con</p>}
      </div>
    </Modal>
  );
}

export default function DrivePage() {
  const { space: spaceParam, folderId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useApp();
  const space = folderId ? null : spaceParam || 'personal';
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [data, reload, loading, error] = useFetch(
    () => api.get('/drive/items', folderId ? { parent_id: folderId, q: dq } : { space, q: dq }), [space, folderId, dq],
  );
  const [modal, setModal] = useState(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef();
  if (!TITLES[space] && !folderId) return <div className="page"><Empty title="Không gian không tồn tại" /></div>;
  const canCreate = data?.perm === 'edit' && (folderId || space === 'personal' || space === 'company');
  const target = folderId ? { parent_id: folderId } : { space };
  const doUpload = async (files) => {
    if (!files?.length) return;
    try { await upload(files, target); toast(`Đã tải lên ${files.length} tệp`); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const newFolder = async () => {
    const name = window.prompt('Tên thư mục mới');
    if (!name) return;
    try { await api.post('/drive/folders', { name, ...target }); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const rename = async (it) => {
    const name = window.prompt('Tên mới', it.name);
    if (!name || name === it.name) return;
    try { await api.put(`/drive/items/${it.id}`, { name }); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (it, permanent) => {
    if (!window.confirm(permanent ? `Xoá vĩnh viễn “${it.name}”? Không thể khôi phục.` : `Chuyển “${it.name}” vào thùng rác?`)) return;
    try { await api.del(`/drive/items/${it.id}`, permanent ? { permanent: 1 } : undefined); toast(permanent ? 'Đã xoá vĩnh viễn' : 'Đã chuyển vào thùng rác'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const restore = async (it) => {
    try { await api.post(`/drive/items/${it.id}/restore`); toast('Đã khôi phục'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const openItem = (it) => {
    if (space === 'trash') return;
    if (it.kind === 'folder') navigate(`/drive/folder/${it.id}`);
    else window.open(api.url(`/drive/items/${it.id}/download`, { inline: 1 }), '_blank', 'noopener');
  };
  const rootSpace = data?.breadcrumb?.[0]?.space;
  const isOwner = (it) => it.owner_id === user.id || user.role === 'admin';
  return (
    <div className={cx('page drive', drag && 'dragging')}
      onDragOver={(e) => { if (canCreate) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (canCreate) doUpload(e.dataTransfer.files); }}>
      <div className="page-head">
        <div>
          {folderId ? (
            <div className="crumbs">
              <Link to={rootSpace === 'company' ? '/drive/company' : '/drive'}>{TITLES[rootSpace] || 'Drive'}</Link>
              {data?.breadcrumb.map((b, i) => (
                <span key={b.id}><ChevronRight size={14} />{i === data.breadcrumb.length - 1 ? <b>{b.name}</b> : <Link to={`/drive/folder/${b.id}`}>{b.name}</Link>}</span>
              ))}
            </div>
          ) : <h1>{TITLES[space]}</h1>}
        </div>
        {canCreate && (
          <div className="row gap-sm">
            <button className="btn" onClick={newFolder}><FolderPlus size={15} /> Thư mục mới</button>
            <button className="btn btn-primary" onClick={() => fileRef.current.click()}><Upload size={15} /> Tải lên</button>
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => { doUpload(e.target.files); e.target.value = ''; }} />
          </div>
        )}
      </div>
      <div className="toolbar">
        <div className="ww-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm trong thư mục này" /></div>
        {data?.usage && <small className="muted">Bạn đang lưu {data.usage.files} tệp · {fileSize(data.usage.bytes)}</small>}
      </div>
      {error ? <div className="alert alert-error">{error.message}</div> : loading && !data ? <Spinner /> : !data.items.length ? (
        <Empty icon={space === 'trash' ? Trash2 : Folder} title={space === 'trash' ? 'Thùng rác trống' : 'Chưa có tài liệu'}>
          {canCreate && <p className="muted">Kéo thả tệp vào đây hoặc bấm “Tải lên”.</p>}
        </Empty>
      ) : (
        <div className="table-wrap"><table className="table drive-table">
          <thead><tr><th>Tên</th><th>Chủ sở hữu</th><th>Cập nhật</th><th>Kích thước</th><th style={{ width: 44 }} /></tr></thead>
          <tbody>{data.items.map((it) => (
            <tr key={it.id} className={cx(space !== 'trash' && 'clickable')} onDoubleClick={() => openItem(it)}>
              <td onClick={() => openItem(it)}>
                <span className="row gap-sm">
                  {it.kind === 'folder' ? <Folder size={20} className="text-blue" fill="currentColor" fillOpacity={0.15} /> : <FileText size={20} className="muted" />}
                  <span className="ellipsis">{it.name}</span>
                  {it.share_count > 0 && <Share2 size={13} className="muted" title="Đã chia sẻ" />}
                </span>
              </td>
              <td><span className="row gap-sm"><Avatar name={it.owner_name || '?'} color={it.owner_color} size={22} /><small>{it.owner_id === user.id ? 'Tôi' : it.owner_name}</small></span></td>
              <td><small>{fmtDateTime(space === 'trash' ? it.deleted_at : it.updated_at)}</small></td>
              <td><small>{it.kind === 'folder' ? `${it.child_count} mục` : fileSize(it.size)}</small></td>
              <td onClick={(e) => e.stopPropagation()}>
                <Dropdown align="right" trigger={(open, toggle) => <button className="icon-btn" aria-label="Thao tác" onClick={toggle}><MoreHorizontal size={16} /></button>}>
                  {space === 'trash' ? (
                    <>
                      <MenuItem icon={RotateCcw} onClick={() => restore(it)}>Khôi phục</MenuItem>
                      <MenuItem icon={Trash2} danger onClick={() => remove(it, true)}>Xoá vĩnh viễn</MenuItem>
                    </>
                  ) : (
                    <>
                      {it.kind === 'file' && <MenuItem icon={Eye} onClick={() => openItem(it)}>Xem</MenuItem>}
                      {it.kind === 'file' && <MenuItem icon={Download} onClick={() => { window.location.href = api.url(`/drive/items/${it.id}/download`); }}>Tải xuống</MenuItem>}
                      {isOwner(it) && <MenuItem icon={Pencil} onClick={() => rename(it)}>Đổi tên</MenuItem>}
                      {isOwner(it) && <MenuItem icon={FolderInput} onClick={() => setModal({ type: 'move', item: it })}>Di chuyển</MenuItem>}
                      {isOwner(it) && it.space === 'personal' && <MenuItem icon={Share2} onClick={() => setModal({ type: 'share', item: it })}>Chia sẻ</MenuItem>}
                      {isOwner(it) && <MenuItem icon={Trash2} danger onClick={() => remove(it)}>Chuyển vào thùng rác</MenuItem>}
                    </>
                  )}
                </Dropdown>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {drag && <div className="drop-hint"><Upload size={32} /> Thả tệp để tải lên</div>}
      {modal?.type === 'share' && <ShareModal item={modal.item} onClose={(ok) => { setModal(null); if (ok) reload(); }} />}
      {modal?.type === 'move' && <MoveModal item={modal.item} onClose={(ok) => { setModal(null); if (ok) reload(); }} />}
    </div>
  );
}
