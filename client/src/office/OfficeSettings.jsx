import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Pencil, Trash2, Plus } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Tabs, Modal, Field, UserPicker, MultiSelect, Spinner } from '../components/ui.jsx';
import { treeOptions } from './DocList.jsx';

function GeneralSettings() {
  const { users, departments } = useApp();
  const toast = useToast();
  const [data] = useFetch(() => api.get('/office/settings'), []);
  const [groups] = useFetch(() => api.get('/account/groups'), []);
  const [f, setF] = useState(null);
  useEffect(() => { if (data) setF(data); }, [data]);
  if (!f) return <Spinner />;
  const set = (k) => (v) => setF({ ...f, [k]: v?.target ? v.target.value : v });
  const year = new Date().getFullYear();
  const example = f.code_format.replaceAll('{seq}', '1'.padStart(Number(f.seq_digits) || 3, '0')).replaceAll('{year}', year)
    .replaceAll('{month}', String(new Date().getMonth() + 1).padStart(2, '0')).replaceAll('{prefix}', 'QĐ').replaceAll('{dept}', 'HCNS');
  const save = async () => {
    try {
      setF(await api.put('/office/settings', f));
      toast('Đã lưu cài đặt Base Office');
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="settings-grid">
      <div className="card">
        <h3 className="card-title">Quyền tạo văn bản</h3>
        <label className="check"><input type="radio" checked={f.create_mode === 'all'} onChange={() => setF({ ...f, create_mode: 'all' })} /> Tất cả thành viên được tạo văn bản</label>
        <label className="check mt"><input type="radio" checked={f.create_mode === 'restricted'} onChange={() => setF({ ...f, create_mode: 'restricted' })} /> Chỉ những người / nhóm / phòng ban được chọn</label>
        {f.create_mode === 'restricted' && (
          <div className="form-grid one mt">
            <Field label="Thành viên"><UserPicker users={users} multiple value={f.creator_users} onChange={set('creator_users')} placeholder="Chọn thành viên" /></Field>
            <Field label="Nhóm người dùng"><MultiSelect options={(groups || []).map((g) => ({ value: g.id, label: g.name }))} value={f.creator_groups} onChange={set('creator_groups')} placeholder="Chọn nhóm" /></Field>
            <Field label="Phòng ban"><MultiSelect options={departments.map((d) => ({ value: d.id, label: d.name }))} value={f.creator_departments} onChange={set('creator_departments')} placeholder="Chọn phòng ban" /></Field>
          </div>
        )}
        <h3 className="card-title">Văn thư</h3>
        <Field label="Người được cấp số văn bản" hint="Văn thư thấy mục 'Duyệt cấp số văn bản' và cấp số cho mọi văn bản. Quản trị viên luôn có quyền này.">
          <UserPicker users={users} multiple value={f.clerks} onChange={set('clerks')} placeholder="Chọn văn thư" />
        </Field>
      </div>
      <div className="card">
        <h3 className="card-title">Số hiệu văn bản</h3>
        <Field label="Mẫu số hiệu" hint="Biến: {seq} số thứ tự · {year} năm · {month} tháng · {prefix} ký hiệu loại văn bản · {dept} mã phòng ban">
          <input className="input mono" value={f.code_format} onChange={set('code_format')} />
        </Field>
        <Field label="Số chữ số của {seq}"><input type="number" min="1" max="6" className="input" value={f.seq_digits} onChange={set('seq_digits')} /></Field>
        <p className="muted small">Ví dụ: <b>{example}</b> — số thứ tự đếm lại theo từng năm và từng loại văn bản.</p>
        <h3 className="card-title">Hiệu lực mặc định</h3>
        <Field label="Số ngày hết hạn mặc định" hint="Để trống nếu văn bản không tự hết hạn">
          <input type="number" min="1" className="input" value={f.default_expire_days || ''} onChange={set('default_expire_days')} />
        </Field>
        <button className="btn btn-primary mt" onClick={save}>Lưu cài đặt</button>
      </div>
    </div>
  );
}

const KINDS = {
  types: { label: 'Loại văn bản', noun: 'loại văn bản' },
  folders: { label: 'Kho lưu trữ', noun: 'kho lưu trữ' },
  categories: { label: 'Cây thư mục', noun: 'thư mục' },
};

export default function OfficeSettings() {
  const { meta, reloadMeta } = useOutletContext();
  const toast = useToast();
  const [tab, setTab] = useState('general');
  const [edit, setEdit] = useState(null);
  if (!meta) return null;
  if (tab === 'general') {
    return (
      <div className="page">
        <div className="page-head"><h1>Cài đặt Base Office</h1></div>
        <Tabs tabs={[{ value: 'general', label: 'Chung' }, ...Object.entries(KINDS).map(([value, k]) => ({ value, label: k.label }))]} value={tab} onChange={setTab} className="page-tabs" />
        <GeneralSettings />
      </div>
    );
  }
  const items = meta[tab];
  const options = tab === 'types' ? items.map((t) => ({ value: t.id, label: t.name, depth: 0, item: t }))
    : treeOptions(items).map((o) => ({ ...o, item: items.find((x) => x.id === o.value) }));

  const save = async () => {
    try {
      if (edit.id) await api.put(`/office/${tab}/${edit.id}`, edit);
      else await api.post(`/office/${tab}`, edit);
      toast('Đã lưu');
      setEdit(null);
      reloadMeta();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const remove = async (item) => {
    if (!window.confirm(`Xóa "${item.name}"? Các văn bản liên quan sẽ không bị xóa.`)) return;
    await api.del(`/office/${tab}/${item.id}`);
    reloadMeta();
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Cài đặt Base Office</h1>
        <button className="btn btn-primary" onClick={() => setEdit({ name: '', prefix: '', parent_id: '' })}><Plus size={15} /> Thêm {KINDS[tab].noun}</button>
      </div>
      <Tabs tabs={[{ value: 'general', label: 'Chung' }, ...Object.entries(KINDS).map(([value, k]) => ({ value, label: k.label }))]} value={tab} onChange={setTab} className="page-tabs" />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Tên</th>{tab === 'types' && <th>Ký hiệu</th>}<th style={{ width: 100 }} /></tr></thead>
          <tbody>
            {options.map((o) => (
              <tr key={o.value}>
                <td style={{ paddingLeft: 12 + o.depth * 22 }}>{o.label}</td>
                {tab === 'types' && <td>{o.item.prefix}</td>}
                <td className="nowrap">
                  <button className="icon-btn sm" onClick={() => setEdit({ ...o.item, parent_id: o.item.parent_id || '' })} aria-label="Sửa"><Pencil size={15} /></button>
                  <button className="icon-btn sm" onClick={() => remove(o.item)} aria-label="Xóa"><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal title={`${edit.id ? 'Sửa' : 'Thêm'} ${KINDS[tab].noun}`} onClose={() => setEdit(null)} width={440}
          footer={<><button className="btn" onClick={() => setEdit(null)}>Hủy</button><button className="btn btn-primary" onClick={save}>Lưu</button></>}>
          <div className="form-grid one">
            <Field label="Tên" required><input className="input" autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            {tab === 'types' ? (
              <Field label="Ký hiệu (dùng khi cấp số)"><input className="input" value={edit.prefix || ''} onChange={(e) => setEdit({ ...edit, prefix: e.target.value })} /></Field>
            ) : (
              <Field label="Thuộc">
                <select className="input" value={edit.parent_id} onChange={(e) => setEdit({ ...edit, parent_id: e.target.value })}>
                  <option value="">— Cấp gốc —</option>
                  {treeOptions(items).filter((o) => o.value !== edit.id).map((o) => (
                    <option key={o.value} value={o.value}>{'   '.repeat(o.depth)}{o.label}</option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
