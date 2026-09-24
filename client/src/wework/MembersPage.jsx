import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '../api.js';
import { useFetch } from '../context.jsx';
import { Avatar, Spinner } from '../components/ui.jsx';
import { useWework } from './WeworkLayout.jsx';

export default function MembersPage() {
  const { version } = useWework();
  const [members] = useFetch(() => api.get('/wework/members'), [version]);
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const list = (members || []).filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()) || m.department_name?.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="ww-page">
      <div className="ww-main wide">
        <div className="page-head">
          <h1>Thành viên</h1>
          <div className="ww-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm thành viên, phòng ban" /></div>
        </div>
        {!members ? <Spinner /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Thành viên</th><th>Phòng ban</th><th>Tổng CV</th><th>Đang thực hiện</th><th>Hoàn thành</th><th>Quá hạn</th></tr></thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id} className="clickable" onClick={() => navigate(`/wework?scope=all&assignee_id=${m.id}`)}>
                    <td><span className="row gap-sm"><Avatar name={m.name} color={m.color} size={30} /><span>{m.name}<small className="muted block">{m.title} · @{m.username}</small></span></span></td>
                    <td>{m.department_name}</td>
                    <td>{m.total}</td>
                    <td>{m.active}</td>
                    <td className="text-green">{m.done}</td>
                    <td className={m.overdue ? 'text-red' : ''}>{m.overdue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
