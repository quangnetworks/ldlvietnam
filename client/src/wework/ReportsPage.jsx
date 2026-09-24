import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BarChart3, Download, FolderKanban, Building2, CheckSquare, Target, Users, Info, CheckCircle2, CalendarRange, Lock, ShieldCheck,
  Search, ExternalLink, Award, MessageSquare,
} from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Avatar, Spinner, Empty, FilterSelect, Modal, Field, UserPicker, MultiSelect } from '../components/ui.jsx';
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

const BUCKET_LABEL = { ...Object.fromEntries(TASK_BUCKETS.map((b) => [b.key, b.label])), open: 'Đang thực hiện', done: 'Đã hoàn thành' };
const BUCKET_COLOR = Object.fromEntries(TASK_BUCKETS.map((b) => [b.key, b.color]));

/** Nút số liệu: bấm để mở popup danh sách công việc liên quan. */
function Num({ onClick, children, className, title }) {
  return <button type="button" className={cx('rpt-link', className)} onClick={onClick} title={title || 'Xem danh sách công việc'}>{children}</button>;
}

/**
 * Popup chi tiết của báo cáo: danh sách công việc đứng sau một con số / một phần biểu đồ.
 * Bấm vào công việc để mở chi tiết (kết quả, tệp, thảo luận) ngay trên popup.
 */
function ReportTasksModal({ drill, base, onClose }) {
  const { openTask, version } = useWework();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(50);
  const [data, , loading, error] = useFetch(() => api.get('/wework/reports/tasks', { ...base, ...drill.params, q: q.trim() || undefined, limit }),
    [JSON.stringify(base), JSON.stringify(drill.params), q, limit, version]);
  const items = data?.items || [];
  const exportCsv = async () => {
    const all = await api.get('/wework/reports/tasks', { ...base, ...drill.params, q: q.trim() || undefined, limit: 200 });
    downloadCsv('chi-tiet-bao-cao', ['Mã', 'Công việc', 'Trạng thái', 'Người thực hiện', 'Người tạo', 'Dự án / phòng ban', 'Thời hạn', 'Hoàn thành', 'Số kết quả'],
      all.items.map((t) => [t.id, t.title, BUCKET_LABEL[t.bucket], t.assignee_name, t.creator_name, t.project_name, fmtDate(t.due_date), fmtDate(t.completed_at), t.result_count]));
  };
  return (
    <Modal title={drill.title} onClose={onClose} width={860} className="rpt-modal">
      <div className="row gap rpt-modal-bar">
        <div className="rpt-search"><Search size={14} className="muted" /><input className="input input-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm công việc…" /></div>
        <span className="muted small grow">{data ? <><b>{data.total}</b> công việc{drill.sub && ` · ${drill.sub}`}</> : ' '}</span>
        {data?.total > 0 && <button className="link-btn" onClick={exportCsv}><Download size={14} /> Xuất Excel</button>}
      </div>
      {error && <div className="alert alert-error">{error.message}</div>}
      {!data && !error && <Spinner />}
      {data && !items.length && <Empty icon={CheckSquare} title="Không có công việc nào" />}
      <div className={cx('rpt-tasks', loading && 'refetching')}>
        {items.map((t) => (
          <button key={t.id} type="button" className="rpt-task" onClick={() => openTask(t.id)}>
            <i className="rpt-task-bar" style={{ background: BUCKET_COLOR[t.bucket] }} />
            <span className="grow rpt-task-main">
              <b className="ellipsis block">{t.title}</b>
              <small className="muted ellipsis block">
                {t.project_name || 'Công việc cá nhân'}{t.creator_name && ` · Tạo bởi ${t.creator_name}`}
                {t.result_count > 0 && <> · <Award size={11} /> {t.result_count} kết quả</>}
                {t.comment_count > 0 && <> · <MessageSquare size={11} /> {t.comment_count}</>}
              </small>
            </span>
            <span className="rpt-badge" style={{ '--c': BUCKET_COLOR[t.bucket] }}>{BUCKET_LABEL[t.bucket]}</span>
            <span className={cx('rpt-task-due small', t.bucket === 'overdue' && 'text-red')}>{fmtDate(t.due_date) || '—'}</span>
            <span className="rpt-task-user">{t.assignee_name
              ? <><Avatar name={t.assignee_name} color={t.assignee_color} uid={t.assignee_id} size={22} /><span className="ellipsis small">{t.assignee_name}</span></>
              : <span className="muted small">Chưa giao</span>}</span>
          </button>
        ))}
      </div>
      {data && data.total > items.length && (
        <div className="center mt"><button className="btn btn-sm" onClick={() => setLimit(Math.min(200, limit + 50))} disabled={limit >= 200}>
          {limit >= 200 ? 'Tìm kiếm để thu hẹp danh sách' : `Xem thêm (${data.total - items.length})`}</button></div>
      )}
    </Modal>
  );
}

/** Popup danh sách dự án / phòng ban (bấm để mở dự án hoặc xem công việc). */
function ProjectsModal({ title, list, onClose, onTasks }) {
  const navigate = useNavigate();
  return (
    <Modal title={title} onClose={onClose} width={640}>
      {!list.length && <Empty icon={FolderKanban} title="Không có dữ liệu" />}
      <div className="rpt-tasks">
        {list.map((p) => (
          <div key={p.id} className="rpt-task">
            <span className="proj-dot lg" style={{ background: p.color || 'var(--blue-2)' }}>{p.name.trim()[0]}</span>
            <span className="grow rpt-task-main"><b className="ellipsis block">{p.name}</b>
              <small className="muted">{p.kind === 'department' ? 'Phòng ban' : 'Dự án'} · {p.status === 'closed' ? 'Đã đóng' : 'Đang hoạt động'}{p.total != null && ` · ${p.total} công việc trong kỳ`}</small></span>
            {p.total > 0 && <button className="link-btn" onClick={() => onTasks(p)}>Công việc</button>}
            <button className="icon-btn sm" title="Mở dự án" onClick={() => { onClose(); navigate(`/wework/project/${p.id}`); }}><ExternalLink size={15} /></button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** Cài đặt quyền xem báo cáo (chỉ quản trị viên). */
function ReportAccessModal({ onClose }) {
  const { users, departments } = useApp();
  const { loadMeta } = useWework();
  const toast = useToast();
  const [data] = useFetch(() => api.get('/wework/settings'), []);
  const [groups] = useFetch(() => api.get('/account/groups').catch(() => []), []);
  const [f, setF] = useState(null);
  useEffect(() => { if (data) setF(data); }, [data]);
  const save = async () => {
    try {
      await api.put('/wework/settings', f);
      toast('Đã lưu quyền xem báo cáo');
      loadMeta();
      onClose();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title="Quyền xem báo cáo Wework" onClose={onClose} width={560}
      footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" onClick={save} disabled={!f}>Lưu</button></>}>
      {!f ? <Spinner /> : (
        <div className="rpt-access">
          <p className="rpt-hint"><ShieldCheck size={14} /> Báo cáo (toàn công ty và trong từng dự án) chỉ hiển thị cho <b>quản trị viên</b> và những người được chọn dưới đây.
            Người được cấp quyền xem được số liệu của toàn bộ công việc và mở chi tiết công việc từ báo cáo.</p>
          <Field label="Cá nhân"><UserPicker users={users} multiple value={f.report_users} onChange={(v) => setF({ ...f, report_users: v })} placeholder="Chọn thành viên" /></Field>
          <Field label="Nhóm người dùng"><MultiSelect options={(groups || []).map((g) => ({ value: g.id, label: g.name }))} value={f.report_groups} onChange={(v) => setF({ ...f, report_groups: v })} placeholder="Chọn nhóm" /></Field>
          <Field label="Phòng ban"><MultiSelect options={departments.map((d) => ({ value: d.id, label: d.name }))} value={f.report_departments} onChange={(v) => setF({ ...f, report_departments: v })} placeholder="Chọn phòng ban" /></Field>
        </div>
      )}
    </Modal>
  );
}

function Card({ title, action, children, className }) {
  return (
    <section className={cx('rpt-card', className)}>
      <header className="rpt-card-head"><h3>{title}</h3>{action}</header>
      <div className="rpt-card-body">{children}</div>
    </section>
  );
}

function SummaryCard({ icon: Icon, title, value, rows, tint, onOpen }) {
  return (
    <section className="rpt-sum">
      <header><span className={cx('rpt-sum-icon', tint)}><Icon size={16} /></span>{title}</header>
      <div className="rpt-sum-body">
        {onOpen ? <Num className="rpt-sum-value" onClick={() => onOpen(null)} title={`Xem ${title.toLowerCase()}`}>{value}</Num> : <b className="rpt-sum-value">{value}</b>}
        <div className="rpt-sum-rows">
          <small className="muted">{title.toUpperCase()}</small>
          {rows.map((r) => (
            <div key={r.label}><i className={cx('rpt-dot', r.tone)} />
              {onOpen && r.value ? <Num onClick={() => onOpen(r.key)}><b>{r.value}</b> {r.label}</Num> : <><b>{r.value}</b> {r.label}</>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PersonRow({ p, right, sub, onOpen }) {
  const Tag = onOpen ? 'button' : 'div';
  return (
    <Tag type={onOpen ? 'button' : undefined} className={cx('rpt-person', onOpen && 'clickable')} onClick={onOpen} title={onOpen ? 'Xem danh sách công việc' : undefined}>
      <Avatar name={p.name} color={p.color} uid={p.id} size={34} />
      <div className="grow"><b className="ellipsis block">{p.name}</b><small className="muted">{sub}</small></div>
      {right}
    </Tag>
  );
}

function MemberTable({ rows, unit, onOpen }) {
  return (
    <>
      <div className="table-wrap rpt-table">
        <table className="table compact">
          <thead><tr><th>Thành viên</th><th />{TASK_BUCKETS.map((b) => <th key={b.key} className="num" title={b.label}><i className="viz-key" style={{ background: b.color }} />{b.short}</th>)}</tr></thead>
          <tbody>{rows.map((m) => (
            <tr key={m.id}>
              <td className="rpt-name"><button type="button" className="row gap-sm rpt-link plain" onClick={() => onOpen(m, null)} title="Xem danh sách công việc">
                <Avatar name={m.name} color={m.color} uid={m.id} size={30} /><span className="ellipsis"><b>{m.name}</b><small className="muted block">{m.total} {unit}</small></span></button></td>
              <td><MiniStack series={TASK_BUCKETS} values={vals(m)} width={72} /></td>
              {TASK_BUCKETS.map((b) => <td key={b.key} className={cx('num', !m[b.key] && 'muted')}>{m[b.key] ? <Num onClick={() => onOpen(m, b.key)}>{m[b.key]}</Num> : 0}</td>)}
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
  const base = { from, to, basis, project_id: projectId || pid, subtasks, status };
  const [drill, setDrill] = useState(null);
  const [plist, setPlist] = useState(null);
  const { projects: allProjects } = useWework();
  /** Mở popup danh sách công việc: title, params lọc chi tiết, sub (mô tả thêm). */
  const open = (title, params = {}, sub) => setDrill({ title, params, sub });
  const bucketTitle = (b) => (b ? BUCKET_LABEL[b] : 'Tất cả công việc');
  const [dailyMode, dailyToggle] = useChartTable();
  const [weeklyMode, weeklyToggle] = useChartTable();
  const [deptMode, deptToggle] = useChartTable();

  const dailyRows = useMemo(() => (r?.daily || []).map((d) => ({ label: dm(d.day), tip: fmtDate(d.day), values: vals(d) })), [r]);
  const weeklyRows = useMemo(() => (r?.weekly || []).map((w) => {
    const end = isoDate(new Date(new Date(`${w.week}T00:00:00`).getTime() + 6 * 864e5));
    return { label: `${dm(w.week)}–${dm(end)}`, tip: `Tuần ${fmtDate(w.week)} – ${fmtDate(end)}`, values: vals(w) };
  }), [r]);
  const deptRows = useMemo(() => (r?.department_chart || []).map((p) => ({ label: p.name.length > 14 ? `${p.name.slice(0, 13)}…` : p.name, tip: p.name, values: vals(p) })), [r]);

  const navigate = useNavigate();
  const openProjects = (kind, k) => {
    const counts = Object.fromEntries((r?.projects || []).map((p) => [p.id, p.total]));
    const list = allProjects.filter((p) => p.kind === kind && (!k || (k === 'closed' ? p.status === 'closed' : p.status !== 'closed')))
      .map((p) => ({ ...p, total: counts[p.id] || 0 }));
    setPlist({ title: `${kind === 'department' ? 'Phòng ban' : 'Dự án'}${k ? (k === 'closed' ? ' đã đóng' : ' đang hoạt động') : ''}`, list });
  };
  const modals = (
    <>
      {drill && <ReportTasksModal drill={drill} base={base} onClose={() => setDrill(null)} />}
      {plist && <ProjectsModal {...plist} onClose={() => setPlist(null)} onTasks={(p) => { setPlist(null); open(p.name, { drill_project: p.id }); }} />}
    </>
  );

  if (error) return <div className="alert alert-error">{error.message}</div>;
  if (!r) return <Spinner />;
  const s = r.summary;
  const openDay = (i, b) => { const d = r.daily[i]; if (d) open(`Luỹ kế đến ngày ${fmtDate(d.day)}${b ? ` · ${BUCKET_LABEL[b]}` : ''}`, { day_to: d.day, ...(b && { bucket: b }) }); };
  const openWeek = (i, b) => {
    const w = r.weekly[i];
    if (!w) return;
    const end = isoDate(new Date(new Date(`${w.week}T00:00:00`).getTime() + 6 * 864e5));
    open(`Tuần ${fmtDate(w.week)} – ${fmtDate(end)}${b ? ` · ${BUCKET_LABEL[b]}` : ''}`, { day_from: w.week, day_to: end, ...(b && { bucket: b }) });
  };
  const openProject = (p, b) => open(`${p.name}${b ? ` · ${BUCKET_LABEL[b]}` : ''}`, { drill_project: p.id, ...(b && { bucket: b }) });
  const nt = r.not_on_time;
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

  return (
    <div className={cx('rpt', loading && 'refetching')}>
      {modals}
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
          <SummaryCard icon={FolderKanban} tint="blue" title="Dự án" value={r.cards.projects.total} onOpen={(k) => openProjects('project', k)}
            rows={[{ key: 'active', value: r.cards.projects.active, label: 'đang hoạt động', tone: 'blue' }, { key: 'closed', value: r.cards.projects.total - r.cards.projects.active, label: 'đã đóng', tone: 'gray' }]} />
          <SummaryCard icon={Building2} tint="indigo" title="Phòng ban" value={r.cards.departments.total} onOpen={(k) => openProjects('department', k)}
            rows={[{ key: 'active', value: r.cards.departments.active, label: 'đang hoạt động', tone: 'blue' }, { key: 'closed', value: r.cards.departments.total - r.cards.departments.active, label: 'đã đóng', tone: 'gray' }]} />
          <SummaryCard icon={CheckSquare} tint="green" title="Công việc" value={r.cards.tasks.total} onOpen={(k) => open(bucketTitle(k), k ? { bucket: k } : {})}
            rows={[{ key: 'open', value: r.cards.tasks.open, label: 'đang thực hiện', tone: 'blue' }, { key: 'done', value: r.cards.tasks.done, label: 'hoàn thành', tone: 'green' }]} />
          <SummaryCard icon={Target} tint="orange" title="Mục tiêu" value={r.cards.goals.total} onOpen={() => document.getElementById('rpt-goals')?.scrollIntoView({ behavior: 'smooth' })}
            rows={[{ key: 'a', value: r.cards.goals.active, label: 'đang xử lý', tone: 'blue' }, { key: 'd', value: r.cards.goals.done, label: 'hoàn thành', tone: 'green' }]} />
          <SummaryCard icon={Users} tint="purple" title="Thành viên" value={r.cards.members.total} onOpen={() => navigate('/wework/members')}
            rows={[{ key: 's', value: r.cards.members.staff, label: 'nhân viên', tone: 'blue' }, { key: 'g', value: r.cards.members.guests, label: 'tài khoản khách', tone: 'gray' }]} />
        </div>
      )}

      {!s.total ? <Empty icon={BarChart3} title="Không có công việc trong khoảng thời gian này">Thử mở rộng khoảng thời gian hoặc đổi mốc ngày.</Empty> : (
        <>
          <h4 className="rpt-section">Báo cáo công việc</h4>
          <div className="rpt-grid four">
            <Card title="Trạng thái công việc">
              <Donut series={TASK_BUCKETS} values={vals(s)} centerLabel="công việc" onSelect={(k) => open(bucketTitle(k), k ? { bucket: k } : {})} />
            </Card>
            <Card title="Thành viên xuất sắc">
              {r.excellent.length ? r.excellent.map((m) => (
                <PersonRow key={m.id} p={m} sub={<><b>{m.on_time + m.late}</b>/{m.total} công việc đã hoàn thành</>}
                  onOpen={() => open(`Công việc của ${m.name}`, { assignee_id: m.id })}
                  right={<span className="rpt-rate"><span style={{ width: `${m.rate}%` }} /><b>{m.rate}%</b></span>} />
              )) : <p className="muted small">Chưa có thành viên hoàn thành công việc</p>}
            </Card>
            <Card title="Công việc không đúng hạn">
              <div className="rpt-late">
                <RingMeter pct={pct(nt.overdue, nt.open)} color="var(--viz-overdue)" label="Quá hạn" />
                <div><Num className="rpt-big red" onClick={() => open('Công việc quá hạn', { bucket: 'overdue' })}>{nt.overdue}</Num><small>công việc quá hạn<br />trên <Num onClick={() => open('Công việc đang thực hiện', { bucket: 'open' })}><b>{nt.open}</b></Num> công việc đang thực hiện</small></div>
              </div>
              <div className="rpt-late">
                <RingMeter pct={pct(nt.late, nt.done)} color="var(--viz-late)" label="Hoàn thành muộn" />
                <div><Num className="rpt-big amber" onClick={() => open('Công việc hoàn thành muộn', { bucket: 'late' })}>{nt.late}</Num><small>công việc hoàn thành muộn<br />trên <Num onClick={() => open('Công việc đã hoàn thành', { bucket: 'done' })}><b>{nt.done}</b></Num> công việc đã hoàn thành</small></div>
              </div>
              <p className="rpt-note"><Info size={14} /> {nt.no_due ? <Num onClick={() => open('Công việc không có thời hạn', { no_due: 1 })}><b>{nt.no_due}</b></Num> : <b>0</b>} công việc được tạo không có thời hạn</p>
            </Card>
            <div className="rpt-stack">
              <Card title="Ma trận Eisenhower">
                <div className="rpt-eisen" role="table" aria-label="Ma trận Eisenhower">
                  {[['imp', 'important', 'Quan trọng'], ['both', null, 'Quan trọng & khẩn cấp'], ['none', 'normal', 'Bình thường'], ['urg', 'urgent', 'Khẩn cấp']].map(([cls, pr, label]) => {
                    const n = r.eisenhower[cls === 'imp' ? 'important' : cls === 'urg' ? 'urgent' : cls];
                    return pr && n ? (
                      <button key={cls} type="button" className={cx('q clickable', cls)} onClick={() => open(`Công việc: ${label}`, { priority: pr })}><b>{n}</b><small>{label}</small></button>
                    ) : <div key={cls} className={cx('q', cls)}><b>{n}</b><small>{label}</small></div>;
                  })}
                </div>
              </Card>
              <Card title="Đang chờ đánh giá">
                <div className="rpt-review">
                  <Num className="rpt-big green" onClick={() => open('Công việc chờ đánh giá', { bucket: 'review' })}>{r.review.total}</Num>
                  <div><small className="muted">ĐANG CHỜ ĐÁNH GIÁ</small><div>{r.review.overdue ? <Num className="text-red" onClick={() => open('Chờ đánh giá đã quá hạn', { review_overdue: 1 })}><b>{r.review.overdue}</b></Num> : <b>0</b>}/{r.review.total} quá hạn</div></div>
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
                  <StackedColumns series={TASK_BUCKETS} rows={dailyRows} yLabel="Số lượng công việc (luỹ kế)" onSelect={(i) => openDay(i, null)} />
                </>
              ) : <SeriesTable series={TASK_BUCKETS} rows={dailyRows} labelHead="Ngày" onCell={openDay} />}
            </Card>
            <Card title="Tổng hợp theo tuần" action={weeklyToggle}>
              {weeklyMode === 'chart' ? (
                <>
                  <Legend series={TASK_BUCKETS} className="top" />
                  <StackedColumns series={TASK_BUCKETS} rows={weeklyRows} labelEvery={1} yLabel="Số lượng công việc" onSelect={(i) => openWeek(i, null)} />
                </>
              ) : <SeriesTable series={TASK_BUCKETS} rows={weeklyRows} labelHead="Tuần" onCell={openWeek} />}
            </Card>
          </div>

          <h4 className="rpt-section">Theo thành viên</h4>
          <div className="rpt-grid two-one-one">
            <Card title="Công việc được giao theo thành viên" action={<button className="link-btn" onClick={() => csvMembers('cong-viec-duoc-giao', r.assigned, 'công việc được giao')}><Download size={14} /> Xuất Excel</button>}>
              <MemberTable rows={r.assigned} unit="công việc được giao" onOpen={(m, b) => open(`Được giao cho ${m.name}${b ? ` · ${BUCKET_LABEL[b]}` : ''}`, { assignee_id: m.id, ...(b && { bucket: b }) })} />
            </Card>
            <Card title="Còn nhiều việc nhất">
              {r.most_open.map((m) => <PersonRow key={m.id} p={m} sub={<><b>{m.open}</b>/{m.total} công việc đang thực hiện</>} onOpen={() => open(`${m.name} · đang thực hiện`, { assignee_id: m.id, bucket: 'open' })} />)}
              {!r.most_open.length && <p className="muted small">Không có</p>}
            </Card>
            <Card title="Làm muộn nhiều nhất">
              {r.most_late.map((m) => <PersonRow key={m.id} p={m} sub={<><b className="text-red">{m.overdue}</b> quá hạn · <b>{m.late}</b> hoàn thành muộn</>} onOpen={() => open(`${m.name} · quá hạn & hoàn thành muộn`, { assignee_id: m.id, bucket: 'overdue,late' })} />)}
              {!r.most_late.length && <p className="muted small">Không có ai trễ hạn 🎉</p>}
            </Card>
          </div>
          <div className="rpt-grid two-one-one">
            <Card title="Công việc đã tạo theo thành viên" action={<button className="link-btn" onClick={() => csvMembers('cong-viec-da-tao', r.created, 'công việc đã tạo')}><Download size={14} /> Xuất Excel</button>}>
              <MemberTable rows={r.created} unit="công việc đã tạo" onOpen={(m, b) => open(`Do ${m.name} tạo${b ? ` · ${BUCKET_LABEL[b]}` : ''}`, { creator_id: m.id, ...(b && { bucket: b }) })} />
            </Card>
            <Card title="Tạo nhiều công việc nhất">
              {r.most_created.map((m) => <PersonRow key={m.id} p={m} sub={<><b>{m.total}</b> công việc</>} onOpen={() => open(`Do ${m.name} tạo`, { creator_id: m.id })} />)}
            </Card>
            <Card title="Chưa giao nhiều nhất">
              {r.most_unassigned.map((m) => <PersonRow key={m.id} p={m} sub={<><b>{m.n}</b> chưa giao</>} onOpen={() => open(`${m.name} · chưa giao`, { creator_id: m.id, unassigned: 1 })} />)}
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
                          <td className="rpt-name"><span className="row gap-sm">
                            <button type="button" className="row gap-sm rpt-link plain" onClick={() => openProject(p, null)} title="Xem danh sách công việc">
                              <span className="proj-dot lg" style={{ background: p.color || 'var(--blue-2)' }}>{p.name.trim()[0]}</span>
                              <span><b>{p.name}</b><small className="muted block">{p.kind === 'department' ? 'Phòng ban' : 'Dự án'} · {p.total} công việc</small></span></button>
                            <Link to={`/wework/project/${p.id}`} className="icon-btn sm" title="Mở dự án"><ExternalLink size={13} /></Link></span></td>
                          <td><MiniStack series={TASK_BUCKETS} values={vals(p)} width={72} /></td>
                          {TASK_BUCKETS.map((b) => <td key={b.key} className={cx('num', !p[b.key] && 'muted')}>{p[b.key] ? <Num onClick={() => openProject(p, b.key)}>{p[b.key]}</Num> : 0}</td>)}
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </Card>
                <div className="rpt-stack">
                  <Card title="Tổng hợp dự án">
                    <Donut series={HEALTH} values={r.project_health} centerLabel="dự án" size={150} thickness={18}
                      onSelect={(k) => setPlist({ title: k ? `Dự án & phòng ban: ${HEALTH.find((h) => h.key === k).label}` : 'Dự án & phòng ban có công việc trong kỳ', list: r.projects.filter((p) => !k || p.health === k) })} />
                  </Card>
                  <Card title="Phân bổ công việc theo phòng ban" action={deptToggle}>
                    {!deptRows.length ? <p className="muted small">Chưa có công việc thuộc phòng ban</p> : deptMode === 'chart' ? (
                      <>
                        <Legend series={TASK_BUCKETS} className="top" />
                        <StackedColumns series={TASK_BUCKETS} rows={deptRows} labelEvery={1} height={220} showTotal={false} onSelect={(i) => openProject(r.department_chart[i], null)} />
                      </>
                    ) : <SeriesTable series={TASK_BUCKETS} rows={deptRows} labelHead="Phòng ban" onCell={(i, b) => openProject(r.department_chart[i], b)} />}
                  </Card>
                </div>
              </div>

              <h4 className="rpt-section" id="rpt-goals">Mục tiêu & thống kê</h4>
              <div className="rpt-grid two-one">
                <Card title="Danh sách mục tiêu" className="rpt-goals-card">
                  {!r.goals.length ? <p className="muted small">Chưa có mục tiêu</p> : (
                    <div className="table-wrap rpt-table">
                      <table className="table compact">
                        <thead><tr><th>Mục tiêu</th><th>Phụ trách</th><th style={{ width: '30%' }}>Hoàn thành</th><th>Thời hạn</th></tr></thead>
                        <tbody>{r.goals.slice(0, 12).map((g) => (
                          <tr key={g.id}>
                            <td><Num className="plain" onClick={() => open(`Mục tiêu: ${g.title}`, { goal_id: g.id }, 'mọi công việc gắn với mục tiêu')}><b>{g.title}</b></Num><small className="muted block">{g.department_name || '—'}</small></td>
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
                    <div>{r.stats.comments ? <Num onClick={() => open('Công việc có bình luận', { with_comments: 1 })}><b>{r.stats.comments}</b></Num> : <b>0</b>}<small>tổng số bình luận</small></div>
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
  const { user } = useApp();
  const { canReports } = useWework();
  const [meta] = useFetch(() => api.get('/wework/meta'), []);
  const [access, setAccess] = useState(false);
  const allowed = meta ? meta.can_view_reports : canReports;
  return (
    <div className="ww-page">
      <div className="ww-main wide rpt-page">
        <div className="rpt-head">
          <span className="rpt-head-icon"><BarChart3 size={18} /></span>
          <div className="grow"><h1>Báo cáo</h1><div className="rpt-tabs"><span className="active">Báo cáo tổng hợp</span></div></div>
          {user.role === 'admin' && <button className="btn btn-sm" onClick={() => setAccess(true)}><ShieldCheck size={15} /> Phân quyền xem báo cáo</button>}
        </div>
        {!meta && !allowed ? <Spinner /> : allowed ? <ReportView /> : (
          <Empty icon={Lock} title="Bạn chưa được cấp quyền xem báo cáo">Báo cáo Wework chỉ dành cho quản trị viên và các cá nhân được cài đặt quyền. Liên hệ quản trị viên để được cấp quyền.</Empty>
        )}
        {access && <ReportAccessModal onClose={() => setAccess(false)} />}
      </div>
    </div>
  );
}
