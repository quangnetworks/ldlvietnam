import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, LogIn, LogOut, Clock, Search, Camera, MapPin } from 'lucide-react';
import { api, toFormData } from '../api.js';
import { CheckinCamera, isMobileDevice, mapUrl } from './CheckinCamera.jsx';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Avatar, Spinner, Field, Empty, FilterSelect, useShowMore, foldVi } from '../components/ui.jsx';
import { cx } from '../utils.js';

const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const DAY_STATUS = {
  ok: ['Đúng giờ', 'ci-ok'], late: ['Đi muộn', 'ci-late'], absent: ['Vắng', 'ci-absent'], leave: ['Nghỉ phép', 'ci-leave'],
  off: ['Nghỉ', 'ci-off'], upcoming: ['', 'ci-upcoming'],
};

export function vnMonth() {
  return new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);
}
export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
export function MonthNav({ month, onChange }) {
  const [y, m] = month.split('-');
  return (
    <div className="month-nav">
      <button className="icon-btn" onClick={() => onChange(shiftMonth(month, -1))} aria-label="Tháng trước"><ChevronLeft size={16} /></button>
      <b>Tháng {Number(m)}/{y}</b>
      <button className="icon-btn" onClick={() => onChange(shiftMonth(month, 1))} aria-label="Tháng sau"><ChevronRight size={16} /></button>
    </div>
  );
}

function Clock24() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return <div className="ci-clock">{now.toLocaleTimeString('vi-VN', { hour12: false, timeZone: 'Asia/Ho_Chi_Minh' })}</div>;
}

function Timesheet({ userId }) {
  const [month, setMonth] = useState(vnMonth());
  const [data, , loading, error] = useFetch(() => api.get('/checkin/month', { month, user_id: userId }), [month, userId]);
  if (error) return <div className="alert alert-error">{error.message}</div>;
  const first = data?.days[0]?.dow ?? 0;
  const pad = (first + 6) % 7; // tuần bắt đầu từ thứ 2
  return (
    <div className="card">
      <div className="row between wrap gap"><h3 className="card-title">Bảng công</h3><MonthNav month={month} onChange={setMonth} /></div>
      {loading && !data ? <Spinner /> : (
        <>
          <div className="stat-row compact">
            <div className="stat-tile"><div className="stat-label">Ngày công</div><div className="stat-value">{data.summary.worked}</div></div>
            <div className="stat-tile"><div className="stat-label">Đi muộn</div><div className="stat-value text-orange">{data.summary.late}</div></div>
            <div className="stat-tile"><div className="stat-label">Vắng</div><div className="stat-value text-red">{data.summary.absent}</div></div>
            <div className="stat-tile"><div className="stat-label">Nghỉ phép</div><div className="stat-value">{data.summary.leave}</div></div>
            <div className="stat-tile"><div className="stat-label">Tổng giờ</div><div className="stat-value">{data.summary.hours}</div></div>
          </div>
          <div className="cal-grid">
            {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((d) => <div key={d} className="cal-head">{d}</div>)}
            {Array.from({ length: pad }).map((_, i) => <div key={`p${i}`} className="cal-cell empty" />)}
            {data.days.map((d) => {
              const [label, cls] = DAY_STATUS[d.status];
              return (
                <div key={d.date} className={cx('cal-cell', cls)} title={d.leave?.kind || label}>
                  <span className="cal-day">{Number(d.date.slice(8))}</span>
                  {d.record?.in_time && <small>{d.record.in_time}{d.record.out_time ? ` – ${d.record.out_time}` : ''}</small>}
                  {d.leave && <small>{d.leave.kind}</small>}
                  {!d.record && !d.leave && label && <small>{label}</small>}
                </div>
              );
            })}
          </div>
          <div className="legend">{Object.entries(DAY_STATUS).filter(([, [l]]) => l).map(([k, [l, cls]]) => <span key={k}><i className={cx('dot', cls)} /> {l}</span>)}</div>
        </>
      )}
    </div>
  );
}

/** Ảnh chấm công (vào / ra) kèm liên kết bản đồ vị trí. */
function PunchPhoto({ rec, kind }) {
  const src = api.url(`/checkin/${rec.id}/photo/${kind}`);
  const lat = rec[`${kind}_lat`]; const lng = rec[`${kind}_lng`];
  return (
    <figure className="ci-photo">
      <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={`Ảnh chấm công ${kind === 'in' ? 'vào' : 'ra'}`} loading="lazy" /></a>
      <figcaption>
        {kind === 'in' ? 'Vào' : 'Ra'} {rec[`${kind}_time`] || ''}
        {lat != null && <a className="link row gap-xs" href={mapUrl(lat, lng)} target="_blank" rel="noreferrer"><MapPin size={12} /> Bản đồ{rec[`${kind}_accuracy`] != null ? ` ±${rec[`${kind}_accuracy`]}m` : ''}</a>}
      </figcaption>
    </figure>
  );
}

/** Biểu tượng nhỏ trong bảng: mở ảnh / bản đồ. */
function PunchLinks({ rec }) {
  if (!rec) return null;
  const items = ['in', 'out'].filter((k) => rec[`${k}_photo`] || rec[`${k}_lat`] != null);
  if (!items.length) return null;
  return (
    <span className="row ci-links">
      {items.map((k) => (
        <span key={k} className="row gap-xs">
          {rec[`${k}_photo`] && <a className="icon-btn" href={api.url(`/checkin/${rec.id}/photo/${k}`)} target="_blank" rel="noreferrer" title={`Ảnh chấm công ${k === 'in' ? 'vào' : 'ra'}`}><Camera size={14} /></a>}
          {rec[`${k}_lat`] != null && <a className="icon-btn" href={mapUrl(rec[`${k}_lat`], rec[`${k}_lng`])} target="_blank" rel="noreferrer" title={`Vị trí chấm công ${k === 'in' ? 'vào' : 'ra'}`}><MapPin size={14} /></a>}
        </span>
      ))}
    </span>
  );
}

export function CheckinHome() {
  const { user, users } = useApp();
  const toast = useToast();
  const [params] = useSearchParams();
  const uid = Number(params.get('user_id')) || null;
  const [today, reload] = useFetch(() => api.get('/checkin/today'), []);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);
  const [camera, setCamera] = useState(null); // 'in' | 'out' khi đang mở hộp thoại chụp ảnh
  const other = uid && uid !== user.id ? users.find((u) => u.id === uid) : null;
  const mobile = isMobileDevice();
  const send = async (kind, shot) => {
    const body = shot ? toFormData({ mobile: 1, lat: shot.lat, lng: shot.lng, accuracy: shot.accuracy }, [shot.file]) : (mobile ? { mobile: 1 } : {});
    const r = await api.post(`/checkin/${kind}`, body);
    toast(kind === 'in' ? `Đã chấm công vào lúc ${r.in_time}${r.late_minutes ? ` (muộn ${r.late_minutes} phút)` : ''}` : `Đã chấm công ra lúc ${r.out_time}`);
    reload(); setKey((k) => k + 1);
  };
  const act = async (kind) => {
    if (mobile && today?.photo?.required) { setCamera(kind); return; }
    setBusy(true);
    try { await send(kind); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const confirmShot = async (shot) => {
    try { await send(camera, shot); setCamera(null); } catch (e) { toast(e.message, 'error'); }
  };
  if (other || (uid && uid !== user.id)) {
    return (
      <div className="page">
        <div className="page-head"><h1 className="row gap-sm">{other && <Avatar name={other.name} color={other.color} size={32} />} Bảng công {other?.name || ''}</h1></div>
        <Timesheet userId={uid} />
      </div>
    );
  }
  const rec = today?.record;
  return (
    <div className="page">
      <div className="page-head"><h1>Chấm công của tôi</h1></div>
      <div className="grid-2 ci-top">
        <div className="card ci-card">
          {!today ? <Spinner /> : (
            <>
              <Clock24 />
              <div className="muted">Ca làm việc {today.settings.start} – {today.settings.end} · cho phép muộn {today.settings.grace} phút</div>
              {!rec?.check_in_at ? (
                <button className="ci-btn in" disabled={busy} onClick={() => act('in')}><LogIn size={28} /> Chấm công vào</button>
              ) : !rec.check_out_at ? (
                <button className="ci-btn out" disabled={busy} onClick={() => act('out')}><LogOut size={28} /> Chấm công ra</button>
              ) : (
                <div className="ci-done">Bạn đã hoàn thành chấm công hôm nay</div>
              )}
              {today.photo?.required && <small className="muted row gap-sm"><Camera size={13} /> Chấm công bằng điện thoại cần chụp ảnh và bật định vị</small>}
              {today.settings.ip_only && !(today.photo?.required && today.photo.sales && mobile)
                && <small className="muted">Chỉ chấm công được từ mạng công ty · IP của bạn: {today.ip || '—'}</small>}
            </>
          )}
        </div>
        <div className="card">
          <h3 className="card-title row gap-sm"><Clock size={16} /> Hôm nay</h3>
          {!rec ? <p className="muted">Chưa có dữ liệu chấm công.</p> : (
            <div className="ci-today">
              <div><small className="muted">Giờ vào</small><b>{rec.in_time || '—'}</b>{rec.late_minutes > 0 && <span className="badge badge-orange">Muộn {rec.late_minutes}′</span>}</div>
              <div><small className="muted">Giờ ra</small><b>{rec.out_time || '—'}</b>{rec.early_minutes > 0 && rec.out_time && <span className="badge badge-orange">Sớm {rec.early_minutes}′</span>}</div>
              <div><small className="muted">Số giờ</small><b>{rec.hours ?? '—'}</b></div>
            </div>
          )}
          {rec && (rec.in_photo || rec.out_photo) && (
            <div className="ci-photos">
              {['in', 'out'].map((k) => rec[`${k}_photo`] && <PunchPhoto key={k} rec={rec} kind={k} />)}
            </div>
          )}
        </div>
      </div>
      <Timesheet key={key} userId={user.id} />
      {camera && <CheckinCamera kind={camera} userName={user.name} office={today?.photo?.office} onConfirm={confirmShot} onClose={() => setCamera(null)} />}
    </div>
  );
}

export function CheckinTeam() {
  const [date, setDate] = useState(new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10));
  const [data, , loading, error] = useFetch(() => api.get('/checkin/team', { date }), [date]);
  const { departments } = useApp();
  const [q, setQ] = useState('');
  const [dep, setDep] = useState('');
  const [state, setState] = useState('');
  const all = data?.items || [];
  const STATES = { in: (x) => x.record?.check_in_at, late: (x) => x.record?.late_minutes > 0, leave: (x) => x.leave, none: (x) => !x.record?.check_in_at && !x.leave };
  const fq = foldVi(q.trim());
  const items = all.filter((x) => (!fq || foldVi(`${x.name} ${x.title || ''}`).includes(fq)) && (!dep || x.department_name === dep) && (!state || STATES[state](x)));
  const [shown, more] = useShowMore(items, 80, `${q}|${dep}|${state}|${date}`);
  if (error) return <div className="page"><div className="alert alert-error">{error.message}</div></div>;
  const count = (fn) => all.filter(fn).length;
  const tile = (key, label, value, cls = '') => (
    <button type="button" className={cx('stat-tile', state === key && 'active')} onClick={() => setState(state === key ? '' : key)} aria-pressed={state === key}>
      <div className="stat-label">{label}</div><div className={cx('stat-value', cls)}>{value}</div></button>
  );
  return (
    <div className="page">
      <div className="page-head">
        <h1>Bảng công nhân viên</h1>
        {data?.is_hr && <a className="btn" href={api.url('/checkin/export', { month: date.slice(0, 7) })}><Download size={15} /> Xuất bảng công tháng {date.slice(5, 7)}</a>}
      </div>
      <div className="toolbar wrap">
        <input className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 170 }} />
        <div className="ww-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm nhân viên" /></div>
        <FilterSelect value={dep} onChange={setDep} options={[{ value: '', label: 'Tất cả phòng ban' }, ...departments.map((d) => ({ value: d.name, label: d.name }))]} />
      </div>
      {loading && !data ? <Spinner /> : (
        <>
          <div className="stat-row compact">
            {tile('', 'Nhân viên', all.length)}
            {tile('in', 'Đã chấm công', count(STATES.in), 'text-green')}
            {tile('none', 'Chưa chấm công', count(STATES.none))}
            {tile('late', 'Đi muộn', count(STATES.late), 'text-orange')}
            {tile('leave', 'Nghỉ phép', count(STATES.leave))}
          </div>
          {!items.length ? <Empty title={all.length ? 'Không có nhân viên phù hợp bộ lọc' : 'Bạn chưa quản lý nhân viên nào'} /> : (<>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Nhân viên</th><th>Phòng ban</th><th>Giờ vào</th><th>Giờ ra</th><th>Số giờ</th><th>Trạng thái</th><th>Ảnh / vị trí</th><th /></tr></thead>
              <tbody>{shown.map((u) => {
                const r = u.record;
                return (
                  <tr key={u.id}>
                    <td><span className="row gap-sm"><Avatar name={u.name} color={u.color} size={26} /><span>{u.name}<small className="muted block">{u.title}</small></span></span></td>
                    <td>{u.department_name}</td>
                    <td>{r?.in_time || '—'}</td><td>{r?.out_time || '—'}</td><td>{r?.hours ?? '—'}</td>
                    <td>{u.leave ? <span className="badge badge-purple">{u.leave}</span>
                      : r?.check_in_at ? (r.late_minutes > 0 ? <span className="badge badge-orange">Muộn {r.late_minutes} phút</span> : <span className="badge badge-green">Đúng giờ</span>)
                        : <span className="badge badge-gray">Chưa chấm công</span>}</td>
                    <td><PunchLinks rec={r} /></td>
                    <td><Link to={`/checkin?user_id=${u.id}`} className="link">Bảng công</Link></td>
                  </tr>
                );
              })}</tbody>
            </table></div>{more}</>
          )}
        </>
      )}
    </div>
  );
}

export function CheckinSettings() {
  const toast = useToast();
  const [data] = useFetch(() => api.get('/checkin/settings'), []);
  const [f, setF] = useState(null);
  useEffect(() => { if (data) setF({ ...data, ip_rules: data.ip_rules.join('\n') }); }, [data]);
  if (!f) return <div className="page"><Spinner /></div>;
  const save = async () => {
    try { const r = await api.put('/checkin/settings', f); setF({ ...r, ip_rules: r.ip_rules.join('\n') }); toast('Đã lưu cài đặt chấm công'); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="page" style={{ maxWidth: 680 }}>
      <h1>Cài đặt LDL Checkin</h1>
      <div className="card mt">
        <div className="form-grid three">
          <Field label="Giờ bắt đầu ca"><input className="input" type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
          <Field label="Giờ kết thúc ca"><input className="input" type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
          <Field label="Cho phép muộn (phút)"><input className="input" type="number" min={0} max={120} value={f.grace} onChange={(e) => setF({ ...f, grace: e.target.value })} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={f.work_saturday} onChange={(e) => setF({ ...f, work_saturday: e.target.checked })} /> Làm việc thứ 7</label>
        <label className="check"><input type="checkbox" checked={f.ip_only} onChange={(e) => setF({ ...f, ip_only: e.target.checked })} /> Chỉ cho phép chấm công từ mạng công ty (theo IP)</label>
        <Field label="Danh sách IP / dải IP của văn phòng" hint="Mỗi dòng một địa chỉ, ví dụ 203.0.113.10 hoặc 203.0.113.0/24">
          <textarea className="input mono" rows={4} value={f.ip_rules} onChange={(e) => setF({ ...f, ip_rules: e.target.value })} />
        </Field>
        <button className="btn btn-primary mt" onClick={save}>Lưu</button>
      </div>
      <PhotoRules f={f} setF={setF} onSave={save} />
    </div>
  );
}

/** Cài đặt chụp ảnh + định vị khi chấm công bằng điện thoại, theo từng văn phòng. */
function PhotoRules({ f, setF, onSave }) {
  const [cat] = useFetch(() => api.get('/hrm/catalog'), []);
  const rules = f.photo_rules || [];
  const offices = [...new Set([...(cat?.offices || []), ...rules.map((x) => x.office).filter(Boolean)])];
  const rows = [...offices.map((o) => [o, o]), ['', 'Chưa gán văn phòng']];
  const ruleOf = (o) => rules.find((x) => x.office === o) || { office: o, staff: false, sales: false };
  const toggle = (o, k) => {
    const next = { ...ruleOf(o), [k]: !ruleOf(o)[k] };
    setF({ ...f, photo_rules: [...rules.filter((x) => x.office !== o), next] });
  };
  return (
    <div className="card mt">
      <h3 className="card-title row gap-sm"><Camera size={16} /> Chụp ảnh & định vị khi chấm công bằng điện thoại</h3>
      <p className="muted">Khi bật, nhân viên chấm công trên điện thoại phải chụp ảnh tại chỗ; ảnh được in sẵn thời gian, toạ độ GPS và tên nhân viên.
        Văn phòng lấy theo hồ sơ LDL HRM; đội sales là nhân viên đang có vị trí trong LDL Sales.
        Đội sales đã bật ở đây được chấm công ngoài mạng công ty (ảnh + vị trí thay cho kiểm tra IP).</p>
      {!cat ? <Spinner /> : (
        <div className="table-wrap"><table className="table compact">
          <thead><tr><th>Văn phòng</th><th className="center">Nhân viên văn phòng</th><th className="center">Đội sales</th></tr></thead>
          <tbody>{rows.map(([o, label]) => (
            <tr key={o || '_none'}>
              <td>{o ? label : <span className="muted">{label}</span>}</td>
              {['staff', 'sales'].map((k) => (
                <td key={k} className="center"><input type="checkbox" checked={ruleOf(o)[k]} onChange={() => toggle(o, k)} aria-label={`${label} – ${k === 'staff' ? 'nhân viên văn phòng' : 'đội sales'}`} /></td>
              ))}
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <button className="btn btn-primary mt" onClick={onSave}>Lưu</button>
    </div>
  );
}

export { DOW };
