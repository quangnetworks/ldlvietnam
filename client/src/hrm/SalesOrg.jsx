/**
 * LDL HRM → Cơ cấu kinh doanh: NSM (Toàn quốc) → RSM (Miền Bắc / Trung / Nam) → ASM (Khu vực) → SS (Tỉnh) → PG / SREP / SREP KA.
 * Chia theo ngành hàng (Hóa mỹ phẩm, Thực phẩm…): cây địa bàn dùng chung, mỗi phân công gắn một ngành hoặc "chung".
 * Sơ đồ theo địa bàn, danh sách theo người, phân công (có kiêm nhiệm) và đồng bộ quản lý trực tiếp theo cơ cấu.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Network, Search, Plus, Pencil, Trash2, UserPlus, X, ChevronDown, ChevronRight, RefreshCw, MapPinned, Map as MapIcon, Crown, Users2, UserRound,
  ListTree, Rows3, AlertTriangle, Tags,
} from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch, useToast } from '../context.jsx';
import { Avatar, Spinner, Field, Modal, UserPicker, Empty } from '../components/ui.jsx';
import { HrHero, Kpi, HrCard } from './hrUi.jsx';
import { useDebounced } from '../components/shell.jsx';
import { cx } from '../utils.js';

/** Màu cố định theo vị trí (không theo thứ hạng hiển thị). */
export const ROLE_TONE = { NSM: 'amber', RSM: 'orange', ASM: 'violet', SS: 'blue', PG: 'pink', SREP: 'green', SREP_KA: 'aqua' };
export const ROLE_SHORT = { NSM: 'NSM', RSM: 'RSM', ASM: 'ASM', SS: 'SS', PG: 'PG', SREP: 'SREP', SREP_KA: 'SREP KA' };
const RANK = { NSM: 1, RSM: 2, ASM: 3, SS: 4, PG: 5, SREP: 5, SREP_KA: 5 };
const FIELD_ROLES = ['PG', 'SREP', 'SREP_KA'];
const IND_TONES = ['pink', 'green', 'blue', 'orange', 'violet', 'aqua'];
/** Màu cố định theo thứ tự ngành hàng trong danh mục (HMP hồng, TP xanh lá…). */
export const industryTone = (industries, code) => IND_TONES[Math.max(0, (industries || []).findIndex((x) => x.code === code)) % IND_TONES.length];

export function IndustryTag({ code, industries }) {
  if (!code) return null;
  const it = (industries || []).find((x) => x.code === code);
  return <span className={cx('so-ind', `tone-${industryTone(industries, code)}`)} title={it?.name || code}>{code}</span>;
}

export function RoleBadge({ role, concurrent }) {
  if (!role) return null;
  return <span className={cx('so-role', `tone-${ROLE_TONE[role] || 'gray'}`)} title={concurrent ? 'Kiêm nhiệm' : undefined}>{ROLE_SHORT[role] || role}{concurrent ? ' · KN' : ''}</span>;
}

function MemberChip({ m, manage, onRemove, hit, industries }) {
  return (
    <span className={cx('so-member', m.is_concurrent && 'concurrent', hit && 'hit')}>
      <Link to={`/account/u/${m.user_id}`} className="so-member-link" title={`${m.name}${m.title ? ` · ${m.title}` : ''}${m.manager_name ? ` · Quản lý: ${m.manager_name}` : ''}`}>
        <Avatar name={m.name} color={m.color} uid={m.user_id} size={24} />
        <span className="ellipsis">{m.name}</span>
      </Link>
      <RoleBadge role={m.role} concurrent={m.is_concurrent} />
      <IndustryTag code={m.industry} industries={industries} />
      {manage && <button className="so-x" aria-label={`Gỡ ${m.name}`} onClick={() => onRemove(m)}><X size={12} /></button>}
    </span>
  );
}

function NodeTools({ t, data, onAction }) {
  if (!data.can_manage) return null;
  return (
    <span className="so-tools">
      <button className="icon-btn sm" title="Phân công người phụ trách" aria-label="Phân công" onClick={() => onAction('assign', t)}><UserPlus size={14} /></button>
      {t.level !== 'province' && <button className="icon-btn sm" title={`Thêm ${CHILD_LABEL[t.level]}`} aria-label="Thêm địa bàn con" onClick={() => onAction('add', t)}><Plus size={14} /></button>}
      <button className="icon-btn sm" title="Đổi tên" aria-label="Đổi tên" onClick={() => onAction('edit', t)}><Pencil size={13} /></button>
      {t.level !== 'national' && <button className="icon-btn sm" title="Xoá địa bàn" aria-label="Xoá" onClick={() => onAction('delete', t)}><Trash2 size={13} /></button>}
    </span>
  );
}
const CHILD_LABEL = { national: 'miền', region: 'khu vực', area: 'tỉnh / thành' };

function Members({ list, data, onRemove, match, empty }) {
  if (!list.length) return empty ? <span className="so-vacant"><AlertTriangle size={12} /> {empty}</span> : null;
  return <div className="so-members">{list.map((m) => <MemberChip key={`${m.user_id}-${m.role}`} m={m} manage={data.can_manage} onRemove={onRemove} hit={match(m)} industries={data.industries} />)}</div>;
}

export function SalesOrg() {
  const toast = useToast();
  const [data, reload, loading, error] = useFetch(() => api.get('/sales/structure'), []);
  const [q, setQ] = useState('');
  const dq = useDebounced(q).trim().toLowerCase();
  const [mode, setMode] = useState('tree');
  const [ind, setInd] = useState('');
  const [open, setOpen] = useState({});
  const [dialog, setDialog] = useState(null);

  const idx = useMemo(() => {
    if (!data) return null;
    const children = {}; const members = {};
    for (const t of data.territories) (children[t.parent_id ?? 0] ||= []).push(t);
    // lọc ngành hàng: người của ngành đó + người phụ trách chung
    const shown = data.members.filter((m) => !ind || !m.industry || m.industry === ind);
    for (const m of shown) (members[m.territory_id] ||= []).push(m);
    for (const k in members) members[k].sort((a, b) => RANK[a.role] - RANK[b.role] || a.is_concurrent - b.is_concurrent || a.name.localeCompare(b.name));
    return { children, members, shown, byId: Object.fromEntries(data.territories.map((t) => [t.id, t])) };
  }, [data, ind]);

  if (error) return <div className="page hr"><div className="alert alert-error">{error.message}</div></div>;
  if (loading && !data) return <div className="page hr"><Spinner /></div>;

  const kids = (t) => idx.children[t.id] || [];
  const mem = (t) => idx.members[t.id] || [];
  const match = (m) => !!dq && m.name.toLowerCase().includes(dq);
  /** địa bàn khớp tìm kiếm: tên địa bàn hoặc có người phụ trách khớp, tính cả địa bàn con */
  const hits = (t) => !dq || t.name.toLowerCase().includes(dq) || mem(t).some(match) || kids(t).some(hits);
  const isOpen = (t) => (dq ? hits(t) : open[t.id] ?? t.level !== 'area');
  const toggle = (t) => setOpen({ ...open, [t.id]: !isOpen(t) });
  const root = (idx.children[0] || [])[0];

  const people = new Set(idx.shown.map((m) => m.user_id)).size;
  const countRole = (roles) => new Set(idx.shown.filter((m) => roles.includes(m.role) && !m.is_concurrent).map((m) => m.user_id)).size;
  const leaderOf = { area: ['ASM'], province: ['SS'] };
  const vacant = data.territories.filter((t) => leaderOf[t.level] && !mem(t).some((m) => leaderOf[t.level].includes(m.role))).length;

  const remove = async (m) => {
    if (!window.confirm(`Gỡ ${m.name} (${ROLE_SHORT[m.role]}) khỏi ${idx.byId[m.territory_id]?.name}?`)) return;
    try { await api.del(`/sales/territories/${m.territory_id}/members/${m.user_id}?role=${m.role}`); toast('Đã gỡ phân công'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const onAction = async (kind, t) => {
    if (kind === 'delete') {
      const n = kids(t).length;
      if (!window.confirm(`Xoá "${t.name}"${n ? ` cùng ${n} địa bàn con` : ''} và các phân công thuộc địa bàn này?`)) return;
      try { await api.del(`/sales/territories/${t.id}`); toast('Đã xoá địa bàn'); reload(); } catch (e) { toast(e.message, 'error'); }
      return;
    }
    setDialog({ kind, t });
  };

  const area = (a) => (
    <div key={a.id} className={cx('so-area', isOpen(a) && 'open')}>
      <div className="so-area-head">
        <button className="so-toggle" onClick={() => toggle(a)} aria-expanded={isOpen(a)}>
          {isOpen(a) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <b>{a.name}</b>{a.code && <small className="muted">{a.code}</small>}
          <span className="so-count">{kids(a).length} tỉnh</span>
        </button>
        <NodeTools t={a} data={data} onAction={onAction} />
      </div>
      <Members list={mem(a)} data={data} onRemove={remove} match={match} empty="Chưa có ASM" />
      {isOpen(a) && (
        <div className="so-provinces">
          {kids(a).filter(hits).map((p) => (
            <div key={p.id} className="so-province">
              <div className="so-province-head"><MapPinned size={13} /><b className="ellipsis">{p.name}</b><NodeTools t={p} data={data} onAction={onAction} /></div>
              <Members list={mem(p)} data={data} onRemove={remove} match={match} empty="Chưa có SS" />
            </div>
          ))}
          {!kids(a).length && <span className="muted small">Chưa có tỉnh / thành. {data.can_manage && 'Bấm + để thêm.'}</span>}
        </div>
      )}
    </div>
  );

  return (
    <div className="page hr">
      <HrHero icon={Network} tone="teal" title="Cơ cấu kinh doanh"
        subtitle={`NSM toàn quốc → RSM miền Bắc / Trung / Nam → ASM khu vực → SS tỉnh → PG / SREP / SREP KA, theo ngành hàng ${data.industries.map((x) => x.name).join(', ')}. Quản lý trực tiếp theo cơ cấu dùng cho duyệt đề xuất và quyền xem công việc, hồ sơ.`}>
        {data.can_manage && <button className="btn" onClick={() => setDialog({ kind: 'industries' })}><Tags size={15} /> Ngành hàng</button>}
        {data.can_manage && <button className="btn solid" onClick={() => setDialog({ kind: 'sync' })}><RefreshCw size={15} /> Đồng bộ quản lý trực tiếp</button>}
      </HrHero>
      <div className="hr-kpis">
        <Kpi i={0} icon={Crown} tone="amber" label="NSM / RSM" value={`${countRole(['NSM'])} / ${countRole(['RSM'])}`} sub="Toàn quốc / miền" />
        <Kpi i={1} icon={MapIcon} tone="violet" label="ASM" value={countRole(['ASM'])} sub={`${data.territories.filter((t) => t.level === 'area').length} khu vực`} />
        <Kpi i={2} icon={UserRound} tone="blue" label="SS" value={countRole(['SS'])} sub={`${data.territories.filter((t) => t.level === 'province').length} tỉnh / thành`} />
        <Kpi i={3} icon={Users2} tone="green" label="PG / SREP / SREP KA" value={countRole(FIELD_ROLES)} sub={`${people} nhân sự trong cơ cấu`} />
        <Kpi i={4} icon={AlertTriangle} tone={vacant ? 'red' : 'gray'} label="Địa bàn chưa có người phụ trách" value={vacant} sub="Khu vực chưa có ASM, tỉnh chưa có SS" />
      </div>
      <div className="hr-seg" role="tablist" aria-label="Ngành hàng">
        {[{ code: '', name: 'Tất cả ngành hàng' }, ...data.industries].map((x) => (
          <button key={x.code} role="tab" aria-selected={ind === x.code} className={cx(`tone-${x.code ? industryTone(data.industries, x.code) : 'gray'}`, ind === x.code && 'active')}
            onClick={() => setInd(x.code)}><i />{x.name}
            <span className="so-seg-count">{new Set(data.members.filter((m) => !x.code || m.industry === x.code).map((m) => m.user_id)).size}</span></button>
        ))}
      </div>
      <div className="hr-toolbar">
        <div className="ww-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm nhân sự hoặc địa bàn" /></div>
        <div className="grow" />
        <div className="so-mode" role="tablist">
          <button role="tab" aria-selected={mode === 'tree'} className={cx(mode === 'tree' && 'active')} onClick={() => setMode('tree')}><ListTree size={14} /> Sơ đồ địa bàn</button>
          <button role="tab" aria-selected={mode === 'people'} className={cx(mode === 'people' && 'active')} onClick={() => setMode('people')}><Rows3 size={14} /> Theo nhân sự</button>
        </div>
      </div>
      {mode === 'people' ? <PeopleView data={data} idx={idx} q={dq} /> : root ? (
        <div className="so-tree">
          <section className="so-national hr-rise">
            <div className="so-node-head"><span className="so-level tone-amber"><Crown size={14} /> {root.name}</span><NodeTools t={root} data={data} onAction={onAction} /></div>
            <Members list={mem(root)} data={data} onRemove={remove} match={match} empty="Chưa có NSM" />
          </section>
          <div className="so-regions">
            {kids(root).filter(hits).map((rg, i) => (
              <HrCard key={rg.id} icon={MapIcon} tone={['orange', 'violet', 'aqua', 'pink'][i % 4]} title={rg.name} count={kids(rg).length} i={i + 1}
                action={<NodeTools t={rg} data={data} onAction={onAction} />} className="so-region">
                <Members list={mem(rg)} data={data} onRemove={remove} match={match} empty="Chưa có RSM" />
                <div className="so-areas">{kids(rg).filter(hits).map(area)}</div>
              </HrCard>
            ))}
          </div>
          {dq && !hits(root) && <Empty title="Không tìm thấy nhân sự hoặc địa bàn phù hợp" />}
        </div>
      ) : <Empty title="Chưa có địa bàn" />}
      {dialog?.kind === 'assign' && <AssignModal t={dialog.t} data={data} industry={ind} onClose={() => setDialog(null)} onDone={reload} />}
      {dialog?.kind === 'industries' && <IndustriesModal data={data} onClose={() => setDialog(null)} onDone={reload} />}
      {dialog?.kind === 'add' && <AddChildrenModal t={dialog.t} onClose={() => setDialog(null)} onDone={reload} />}
      {dialog?.kind === 'edit' && <EditTerritoryModal t={dialog.t} data={data} onClose={() => setDialog(null)} onDone={reload} />}
      {dialog?.kind === 'sync' && <SyncModal industries={data.industries} onClose={() => setDialog(null)} onDone={reload} />}
    </div>
  );
}

function PeopleView({ data, idx, q }) {
  const rows = useMemo(() => {
    const by = {};
    for (const m of idx.shown) (by[m.user_id] ||= { ...m, posts: [] }).posts.push(m);
    return Object.values(by).map((u) => {
      u.posts.sort((a, b) => a.is_concurrent - b.is_concurrent || RANK[a.role] - RANK[b.role]);
      return { ...u, role: u.posts[0].role };
    }).filter((u) => !q || u.name.toLowerCase().includes(q) || u.posts.some((p) => idx.byId[p.territory_id]?.name.toLowerCase().includes(q)))
      .sort((a, b) => RANK[a.role] - RANK[b.role] || a.name.localeCompare(b.name));
  }, [data, idx, q]);
  if (!rows.length) return <div className="hr-table-card"><Empty title="Chưa có nhân sự trong cơ cấu" /></div>;
  return (
    <div className="hr-table-card hr-rise">
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Nhân sự</th><th>Vị trí</th><th>Ngành hàng</th><th>Địa bàn phụ trách</th><th>Quản lý trực tiếp</th></tr></thead>
        <tbody>{rows.map((u) => (
          <tr key={u.user_id} className="hr-row">
            <td><Link to={`/account/u/${u.user_id}`} className="hr-name"><Avatar name={u.name} color={u.color} uid={u.user_id} size={30} /><span><b>{u.name}</b><small className="muted block">{u.title}</small></span></Link></td>
            <td><RoleBadge role={u.role} /></td>
            <td>{u.posts[0].industry ? <IndustryTag code={u.posts[0].industry} industries={data.industries} /> : <span className="muted small">Chung</span>}</td>
            <td><div className="so-posts">{u.posts.map((p) => (
              <span key={`${p.territory_id}-${p.role}`} className={cx('hr-chip', p.is_concurrent ? 'tone-gray' : `tone-${ROLE_TONE[p.role]}`)}>
                {idx.byId[p.territory_id]?.name}{p.role !== u.role ? ` (${ROLE_SHORT[p.role]})` : ''}{p.industry && p.industry !== u.posts[0].industry ? ` · ${p.industry}` : ''}{p.is_concurrent ? ' · kiêm nhiệm' : ''}
              </span>))}</div></td>
            <td>{u.manager_name || <span className="muted">—</span>}</td>
          </tr>))}</tbody>
      </table></div>
      <div className="hr-table-foot"><span>{rows.length} nhân sự</span><span>KN = kiêm nhiệm</span></div>
    </div>
  );
}

function AssignModal({ t, data, industry, onClose, onDone }) {
  const { users } = useApp();
  const toast = useToast();
  const roles = Object.entries(data.roles).filter(([, r]) => r.levels.includes(t.level));
  const [f, setF] = useState({ role: roles[0]?.[0] || '', user_id: null, is_concurrent: false, since: '', industry: industry || '' });
  const taken = (data.members.filter((m) => m.territory_id === t.id && m.role === f.role)).map((m) => m.user_id);
  const elsewhere = f.user_id && data.members.filter((m) => m.user_id === f.user_id && !m.is_concurrent && m.territory_id !== t.id);
  const save = async () => {
    try {
      await api.post(`/sales/territories/${t.id}/members`, f);
      toast('Đã phân công'); onDone(); onClose();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title={`Phân công · ${t.name}`} onClose={onClose} width={520}
      footer={<><button className="btn" onClick={onClose}>Huỷ</button><button className="btn btn-primary" disabled={!f.user_id || !f.role} onClick={save}>Phân công</button></>}>
      <Field label="Vị trí" required>
        <div className="so-role-pick">
          {roles.map(([k, r]) => (
            <button key={k} type="button" className={cx('so-role-opt', `tone-${ROLE_TONE[k]}`, f.role === k && 'active')} onClick={() => setF({ ...f, role: k })}>
              <b>{r.short}</b><small>{r.label.split('–')[1]?.trim()}</small>
            </button>
          ))}
        </div>
      </Field>
      <Field label="Ngành hàng" hint="Cấp trên được chọn cùng ngành hàng hoặc người phụ trách chung">
        <div className="so-ind-pick">
          {[{ code: '', name: 'Chung (mọi ngành)' }, ...data.industries].map((x) => (
            <button key={x.code} type="button" className={cx('chip-btn', f.industry === x.code && 'active')} onClick={() => setF({ ...f, industry: x.code })}>{x.name}</button>
          ))}
        </div>
      </Field>
      <Field label="Nhân sự" required>
        <UserPicker users={users.filter((u) => u.role !== 'guest' && u.active !== 0)} value={f.user_id} exclude={taken} onChange={(v) => setF({ ...f, user_id: v })} placeholder="Chọn nhân sự" />
      </Field>
      <label className="check mt-xs"><input type="checkbox" checked={f.is_concurrent} onChange={(e) => setF({ ...f, is_concurrent: e.target.checked })} /> Kiêm nhiệm (phụ trách thêm, ngoài địa bàn chính)</label>
      {elsewhere?.length > 0 && !f.is_concurrent && (
        <div className="alert alert-info mt-xs small">Người này đang phụ trách chính: {elsewhere.map((m) => `${ROLE_SHORT[m.role]} ${data.territories.find((x) => x.id === m.territory_id)?.name}`).join(', ')}.
          Chọn "Kiêm nhiệm" nếu đây là địa bàn phụ trách thêm (VD 1 SS phụ trách 2 tỉnh).</div>
      )}
      <Field label="Từ ngày"><input className="input" type="date" value={f.since} onChange={(e) => setF({ ...f, since: e.target.value })} /></Field>
    </Modal>
  );
}

function AddChildrenModal({ t, onClose, onDone }) {
  const toast = useToast();
  const [names, setNames] = useState('');
  const save = async () => {
    try { const r = await api.post('/sales/territories', { parent_id: t.id, names }); toast(`Đã thêm ${r.added} ${CHILD_LABEL[t.level]}`); onDone(); onClose(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title={`Thêm ${CHILD_LABEL[t.level]} · ${t.name}`} onClose={onClose} width={480}
      footer={<><button className="btn" onClick={onClose}>Huỷ</button><button className="btn btn-primary" disabled={!names.trim()} onClick={save}>Thêm</button></>}>
      <Field label={`Tên ${CHILD_LABEL[t.level]}`} hint="Mỗi dòng một tên; có thể dán cả danh sách. Tên đã có sẽ được bỏ qua.">
        <textarea className="input" rows={6} autoFocus value={names} onChange={(e) => setNames(e.target.value)} placeholder={t.level === 'area' ? 'Hà Nam\nNam Định\nNinh Bình' : 'Tên địa bàn'} />
      </Field>
    </Modal>
  );
}

function EditTerritoryModal({ t, data, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ name: t.name, code: t.code || '', sort: t.sort, parent_id: t.parent_id });
  const parentLevel = { region: 'national', area: 'region', province: 'area' }[t.level];
  const parents = parentLevel ? data.territories.filter((x) => x.level === parentLevel) : [];
  const save = async () => {
    try { await api.put(`/sales/territories/${t.id}`, f); toast('Đã lưu'); onDone(); onClose(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title={`Sửa địa bàn · ${t.name}`} onClose={onClose} width={480}
      footer={<><button className="btn" onClick={onClose}>Huỷ</button><button className="btn btn-primary" disabled={!f.name.trim()} onClick={save}>Lưu</button></>}>
      <div className="form-grid">
        <Field label="Tên" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Mã"><input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="Thứ tự"><input className="input" type="number" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })} /></Field>
        {parents.length > 1 && (
          <Field label={`Thuộc ${{ national: 'toàn quốc', region: 'miền', area: 'khu vực' }[parentLevel]}`} hint="Chuyển địa bàn sang cấp trên khác (VD tách / gộp miền, khu vực)">
            <select className="input" value={f.parent_id} onChange={(e) => setF({ ...f, parent_id: Number(e.target.value) })}>
              {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

function SyncModal({ industries, onClose, onDone }) {
  const toast = useToast();
  const [plan] = useFetch(() => api.get('/sales/sync-managers'), []);
  const [skip, setSkip] = useState({});
  if (!plan) return <Modal title="Đồng bộ quản lý trực tiếp" onClose={onClose}><Spinner /></Modal>;
  const changed = plan.filter((p) => p.changed);
  const chosen = changed.filter((p) => !skip[p.user_id]);
  const apply = async () => {
    try {
      const r = await api.post('/sales/sync-managers', { user_ids: chosen.map((p) => p.user_id) });
      toast(`Đã cập nhật quản lý trực tiếp cho ${r.updated} nhân sự`); onDone(); onClose();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title="Đồng bộ quản lý trực tiếp theo cơ cấu" onClose={onClose} width={760}
      footer={<><button className="btn" onClick={onClose}>Đóng</button><button className="btn btn-primary" disabled={!chosen.length} onClick={apply}><RefreshCw size={14} /> Cập nhật {chosen.length} nhân sự</button></>}>
      <p className="muted small">Mỗi người báo cáo cho cấp cao hơn gần nhất trên địa bàn chính, cùng ngành hàng hoặc người phụ trách chung: SREP / PG / SREP KA → SS cùng tỉnh (không có thì ASM khu vực), SS → ASM, ASM → RSM, RSM → NSM.
        Người kiêm nhiệm được tính là cấp trên ở địa bàn kiêm nhiệm. Quản lý trực tiếp dùng cho duyệt đề xuất, quyền xem công việc, hồ sơ, tài sản.</p>
      {!changed.length ? <div className="alert alert-info">Quản lý trực tiếp của mọi nhân sự đã khớp cơ cấu kinh doanh.</div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th style={{ width: 32 }} /><th>Nhân sự</th><th>Quản lý hiện tại</th><th>Theo cơ cấu</th></tr></thead>
          <tbody>{changed.map((p) => (
            <tr key={p.user_id}>
              <td><input type="checkbox" aria-label={`Cập nhật ${p.name}`} checked={!skip[p.user_id]} onChange={(e) => setSkip({ ...skip, [p.user_id]: !e.target.checked })} /></td>
              <td><span className="hr-name"><Avatar name={p.name} color={p.color} uid={p.user_id} size={26} /><span><b>{p.name}</b> <RoleBadge role={p.role} /> <IndustryTag code={p.industry} industries={industries} /><small className="muted block">{p.territory}</small></span></span></td>
              <td className="muted">{p.current_manager_name || '—'}</td>
              <td><b>{p.manager_name}</b> <RoleBadge role={p.manager_role} /> <IndustryTag code={p.manager_industry} industries={industries} /></td>
            </tr>))}</tbody>
        </table></div>
      )}
      {plan.length > changed.length && <p className="muted small mt-xs">{plan.length - changed.length} nhân sự đã đúng quản lý theo cơ cấu.</p>}
    </Modal>
  );
}

/** Chip vị trí & địa bàn trên hồ sơ nhân sự. */
export function SalesFacts({ userId }) {
  const [rows] = useFetch(() => api.get(`/sales/users/${userId}`), [userId]);
  if (!rows?.length) return null;
  return rows.map((r) => (
    <span key={`${r.territory_id}-${r.role}`} className={cx('hr-fact', r.is_concurrent ? 'tone-gray' : `tone-${ROLE_TONE[r.role]}`)}>
      <Network size={13} /> {ROLE_SHORT[r.role]} {r.territory_name}{r.industry ? ` · ${r.industry}` : ''}{r.is_concurrent ? ' (kiêm nhiệm)' : ''}
    </span>
  ));
}


function IndustriesModal({ data, onClose, onDone }) {
  const toast = useToast();
  const [list, setList] = useState(data.industries.map((x) => ({ ...x })));
  const used = new Set(data.members.map((m) => m.industry).filter(Boolean));
  const set = (i, k, v) => setList(list.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const save = async () => {
    try { await api.put('/sales/settings', { industries: list }); toast('Đã lưu ngành hàng'); onDone(); onClose(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title="Ngành hàng" onClose={onClose} width={520}
      footer={<><button className="btn" onClick={onClose}>Huỷ</button><button className="btn btn-primary" onClick={save}>Lưu</button></>}>
      <p className="muted small">Mỗi ngành hàng có lực lượng bán hàng riêng trên cùng cây địa bàn. Mã ngắn hiển thị trên sơ đồ (VD HMP, TP).</p>
      {list.map((x, i) => (
        <div key={i} className="row gap-sm mt-xs">
          <input className="input input-sm" style={{ width: 90 }} value={x.code} disabled={used.has(x.code) && data.industries.some((y) => y.code === x.code)}
            onChange={(e) => set(i, 'code', e.target.value.toUpperCase())} placeholder="Mã" aria-label="Mã ngành hàng" />
          <input className="input" value={x.name} onChange={(e) => set(i, 'name', e.target.value)} placeholder="Tên ngành hàng" aria-label="Tên ngành hàng" />
          <button className="icon-btn sm" aria-label="Xoá" disabled={used.has(x.code)} title={used.has(x.code) ? 'Đang có người phụ trách' : 'Xoá'}
            onClick={() => setList(list.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
        </div>
      ))}
      <button className="btn btn-sm mt" onClick={() => setList([...list, { code: '', name: '' }])}><Plus size={14} /> Thêm ngành hàng</button>
    </Modal>
  );
}
