import { Link } from 'react-router-dom';
import { Flame, Star, AlertOctagon, CheckCircle2 } from 'lucide-react';
import { Avatar } from '../components/ui.jsx';
import { cx, parseDate } from '../utils.js';

const ROLE = { assignee: 'Bạn thực hiện', creator: 'Bạn giao', follower: 'Bạn theo dõi' };
const STATUS = { todo: 'Cần làm', doing: 'Đang làm', review: 'Chờ đánh giá' };

function dueText(due, today) {
  if (!due) return { text: 'Không thời hạn', cls: 'muted' };
  const days = Math.round((parseDate(due) - parseDate(today)) / 864e5);
  if (days < 0) return { text: `Quá hạn ${-days} ngày`, cls: 'danger' };
  if (days === 0) return { text: 'Hạn hôm nay', cls: 'warn' };
  if (days === 1) return { text: 'Hạn ngày mai', cls: 'warn' };
  return { text: `Còn ${days} ngày`, cls: '' };
}

/** "Quan trọng cần lưu ý": công việc khẩn cấp / quan trọng chưa xong mà tôi thực hiện, giao hoặc theo dõi. */
export default function HomeImportant({ data }) {
  const list = data?.important || [];
  if (!data) return null;
  const overdue = list.filter((i) => i.bucket === 'overdue').length;
  return (
    <section className="hcard important">
      <div className="hcard-head">
        <h3><AlertOctagon size={16} className="text-red" /> Quan trọng cần lưu ý</h3>
        {list.length > 0 && <span className="imp-count">{list.length}{overdue > 0 && <b> · {overdue} quá hạn</b>}</span>}
      </div>
      {!list.length ? (
        <div className="agenda-empty"><CheckCircle2 size={26} /><span>Không có công việc khẩn cấp / quan trọng nào đang mở</span></div>
      ) : (
        <div className="imp-list">
          {list.slice(0, 8).map((i) => {
            const d = dueText(i.due, data.today);
            return (
              <Link key={i.key} to={i.link} className={cx('imp-item', i.priority, i.bucket === 'overdue' && 'late')}>
                <span className={cx('imp-flag', i.priority)}>{i.priority === 'urgent' ? <><Flame size={12} /> Khẩn cấp</> : <><Star size={12} /> Quan trọng</>}</span>
                <span className="grow imp-body">
                  <b className="ellipsis block">{i.title}</b>
                  <small className="muted ellipsis block">{ROLE[i.role]} · {STATUS[i.status]}{i.project_name ? ` · ${i.project_name}` : ''}</small>
                </span>
                <span className="imp-right">
                  <span className={cx('agenda-due', d.cls)}>{d.text}</span>
                  {i.role !== 'assignee' && i.assignee_name && <Avatar name={i.assignee_name} color={i.assignee_color} uid={i.assignee_id} size={20} title={i.assignee_name} />}
                </span>
              </Link>
            );
          })}
          {list.length > 8 && <Link to="/wework" className="link small imp-more">Xem tất cả {list.length} công việc</Link>}
        </div>
      )}
    </section>
  );
}
