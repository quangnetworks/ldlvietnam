import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { TaskDetail } from './TaskDrawer.jsx';
import { useWework } from './WeworkLayout.jsx';

export default function TaskPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { bump } = useWework();
  return (
    <div className="ww-page">
      <div className="ww-main task-page">
        <button className="link-btn" onClick={() => navigate('/wework')}><ArrowLeft size={14} /> Danh sách công việc</button>
        <div className="card no-pad">
          <TaskDetail id={Number(id)} standalone onChanged={bump} onClose={() => navigate('/wework')} />
        </div>
      </div>
    </div>
  );
}
