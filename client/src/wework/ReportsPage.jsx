import { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { api } from '../api.js';
import { useFetch } from '../context.jsx';
import { Avatar, Spinner, Empty, FilterSelect } from '../components/ui.jsx';
import { TASK_STATUS, isoDate, fmtDate } from '../utils.js';
import { useWework } from './WeworkLayout.jsx';

function StatTile({ label, value, sub, tone }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone || ''}`}>{value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

/** Horizontal stacked bar of task counts by status, with a legend (identity never by color alone). */
function StatusBar({ byStatus }) {
  const total = byStatus.reduce((s, x) => s + x.c, 0);
  if (!total) return <p className="muted">Chưa có dữ liệu</p>;
  const order = Object.keys(TASK_STATUS);
  const rows = order.map((k) => ({ k, c: byStatus.find((x) => x.status === k)?.c || 0 })).filter((x) => x.c);
  return (
    <>
      <div className="stack-bar" role="img" aria-label="Phân bổ trạng thái công việc">
        {rows.map((r) => (
          <div key={r.k} style={{ flex: r.c, background: TASK_STATUS[r.k].color }} title={`${TASK_STATUS[r.k].label}: ${r.c} (${Math.round((r.c / total) * 100)}%)`} />
        ))}
      </div>
      <div className="legend">
        {rows.map((r) => (
          <span key={r.k}><i style={{ background: TASK_STATUS[r.k].color }} /> {TASK_STATUS[r.k].label} <b>{r.c}</b> <span className="muted">({Math.round((r.c / total) * 100)}%)</span></span>
        ))}
      </div>
    </>
  );
}

/** 30-day column chart for one series; hover shows exact value. */
function TrendChart({ points, color = '#2d7ff9' }) {
  const [hover, setHover] = useState(null);
  const days = [];
  const map = Object.fromEntries(points.map((p) => [p.day, p.c]));
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = isoDate(d);
    days.push({ day: key, c: map[key] || 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.c));
  return (
    <div className="trend">
      <div className="trend-plot">
        {(max >= 2 ? [1, 0.5] : [1]).map((f) => <div key={f} className="trend-grid" style={{ bottom: `${f * 100}%` }}><span>{Math.round(max * f)}</span></div>)}
        {days.map((d) => (
          <div key={d.day} className="trend-col" onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)}>
            <div className="trend-bar" style={{ height: `${(d.c / max) * 100}%`, background: color, opacity: hover && hover.day !== d.day ? 0.5 : 1 }} />
          </div>
        ))}
        {hover && <div className="trend-tip">{fmtDate(hover.day)}: <b>{hover.c}</b></div>}
      </div>
      <div className="trend-axis"><span>{fmtDate(days[0].day)}</span><span>{fmtDate(days[29].day)}</span></div>
    </div>
  );
}

export function ReportView({ projectId }) {
  const { version } = useWework();
  const [range, setRange] = useState('');
  const from = range ? isoDate(new Date(Date.now() - Number(range) * 86400000)) : undefined;
  const [r, , loading] = useFetch(() => api.get('/wework/reports', { project_id: projectId, from }), [projectId, range, version]);
  if (loading && !r) return <Spinner />;
  if (!r) return null;
  const total = r.by_status.reduce((s, x) => s + x.c, 0);
  const done = r.by_status.find((x) => x.status === 'done')?.c || 0;
  const active = r.by_status.filter((x) => ['todo', 'doing'].includes(x.status)).reduce((s, x) => s + x.c, 0);
  if (!total && !range) return <Empty icon={BarChart3} title="Chưa có dữ liệu báo cáo" />;
  return (
    <div className="report">
      <div className="ww-toolbar">
        <div className="grow" />
        <FilterSelect value={range} onChange={setRange} options={[
          { value: '', label: 'Toàn thời gian' }, { value: '7', label: '7 ngày qua' }, { value: '30', label: '30 ngày qua' }, { value: '90', label: '90 ngày qua' },
        ]} />
      </div>
      <div className="stat-row">
        <StatTile label="Tổng công việc" value={total} />
        <StatTile label="Đang thực hiện" value={active} />
        <StatTile label="Hoàn thành" value={done} sub={`Tỷ lệ ${total ? Math.round((done / total) * 100) : 0}%`} tone="text-green" />
        <StatTile label="Quá hạn" value={r.overdue} tone={r.overdue ? 'text-red' : ''} />
        <StatTile label="Hoàn thành muộn" value={r.late} />
      </div>
      <div className="card">
        <h3 className="card-title">Phân bổ theo trạng thái</h3>
        <StatusBar byStatus={r.by_status} />
      </div>
      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">Công việc hoàn thành — 30 ngày gần đây</h3>
          <TrendChart points={r.done_trend} color="#37b24d" />
        </div>
        <div className="card">
          <h3 className="card-title">Công việc được tạo — 30 ngày gần đây</h3>
          <TrendChart points={r.created_trend} />
        </div>
      </div>
      <div className="card">
        <h3 className="card-title">Theo thành viên</h3>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Thành viên</th><th>Tổng</th><th>Đang làm</th><th>Hoàn thành</th><th>Quá hạn</th><th>Thất bại</th><th style={{ width: '30%' }}>Tỷ lệ hoàn thành</th></tr></thead>
            <tbody>
              {r.by_member.map((m) => {
                const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
                return (
                  <tr key={m.id}>
                    <td><span className="row gap-sm"><Avatar name={m.name} color={m.color} size={24} /> {m.name}</span></td>
                    <td>{m.total}</td><td>{m.active}</td><td>{m.done}</td>
                    <td className={m.overdue ? 'text-red' : ''}>{m.overdue}</td><td>{m.failed}</td>
                    <td><div className="row gap-sm"><div className="meter"><div style={{ width: `${pct}%` }} /></div><small>{pct}%</small></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {!projectId && (
        <div className="card">
          <h3 className="card-title">Theo dự án / phòng ban</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Dự án</th><th>Tổng</th><th>Hoàn thành</th><th>Quá hạn</th><th style={{ width: '30%' }}>Tiến độ</th></tr></thead>
              <tbody>
                {r.by_project.map((p) => {
                  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
                  return (
                    <tr key={p.id}>
                      <td><span className="row gap-sm"><span className="proj-dot" style={{ background: p.color }}>{p.name[0]}</span> {p.name}</span></td>
                      <td>{p.total}</td><td>{p.done}</td><td className={p.overdue ? 'text-red' : ''}>{p.overdue}</td>
                      <td><div className="row gap-sm"><div className="meter"><div style={{ width: `${pct}%` }} /></div><small>{pct}%</small></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const { projects } = useWework();
  const [pid, setPid] = useState('');
  return (
    <div className="ww-page">
      <div className="ww-main wide">
        <div className="page-head">
          <h1>Báo cáo công việc</h1>
          <FilterSelect value={pid} onChange={setPid} options={[{ value: '', label: 'Tất cả dự án' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
        </div>
        <ReportView projectId={pid || undefined} />
      </div>
    </div>
  );
}
