import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, FolderKanban, Users, AlertCircle, Copy, LayoutGrid, List } from 'lucide-react';
import { api } from '../api.js';
import { useFetch } from '../context.jsx';
import { Avatar, Spinner, Empty, Progress, FilterSelect } from '../components/ui.jsx';
import { useDebounced } from '../components/shell.jsx';
import { fmtDate, cx } from '../utils.js';
import { useWework } from './WeworkLayout.jsx';

const TITLES = {
  project: 'Dự án',
  department: 'Phòng ban',
  template: 'Tạo từ mẫu',
};

export default function ProjectsPage({ kind }) {
  const { openProjectForm, version } = useWework();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [filterKind, setFilterKind] = useState(kind === 'department' ? 'department' : kind === 'project' ? 'project' : '');
  const [view, setView] = useState('grid');
  const dq = useDebounced(q);
  const isTemplate = kind === 'template';
  const [items, , loading] = useFetch(() => api.get('/projects', {
    q: dq, template: isTemplate ? 1 : undefined, kind: kind === 'department' ? 'department' : filterKind || undefined,
    status: isTemplate ? undefined : status,
  }), [dq, kind, status, filterKind, version]);

  return (
    <div className="ww-page">
      <div className="ww-main">
        <div className="page-head">
          <div>
            <h1>{TITLES[kind]}</h1>
            {isTemplate && <p className="muted">Chọn một mẫu để tạo nhanh dự án với các nhóm công việc và đầu việc có sẵn. Mở một dự án bất kỳ và chọn "Lưu thành mẫu" để tạo mẫu mới.</p>}
          </div>
          <div className="page-actions">
            {!isTemplate && (
              <button className="btn btn-primary" onClick={() => openProjectForm({ kind: kind === 'department' ? 'department' : 'project' })}>
                <Plus size={15} /> {kind === 'department' ? 'Tạo phòng ban mới' : 'Tạo dự án mới'}
              </button>
            )}
          </div>
        </div>
        <div className="ww-toolbar">
          <div className="ww-search">
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm kiếm" />
          </div>
          <div className="grow" />
          {kind === 'project' && (
            <FilterSelect value={filterKind} onChange={setFilterKind}
              options={[{ value: 'project', label: 'Dự án' }, { value: '', label: 'Dự án & phòng ban' }]} />
          )}
          {!isTemplate && (
            <FilterSelect value={status} onChange={setStatus}
              options={[{ value: 'active', label: 'Đang hoạt động' }, { value: 'archived', label: 'Đã lưu trữ' }]} />
          )}
          <div className="seg">
            <button className={cx(view === 'grid' && 'active')} onClick={() => setView('grid')} aria-label="Dạng lưới"><LayoutGrid size={15} /></button>
            <button className={cx(view === 'list' && 'active')} onClick={() => setView('list')} aria-label="Dạng danh sách"><List size={15} /></button>
          </div>
        </div>
        {loading && !items ? <Spinner /> : !items?.length ? (
          <Empty icon={FolderKanban} title="Không có kết quả nào" />
        ) : view === 'grid' ? (
          <div className="project-grid">
            {items.map((p) => {
              const pct = p.task_count ? Math.round((p.done_count / p.task_count) * 100) : 0;
              return (
                <div key={p.id} className="project-card">
                  <Link to={`/wework/project/${p.id}`} className="pc-top">
                    <span className="proj-dot lg" style={{ background: p.color }}>{p.name.trim()[0]?.toUpperCase()}</span>
                    <div className="grow">
                      <b className="ellipsis block">{p.name}</b>
                      <small className="muted">{p.kind === 'department' ? 'Phòng ban' : 'Dự án'}{p.department_name && ` · ${p.department_name}`}</small>
                    </div>
                  </Link>
                  {p.description && <p className="muted small clamp2">{p.description}</p>}
                  <Progress value={pct} color={p.color} />
                  <div className="pc-stats">
                    <span>{p.done_count}/{p.task_count} công việc · {pct}%</span>
                    {p.overdue_count > 0 && <span className="text-red"><AlertCircle size={12} /> {p.overdue_count} quá hạn</span>}
                  </div>
                  <div className="pc-foot">
                    <span className="row gap-sm"><Avatar name={p.owner_name} color={p.owner_color} size={20} /> <small>{p.owner_name}</small></span>
                    <small className="muted"><Users size={12} /> {p.member_count}</small>
                    {isTemplate && (
                      <button className="btn btn-sm btn-primary" onClick={() => openProjectForm({ kind: p.kind, templateId: p.id })}><Copy size={13} /> Dùng mẫu</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Tên</th><th>Loại</th><th>Quản lý</th><th>Thành viên</th><th>Tiến độ</th><th>Quá hạn</th><th>Ngày tạo</th></tr></thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td><Link to={`/wework/project/${p.id}`} className="row gap-sm"><span className="proj-dot" style={{ background: p.color }}>{p.name[0]}</span> {p.name}</Link></td>
                    <td>{p.kind === 'department' ? 'Phòng ban' : 'Dự án'}</td>
                    <td>{p.owner_name}</td>
                    <td>{p.member_count}</td>
                    <td style={{ minWidth: 140 }}><Progress value={p.task_count ? (p.done_count / p.task_count) * 100 : 0} color={p.color} /> <small>{p.done_count}/{p.task_count}</small></td>
                    <td className={p.overdue_count ? 'text-red' : ''}>{p.overdue_count}</td>
                    <td>{fmtDate(p.created_at)}</td>
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
