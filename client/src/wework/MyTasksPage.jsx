import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardCheck, Plus, CalendarClock, Filter, FolderKanban, Layers, Settings2, ChevronDown, ChevronRight, ListTree, Search, Award,
} from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Avatar, Dropdown, MenuItem, Spinner } from '../components/ui.jsx';
import { useDebounced } from '../components/shell.jsx';
import { isoDate, parseDate, fmtDate, cx } from '../utils.js';
import { useWework } from './WeworkLayout.jsx';

/** "Công việc của tôi" dạng bảng (theo bố cục Base Wework): tab giao cho tôi / tôi giao đi / đang theo dõi, nhóm theo thời hạn. */
const TABS = [
  { key: 'assigned', label: 'Giao cho tôi' },
  { key: 'created', label: 'Tôi giao đi' },
  { key: 'following', label: 'Đang theo dõi' },
];
const SORTS = [
  { value: 'updated', label: 'Cập nhật gần đây' },
  { value: 'created', label: 'Mới tạo gần đây' },
  { value: 'due', label: 'Thời hạn gần nhất' },
];
const STATUSES = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'active', label: 'Đang thực hiện' },
  { value: 'overdue', label: 'Quá hạn' },
  { value: 'review', label: 'Chờ đánh giá' },
  { value: 'done', label: 'Đã hoàn thành' },
  { value: 'late', label: 'Hoàn thành muộn' },
  { value: 'failed', label: 'Thất bại' },
  { value: 'urgent,important', label: 'Khẩn cấp & quan trọng' },
];
const GROUP_BY = [
  { value: 'due', label: 'Thời hạn' },
  { value: 'status', label: 'Trạng thái' },
  { value: 'project', label: 'Dự án' },
  { value: 'priority', label: 'Mức ưu tiên' },
];
const COLUMNS = [
  { key: 'status', label: 'Trạng thái', width: 130 },
  { key: 'start', label: 'Thời gian bắt đầu', width: 150 },
  { key: 'due', label: 'Thời hạn', width: 150 },
  { key: 'completed', label: 'Thời gian hoàn thành', width: 160 },
  { key: 'project', label: 'Dự án', width: 200 },
  { key: 'parent', label: 'Công việc cha', width: 190 },
  { key: 'labels', label: 'Nhãn', width: 130 },
  { key: 'results', label: 'Kết quả', width: 90 },
  { key: 'creator', label: 'Tạo bởi', width: 160 },
  { key: 'assignee', label: 'Giao cho', width: 160 },
];
const COLS_KEY = 'ldl.mytasks.cols';
const PREF_KEY = 'ldl.mytasks.prefs';
const load = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bỏ qua */ } };

const BADGE = {
  overdue: { label: 'Quá hạn', cls: 'b-red' },
  todo: { label: 'Cần làm', cls: 'b-gray' },
  doing: { label: 'Đang làm', cls: 'b-blue' },
  review: { label: 'Chờ đánh giá', cls: 'b-purple' },
  done: { label: 'Hoàn thành', cls: 'b-green' },
  late: { label: 'HT muộn', cls: 'b-amber' },
  failed: { label: 'Thất bại', cls: 'b-dark' },
};
const badgeOf = (t) => (t.is_overdue ? 'overdue' : t.is_late ? 'late' : t.status);

const addDays = (n) => isoDate(new Date(Date.now() + n * 864e5));
/** Nhóm theo thời hạn: Trước đây · Hôm nay · Ngày mai · 7 ngày tới · Trong tương lai · Không thời hạn. */
function dueBuckets() {
  const today = addDays(0);
  const tomorrow = addDays(1);
  const in7 = addDays(7);
  return [
    { key: 'past', label: 'Trước đây', test: (d) => d && d < today, preset: addDays(-1) },
    { key: 'today', label: 'Hôm nay', test: (d) => d === today, preset: today },
    { key: 'tomorrow', label: 'Ngày mai', test: (d) => d === tomorrow, preset: tomorrow },
    { key: 'week', label: '7 ngày tới', test: (d) => d && d > tomorrow && d <= in7, preset: addDays(3) },
    { key: 'future', label: 'Trong tương lai', test: (d) => d && d > in7, preset: addDays(14) },
    { key: 'none', label: 'Không thời hạn', test: (d) => !d, preset: '' },
  ];
}

function groupTasks(items, by, projects) {
  if (by === 'due') {
    const buckets = dueBuckets();
    return buckets.map((b) => ({ ...b, items: items.filter((t) => b.test(t.due_date?.slice(0, 10) || null)) }));
  }
  if (by === 'status') {
    return Object.entries(BADGE).map(([k, v]) => ({ key: k, label: v.label, items: items.filter((t) => badgeOf(t) === k), defaults: {} }));
  }
  if (by === 'priority') {
    return [['urgent', 'Khẩn cấp'], ['important', 'Quan trọng'], ['normal', 'Bình thường']]
      .map(([k, l]) => ({ key: k, label: l, items: items.filter((t) => t.priority === k), defaults: { priority: k } }));
  }
  const ids = [...new Set(items.map((t) => t.project_id || 0))];
  return ids.map((id) => ({
    key: `p${id}`, label: id ? items.find((t) => t.project_id === id)?.project_name || projects.find((p) => p.id === id)?.name : 'Công việc cá nhân',
    items: items.filter((t) => (t.project_id || 0) === id), defaults: id ? { project_id: id } : {},
  }));
}

/** Ngày giờ theo kiểu Base: "00:00 07/09/2026" (ngày không có giờ: bắt đầu 00:00, thời hạn 23:59). */
function stamp(v, endOfDay) {
  if (!v) return <span className="muted">—</span>;
  if (v.length <= 10) return `${endOfDay ? '23:59' : '00:00'} ${fmtDate(v)}`;
  const d = parseDate(v.length === 16 ? `${v}:00`.replace('T', ' ') : v);
  if (!d || Number.isNaN(d.getTime())) return fmtDate(v);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${fmtDate(d)}`;
}

function Person({ name, color, id }) {
  if (!name) return <span className="muted">—</span>;
  return <span className="mt-person"><Avatar name={name} color={color} uid={id} size={22} /><span className="ellipsis">{name}</span></span>;
}

function QuickAdd({ group, tab, onDone }) {
  const { user } = useApp();
  const { openCreate } = useWework();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const busy = useRef(false);
  const defaults = { ...(group.defaults || {}), ...(group.preset !== undefined && group.preset ? { due_date: group.preset } : {}) };
  const submit = async () => {
    if (!title.trim() || busy.current) return;
    busy.current = true;
    try {
      await api.post('/tasks', { title: title.trim(), assignee_id: user.id, ...defaults });
      setTitle('');
      onDone();
    } catch (e) { toast(e.message, 'error'); } finally { busy.current = false; }
  };
  // "Tôi giao đi": cần chọn người thực hiện → mở hộp thoại tạo công việc
  if (tab === 'created') {
    return <button type="button" className="mt-add" onClick={() => openCreate({ ...defaults, openAfter: false })}><Plus size={14} /> Tạo công việc</button>;
  }
  if (!open) return <button type="button" className="mt-add" onClick={() => setOpen(true)}><Plus size={14} /> Tạo công việc</button>;
  return (
    <div className="mt-add editing">
      <Plus size={14} />
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nhập tên công việc, Enter để tạo · Esc để huỷ"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); submit(); }
          if (e.key === 'Escape') { setOpen(false); setTitle(''); }
        }}
        onBlur={() => !title && setOpen(false)} />
    </div>
  );
}

export default function MyTasksPage() {
  const { projects, openTask, openCreate, version, bump } = useWework();
  const toast = useToast();
  const [prefs, setPrefs] = useState(() => load(PREF_KEY, { tab: 'assigned', sort: 'updated', status: '', project_id: '', group: 'due' }));
  const [cols, setCols] = useState(() => load(COLS_KEY, Object.fromEntries(COLUMNS.map((c) => [c.key, c.key !== 'results']))));
  const [collapsed, setCollapsed] = useState({});
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [limit, setLimit] = useState(200);
  const setPref = (k, v) => setPrefs((p) => { const n = { ...p, [k]: v }; save(PREF_KEY, n); return n; });
  const toggleCol = (k) => setCols((c) => { const n = { ...c, [k]: !c[k] }; save(COLS_KEY, n); return n; });

  const [data, reload, loading] = useFetch(async () => {
    // API trả tối đa 200 công việc / trang → gộp nhiều trang khi "Tải thêm"
    const params = { scope: prefs.tab, sort: prefs.sort, status: prefs.status, project_id: prefs.project_id, q: dq.trim() || undefined, limit: 200 };
    const first = await api.get('/tasks', { ...params, page: 1 });
    const pages = Math.min(Math.ceil(first.total / 200), limit / 200);
    let all = first.items;
    for (let p = 2; p <= pages; p++) all = all.concat((await api.get('/tasks', { ...params, page: p })).items);
    return { ...first, items: all };
  }, [prefs.tab, prefs.sort, prefs.status, prefs.project_id, dq, limit, version]);
  const items = data?.items || [];
  const groups = useMemo(() => groupTasks(items, prefs.group, projects), [items, prefs.group, projects]);
  const shown = COLUMNS.filter((c) => cols[c.key]);
  useEffect(() => { setLimit(200); }, [prefs.tab]);

  const toggleDone = async (t) => {
    try {
      await api.put(`/tasks/${t.id}`, { status: t.status === 'done' ? 'todo' : 'done' });
      if (t.status !== 'done') toast('Đã hoàn thành công việc');
      bump();
    } catch (e) { toast(e.message, 'error'); }
  };
  const label = (list, v) => list.find((x) => x.value === v)?.label;
  const projectName = prefs.project_id ? projects.find((p) => String(p.id) === String(prefs.project_id))?.name : null;

  const cell = (t, key) => {
    switch (key) {
      case 'status': { const b = BADGE[badgeOf(t)]; return <span className={cx('mt-badge', b.cls)}>{b.label}</span>; }
      case 'start': return stamp(t.start_date, false);
      case 'due': return <span className={cx(t.is_overdue && 'text-red')}>{stamp(t.due_date, true)}</span>;
      case 'completed': return t.completed_at ? stamp(t.completed_at.replace(' ', 'T').slice(0, 16), false) : <span className="muted">—</span>;
      case 'project': return t.project_name ? <span className="ellipsis block">{t.project_name}</span> : <span className="muted">Cá nhân</span>;
      case 'parent': return t.parent_title
        ? <button type="button" className="mt-link ellipsis" onClick={(e) => { e.stopPropagation(); openTask(t.parent_id); }}>{t.parent_title}</button>
        : null;
      case 'labels': return t.priority !== 'normal' ? <span className={cx('mt-tag', t.priority)}>{t.priority === 'urgent' ? 'Khẩn cấp' : 'Quan trọng'}</span> : null;
      case 'results': return t.result_count ? <span className="mt-res"><Award size={13} /> {t.result_count}</span> : null;
      case 'creator': return <Person name={t.creator_name} color={t.creator_color} id={t.creator_id} />;
      case 'assignee': return <Person name={t.assignee_name} color={t.assignee_color} id={t.assignee_id} />;
      default: return null;
    }
  };

  return (
    <div className="mt-page">
      <header className="mt-head">
        <span className="mt-head-icon"><ClipboardCheck size={18} /></span>
        <div className="grow">
          <h1>Công việc của tôi</h1>
          <nav className="mt-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={prefs.tab === t.key} className={cx(prefs.tab === t.key && 'active')} onClick={() => setPref('tab', t.key)}>{t.label}</button>
            ))}
          </nav>
        </div>
      </header>

      <div className="mt-toolbar">
        <button className="mt-new" onClick={() => openCreate({})}><Plus size={16} /> Thêm mới</button>
        <Dropdown trigger={(o, toggle) => <button type="button" onClick={toggle} className="mt-tool"><CalendarClock size={15} /> {label(SORTS, prefs.sort)} <ChevronDown size={14} /></button>}>
          {SORTS.map((s) => <MenuItem key={s.value} active={prefs.sort === s.value} onClick={() => setPref('sort', s.value)}>{s.label}</MenuItem>)}
        </Dropdown>
        <Dropdown trigger={(o, toggle) => <button type="button" onClick={toggle} className={cx('mt-tool', prefs.status && 'on')}><Filter size={15} /> {label(STATUSES, prefs.status)} <ChevronDown size={14} /></button>}>
          {STATUSES.map((s) => <MenuItem key={s.value} active={prefs.status === s.value} onClick={() => setPref('status', s.value)}>{s.label}</MenuItem>)}
        </Dropdown>
        <Dropdown trigger={(o, toggle) => <button type="button" onClick={toggle} className={cx('mt-tool', prefs.project_id && 'on')}><FolderKanban size={15} /> <span className="ellipsis">{projectName || 'Tất cả dự án'}</span> <ChevronDown size={14} /></button>}>
          <MenuItem active={!prefs.project_id} onClick={() => setPref('project_id', '')}>Tất cả dự án</MenuItem>
          {projects.map((p) => <MenuItem key={p.id} active={String(prefs.project_id) === String(p.id)} onClick={() => setPref('project_id', p.id)}>{p.name}</MenuItem>)}
        </Dropdown>
        <Dropdown trigger={(o, toggle) => <button type="button" onClick={toggle} className="mt-tool"><Layers size={15} /> <span className="muted">Nhóm theo:</span> {label(GROUP_BY, prefs.group)} <ChevronDown size={14} /></button>}>
          {GROUP_BY.map((g) => <MenuItem key={g.value} active={prefs.group === g.value} onClick={() => setPref('group', g.value)}>{g.label}</MenuItem>)}
        </Dropdown>
        <div className="mt-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm công việc" /></div>
        <div className="grow" />
        {data && <small className="muted">{data.total} công việc</small>}
      </div>

      <div className={cx('mt-table-wrap', loading && data && 'refetching')}>
        {!data ? <Spinner /> : (
          <table className="mt-table">
            <colgroup><col style={{ width: 420 }} />{shown.map((c) => <col key={c.key} style={{ width: c.width }} />)}</colgroup>
            <thead>
              <tr>
                <th className="mt-name-col">
                  <span className="row between">Tên công việc
                    <Dropdown align="right" trigger={(o, toggle) => <button type="button" onClick={toggle} className="mt-colbtn" title="Tuỳ chỉnh cột"><Settings2 size={14} /> Tuỳ chỉnh cột</button>}>
                      {COLUMNS.map((c) => (
                        <label key={c.key} className="menu-item check" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={!!cols[c.key]} onChange={() => toggleCol(c.key)} /> {c.label}
                        </label>
                      ))}
                    </Dropdown>
                  </span>
                </th>
                {shown.map((c) => <th key={c.key}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const isCollapsed = collapsed[g.key];
                return (
                  <Fragment key={g.key}>
                    <tr className="mt-group">
                      <td className="mt-name-col">
                        <div className="mt-group-cell">
                          <button type="button" className="icon-btn sm" onClick={() => setCollapsed({ ...collapsed, [g.key]: !isCollapsed })} aria-label={isCollapsed ? 'Mở rộng' : 'Thu gọn'}>
                            {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                          </button>
                          <b>{g.label}</b><span className="muted">({g.items.length})</span>
                          <div className="grow" />
                          {prefs.tab !== 'following' && (
                            <button type="button" className="mt-group-add" onClick={() => openCreate({ ...(g.defaults || {}), ...(g.preset ? { due_date: g.preset } : {}), openAfter: false })}>
                              <Plus size={13} /> Tạo công việc
                            </button>
                          )}
                        </div>
                      </td>
                      <td colSpan={shown.length} />
                    </tr>
                    {!isCollapsed && g.items.map((t) => (
                      <tr key={t.id} className={cx('mt-row', t.status === 'done' && 'done')} onClick={() => openTask(t.id)}>
                        <td className="mt-name-col">
                          <div className="mt-name">
                            <input type="checkbox" checked={t.status === 'done'} onClick={(e) => e.stopPropagation()} onChange={() => toggleDone(t)}
                              title={t.status === 'done' ? 'Đánh dấu chưa hoàn thành' : 'Đánh dấu hoàn thành'} aria-label="Hoàn thành" />
                            <span className="ellipsis grow" title={t.title}>{t.title}</span>
                            {t.parent_id && <ListTree size={14} className="muted" title="Công việc con" />}
                          </div>
                        </td>
                        {shown.map((c) => <td key={c.key}>{cell(t, c.key)}</td>)}
                      </tr>
                    ))}
                    {!isCollapsed && prefs.tab !== 'following' && (
                      <tr className="mt-addrow">
                        <td className="mt-name-col"><QuickAdd group={g} tab={prefs.tab} onDone={() => { reload(); bump(); }} /></td>
                        <td colSpan={shown.length} />
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        {data && data.total > items.length && (
          <div className="center mt"><button className="btn btn-sm" onClick={() => setLimit(limit + 200)}>Tải thêm ({data.total - items.length} công việc)</button></div>
        )}
      </div>
    </div>
  );
}
