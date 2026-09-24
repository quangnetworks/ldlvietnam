import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, CalendarRange, CheckCircle2, Inbox, Clock, BadgeCheck, XCircle, AlarmClock, Timer } from 'lucide-react';
import { api } from '../api.js';
import { useFetch } from '../context.jsx';
import { Avatar, Spinner, Empty, FilterSelect } from '../components/ui.jsx';
import { Donut, MiniStack, StackedColumns, SeriesTable, Legend, RingMeter, useChartTable } from '../components/charts.jsx';
import { isoDate, fmtDate, cx } from '../utils.js';
import { useRequestApp } from './RequestLayout.jsx';

/** Trạng thái đề xuất — cùng bộ màu đã kiểm tra phân biệt (xanh lá / xanh dương / đỏ / hổ phách) + xám trung tính. */
export const REQUEST_SERIES = [
  { key: 'approved', label: 'Đã chấp thuận', short: 'Chấp thuận', color: 'var(--viz-on-time)' },
  { key: 'pending', label: 'Chờ duyệt', short: 'Chờ duyệt', color: 'var(--viz-doing)' },
  { key: 'rejected', label: 'Đã từ chối', short: 'Từ chối', color: 'var(--viz-overdue)' },
  { key: 'returned', label: 'Đã trả lại', short: 'Trả lại', color: 'var(--viz-late)' },
  { key: 'cancelled', label: 'Đã huỷ', short: 'Đã huỷ', color: 'var(--viz-neutral)' },
];
const RANGES = [
  { value: '7', label: '7 ngày qua' }, { value: '30', label: '30 ngày qua' }, { value: '90', label: '90 ngày qua' }, { value: '', label: 'Toàn thời gian' },
];
const vals = (x) => Object.fromEntries(REQUEST_SERIES.map((s) => [s.key, x[s.key] || 0]));
const hours = (h) => (h == null ? '—' : h < 24 ? `${h} giờ` : `${Math.round((h / 24) * 10) / 10} ngày`);

function downloadCsv(name, head, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/^[=+\-@]/, "'$&").replace(/"/g, '""')}"`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([`﻿${[head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
  a.download = `${name}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function Card({ title, action, children }) {
  return (
    <section className="rpt-card">
      <header className="rpt-card-head"><h3>{title}</h3>{action}</header>
      <div className="rpt-card-body">{children}</div>
    </section>
  );
}

function Kpi({ icon: Icon, label, value, sub, tint }) {
  return (
    <section className="rpt-sum kpi">
      <header><span className={cx('rpt-sum-icon', tint)}><Icon size={16} /></span>{label}</header>
      <b className="rpt-sum-value">{value}</b>
      {sub && <small className="muted">{sub}</small>}
    </section>
  );
}

export default function RequestReports() {
  const { groups } = useRequestApp();
  const [range, setRange] = useState('30');
  const [gid, setGid] = useState('');
  const from = range ? isoDate(new Date(Date.now() - (Number(range) - 1) * 864e5)) : undefined;
  const [r, , loading, error] = useFetch(() => api.get('/request/reports', { from, group_id: gid, days: range || 90 }), [from, gid, range]);
  const [trendMode, trendToggle] = useChartTable();
  const trendRows = useMemo(() => {
    if (!r) return [];
    const n = Math.min(r.days, 90);
    const created = Object.fromEntries(r.created_trend.map((x) => [x.day, x.c]));
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = isoDate(new Date(Date.now() - i * 864e5));
      out.push({ label: `${d.slice(8, 10)}/${d.slice(5, 7)}`, tip: fmtDate(d), values: { created: created[d] || 0 } });
    }
    return out;
  }, [r]);

  if (error) return <div className="rq-page"><div className="alert alert-error">{error.message}</div></div>;
  const s = r?.summary;
  const done = s ? s.approved + s.rejected : 0;
  return (
    <div className="rq-page rpt-page">
      <div className="rpt-head">
        <span className="rpt-head-icon green"><Inbox size={18} /></span>
        <div><h1>Báo cáo đề xuất</h1><div className="rpt-tabs"><span className="active">Báo cáo tổng hợp</span></div></div>
      </div>
      <div className="rpt-filters glass">
        <CalendarRange size={16} className="muted" />
        <FilterSelect value={range} onChange={setRange} options={RANGES} />
        <span className="rpt-sep" />
        <FilterSelect value={gid} onChange={setGid} options={[{ value: '', label: 'Tất cả nhóm đề xuất' }, ...(groups || []).map((g) => ({ value: g.id, label: g.name }))]} />
        <div className="grow" />
        {s && <span className="rpt-scan"><CheckCircle2 size={15} /> Đã tổng hợp <b>{s.total}</b> đề xuất</span>}
      </div>
      {!r ? <Spinner /> : !s.total ? <Empty icon={Inbox} title="Chưa có đề xuất trong khoảng thời gian này" /> : (
        <div className={cx('rpt', loading && 'refetching')}>
          <div className="rpt-sums six">
            <Kpi icon={Inbox} tint="blue" label="Tổng đề xuất" value={s.total} />
            <Kpi icon={Clock} tint="indigo" label="Chờ duyệt" value={s.pending} />
            <Kpi icon={BadgeCheck} tint="green" label="Chấp thuận" value={s.approved} sub={done ? `${Math.round((s.approved / done) * 100)}% số đã xử lý` : null} />
            <Kpi icon={XCircle} tint="orange" label="Từ chối" value={s.rejected} />
            <Kpi icon={AlarmClock} tint="purple" label="Quá hạn xử lý" value={s.overdue} sub="đang chờ, đã quá SLA" />
            <Kpi icon={Timer} tint="blue" label="Thời gian xử lý TB" value={hours(s.avg_hours)} />
          </div>

          <div className="rpt-grid four">
            <Card title="Trạng thái đề xuất">
              <Donut series={REQUEST_SERIES} values={vals(s)} centerLabel="đề xuất" />
            </Card>
            <Card title="Đúng hạn xử lý (SLA)">
              <div className="rpt-late">
                <RingMeter pct={s.with_sla ? Math.round((s.within_sla / s.with_sla) * 1000) / 10 : 0} color="var(--viz-good)" label="Đúng SLA" size={72} />
                <div><b className="rpt-big">{s.within_sla}/{s.with_sla}</b><small>đề xuất có SLA được xử lý đúng hạn</small></div>
              </div>
              <div className="rpt-late">
                <RingMeter pct={s.pending ? Math.round((s.overdue / s.pending) * 1000) / 10 : 0} color="var(--viz-overdue)" label="Quá hạn" size={72} />
                <div><b className="rpt-big red">{s.overdue}</b><small>đề xuất đang chờ đã quá hạn<br />trên <b>{s.pending}</b> đề xuất chờ duyệt</small></div>
              </div>
            </Card>
            <div className="rpt-span-2">
              <Card title="Đề xuất mới theo ngày" action={trendToggle}>
                {trendMode === 'chart'
                  ? <StackedColumns series={[{ key: 'created', label: 'Đề xuất mới', color: 'var(--viz-doing)' }]} rows={trendRows} height={250} yLabel="Số đề xuất được tạo" />
                  : <SeriesTable series={[{ key: 'created', label: 'Đề xuất mới', color: 'var(--viz-doing)' }]} rows={trendRows} labelHead="Ngày" />}
              </Card>
            </div>
          </div>

          <h4 className="rpt-section">Theo nhóm đề xuất & người duyệt</h4>
          <div className="rpt-grid two-one">
            <Card title="Theo nhóm đề xuất" action={<button className="link-btn" onClick={() => downloadCsv('bao-cao-nhom-de-xuat', ['Nhóm đề xuất', 'Danh mục', 'Tổng', ...REQUEST_SERIES.map((x) => x.label), 'Thời gian xử lý TB (giờ)'],
              r.by_group.map((g) => [g.name, g.category, g.total, ...REQUEST_SERIES.map((x) => g[x.key]), g.avg_hours ?? '']))}><Download size={14} /> Xuất Excel</button>}>
              <Legend series={REQUEST_SERIES} className="top" />
              <div className="table-wrap rpt-table">
                <table className="table compact">
                  <thead><tr><th>Nhóm đề xuất</th><th />{REQUEST_SERIES.map((x) => <th key={x.key} className="num" title={x.label}><i className="viz-key" style={{ background: x.color }} />{x.short}</th>)}<th className="num">TG xử lý TB</th></tr></thead>
                  <tbody>{r.by_group.map((g) => (
                    <tr key={g.id}>
                      <td className="rpt-name"><Link to={`/request?group_id=${g.id}`}><b>{g.name}</b><small className="muted block">{g.category || 'Khác'} · {g.total} đề xuất</small></Link></td>
                      <td><MiniStack series={REQUEST_SERIES} values={vals(g)} width={72} /></td>
                      {REQUEST_SERIES.map((x) => <td key={x.key} className={cx('num', !g[x.key] && 'muted')}>{g[x.key]}</td>)}
                      <td className="num">{hours(g.avg_hours)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
            <Card title="Người duyệt">
              {r.by_approver.map((u) => (
                <div key={u.id} className="rpt-person">
                  <Avatar name={u.name} color={u.color} uid={u.id} size={34} />
                  <div className="grow"><b className="ellipsis block">{u.name}</b>
                    <small className="muted"><b>{u.handled}</b>/{u.total} đã xử lý · phản hồi TB {hours(u.avg_hours)}</small></div>
                  {u.waiting > 0 ? <span className="badge badge-orange">{u.waiting} đang chờ</span> : <span className="badge badge-green">Xong</span>}
                </div>
              ))}
              {!r.by_approver.length && <p className="muted small">Chưa có dữ liệu</p>}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
