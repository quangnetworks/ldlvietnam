import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Save } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Avatar, Spinner, Field, Empty, FilterSelect } from '../components/ui.jsx';
import { fmtDate, cx } from '../utils.js';
import { MonthNav, vnMonth } from './Checkin.jsx';

const REQ_STATUS = { approved: ['Đã duyệt', 'badge-green'], pending: ['Chờ duyệt', 'badge-orange'] };

export function TimeoffHome() {
  const { user, users } = useApp();
  const [params] = useSearchParams();
  const uid = Number(params.get('user_id')) || user.id;
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, , loading, error] = useFetch(() => api.get('/timeoff/summary', { user_id: uid, year }), [uid, year]);
  const other = uid !== user.id ? users.find((u) => u.id === uid) : null;
  if (error) return <div className="page"><div className="alert alert-error">{error.message}</div></div>;
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="row gap-sm">{other && <Avatar name={other.name} color={other.color} size={32} />}{other ? `Nghỉ phép · ${other.name}` : 'Nghỉ phép của tôi'}</h1>
        <div className="row gap-sm">
          <FilterSelect value={year} onChange={setYear} options={[0, 1, 2].map((i) => ({ value: new Date().getFullYear() - i, label: `Năm ${new Date().getFullYear() - i}` }))} />
          {!other && data?.group_id && <Link className="btn btn-primary" to={`/request/new?group_id=${data.group_id}`}><Plus size={15} /> Tạo đơn nghỉ phép</Link>}
        </div>
      </div>
      {loading && !data ? <Spinner /> : (
        <>
          {!data.group_id && <div className="alert alert-info">Chưa cấu hình nhóm đề xuất nghỉ phép. Quản trị viên vào “Quỹ phép nhân viên” để chọn.</div>}
          <div className="stat-row">
            <div className="stat-tile"><div className="stat-label">Phép năm {data.year}</div><div className="stat-value">{data.quota}</div></div>
            <div className="stat-tile"><div className="stat-label">Đã sử dụng</div><div className="stat-value text-orange">{data.used}</div></div>
            <div className="stat-tile"><div className="stat-label">Đang chờ duyệt</div><div className="stat-value">{data.pending}</div></div>
            <div className="stat-tile"><div className="stat-label">Còn lại</div><div className={cx('stat-value', data.remaining < 0 ? 'text-red' : 'text-green')}>{data.remaining}</div></div>
          </div>
          <div className="card">
            <h3 className="card-title">Lịch sử nghỉ</h3>
            {!data.records.length ? <Empty title="Chưa có đơn nghỉ nào trong năm" /> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Đơn</th><th>Loại nghỉ</th><th>Từ ngày</th><th>Đến ngày</th><th>Số ngày</th><th>Trạng thái</th></tr></thead>
                <tbody>{data.records.map((r) => (
                  <tr key={r.id}>
                    <td><Link className="link" to={`/request/${r.id}`}>{r.title}</Link>{r.reason && <small className="muted block">{r.reason}</small>}</td>
                    <td>{r.kind}</td><td>{fmtDate(r.from)}</td><td>{fmtDate(r.to)}</td><td>{r.days}</td>
                    <td><span className={cx('badge', REQ_STATUS[r.status]?.[1])}>{REQ_STATUS[r.status]?.[0] || r.status}</span></td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function TimeoffCalendar() {
  const [month, setMonth] = useState(vnMonth());
  const [data, , loading] = useFetch(() => api.get('/timeoff/calendar', { month }), [month]);
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const onDay = (date) => (data?.items || []).filter((x) => x.from <= date && x.to >= date);
  return (
    <div className="page">
      <div className="page-head"><h1>Lịch nghỉ công ty</h1><MonthNav month={month} onChange={setMonth} /></div>
      {loading && !data ? <Spinner /> : (
        <div className="card">
          <div className="cal-grid tall">
            {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((d) => <div key={d} className="cal-head">{d}</div>)}
            {Array.from({ length: pad }).map((_, i) => <div key={`p${i}`} className="cal-cell empty" />)}
            {Array.from({ length: days }).map((_, i) => {
              const date = `${month}-${String(i + 1).padStart(2, '0')}`;
              const list = onDay(date);
              return (
                <div key={date} className="cal-cell">
                  <span className="cal-day">{i + 1}</span>
                  {list.slice(0, 3).map((x) => (
                    <Link key={x.id} to={`/request/${x.id}`} className={cx('cal-chip', x.status === 'pending' && 'pending')} title={`${x.name} · ${x.kind}`}>{x.name}</Link>
                  ))}
                  {list.length > 3 && <small className="muted">+{list.length - 3} người</small>}
                </div>
              );
            })}
          </div>
          <div className="legend"><span><i className="dot ci-leave" /> Đã duyệt</span><span><i className="dot ci-late" /> Chờ duyệt</span></div>
        </div>
      )}
    </div>
  );
}

function TimeoffAdminSettings() {
  const toast = useToast();
  const [st] = useFetch(() => api.get('/timeoff/settings'), []);
  const [groups] = useFetch(() => api.get('/request-groups'), []);
  const [f, setF] = useState(null);
  useEffect(() => { if (st) setF(st); }, [st]);
  if (!f) return null;
  const list = Array.isArray(groups) ? groups : groups?.items || [];
  return (
    <div className="card">
      <h3 className="card-title">Cài đặt LDL Timeoff</h3>
      <div className="form-grid three">
        <Field label="Nhóm đề xuất nghỉ phép">
          <select className="input" value={f.group_id || ''} onChange={(e) => setF({ ...f, group_id: Number(e.target.value) || null })}>
            <option value="">—</option>
            {list.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
        <Field label="Số ngày phép năm mặc định"><input className="input" type="number" min={0} max={365} value={f.annual_days} onChange={(e) => setF({ ...f, annual_days: e.target.value })} /></Field>
        <Field label=" "><label className="check"><input type="checkbox" checked={f.count_saturday} onChange={(e) => setF({ ...f, count_saturday: e.target.checked })} /> Tính thứ 7 là ngày nghỉ phép</label></Field>
      </div>
      <button className="btn btn-primary mt" onClick={async () => { try { setF(await api.put('/timeoff/settings', f)); toast('Đã lưu'); } catch (e) { toast(e.message, 'error'); } }}>Lưu cài đặt</button>
    </div>
  );
}

export function TimeoffBalances() {
  const { user } = useApp();
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, reload, loading, error] = useFetch(() => api.get('/timeoff/balances', { year }), [year]);
  const [edits, setEdits] = useState({});
  useEffect(() => setEdits({}), [data]);
  const save = async (uid) => {
    try { await api.put('/timeoff/quota', { user_id: uid, year, days: edits[uid] }); toast('Đã cập nhật quỹ phép'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="page">
      <div className="page-head"><h1>Quỹ phép nhân viên</h1>
        <FilterSelect value={year} onChange={setYear} options={[1, 0, -1, -2].map((i) => ({ value: new Date().getFullYear() + i, label: `Năm ${new Date().getFullYear() + i}` }))} /></div>
      {user.role === 'admin' && <TimeoffAdminSettings />}
      {error ? <div className="alert alert-error">{error.message}</div> : loading && !data ? <Spinner /> : (
        <div className="table-wrap mt"><table className="table">
          <thead><tr><th>Nhân viên</th><th>Phòng ban</th><th style={{ width: 150 }}>Phép năm</th><th>Đã nghỉ</th><th>Còn lại</th><th /></tr></thead>
          <tbody>{data.items.map((u) => (
            <tr key={u.id}>
              <td><Link to={`/timeoff?user_id=${u.id}`} className="row gap-sm"><Avatar name={u.name} color={u.color} size={26} />{u.name}</Link></td>
              <td>{u.department_name}</td>
              <td><div className="row gap-sm">
                <input className="input input-sm" type="number" min={0} max={365} step={0.5} value={edits[u.id] ?? u.quota} onChange={(e) => setEdits({ ...edits, [u.id]: e.target.value })} style={{ width: 80 }} />
                {edits[u.id] !== undefined && String(edits[u.id]) !== String(u.quota) && <button className="icon-btn" title="Lưu" onClick={() => save(u.id)}><Save size={15} /></button>}
              </div></td>
              <td>{u.used}</td>
              <td className={u.remaining < 0 ? 'text-red' : ''}><b>{u.remaining}</b></td>
              <td><Link className="link" to={`/timeoff?user_id=${u.id}`}>Chi tiết</Link></td>
            </tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}
