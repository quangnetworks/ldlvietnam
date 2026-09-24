import { useState } from 'react';
import { Plus, Pencil, Trash2, Send, CheckCircle2, XCircle, Copy } from 'lucide-react';
import { api } from '../api.js';
import { useFetch, useToast } from '../context.jsx';
import { Modal, Field, Spinner, Empty, Pagination } from '../components/ui.jsx';
import { fmtDateTime, cx } from '../utils.js';
import { useRequestApp } from './RequestLayout.jsx';

function HookModal({ hook, events, onClose, onSaved }) {
  const { groups } = useRequestApp();
  const toast = useToast();
  const [f, setF] = useState(hook ? { ...hook, group_id: hook.group_id || '' } : { name: '', url: 'https://', events: ['request.approved'], group_id: '', active: true });
  const toggle = (e) => setF({ ...f, events: f.events.includes(e) ? f.events.filter((x) => x !== e) : [...f.events, e] });
  const save = async () => {
    try {
      if (hook) await api.put(`/webhooks/${hook.id}`, f);
      else await api.post('/webhooks', f);
      toast('Đã lưu webhook');
      onSaved();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title={hook ? 'Sửa webhook' : 'Tạo webhook'} onClose={onClose} width={600}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" onClick={save}>Lưu</button></>}>
      <div className="form-grid one">
        <Field label="Tên" required><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="VD: Đồng bộ ERP kế toán" /></Field>
        <Field label="URL nhận (https)" required><input className="input mono" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
        <Field label="Áp dụng cho nhóm đề xuất">
          <select className="input" value={f.group_id} onChange={(e) => setF({ ...f, group_id: e.target.value })}>
            <option value="">Tất cả nhóm đề xuất</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
        <div>
          <span className="field-label">Sự kiện</span>
          <div className="app-checks">
            {Object.entries(events).map(([k, l]) => (
              <label key={k} className={cx('app-check', f.events.includes(k) && 'on')}><input type="checkbox" checked={f.events.includes(k)} onChange={() => toggle(k)} /> {l}</label>
            ))}
          </div>
        </div>
        <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Đang hoạt động</label>
      </div>
    </Modal>
  );
}

export function WebhooksPage() {
  const toast = useToast();
  const [data, reload] = useFetch(() => api.get('/webhooks'), []);
  const [page, setPage] = useState(1);
  const [logs, reloadLogs] = useFetch(() => api.get('/webhooks/logs', { page }), [page]);
  const [edit, setEdit] = useState(null);
  if (!data) return <div className="rq-page"><Spinner /></div>;
  const test = async (h) => {
    const r = await api.post(`/webhooks/${h.id}/test`);
    toast(r.error ? `Gửi thử lỗi: ${r.status || ''} ${r.error}` : `Gửi thử thành công (HTTP ${r.status})`, r.error ? 'error' : 'success');
    reload(); reloadLogs();
  };
  return (
    <div className="rq-page">
      <div className="rq-head"><div className="grow"><h1>Webhook</h1>
        <p className="muted">Tự động gửi dữ liệu đề xuất (JSON) sang hệ thống khác khi có sự kiện. Mỗi yêu cầu có header <code>X-LDL-Event</code> và chữ ký <code>X-LDL-Signature: sha256=HMAC(secret, body)</code>.</p></div>
        <button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={15} /> Tạo webhook</button>
      </div>
      {!data.items.length ? <Empty title="Chưa có webhook nào" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Tên</th><th>URL</th><th>Sự kiện</th><th>Đã gửi</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>{data.items.map((h) => (
            <tr key={h.id}>
              <td><b>{h.name}</b><small className="muted block">{h.group_name || 'Tất cả nhóm'}</small></td>
              <td className="mono small">{h.url}
                <button className="icon-btn sm" title="Sao chép secret" onClick={() => { navigator.clipboard?.writeText(h.secret); toast('Đã sao chép secret'); }}><Copy size={13} /></button></td>
              <td className="small">{h.events.map((e) => data.events[e]).join(', ')}</td>
              <td>{h.sent} {h.failed > 0 && <span className="text-red small">({h.failed} lỗi)</span>}</td>
              <td>{h.active ? <span className="text-green">Hoạt động</span> : <span className="muted">Tạm dừng</span>}</td>
              <td className="nowrap">
                <button className="icon-btn sm" title="Gửi thử" onClick={() => test(h)}><Send size={15} /></button>
                <button className="icon-btn sm" title="Sửa" onClick={() => setEdit(h)}><Pencil size={15} /></button>
                <button className="icon-btn sm" title="Xoá" onClick={async () => { if (window.confirm(`Xoá webhook ${h.name}?`)) { await api.del(`/webhooks/${h.id}`); reload(); } }}><Trash2 size={15} /></button>
              </td>
            </tr>))}</tbody>
        </table></div>
      )}
      <h3 className="card-title mt">Lịch sử webhook</h3>
      {logs && (logs.items.length ? (
        <>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Thời gian</th><th>Webhook</th><th>Sự kiện</th><th>Đề xuất</th><th>Kết quả</th><th>Thời gian phản hồi</th></tr></thead>
            <tbody>{logs.items.map((l) => (
              <tr key={l.id}>
                <td className="nowrap">{fmtDateTime(l.created_at)}</td><td>{l.webhook_name}</td><td className="mono small">{l.event}</td>
                <td>{l.request_id ? `#${l.request_id}` : '—'}</td>
                <td>{l.ok ? <span className="text-green"><CheckCircle2 size={13} /> {l.status_code}</span> : <span className="text-red" title={l.error}><XCircle size={13} /> {l.status_code || 'lỗi'} {l.error?.slice(0, 60)}</span>}</td>
                <td>{l.duration_ms} ms</td>
              </tr>))}</tbody>
          </table></div>
          <Pagination page={logs.page} total={logs.total} limit={logs.limit} onChange={setPage} />
        </>
      ) : <Empty title="Chưa gửi webhook nào" />)}
      {edit && <HookModal hook={edit.id ? edit : null} events={data.events} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}
