import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, ChevronRight, Asterisk, X, Target, Trash2, Save, ClipboardList } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Avatar, FilterSelect, Dropdown, MenuItem, Spinner, Empty, Progress, Modal, Field } from '../components/ui.jsx';
import { useDebounced } from '../components/shell.jsx';
import { weekLabel, fmtDate, cx } from '../utils.js';
import { useWework } from './WeworkLayout.jsx';
import { TaskRow, nestTasks } from './taskParts.jsx';
import TaskCalendar from './Calendar.jsx';
import GoalModal from './GoalModal.jsx';

const SCOPES = [
  { value: 'mine', label: 'Giao & được giao' },
  { value: 'assigned', label: 'CV được giao' },
  { value: 'created', label: 'CV giao đi' },
  { value: 'starred', label: 'CV đánh dấu sao' },
  { value: 'all', label: 'Tất cả công việc' },
];
const STATUSES = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'active', label: 'Đang thực hiện (Cần làm & Đang làm)' },
  { value: 'unreviewed', label: 'Đang thực hiện và chưa đánh giá' },
  { value: 'todo', label: 'Cần làm' },
  { value: 'doing', label: 'Đang làm' },
  { value: 'done', label: 'Đã hoàn thành' },
  { value: 'failed', label: 'Thất bại' },
  { value: 'review', label: 'Đang chờ đánh giá' },
  { value: 'late', label: 'Hoàn thành muộn' },
  { value: 'overdue', label: 'Quá hạn' },
  { value: 'urgent', label: 'Khẩn cấp' },
  { value: 'important', label: 'Quan trọng' },
  { value: 'critical', label: 'Quan trọng & khẩn cấp' },
];
const SUBTASKS = [
  { value: '', label: 'Công việc & công việc con' },
  { value: 'none', label: 'Không có công việc con' },
  { value: 'only', label: 'Chỉ công việc con' },
];
const SORTS = [
  { value: 'updated', label: 'Thời gian cập nhật' },
  { value: 'created', label: 'Thời gian tạo' },
  { value: 'due', label: 'Thời hạn hoàn thành' },
];
const FILTER_KEYS = ['scope', 'status', 'project_id', 'sort', 'subtasks', 'assignee_id', 'q'];

function groupByWeek(items, sort) {
  const groups = [];
  const map = new Map();
  for (const t of items) {
    const basis = sort === 'due' ? t.due_date : sort === 'created' ? t.created_at : t.updated_at;
    const label = basis ? weekLabel(basis) : 'KHÔNG CÓ THỜI HẠN';
    if (!map.has(label)) { map.set(label, []); groups.push({ label, items: map.get(label) }); }
    map.get(label).push(t);
  }
  return groups;
}

function RightPanel({ onPick }) {
  const { user } = useApp();
  const { openTask, version } = useWework();
  const toast = useToast();
  const [s, reload] = useFetch(() => api.get('/wework/summary'), [version]);
  const [filters, reloadFilters] = useFetch(() => api.get('/filters'), []);
  const [open, setOpen] = useState(null);
  const [goalForm, setGoalForm] = useState(null);
  if (!s) return <aside className="ww-right"><Spinner /></aside>;
  const list = (key, items) => open === key && (
    <div className="rp-list">
      {items.map((t) => (
        <button key={t.id} className="rp-task" onClick={() => openTask(t.id)}>
          <span className="ellipsis grow">{t.title}</span>
          <small className={cx(t.is_overdue ? 'text-red' : 'muted')}>{fmtDate(t.due_date)}</small>
        </button>
      ))}
      {!items.length && <div className="empty-small">Không có công việc</div>}
    </div>
  );
  return (
    <aside className="ww-right">
      <div className="rp-card">
        <div className="rp-user"><Avatar name={user.name} color={user.color} size={40} /><h2>{user.name}</h2></div>
        <div className="rp-stat">
          <span><ClipboardList size={14} /> Công việc được giao</span><b>{s.rate.toFixed(2)}%</b>
        </div>
        <Progress value={s.rate} color="#37b24d" />
        <div className="rp-sub">{s.done}/{s.total} hoàn thành{s.overdue > 0 && <span className="text-red"> · {s.overdue} quá hạn</span>}</div>
        <button className="rp-row" onClick={() => setOpen(open === 'na' ? null : 'na')}><Asterisk size={14} /> Mới được giao <ChevronRight size={14} className={cx('rot', open === 'na' && 'on')} /></button>
        {list('na', s.new_assigned)}
        <button className="rp-row" onClick={() => setOpen(open === 'nc' ? null : 'nc')}><Asterisk size={14} /> Mới giao đi <ChevronRight size={14} className={cx('rot', open === 'nc' && 'on')} /></button>
        {list('nc', s.new_created)}
        {s.alerts.length > 0 && (
          <>
            <button className="rp-row text-red" onClick={() => setOpen(open === 'al' ? null : 'al')}><Asterisk size={14} /> Cảnh báo ưu tiên ({s.alerts.length}) <ChevronRight size={14} className={cx('rot', open === 'al' && 'on')} /></button>
            {list('al', s.alerts)}
          </>
        )}
      </div>
      <div className="rp-card">
        <div className="rp-head">MỤC TIÊU <button className="link-btn" onClick={() => setGoalForm({})}>+ THÊM</button></div>
        {s.goals.map((g) => (
          <div key={g.id} className="goal" onClick={() => setGoalForm(g)} title="Bấm để gắn công việc liên quan, cập nhật tiến độ">
            <div className="row"><Target size={14} /> <span className="grow ellipsis">{g.title}</span><b>{g.progress}%</b></div>
            <Progress value={g.progress} />
            <small className="muted goal-meta">{g.task_count ? `${g.task_done}/${g.task_count} công việc hoàn thành` : 'Chưa gắn công việc'}
              {g.task_overdue > 0 && <span className="text-red"> · {g.task_overdue} quá hạn</span>}{g.due_date && ` · hạn ${fmtDate(g.due_date)}`}</small>
          </div>
        ))}
        {!s.goals.length && <div className="empty-small">Đặt mục tiêu và gắn các công việc liên quan để theo dõi tiến độ</div>}
      </div>
      <div className="rp-card">
        <div className="rp-head">BỘ LỌC TÙY CHỈNH <button className="link-btn" onClick={() => onPick({ saveCurrent: true, reload: reloadFilters })}>+ THÊM</button></div>
        {filters?.map((f) => (
          <div key={f.id} className="rp-filter">
            <button className="link-btn grow" onClick={() => onPick({ filter: f })}>{f.name}</button>
            <button className="icon-btn sm" onClick={async () => { await api.del(`/filters/${f.id}`); reloadFilters(); }} aria-label="Xóa"><X size={13} /></button>
          </div>
        ))}
      </div>
      <div className="rp-card">
        <div className="rp-head">NHÂN VIÊN CỦA TÔI</div>
        {s.team.map((m) => (
          <button key={m.id} className="rp-member" onClick={() => onPick({ member: m.id })}>
            <Avatar name={m.name} color={m.color} size={26} />
            <span className="grow ellipsis">{m.name}</span>
            <small className="muted">{m.active}</small>
            {m.overdue > 0 && <small className="text-red">· {m.overdue}</small>}
          </button>
        ))}
        {!s.team.length && <div className="empty-small">Bạn chưa quản lý nhân viên nào</div>}
      </div>
      {goalForm && <GoalModal goal={goalForm.id ? goalForm : null} onClose={() => setGoalForm(null)} onSaved={() => { setGoalForm(null); reload(); }} />}
    </aside>
  );
}

function TeamView() {
  const [members] = useFetch(() => api.get('/wework/members', { team: 1 }), []);
  const [params, setParams] = useSearchParams();
  if (!members) return <Spinner />;
  if (!members.length) return <Empty title="Bạn chưa quản lý nhân viên nào">Quản trị viên có thể thiết lập "Quản lý trực tiếp" trong phần Quản trị.</Empty>;
  return (
    <div className="member-grid">
      {members.map((m) => (
        <button key={m.id} className="member-card" onClick={() => { const n = new URLSearchParams(params); n.set('tab', 'tasks'); n.set('scope', 'all'); n.set('assignee_id', m.id); setParams(n); }}>
          <Avatar name={m.name} color={m.color} size={44} />
          <b>{m.name}</b>
          <small className="muted">{m.title}</small>
          <div className="member-stats">
            <span><b>{m.active}</b> đang làm</span>
            <span className="text-green"><b>{m.done}</b> xong</span>
            <span className="text-red"><b>{m.overdue}</b> quá hạn</span>
          </div>
        </button>
      ))}
    </div>
  );
}

export default function TasksHome({ mode }) {
  const { user, users } = useApp();
  const { projects, openTask, openCreate, version, bump } = useWework();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') || '');
  const dq = useDebounced(search, 350);
  const tab = params.get('tab') || 'tasks';
  const [filters] = useFetch(() => api.get('/filters'), [version]);

  const query = useMemo(() => {
    const q = {};
    for (const k of FILTER_KEYS) if (params.get(k)) q[k] = params.get(k);
    if (!q.scope) q.scope = mode === 'my' ? 'assigned' : 'mine';
    if (q.scope === 'all') delete q.scope;
    if (tab === 'following') q.scope = 'following';
    if (tab === 'recurring') q.scope = 'recurring';
    if (dq) q.q = dq;
    q.page = params.get('page') || 1;
    q.limit = 50;
    return q;
  }, [params, tab, mode, dq]);
  const [data, reload, loading] = useFetch(() => api.get('/tasks', query), [JSON.stringify(query), version]);

  const setParam = (patch) => {
    const n = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === '' || v == null ? n.delete(k) : n.set(k, v));
    if (!('page' in patch)) n.delete('page');
    setParams(n);
  };
  const setTab = (t) => {
    const n = new URLSearchParams();
    if (t !== 'tasks') n.set('tab', t);
    setParams(n);
  };

  const [saveFilter, setSaveFilter] = useState(null);
  const onPick = ({ filter, member, saveCurrent, reload: rf }) => {
    if (filter) {
      const q = JSON.parse(filter.query || '{}');
      const n = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (v) n.set(k, v);
      n.set('cf', filter.id);
      setParams(n);
    } else if (member) {
      setParams(new URLSearchParams({ scope: 'all', assignee_id: member }));
    } else if (saveCurrent) {
      setSaveFilter({ name: '', reload: rf });
    }
  };
  const doSaveFilter = async () => {
    const q = {};
    for (const k of FILTER_KEYS) if (params.get(k)) q[k] = params.get(k);
    await api.post('/filters', { name: saveFilter.name, query: q });
    saveFilter.reload?.();
    bump();
    setSaveFilter(null);
    toast('Đã lưu bộ lọc tùy chỉnh');
  };

  const items = data?.items || [];
  const groups = groupByWeek(items, query.sort);
  const assigneeName = params.get('assignee_id') && users.find((u) => String(u.id) === params.get('assignee_id'))?.name;
  const activeFilter = filters?.find((f) => String(f.id) === params.get('cf'));

  const TABS = [
    { value: 'tasks', label: mode === 'my' ? 'CÔNG VIỆC CỦA TÔI' : 'CÔNG VIỆC' },
    { value: 'team', label: 'NHÂN VIÊN CỦA TÔI' },
    { value: 'following', label: 'ĐANG THEO DÕI' },
    { value: 'calendar', label: 'LỊCH BIỂU' },
    { value: 'recurring', label: 'CV LẶP LẠI' },
  ];

  return (
    <div className="ww-page with-right">
      <div className="ww-main">
        <div className="ww-header">
          <Avatar name={user.name} color={user.color} size={36} />
          <div className="grow">
            <div className="ww-name">{user.name}</div>
            <div className="ww-tabs">
              {TABS.slice(0, 2).map((t) => (
                <button key={t.value} className={cx(tab === t.value && 'active')} onClick={() => setTab(t.value)}>{t.label}</button>
              ))}
              <Dropdown trigger={(o, tg) => (
                <button className={cx(params.get('cf') && 'active')} onClick={tg}>BỘ LỌC TÙY CHỈNH <span className="caret" /></button>
              )}>
                {filters?.map((f) => <MenuItem key={f.id} active={String(f.id) === params.get('cf')} onClick={() => onPick({ filter: f })}>{f.name}</MenuItem>)}
                {!filters?.length && <div className="empty-small">Chưa có bộ lọc</div>}
                <MenuItem icon={Save} onClick={() => setSaveFilter({ name: '' })}>Lưu bộ lọc hiện tại</MenuItem>
              </Dropdown>
              {TABS.slice(2).map((t) => (
                <button key={t.value} className={cx(tab === t.value && 'active')} onClick={() => setTab(t.value)}>{t.label}</button>
              ))}
            </div>
          </div>
          <div className="ww-search">
            <Search size={14} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm kiếm công việc" />
          </div>
        </div>

        {tab === 'team' ? <TeamView /> : tab === 'calendar' ? (
          <TaskCalendar filters={{ scope: 'mine' }} />
        ) : (
          <>
            <div className="ww-toolbar">
              <button className="create-task" onClick={() => openCreate({})}><span className="plus-circle"><Plus size={16} /></span> Tạo công việc mới</button>
              <div className="grow" />
              {tab === 'tasks' && <FilterSelect value={params.get('scope') || (mode === 'my' ? 'assigned' : 'mine')} options={SCOPES} onChange={(v) => setParam({ scope: v })} />}
              <FilterSelect value={params.get('subtasks') || ''} options={SUBTASKS} onChange={(v) => setParam({ subtasks: v })} />
              <FilterSelect value={params.get('status') || ''} options={STATUSES} onChange={(v) => setParam({ status: v })} />
              <FilterSelect value={params.get('project_id') || ''} options={[{ value: '', label: 'Tất cả dự án' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} onChange={(v) => setParam({ project_id: v })} />
              <FilterSelect value={params.get('sort') || 'updated'} options={SORTS} onChange={(v) => setParam({ sort: v })} />
            </div>
            {(assigneeName || activeFilter) && (
              <div className="filter-chips">
                {assigneeName && <span className="chip">Người thực hiện: {assigneeName} <button className="chip-x" onClick={() => setParam({ assignee_id: '' })}><X size={12} /></button></span>}
                {activeFilter && <span className="chip">Bộ lọc: {activeFilter.name} <button className="chip-x" onClick={() => setParams(new URLSearchParams())}><X size={12} /></button></span>}
              </div>
            )}
            {loading && !data ? <Spinner /> : !items.length ? (
              <Empty icon={ClipboardList} title="Không có kết quả nào">
                {tab === 'recurring' ? 'Chưa có công việc lặp lại. Chọn "Lặp lại" khi tạo công việc.' : 'Hãy tạo công việc mới hoặc thay đổi bộ lọc.'}
              </Empty>
            ) : (
              <div className="task-groups">
                {groups.map((g) => (
                  <div key={g.label} className="task-group">
                    <div className="group-label">{g.label}</div>
                    {nestTasks(g.items).map(({ t, depth, orphan, childrenShown }) => <TaskRow key={t.id} t={t} depth={depth} orphan={orphan} childrenShown={childrenShown} onOpen={openTask} onChanged={reload} />)}
                  </div>
                ))}
              </div>
            )}
            {data && data.total > data.limit ? (
              <div className="simple-pager">
                <button className="icon-btn" disabled={data.page <= 1} onClick={() => setParam({ page: data.page - 1 })}>←</button>
                <span>Trang {data.page}</span>
                <button className="icon-btn" disabled={data.page * data.limit >= data.total} onClick={() => setParam({ page: data.page + 1 })}>→</button>
              </div>
            ) : data && items.length ? <div className="simple-pager"><span>Trang 1</span></div> : null}
          </>
        )}
      </div>
      <RightPanel onPick={onPick} />
      {saveFilter && (
        <Modal title="Lưu bộ lọc tùy chỉnh" onClose={() => setSaveFilter(null)} width={420}
          footer={<><button className="btn" onClick={() => setSaveFilter(null)}>Hủy</button><button className="btn btn-primary" disabled={!saveFilter.name.trim()} onClick={doSaveFilter}>Lưu</button></>}>
          <p className="muted small">Bộ lọc sẽ lưu các điều kiện đang chọn (phạm vi, trạng thái, dự án, sắp xếp...).</p>
          <Field label="Tên bộ lọc" required><input className="input" autoFocus value={saveFilter.name} onChange={(e) => setSaveFilter({ ...saveFilter, name: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}
