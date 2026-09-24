import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Pencil, Trash2, Plus } from 'lucide-react';
import { api } from '../api.js';
import { useToast } from '../context.jsx';
import { Tabs, Modal, Field } from '../components/ui.jsx';
import { treeOptions } from './DocList.jsx';

const KINDS = {
  types: { label: 'Loại văn bản', noun: 'loại văn bản' },
  folders: { label: 'Kho lưu trữ', noun: 'kho lưu trữ' },
  categories: { label: 'Cây thư mục', noun: 'thư mục' },
};

export default function OfficeSettings() {
  const { meta, reloadMeta } = useOutletContext();
  const toast = useToast();
  const [tab, setTab] = useState('types');
  const [edit, setEdit] = useState(null);
  if (!meta) return null;
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
        <h1>Tùy chỉnh Văn bản</h1>
        <button className="btn btn-primary" onClick={() => setEdit({ name: '', prefix: '', parent_id: '' })}><Plus size={15} /> Thêm {KINDS[tab].noun}</button>
      </div>
      <Tabs tabs={Object.entries(KINDS).map(([value, k]) => ({ value, label: k.label }))} value={tab} onChange={setTab} className="page-tabs" />
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
