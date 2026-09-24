import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Download, FolderKanban, Building2, CheckSquare, Target, Users, Info, CheckCircle2, CalendarRange } from 'lucide-react';
import { api } from '../api.js';
import { useFetch } from '../context.jsx';
import { Avatar, Spinner, Empty, FilterSelect } from '../components/ui.jsx';
import { TASK_BUCKETS, Donut, RingMeter, MiniStack, StackedColumns, SeriesTable, Legend, useChartTable } from '../components/charts.jsx';
import { isoDate, fmtDate, cx } from '../utils.js';
import { useWework } from './WeworkLayout.jsx';

const RANGES = [
  { value: '7', label: '7 ngày qua' },
  { value: '30', label: '30 ngày qua' },
  { value: '90', label: '90 ngày qua' },
  { value: 'month', label: 'Tháng này' },
  { value: 'quarter', label: 'Quý này' },
  { value: 'custom', label: 'Tuỳ chọn…' },
];
const BASIS = [
  { value: 'created', label: 'Theo ngày tạo' },
  { value: 'due', label: 'Theo thời hạn' },
  { value: 'start', label: 'Theo ngày bắt đầu' },
  { value: 'completed', label: 'Theo ngày hoàn thành' },
];
const HEALTH = [
  { key: 'on_track', label: 'Đúng tiến độ', color: 'var(--viz-good)' },
  { key: 'late', label: 'Chậm tiến độ', color: 'var(--viz-warning)' },
  { key: 'risk', label: 'Có rủi ro cao', color: 'var(--viz-critical)' },
  { key: 'closed', label: 'Đã đóng', color: 'var(--viz-neutral)' },
];

function rangeDates(range, custom) {
  const today = new Date();
  const back = (n) => isoDate(new Date(Date.now() - (n - 1) * 864e5));
  if (range === 'custom') return custom;
  if (range === 'month') return { from: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDate(today) };
  if (range === 'quarter') return { from: isoDate(new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1)), to: isoDate(today) };
  return { from: back(Number(range)), to: isoDate(today) };
}

const dm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const vals = (x) => Object.fromEntries(TASK_BUCKETS.map((b) => [b.key, x[b.key] || 0]));

/** Xuất CSV (chặn chèn công thức Excel). */
function downloadCsv(name, head, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/^[=+\-@]/, "'$&").replace(/"/g, '""')}"`;
  const csv = `﻿${[head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${name}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function Card({ title, action, children, className }) {
  return (
    <section className={cx('rpt-card', className)}>
      <header className="rpt-card-head"><h3>{title}</h3>{action}</header>
      <div className="rpt-card-body">{children}</div>
    </section>
  );
}

function SummaryCard({ icon: Icon, title, value, rows, tint }) {
  return (
    <section className="rpt-sum">
      <header><span className={cx('rpt-sum-icon', tint)}><Icon size={16} /></span>{title}</header>
      <div className="rpt-sum-body">
        <b className="rpt-sum-value">{value}</b>
        <div className="rpt-sum-rows">
          <small className="muted">{title.toUpperCase()}</small>
          {rows.map((r) => <div key={r.label}><i className={cx('rpt-dot', r.tone)} /><b>{r.value}</b> {r.label}</div>)}
        </div>
      </div>
    </section>
  );
}

function PersonRow({ p, right, sub }) {
  return (
    <div className="rpt-person">
      <Avatar name={p.name} color={p.color} uid={p.id} size={34} />
      <div className="grow"><b className="ellipsis block">{p.name}</b><small className="muted">{sub}</small></div>
      {right}
    </div>
  );
}

function MemberTable({ rows, unit }) {
  return (
    <>
      <div className="table-wrap rpt-table">
        <table className="table compact">
          <thead><tr><th>Thành viên</th><th />{TASK_BUCKETS.map((b) => <th key={b.key} className="num" title={b.label}><i className="viz-key" style={{ background: b.color }} />{b.short}</th>)}</tr></thead>
          <tbody>{rows.map((m) => (
            <tr key={m.id}>
              <td className="rpt-name"><span className="row gap-sm"><Avatar name={m.name} color={m.color} uid={m.id} size={30} /><span className="ellipsis"><b>{m.name}</b><small className="muted block">{m.total} {unit}</small></span></span></td>
              <td><MiniStack series={TASK_BUCKETS} values={vals(m)} width={72} /></td>
              {TASK_BUCKETS.map((b) => <td key={b.key} className={cx('num', !m[b.key] && 'muted')}>{m[b.key]}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {!rows.length && <p className="muted small center">Chưa có dữ liệu</p>}
    </>
  );
}

const csvMembers = (name, rows, unit) => downloadCsv(name, ['Thành viên', `Số ${unit}`, ...TASK_BUCKETS.map((b) => b.label)],
  rows.map((m) => [m.name, m.total, ...TASK_BUCKETS.map((b) => m[b.key])]));

export function ReportView({ projectId }) {
  const { version, projects } = useWework();
  const [range, setRange] = useState('30');
  const [custom, setCustom] = useState({ from: isoDate(new Date(Date.now() - 29 * 864e5)), to: isoDate(new Date()) });
  const [basis, setBasis] = useState('created');
  const [pid, setPid] = useState(projectId || '');
  const [subtasks, setSubtasks] = useState('1');
  const [status, setStatus] = useState('');
  const { from, to } = rangeDates(range, custom);
  const [r, , loading, error] = useFetch(() => api.get('/wework/reports/overview', {
    from, to, basis, project_id: projectId || pid, subtasks, status,
  }), [from, to, basis, pid, projectId, subtasks, status, version]);
  const [dailyMode, dailyToggle] = useChartTable();
  const [weeklyMode, weeklyToggle] = useChartTable();
  const [deptMode, deptToggle] = useChartTable();

  const dailyRows = useMemo(() => (r?.daily || []).map((d) => ({ label: dm(d.day), tip: fmtDate(d.day), values: vals(d) })), [r]);
  const weeklyRows = useMemo(() => (r?.weekly || []).map((w) => {
    const end = isoDate(new Date(new Date(`${w.week}T00:00:00`).getTime() + 6 * 864e5));
    return { label: `${dm(w.week)}–${dm(end)}`, tip: `Tuần ${fmtDate(w.week)} – ${fmtDate(end)}`, values: vals(w) };
  }), [r]);
  const deptRows = useMemo(() => (r?.department_chart || []).map((p) => ({ label: p.name.length > 14 ? `${p.name.slice(0, 13)}…` : p.name, tip: p.name, values: vals(p) })), [r]);

  if (error) return <div className="alert alert-error">{error.message}</div>;
  if (!r) return <Spinner />;
  const s = r.summary;
  const nt = r.not_on_time;
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

  return (
    <div className={cx('rpt', loading && 'refetching')}>
      <div className="rpt-filters glass">
        <CalendarRange size={16} className="muted" />
        <FilterSelect value={range} onChange={setRange} options={RANGES} />
        {range === 'custom' && (
          <span className="rpt-dates">
            <input type="date" className="input input-sm" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} aria-label="Từ ngày" />
            <span className="muted">→</span>
            <input type="date" className="input input-sm" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} aria-label="Đến ngày" />
          </span>
        )}
        <span className="rpt-sep" />
        <FilterSelect value={basis} onChange={setBasis} options={BASIS} />
        {!projectId && <FilterSelect value={pid} onChange={setPid} options={[{ value: '', label: 'Tất cả dự án & phòng ban' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />}
        <FilterSelect value={subtasks} onChange={setSubtasks} options={[{ value: '1', label: 'Công việc & công việc con' }, { value: '0', label: 'Không tính công việc con' }]} />
        <FilterSelect value={status} onChange={setStatus} options={[{ value: '', label: 'Tất cả trạng thái' }, { value: 'active', label: 'Công việc đang thực hiện' }, { value: 'done', label: 'Công việc đã hoàn thành' }]} />
        <div className="grow" />
        <span className="rpt-scan"><CheckCircle2 size={15} /> Đã quét <b>{r.scanned}</b> công việc · {fmtDate(r.from)} – {fmtDate(r.to)}</span>
      </div>

      {!projectId && (
        <div className="rpt-sums">
          <SummaryCard icon={FolderKanban} tint="blue" title="Dự án" value={r.cards.projects.total} rows={[{ value: r.cards.projects.active, label: 'đang hoạt động', tone: 'blue' }, { value: r.cards.projects.total - r.cards.projects.active, label: 'đã đóng', tone: 'gray' }]} />
          <SummaryCard icon={Building2} tint="indigo" title="Phòng ban" value={r.cards.departments.total} rows={[{ value: r.cards.departments.active, label: 'đang hoạt động', tone: 'blue' }, { value: r.cards.departments.total - r.cards.departments.active, label: 'đã đóng', tone: 'gray' }]} />
          <SummaryCard icon={CheckSquare} tint="green" title="Công việc" value={r.cards.tasks.total} rows={[{ value: r.cards.tasks.open, label: 'đang thực hiện', tone: 'blue' }, { value: r.cards.tasks.done, label: 'hoàn thành', tone: 'green' }]} />
          <SummaryCard icon={Target} tint="orange" title="Mục tiêu" value={r.cards.goals.total} rows={[{ value: r.cards.goals.active, label: 'đang xử lý', tone: 'blue' }, { value: r.cards.goals.done, label: 'hoàn thành', tone: 'green' }]} />
          <SummaryCard icon={Users} tint="purple" title="Thành viên" value={r.cards.members.total} rows={[{ value: r.cards.members.staff, label: 'nhân viên', tone: 'blue' }, { value: r.cards.members.guests, label: 'tài khoản khách', tone: 'gray' }]} />
        </div>
      )}

      {!s.total ? <Empty icon={BarChart3} title="Không có công việc trong khoảng thời gian này">Thử mở rộng khoảng thời gian hoặc đổi mốc ngày.</Empty> : (
        <>
          <h4 className="rpt-section">Báo cáo công việc</h4>
          <div className="rpt-grid four">
            <Card title="Trạng thái công việc">
              <Donut series={TASK_BUCKETS} values={vals(s)} centerLabel="công việc" />
            </Card>
            <Card title="Thành viên xuất sắc">
              {r.excellent.length ? r.excellent.map((m) => (
                <PersonRow key={m.id} p={m} sub={<><b>{m.on_time + m.late}</b>/{m.total} công việc đã hoàn thành</>}
                  right={<span className="rpt-rate"><span style={{ width: `${m.rate}%` }} /><b>{m.rate}%</b></span>} />
              )) : <p className="muted small">Chưa có thành viên hoàn thành công việc</p>}
            </Card>
            <Card title="Công việc không đúng hạn">
              <div className="rpt-late">
                <RingMeter pct={pct(nt.overdue, nt.open)} color="var(--viz-overdue)" label="Quá hạn" />
                <div><b className="rpt-big red">{nt.overdue}</b><small>công việc quá hạn<br />trên <b>{nt.open}</b> công việc đang thực hiện</small></div>
              </div>
              <div className="rpt-late">
                <RingMeter pct={pct(nt.late, nt.done)} color="var(--viz-late)" label="Hoàn thành muộn" />
                <div><b className="rpt-big amber">{nt.late}</b><small>công việc hoàn thành muộn<br />trên <b>{nt.done}</b> công việc đã hoàn thành</small></div>
              </div>
              <p className="rpt-note"><Info size={14} /> <b>{nt.no_due}</b> công việc được tạo không có thời hạn</p>
            </Card>
            <div className="rpt-stack">
              <Card title="Ma trận Eisenhower">
                <div className="rpt-eisen" role="table" aria-label="Ma trận Eisenhower">
                  <div className="q imp"><b>{r.eisenhower.important}</b><small>Quan trọng</small></div>
                  <div className="q both"><b>{r.eisenhower.both}</b><small>Quan trọng & khẩn cấp</small></div>
                  <div className="q none"><b>{r.eisenhower.none}</b><small>Bình thường</small></div>
                  <div className="q urg"><b>{r.eisenhower.urgent}</b><small>Khẩn cấp</small></div>
                </div>
              </Card>
              <Card title="Đang chờ đánh giá">
                <div className="rpt-review">
                  <b className="rpt-big green">{r.review.total}</b>
                  <div><small className="muted">ĐANG CHỜ ĐÁNH GIÁ</small><div><b className={r.review.overdue ? 'text-red' : ''}>{r.review.overdue}</b>/{r.review.total} quá hạn</div></div>
                </div>
                <p className="rpt-note"><b>{r.review.projects_with_review}/{r.review.projects_total}</b> dự án & phòng ban có công việc chờ duyệt</p>
              </Card>
            </div>
          </div>

          <div className="rpt-grid two-one">
            <Card title="Quá trình hoàn thành theo ngày" action={dailyToggle}>
              {dailyMode === 'chart' ? (
                <>
                  <Legend series={TASK_BUCKETS} className="top" />
                  <StackedColumns series={TASK_BUCKETS} rows={dailyRows} yLabel="Số lượng công việc (luỹ kế)" />
                </>
              ) : <SeriesTable series={TASK_BUCKETS} rows={dailyRows} labelHead="Ngày" />}
            </Card>
            <Card title="Tổng hợp theo tuần" action={weeklyToggle}>
              {weeklyMode === 'chart' ? (
                <>
                  <Legend series={TASK_BUCKETS} className="top" />
                  <StackedColumns series={TASK_BUCKETS} rows={weeklyRows} labelEvery={1} yLabel="Số lượng công việc" />
                </>
              ) : <SeriesTable series={TASK_BUCKETS} rows={weeklyRows} labelHead="Tuần" />}
            </Card>
          </div>

          <h4 className="rpt-section">Theo thành viên</h4>
          <div className="rpt-grid two-one-one">
            <Card title="Công việc được giao theo thành viên" action={<button className="link-btn" onClick={() => csvMembers('cong-viec-duoc-giao', r.assigned, 'công việc được giao')}><Download size={14} /> Xuất Excel</button>}>
              <MemberTable rows={r.assigned} unit="công việc được giao" />
            </Card>
            <Card title="Còn nhiều việc nhất">
              {r.most_open.map((m) => <PersonRow key={m.id} p={m} sub={<><b>{m.open}</b>/{m.total} công việc đang thực hiện</>} />)}
              {!r.most_open.length && <p className="muted small">Không có</p>}
            </Card>
            <Card title="Làm muộn nhiều nhất">
              {r.most_late.map((m) => <PersonRow key={m.id} p={m} sub={<><b className="text-red">{m.overdue}</b> quá hạn · <b>{m.late}</b> hoàn thành muộn</>} />)}
              {!r.most_late.length && <p className="muted small">Không có ai trễ hạn 🎉</p>}
            </Card>
          </div>
          <div className="rpt-grid two-one-one">
            <Card title="Công việc đã tạo theo thành viên" action={<button className="link-btn" onClick={() => csvMembers('cong-viec-da-tao', r.created, 'công việc đã tạo')}><Download size={14} /> Xuất Excel</button>}>
              <MemberTable rows={r.created} unit="công việc đã tạo" />
            </Card>
            <Card title="Tạo nhiều công việc nhất">
              {r.most_created.map((m) => <PersonRow key={m.id} p={m} sub={<><b>{m.total}</b> công việc</>} />)}
            </Card>
            <Card title="Chưa giao nhiều nhất">
              {r.most_unassigned.map((m) => <PersonRow key={m.id} p={m} sub={<><b>{m.n}</b> chưa giao</>} />)}
              {!r.most_unassigned.length && <p className="muted small">Mọi công việc đều đã có người thực hiện</p>}
            </Card>
          </div>

          {!projectId && (
            <>
              <h4 className="rpt-section">Dự án, phòng ban</h4>
              <div className="rpt-grid two-one">
                <Card title="Dự án & phòng ban" action={<button className="link-btn" onClick={() => downloadCsv('du-an-phong-ban', ['Dự án / phòng ban', 'Loại', 'Tổng', ...TASK_BUCKETS.map((b) => b.label)], r.projects.map((p) => [p.name, p.kind === 'department' ? 'Phòng ban' : 'Dự án', p.total, ...TASK_BUCKETS.map((b) => p[b.key])]))}><Download size={14} /> Xuất Excel</button>}>
                  <div className="table-wrap rpt-table">
                    <table className="table compact">
                      <thead><tr><th>Dự án & phòng ban</th><th />{TASK_BUCKETS.map((b) => <th key={b.key} className="num" title={b.label}><i className="viz-key" style={{ background: b.color }} />{b.short}</th>)}</tr></thead>
                      <tbody>{r.projects.map((p) => (
                        <tr key={p.id}>
                          <td className="rpt-name"><Link to={`/wework/project/${p.id}`} className="row gap-sm"><span className="proj-dot lg" style={{ background: p.color || 'var(--blue-2)' }}>{p.name.trim()[0]}</span>
                            <span><b>{p.name}</b><small className="muted block">{p.kind === 'department' ? 'Phòng ban' : 'Dự án'} · {p.total} công việc</small></span></Link></td>
                          <td><MiniStack series={TASK_BUCKETS} values={vals(p)} width={72} /></td>
                          {TASK_BUCKETS.map((b) => <td key={b.key} className={cx('num', !p[b.key] && 'muted')}>{p[b.key]}</td>)}
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </Card>
                <div className="rpt-stack">
                  <Card title="Tổng hợp dự án">
                    <Donut series={HEALTH} values={r.project_health} centerLabel="dự án" size={150} thickness={18} />
                  </Card>
                  <Card title="Phân bổ công việc theo phòng ban" action={deptToggle}>
                    {!deptRows.length ? <p className="muted small">Chưa có công việc thuộc phòng ban</p> : deptMode === 'chart' ? (
                      <>
                        <Legend series={TASK_BUCKETS} className="top" />
                        <StackedColumns series={TASK_BUCKETS} rows={deptRows} labelEvery={1} height={220} showTotal={false} />
                      </>
                    ) : <SeriesTable series={TASK_BUCKETS} rows={deptRows} labelHead="Phòng ban" />}
                  </Card>
                </div>
              </div>

              <h4 className="rpt-section">Mục tiêu & thống kê</h4>
              <div className="rpt-grid two-one">
                <Card title="Danh sách mục tiêu">
                  {!r.goals.length ? <p className="muted small">Chưa có mục tiêu</p> : (
                    <div className="table-wrap rpt-table">
                      <table className="table compact">
                        <thead><tr><th>Mục tiêu</th><th>Phụ trách</th><th style={{ width: '30%' }}>Hoàn thành</th><th>Thời hạn</th></tr></thead>
                        <tbody>{r.goals.slice(0, 12).map((g) => (
                          <tr key={g.id}>
                            <td><b>{g.title}</b><small className="muted block">{g.department_name || '—'}</small></td>
                            <td><span className="row gap-sm"><Avatar name={g.user_name} color={g.user_color} size={24} />{g.user_name}</span></td>
                            <td><div className="rpt-rate wide"><span style={{ width: `${g.progress}%` }} /><b>{g.progress}%</b></div></td>
                            <td className={g.due_date && g.due_date < r.today && g.progress < 100 ? 'text-red' : ''}>{fmtDate(g.due_date) || '—'}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                </Card>
                <Card title="Các con số thống kê">
                  <p className="rpt-hint">Chỉ tính các công việc trong khoảng thời gian được chọn</p>
                  <div className="rpt-stats">
                    <div><b>{r.stats.per_week}</b><small>công việc trung bình mỗi tuần</small></div>
                    <div><b>{r.stats.per_week_per_person}</b><small>công việc trung bình mỗi tuần, mỗi người</small></div>
                    <div><b>{r.stats.per_project}</b><small>công việc trung bình mỗi dự án</small></div>
                    <div><b>{r.stats.comments}</b><small>tổng số bình luận</small></div>
                  </div>
                </Card>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <div className="ww-page">
      <div className="ww-main wide rpt-page">
        <div className="rpt-head">
          <span className="rpt-head-icon"><BarChart3 size={18} /></span>
          <div><h1>Báo cáo</h1><div className="rpt-tabs"><span className="active">Báo cáo tổng hợp</span></div></div>
        </div>
        <ReportView />
      </div>
    </div>
  );
}
