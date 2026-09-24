import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../api.js';
import { useFetch } from '../context.jsx';
import { isoDate, startOfWeek, cx } from '../utils.js';
import { useWework } from './WeworkLayout.jsx';

const DOW = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

/** Month calendar of tasks (placed on their due date, or start date when no deadline). */
export default function TaskCalendar({ filters = {} }) {
  const { openTask, openCreate, version } = useWework();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const gridStart = startOfWeek(month);
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(d.getDate() + i); return d; });
  const from = isoDate(days[0]);
  const to = isoDate(days[41]);
  const [data] = useFetch(() => api.get('/tasks', { ...filters, from, to, limit: 200, sort: 'due' }), [from, to, JSON.stringify(filters), version]);

  const byDay = useMemo(() => {
    const map = {};
    for (const t of data?.items || []) {
      const key = (t.due_date || t.start_date || t.created_at)?.slice(0, 10);
      (map[key] ||= []).push(t);
    }
    return map;
  }, [data]);
  const todayKey = isoDate(new Date());
  const shift = (n) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <div className="calendar">
      <div className="cal-head">
        <button className="icon-btn" onClick={() => shift(-1)} aria-label="Tháng trước"><ChevronLeft size={18} /></button>
        <b>Tháng {month.getMonth() + 1}/{month.getFullYear()}</b>
        <button className="icon-btn" onClick={() => shift(1)} aria-label="Tháng sau"><ChevronRight size={18} /></button>
        <button className="btn btn-sm" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Hôm nay</button>
      </div>
      <div className="cal-grid">
        {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {days.map((d) => {
          const key = isoDate(d);
          const tasks = byDay[key] || [];
          return (
            <div key={key} className={cx('cal-cell', d.getMonth() !== month.getMonth() && 'other', key === todayKey && 'today')}
              onDoubleClick={() => openCreate({ due_date: key, ...(filters.project_id ? { project_id: filters.project_id } : {}) })}>
              <div className="cal-day">{d.getDate()}</div>
              {tasks.slice(0, 4).map((t) => (
                <button key={t.id} className={cx('cal-task', t.status === 'done' && 'done', t.is_overdue && 'overdue')}
                  style={{ borderLeftColor: t.project_color || '#adb5bd' }} onClick={() => openTask(t.id)} title={t.title}>
                  {t.title}
                </button>
              ))}
              {tasks.length > 4 && <small className="muted">+{tasks.length - 4} công việc</small>}
            </div>
          );
        })}
      </div>
      <p className="muted small">Nhấp đúp vào một ngày để tạo công việc với thời hạn là ngày đó.</p>
    </div>
  );
}

/** Simple Gantt/timeline for a project. */
export function Timeline({ tasks, onOpen }) {
  const dated = tasks.filter((t) => t.start_date || t.due_date);
  if (!dated.length) return <p className="muted">Chưa có công việc nào có ngày bắt đầu / thời hạn.</p>;
  const toDay = (v) => Date.parse(v.slice(0, 10)) / 86400000;
  let min = Infinity;
  let max = -Infinity;
  for (const t of dated) {
    const s = toDay(t.start_date || t.due_date);
    const e = toDay(t.due_date || t.start_date);
    min = Math.min(min, s);
    max = Math.max(max, e);
  }
  const today = toDay(isoDate(new Date()));
  min = Math.min(min, today) - 2;
  max = Math.max(max, today) + 3;
  const span = max - min + 1;
  const pct = (d) => ((d - min) / span) * 100;
  const ticks = [];
  for (let d = min; d <= max; d += Math.max(1, Math.ceil(span / 12))) ticks.push(d);
  return (
    <div className="timeline-chart">
      <div className="tl-row tl-axis">
        <div className="tl-label" />
        <div className="tl-track">
          {ticks.map((d) => {
            const dt = new Date(d * 86400000);
            return <span key={d} className="tl-tick" style={{ left: `${pct(d)}%` }}>{dt.getUTCDate()}/{dt.getUTCMonth() + 1}</span>;
          })}
          <span className="tl-today" style={{ left: `${pct(today)}%` }} />
        </div>
      </div>
      {dated.map((t) => {
        const s = toDay(t.start_date || t.due_date);
        const e = toDay(t.due_date || t.start_date);
        return (
          <div key={t.id} className="tl-row" onClick={() => onOpen(t.id)}>
            <div className="tl-label ellipsis" title={t.title}>{t.title}</div>
            <div className="tl-track">
              <span className="tl-today" style={{ left: `${pct(today)}%` }} />
              <div className={cx('tl-bar', t.status === 'done' && 'done', t.is_overdue && 'overdue')}
                style={{ left: `${pct(s)}%`, width: `${Math.max(1.5, ((e - s + 1) / span) * 100)}%` }} title={t.title}>
                <span className="ellipsis">{t.assignee_name}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
