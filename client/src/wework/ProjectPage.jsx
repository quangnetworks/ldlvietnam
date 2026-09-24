import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Plus, Settings, Copy, Trash2, MoreHorizontal, Pencil, ChevronDown, UserPlus, X, History, Calendar as CalIcon,
} from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Avatar, AvatarStack, Spinner, Empty, Dropdown, MenuItem, UserPicker, Modal, Progress, FilterSelect } from '../components/ui.jsx';
import { TASK_STATUS, fmtDate, fmtDateTime, cx } from '../utils.js';
import { useWework } from './WeworkLayout.jsx';
import { TaskRow, TaskTags } from './taskParts.jsx';
import TaskCalendar, { Timeline } from './Calendar.jsx';
import ProjectFormModal from './ProjectFormModal.jsx';
import { ReportView } from './ReportsPage.jsx';

const VIEWS = [
  { value: 'list', label: 'Danh sách' },
  { value: 'board', label: 'Kanban' },
  { value: 'status', label: 'Theo trạng thái' },
  { value: 'calendar', label: 'Lịch' },
  { value: 'gantt', label: 'Tiến độ' },
  { value: 'members', label: 'Thành viên' },
  { value: 'activity', label: 'Hoạt động' },
  { value: 'report', label: 'Báo cáo' },
];

function QuickAdd({ projectId, listId, onAdded }) {
  const [title, setTitle] = useState('');
  const [open, setOpen] = useState(false);
  if (!open) return <button className="quick-add-btn" onClick={() => setOpen(true)}><Plus size={14} /> Thêm công việc</button>;
  return (
    <form className="quick-add" onSubmit={async (e) => {
      e.preventDefault();
      if (!title.trim()) return;
      await api.post('/tasks', { title, project_id: projectId, list_id: listId || null });
      setTitle('');
      onAdded();
    }}>
      <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tên công việc, Enter để thêm"
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} onBlur={() => !title && setOpen(false)} />
    </form>
  );
}

function BoardCard({ t, onOpen }) {
  return (
    <div className={cx('board-card', t.status === 'done' && 'is-done')} draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(t.id)); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={() => onOpen(t.id)}>
      <div className="bc-title">{t.title}</div>
      <div className="task-meta"><TaskTags t={t} showProject={false} /></div>
      <div className="bc-foot">
        <span className="status-dot" style={{ background: TASK_STATUS[t.status].color }} title={TASK_STATUS[t.status].label} />
        {t.due_date && <small className={cx(t.is_overdue ? 'text-red' : 'muted')}><CalIcon size={11} /> {fmtDate(t.due_date)}</small>}
        <div className="grow" />
        {t.assignee_name && <Avatar name={t.assignee_name} color={t.assignee_color} size={22} />}
      </div>
    </div>
  );
}

function Board({ columns, tasks, field, onMove, onOpen, projectId, onAdded, quickAdd }) {
  const [over, setOver] = useState(null);
  return (
    <div className="board">
      {columns.map((c) => {
        const colTasks = tasks.filter((t) => String(t[field] ?? '') === String(c.id ?? ''));
        return (
          <div key={c.id ?? 'none'} className={cx('board-col', over === c.id && 'over')}
            onDragOver={(e) => { e.preventDefault(); setOver(c.id); }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); onMove(Number(e.dataTransfer.getData('text/plain')), c.id); }}>
            <div className="board-col-head" style={c.color ? { borderTopColor: c.color } : undefined}>
              <b>{c.name}</b><span className="muted">{colTasks.length}</span>
            </div>
            <div className="board-col-body">
              {colTasks.map((t) => <BoardCard key={t.id} t={t} onOpen={onOpen} />)}
              {quickAdd && <QuickAdd projectId={projectId} listId={c.id} onAdded={onAdded} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Members({ project, reload }) {
  const { users } = useApp();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState([]);
  const isManager = project.my_role === 'manager';
  const save = async (members) => {
    try {
      await api.put(`/projects/${project.id}/members`, { members });
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const current = project.members.map((m) => ({ user_id: m.id, role: m.role }));
  return (
    <div className="card">
      <div className="row between">
        <h3 className="card-title">Thành viên ({project.members.length})</h3>
        {isManager && <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}><UserPlus size={14} /> Thêm thành viên</button>}
      </div>
      <div className="user-list">
        {project.members.map((m) => (
          <div key={m.id} className="user-row">
            <Avatar name={m.name} color={m.color} size={34} />
            <span className="grow">{m.name}<small className="muted block">@{m.username} · {m.title}</small></span>
            {isManager && m.id !== project.owner_id ? (
              <>
                <select className="input input-sm" value={m.role} onChange={(e) => save(current.map((c) => (c.user_id === m.id ? { ...c, role: e.target.value } : c)))}>
                  <option value="manager">Quản lý</option>
                  <option value="member">Thành viên</option>
                </select>
                <button className="icon-btn sm" onClick={() => save(current.filter((c) => c.user_id !== m.id))} aria-label="Xóa"><X size={15} /></button>
              </>
            ) : <span className="badge badge-gray">{m.id === project.owner_id ? 'Chủ sở hữu' : m.role === 'manager' ? 'Quản lý' : 'Thành viên'}</span>}
          </div>
        ))}
      </div>
      {adding && (
        <Modal title="Thêm thành viên" onClose={() => setAdding(false)} width={480}
          footer={<><button className="btn" onClick={() => setAdding(false)}>Hủy</button>
            <button className="btn btn-primary" disabled={!picked.length} onClick={() => { save([...current, ...picked.map((id) => ({ user_id: id, role: 'member' }))]); setAdding(false); setPicked([]); }}>Thêm</button></>}>
          <UserPicker users={users} multiple exclude={project.members.map((m) => m.id)} value={picked} onChange={setPicked} placeholder="Chọn thành viên" />
        </Modal>
      )}
    </div>
  );
}

export default function ProjectPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { openTask, openCreate, version, bump, loadProjects, canReports } = useWework();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') || 'list';
  const [statusFilter, setStatusFilter] = useState('');
  const [assignee, setAssignee] = useState('');
  const [project, reloadProject, loadingP, errP] = useFetch(() => api.get(`/projects/${id}`), [id, version]);
  const [data, reloadTasks] = useFetch(() => api.get('/tasks', {
    project_id: id, subtasks: 'none', limit: 200, sort: 'position', status: statusFilter, assignee_id: assignee,
  }), [id, version, statusFilter, assignee]);
  const [activity] = useFetch(() => (view === 'activity' ? api.get(`/projects/${id}/activity`) : Promise.resolve(null)), [id, view, version]);
  const [editing, setEditing] = useState(false);
  const [collapsed, setCollapsed] = useState({});

  if (errP) return <div className="ww-page"><div className="ww-main"><div className="alert alert-error">{errP.message}</div></div></div>;
  if (loadingP && !project) return <div className="ww-page"><div className="ww-main"><Spinner /></div></div>;
  if (!project) return null;
  const tasks = data?.items || [];
  const isManager = project.my_role === 'manager';
  const reload = () => { reloadTasks(); reloadProject(); };
  const pct = project.task_count ? Math.round((project.done_count / project.task_count) * 100) : 0;

  const moveTask = async (taskId, patch) => {
    try {
      await api.put(`/tasks/${taskId}`, patch);
      bump();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const addList = async () => {
    const name = window.prompt('Tên nhóm công việc mới');
    if (!name?.trim()) return;
    await api.post(`/projects/${id}/lists`, { name });
    reloadProject();
  };
  const renameList = async (l) => {
    const name = window.prompt('Đổi tên nhóm công việc', l.name);
    if (!name?.trim()) return;
    await api.put(`/projects/${id}/lists/${l.id}`, { name });
    reloadProject();
  };
  const deleteList = async (l) => {
    if (!window.confirm(`Xóa nhóm "${l.name}"? Công việc trong nhóm sẽ chuyển sang "Chưa phân nhóm".`)) return;
    await api.del(`/projects/${id}/lists/${l.id}`);
    reload();
  };
  const listColumns = [...project.lists.map((l) => ({ id: l.id, name: l.name, list: l })),
    ...(tasks.some((t) => !t.list_id) ? [{ id: null, name: 'Chưa phân nhóm' }] : [])];

  return (
    <div className="ww-page">
      <div className="ww-main wide">
        <div className="project-head">
          <span className="proj-dot xl" style={{ background: project.color }}>{project.name.trim()[0]?.toUpperCase()}</span>
          <div className="grow">
            <h1>{project.name} {project.status === 'archived' && <span className="badge badge-gray">ĐÃ LƯU TRỮ</span>}</h1>
            <div className="muted small row gap-sm wrap">
              <span>{project.kind === 'department' ? 'Phòng ban' : 'Dự án'}</span>·
              <span>Quản lý: {project.owner_name}</span>·
              <span>{project.done_count}/{project.task_count} hoàn thành ({pct}%)</span>
              {project.start_date && <>· <span>{fmtDate(project.start_date)} → {fmtDate(project.end_date)}</span></>}
            </div>
          </div>
          <AvatarStack users={project.members} max={5} />
          <button className="btn btn-primary" onClick={() => openCreate({ project_id: project.id })}><Plus size={15} /> Tạo công việc</button>
          <Dropdown align="right" trigger={(o, t) => <button className="btn" onClick={t} aria-label="Thêm"><MoreHorizontal size={16} /></button>}>
            {isManager && <MenuItem icon={Settings} onClick={() => setEditing(true)}>Cài đặt</MenuItem>}
            {isManager && <MenuItem icon={Plus} onClick={addList}>Thêm nhóm công việc</MenuItem>}
            {isManager && !project.is_template && <MenuItem icon={Copy} onClick={async () => {
              const p = await api.post(`/projects/${id}/save-template`, {});
              toast(`Đã lưu thành mẫu "${p.name}"`);
            }}>Lưu thành mẫu</MenuItem>}
            <MenuItem icon={Trash2} danger onClick={async () => {
              if (!window.confirm('Xóa dự án cùng toàn bộ công việc? Thao tác không thể hoàn tác.')) return;
              try {
                await api.del(`/projects/${id}`);
                loadProjects();
                navigate('/wework/projects');
              } catch (e) { toast(e.message, 'error'); }
            }}>Xóa dự án</MenuItem>
          </Dropdown>
        </div>
        <Progress value={pct} color={project.color} />
        {project.description && <p className="muted small">{project.description}</p>}

        <div className="ww-toolbar">
          <div className="view-tabs">
            {VIEWS.filter((v) => v.value !== 'report' || canReports).map((v) => (
              <button key={v.value} className={cx(view === v.value && 'active')} onClick={() => setParams(v.value === 'list' ? {} : { view: v.value })}>{v.label}</button>
            ))}
          </div>
          <div className="grow" />
          {['list', 'board', 'status', 'gantt'].includes(view) && (
            <>
              <FilterSelect value={assignee} onChange={setAssignee} options={[{ value: '', label: 'Tất cả thành viên' }, ...project.members.map((m) => ({ value: m.id, label: m.name }))]} />
              <FilterSelect value={statusFilter} onChange={setStatusFilter} options={[
                { value: '', label: 'Tất cả trạng thái' }, { value: 'active', label: 'Đang thực hiện' },
                ...Object.entries(TASK_STATUS).map(([k, s]) => ({ value: k, label: s.label })), { value: 'overdue', label: 'Quá hạn' },
              ]} />
            </>
          )}
        </div>

        {view === 'list' && (
          <div className="task-groups">
            {listColumns.map((c) => {
              const listTasks = tasks.filter((t) => String(t.list_id ?? '') === String(c.id ?? ''));
              const key = c.id ?? 'none';
              return (
                <div key={key} className="task-group">
                  <div className="group-label row between">
                    <button className="link-btn dark" onClick={() => setCollapsed({ ...collapsed, [key]: !collapsed[key] })}>
                      <ChevronDown size={14} style={{ transform: collapsed[key] ? 'rotate(-90deg)' : '' }} /> {c.name.toUpperCase()} <span className="muted">({listTasks.length})</span>
                    </button>
                    {c.list && isManager && (
                      <Dropdown align="right" trigger={(o, t) => <button className="icon-btn sm" onClick={t} aria-label="Tùy chọn nhóm"><MoreHorizontal size={15} /></button>}>
                        <MenuItem icon={Pencil} onClick={() => renameList(c.list)}>Đổi tên</MenuItem>
                        <MenuItem icon={Trash2} danger onClick={() => deleteList(c.list)}>Xóa nhóm</MenuItem>
                      </Dropdown>
                    )}
                  </div>
                  {!collapsed[key] && (
                    <>
                      {listTasks.map((t) => <TaskRow key={t.id} t={t} onOpen={openTask} onChanged={bump} showProject={false} />)}
                      <QuickAdd projectId={project.id} listId={c.id} onAdded={bump} />
                    </>
                  )}
                </div>
              );
            })}
            {isManager && <button className="btn btn-sm mt" onClick={addList}><Plus size={14} /> Thêm nhóm công việc</button>}
          </div>
        )}
        {view === 'board' && (
          <Board columns={listColumns} tasks={tasks} field="list_id" onOpen={openTask} projectId={project.id} onAdded={bump} quickAdd
            onMove={(taskId, listId) => moveTask(taskId, { list_id: listId })} />
        )}
        {view === 'status' && (
          <Board columns={Object.entries(TASK_STATUS).map(([k, s]) => ({ id: k, name: s.label, color: s.color }))} tasks={tasks} field="status"
            onOpen={openTask} onMove={(taskId, status) => moveTask(taskId, { status })} />
        )}
        {view === 'calendar' && <TaskCalendar filters={{ project_id: project.id }} />}
        {view === 'gantt' && <Timeline tasks={tasks} onOpen={openTask} />}
        {view === 'members' && <Members project={project} reload={reloadProject} />}
        {view === 'activity' && (
          <div className="card">
            {!activity ? <Spinner /> : !activity.length ? <Empty icon={History} title="Chưa có hoạt động" /> : (
              <ul className="timeline">
                {activity.map((a) => (
                  <li key={a.id}>
                    <Avatar name={a.user_name} color={a.user_color} size={22} /> <b>{a.user_name}</b> — {a.detail}
                    {' '}<button className="link-btn" onClick={() => openTask(a.entity_id)}>{a.task_title}</button>
                    <small className="muted block">{fmtDateTime(a.created_at)}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {view === 'report' && canReports && <ReportView projectId={project.id} />}
      </div>
      {editing && <ProjectFormModal project={project} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reloadProject(); loadProjects(); }} />}
    </div>
  );
}
