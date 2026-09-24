import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckSquare, GitPullRequestArrow, FileText, Fingerprint, Plane, RotateCcw, ClipboardCheck, PartyPopper, RefreshCw } from 'lucide-react';
import { Spinner } from '../components/ui.jsx';
import { cx, parseDate } from '../utils.js';

const TABS = [
  { key: 'overdue', label: 'Quá hạn' },
  { key: 'today', label: 'Hôm nay' },
  { key: 'upcoming', label: 'Sắp tới' },
  { key: 'todo', label: 'Cần xử lý' },
];
const TYPE = {
  task: { icon: CheckSquare, cls: 'ag-blue', label: 'Công việc' },
  review: { icon: ClipboardCheck, cls: 'ag-purple', label: 'Đánh giá' },
  request: { icon: GitPullRequestArrow, cls: 'ag-green', label: 'Đề xuất' },
  returned: { icon: RotateCcw, cls: 'ag-orange', label: 'Trả lại' },
  document: { icon: FileText, cls: 'ag-teal', label: 'Văn bản' },
  checkin: { icon: Fingerprint, cls: 'ag-orange', label: 'Chấm công' },
  leave: { icon: Plane, cls: 'ag-purple', label: 'Nghỉ phép' },
};
const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function dueLabel(item, today) {
  if (!item.due) return null;
  const days = Math.round((parseDate(item.due) - parseDate(today)) / 864e5);
  if (days < 0) return { text: `Quá hạn ${-days} ngày`, cls: 'danger' };
  if (days === 0) return { text: 'Hôm nay', cls: 'warn' };
  if (days === 1) return { text: 'Ngày mai', cls: '' };
  const d = parseDate(item.due);
  return { text: `${DOW[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`, cls: '' };
}

/** Khung "Việc cần làm": quá hạn / hôm nay / sắp tới / cần xử lý, gom từ mọi phân hệ. */
export default function HomeAgenda({ data, reload, loading }) {
  const [tab, setTab] = useState(null);
  const counts = data?.counts || {};
  const active = tab || TABS.find((t) => counts[t.key] > 0)?.key || 'today';
  const items = (data?.items || []).filter((i) => i.bucket === active);
  return (
    <section className="hcard agenda">
      <div className="hcard-head">
        <h3>Việc cần làm</h3>
        <button className="icon-btn sm" onClick={reload} title="Làm mới" aria-label="Làm mới"><RefreshCw size={14} /></button>
      </div>
      <div className="agenda-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={active === t.key} className={cx(active === t.key && 'active', t.key)} onClick={() => setTab(t.key)}>
            <b>{counts[t.key] ?? '–'}</b><span>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="agenda-list">
        {loading && !data ? <Spinner /> : !items.length ? (
          <div className="agenda-empty"><PartyPopper size={28} /><span>{active === 'overdue' ? 'Không có việc quá hạn. Tuyệt vời!' : 'Không có việc nào trong mục này'}</span></div>
        ) : items.map((i) => {
          const t = TYPE[i.type] || TYPE.task;
          const due = dueLabel(i, data.today);
          return (
            <Link key={i.key} to={i.link} className="agenda-item">
              <span className={cx('agenda-icon', t.cls)}><t.icon size={15} /></span>
              <span className="grow">
                <span className="agenda-title ellipsis">{i.priority === 'urgent' && <span className="agenda-flag">Khẩn</span>}{i.title}</span>
                <small className="muted ellipsis block">{t.label} · {i.sub}</small>
              </span>
              {due && <span className={cx('agenda-due', due.cls)}>{due.text}</span>}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
