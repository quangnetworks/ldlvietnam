/**
 * Công cụ quản trị nhóm đề xuất (theo Base Request): cài đặt SLA / quy trình hàng loạt, thay thế người duyệt,
 * nhập nhóm từ Excel (kèm file mẫu), xuất / nhập thiết lập JSON.
 */
import { useState } from 'react';
import { ChevronDown, Clock, UserCog, FileSpreadsheet, FileJson, Download, Upload, Workflow } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useToast } from '../context.jsx';
import { Dropdown, MenuItem, Modal, Field, UserPicker } from '../components/ui.jsx';
import { readSheetFile, rowsToObjects, downloadBlob, downloadCsv } from '../sheet.js';
import { FLOWS } from './fields.jsx';

const EXCEL_COLUMNS = [
  ['name', 'Tên nhóm đề xuất', 'Tên nhóm'], ['category', 'Danh mục'], ['description', 'Mô tả'], ['flow', 'Quy trình', 'Quy trình xử lý'],
  ['sla', 'SLA (giờ)', 'SLA', 'Thời hạn'], ['approvers', 'Người duyệt', 'Người xét duyệt'], ['followers', 'Người theo dõi'],
];

export function GroupTools({ selected, groups, onDone }) {
  const [modal, setModal] = useState(null);
  const toast = useToast();
  const targets = selected.length ? selected : groups.map((g) => g.id);
  const exportJson = async () => {
    try {
      const data = await api.get('/request-groups/export', { ids: selected });
      downloadBlob(`thiet-lap-nhom-de-xuat-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      toast(`Đã xuất thiết lập ${data.groups.length} nhóm đề xuất`);
    } catch (e) { toast(e.message, 'error'); }
  };
  const template = () => downloadCsv('mau-nhap-nhom-de-xuat', EXCEL_COLUMNS.map((c) => c[1]), [
    ['Đề xuất mua văn phòng phẩm', 'HÀNH CHÍNH', 'Cấp văn phòng phẩm hằng tháng', 'Chỉ cần một người duyệt', '24', 'chilan, hoangcong', 'thuhuyen'],
    ['Đề nghị thanh toán hợp đồng', 'TÀI CHÍNH', '', 'Duyệt lần lượt', '48', 'thuhuyen, giamdoc', ''],
    ['Đề xuất tuyển dụng', 'NHÂN SỰ', '', 'Duyệt đồng thời', '', 'chilan, giamdoc', ''],
  ]);
  return (
    <>
      <Dropdown align="right" width={270} trigger={(o, t) => <button className="btn" onClick={t}>Công cụ <ChevronDown size={14} /></button>}>
        {(close) => {
          const open = (m) => () => { close(); setModal(m); };
          return (
            <>
              <MenuItem icon={Clock} onClick={open('sla')}>Cài đặt SLA{selected.length ? ` (${selected.length} nhóm)` : ''}</MenuItem>
              <MenuItem icon={Workflow} onClick={open('flow')}>Đổi quy trình xử lý{selected.length ? ` (${selected.length} nhóm)` : ''}</MenuItem>
              <MenuItem icon={UserCog} onClick={open('replace')}>Thay thế người duyệt</MenuItem>
              <MenuItem icon={FileSpreadsheet} onClick={open('excel')}>Nhập nhóm đề xuất từ Excel</MenuItem>
              <MenuItem icon={Download} onClick={() => { close(); template(); }}>Tải xuống file Excel mẫu</MenuItem>
              <MenuItem icon={FileJson} onClick={() => { close(); exportJson(); }}>Xuất thiết lập ra JSON{selected.length ? ` (${selected.length} nhóm)` : ''}</MenuItem>
              <MenuItem icon={Upload} onClick={open('json')}>Nhập thiết lập từ JSON</MenuItem>
            </>
          );
        }}
      </Dropdown>
      {(modal === 'sla' || modal === 'flow') && <BulkModal kind={modal} ids={targets} all={!selected.length} onClose={() => setModal(null)} onDone={onDone} />}
      {modal === 'replace' && <ReplaceModal onClose={() => setModal(null)} onDone={onDone} />}
      {(modal === 'excel' || modal === 'json') && <ImportModal kind={modal} onClose={() => setModal(null)} onDone={onDone} onTemplate={template} />}
    </>
  );
}

function BulkModal({ kind, ids, all, onClose, onDone }) {
  const toast = useToast();
  const [sla, setSla] = useState('');
  const [flow, setFlow] = useState('sequential');
  const apply = async () => {
    try {
      const r = await api.post('/request-groups/bulk', kind === 'sla' ? { ids, action: 'sla', sla_hours: sla } : { ids, action: 'flow', flow });
      toast(`Đã cập nhật ${r.affected} nhóm đề xuất`);
      onClose(); onDone();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title={kind === 'sla' ? 'Cài đặt SLA' : 'Đổi quy trình xử lý'} onClose={onClose} width={460}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" onClick={apply}>Áp dụng cho {ids.length} nhóm</button></>}>
      <p className="muted small">{all ? 'Chưa chọn nhóm nào: áp dụng cho tất cả nhóm đang hiển thị.' : `Áp dụng cho ${ids.length} nhóm đã chọn.`}</p>
      {kind === 'sla' ? (
        <Field label="Thời hạn (SLA, giờ)" hint="Số giờ quy định để xử lý đề xuất. Để trống nếu không có yêu cầu cụ thể.">
          <input className="input" type="number" min="1" autoFocus value={sla} onChange={(e) => setSla(e.target.value)} placeholder="VD: 24" />
        </Field>
      ) : (
        <Field label="Quy trình xử lý" hint="Nhóm theo khối người duyệt sẽ chuyển về danh sách người duyệt theo thứ tự">
          <select className="input" value={flow} onChange={(e) => setFlow(e.target.value)}>
            {FLOWS.filter((f) => f.value !== 'blocks').map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </Field>
      )}
    </Modal>
  );
}

function ReplaceModal({ onClose, onDone }) {
  const { users } = useApp();
  const toast = useToast();
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [pending, setPending] = useState(true);
  const apply = async () => {
    try {
      const r = await api.post('/request-groups/replace-approver', { from_id: from, to_id: to, pending });
      toast(`Đã thay trong ${r.groups} nhóm${pending ? ` và ${r.requests} đề xuất đang chờ` : ''}`);
      onClose(); onDone();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title="Thay thế người duyệt" onClose={onClose} width={500}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" disabled={!from || !to || from === to} onClick={apply}>Thay thế</button></>}>
      <p className="muted small">Dùng khi nhân sự nghỉ việc, nghỉ dài ngày hoặc đổi vị trí: chuyển vai trò người duyệt, người duyệt cuối và người theo dõi
        trong mọi nhóm đề xuất sang người mới.</p>
      <Field label="Người cần thay"><UserPicker users={users} value={from} onChange={setFrom} placeholder="Chọn người" /></Field>
      <Field label="Người thay thế"><UserPicker users={users} value={to} onChange={setTo} exclude={from ? [from] : []} placeholder="Chọn người" /></Field>
      <label className="check"><input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} /> Chuyển luôn các đề xuất đang chờ người cũ duyệt</label>
    </Modal>
  );
}

function ImportModal({ kind, onClose, onDone, onTemplate }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file) => {
    if (!file) return;
    setResult(null);
    try {
      if (kind === 'json') {
        const data = JSON.parse(await file.text());
        setRows(Array.isArray(data) ? data : data.groups || []);
      } else setRows(rowsToObjects(await readSheetFile(file), EXCEL_COLUMNS).filter((r) => r.name));
    } catch (e) { toast(e.message.includes('JSON') ? 'Tệp JSON không hợp lệ' : e.message, 'error'); }
  };
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.post('/request-groups/import', { groups: rows });
      setResult(r);
      if (r.created.length) { toast(`Đã tạo ${r.created.length} nhóm đề xuất`); onDone(); }
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title={kind === 'json' ? 'Nhập thiết lập từ JSON' : 'Nhập nhóm đề xuất từ Excel'} onClose={onClose} width={620}
      footer={<><button className="btn" onClick={onClose}>Đóng</button>
        <button className="btn btn-primary" disabled={!rows?.length || busy || !!result} onClick={run}>Tạo {rows?.length || 0} nhóm đề xuất</button></>}>
      {kind === 'excel' ? (
        <p className="muted small">Mỗi dòng một nhóm đề xuất: Tên nhóm, Danh mục, Mô tả, Quy trình (Duyệt đồng thời / Duyệt lần lượt / Chỉ cần một người duyệt),
          SLA (giờ), Người duyệt và Người theo dõi (tên đăng nhập, cách nhau bởi dấu phẩy). Biểu mẫu mặc định có trường “Nội dung”, chỉnh thêm sau khi nhập.
          <button className="link-btn" onClick={onTemplate}><Download size={13} /> Tải file mẫu</button></p>
      ) : <p className="muted small">Chọn tệp .json được xuất từ “Xuất thiết lập ra JSON” (LDL Request) để tạo lại các nhóm đề xuất, kể cả biểu mẫu, quy trình và người duyệt.</p>}
      <input type="file" className="input" accept={kind === 'json' ? '.json,application/json' : '.xlsx,.csv'} onChange={(e) => pick(e.target.files[0])} />
      {rows && !result && (
        <div className="table-wrap mt"><table className="table">
          <thead><tr><th>Tên nhóm</th><th>Danh mục</th><th>Quy trình</th><th>SLA</th><th>Người duyệt</th></tr></thead>
          <tbody>{rows.slice(0, 50).map((r, i) => (
            <tr key={i}><td>{r.name}</td><td>{r.category || 'Chung'}</td><td>{FLOWS.find((f) => f.value === r.flow)?.label || r.flow || 'Duyệt lần lượt'}</td>
              <td>{r.sla ?? r.sla_hours ?? ''}</td>
              <td>{Array.isArray(r.approvers) ? r.approvers.map((a) => a.username || a).join(', ') : r.approvers}</td></tr>
          ))}</tbody>
        </table>{rows.length > 50 && <small className="muted">… và {rows.length - 50} dòng khác</small>}</div>
      )}
      {rows && !rows.length && <p className="text-red small">Không tìm thấy dòng dữ liệu nào.</p>}
      {result && (
        <div className="mt">
          <p className="text-green">Đã tạo {result.created.length} nhóm đề xuất.</p>
          {result.errors.length > 0 && <ul className="small text-red">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      )}
    </Modal>
  );
}
