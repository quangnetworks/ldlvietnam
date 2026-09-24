import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, ChevronRight, Star, MessageSquare, Paperclip, Clock, X } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useFetch } from '../context.jsx';
import { Avatar, Spinner, Modal, Field, UserPicker } from '../components/ui.jsx';
import { useDebounced } from '../components/shell.jsx';
import { fmtDateTime, timeAgo, cx } from '../utils.js';
import { useRequestApp } from './RequestLayout.jsx';
import { STATUS } from './fields.jsx';

const TABS = [
  ['', 'TẤT CẢ'], ['my_turn', 'ĐẾN LƯỢT DUYỆT'], ['overdue', 'QUÁ HẠN'], ['pending', 'CHỜ XỬ LÝ'], ['approved', 'ĐÃ CHẤP THUẬN'],
  ['rejected', 'ĐÃ TỪ CHỐI'], ['returned', 'ĐÃ TRẢ LẠI'], ['starred', 'ĐÃ ĐÁNH DẤU'], ['draft', 'ĐÃ LƯU NHÁP'],
];
const BOX_TITLE = { to_me: 'Gửi đến tôi', mine: 'Tôi gửi đi', following: 'Đang theo dõi' };

export function EmptyIllustration({ children }) {
  return (
    <div className="rq-empty">
      <svg width="220" height="170" viewBox="0 0 220 170" aria-hidden="true">
        <ellipse cx="110" cy="150" rx="90" ry="10" fill="#e9f7ef" />
        <rect x="70" y="20" width="110" height="120" rx="6" fill="#fff" stroke="#2f9e44" strokeWidth="2" />
        {[40, 58, 76, 94, 112].map((y) => <rect key={y} x="84" y={y} width={y % 36 ? 70 : 50} height="6" rx="3" fill="#d3f9d8" />)}
        <circle cx="52" cy="92" r="30" fill="#d3f9d8" />
        <path d="M40 92l9 9 17-19" stroke="#2f9e44" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="muted">{children}</div>
    </div>
  );
}

function FilterModal({ params, onApply, onClose }) {
  const { users } = useApp();
  const [f, setF] = useState({ creator_id: params.get('creator_id') ? Number(params.get('creator_id')) : null, from: params.get('from') || '', to: params.get('to') || '', sort: params.get('sort') || '' });
  return (
    <Modal title="Bộ lọc" onClose={onClose} width={480}
      footer={<><button className="btn" onClick={() => onApply({ creator_id: '', from: '', to: '', sort: '' })}>Xoá bộ lọc</button><div className="grow" />
        <button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" onClick={() => onApply(f)}>Áp dụng</button></>}>
      <div className="form-grid">
        <div className="span-2"><Field label="Người tạo"><UserPicker users={users} value={f.creator_id} onChange={(v) => setF({ ...f, creator_id: v })} placeholder="Tất cả" /></Field></div>
        <Field label="Từ ngày"><input type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="Đến ngày"><input type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        <Field label="Sắp xếp">
          <select className="input" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })}>
            <option value="">Cập nhật gần nhất</option><option value="oldest">Cũ nhất</option><option value="deadline">Sắp đến hạn</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}

export function RequestRow({ q }) {
  const s = STATUS[q.status];
  return (
    <Link to={`/request/${q.id}`} className={cx('rq-row', q.my_turn && 'turn')}>
      <Avatar name={q.creator_name} color={q.creator_color} size={40} />
      <div className="grow">
        <div className="rq-row-title">
          {q.starred && <Star size={14} className="starred" fill="currentColor" />} {q.title} <span className="muted">#{q.id}</span>
        </div>
        <div className="rq-row-meta">
          <span className="tag tag-blue-outline">{q.group_name}</span>
          <span>{q.creator_name}{q.creator_department ? ` · ${q.creator_department}` : ''}</span>
          <span className="muted">{timeAgo(q.created_at)}</span>
          {q.comment_count > 0 && <span className="muted mini"><MessageSquare size={12} /> {q.comment_count}</span>}
          {q.attachment_count > 0 && <span className="muted mini"><Paperclip size={12} /> {q.attachment_count}</span>}
        </div>
      </div>
      <div className="rq-row-side">
        <span className={cx('badge', s.cls)}>{s.label.toUpperCase()}</span>
        {q.status === 'pending' && <small className="muted">{q.approved_count}/{q.approver_count} đã duyệt</small>}
        {q.is_overdue && <small className="text-red"><Clock size={11} /> Quá hạn {fmtDateTime(q.deadline_at)}</small>}
        {q.my_turn && <small className="text-blue">Đến lượt bạn duyệt</small>}
      </div>
    </Link>
  );
}

export default function RequestList({ adminAll = false }) {
  const { groups, counts, version } = useRequestApp();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') || '');
  const [filterOpen, setFilterOpen] = useState(false);
  const dq = useDebounced(search, 350);
  const query = useMemo(() => ({ ...Object.fromEntries(params.entries()), q: dq }), [params, dq]);
  const [data, , loading] = useFetch(() => api.get('/requests', query), [JSON.stringify(query), version]);
  const setParam = (patch) => {
    const n = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === '' || v == null ? n.delete(k) : n.set(k, v));
    if (!('page' in patch)) n.delete('page');
    setParams(n);
  };
  const tab = params.get('tab') || '';
  const group = groups.find((g) => String(g.id) === params.get('group_id'));
  const title = adminAll ? 'Tất cả đề xuất hệ thống' : group ? group.name : BOX_TITLE[params.get('box')] || 'Danh sách đề xuất';
  const badge = { my_turn: counts?.my_turn, overdue: counts?.overdue, draft: counts?.draft };
  const filterCount = ['creator_id', 'from', 'to', 'sort'].filter((k) => params.get(k)).length;
  return (
    <div className="rq-page">
      <div className="rq-head">
        <div className="grow">
          <h1>{title} {group && <button className="icon-btn sm" onClick={() => setParam({ group_id: '' })} aria-label="Bỏ lọc nhóm"><X size={15} /></button>}</h1>
          <div className="rq-tabs">
            {TABS.map(([k, l]) => (
              <button key={k} className={cx(tab === k && 'active')} onClick={() => setParam({ tab: k })}>
                {l}{badge[k] ? <span className="rq-count">{badge[k]}</span> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="rq-actions">
          <div className="rq-searchbox"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm kiếm đề xuất" /><Search size={15} /></div>
          <button className={cx('btn', filterCount && 'btn-outline-primary')} onClick={() => setFilterOpen(true)}>Bộ lọc {filterCount > 0 && `(${filterCount})`} <ChevronRight size={14} /></button>
          <Link className="btn btn-primary" to={group ? `/request/new?group_id=${group.id}` : '/request/new'}>Tạo đề xuất</Link>
        </div>
      </div>
      {loading && !data ? <Spinner /> : !data.items.length ? (
        <EmptyIllustration>Không có đề xuất nào được hiển thị. <Link to="/request/new" className="text-blue">Tạo đề xuất mới?</Link></EmptyIllustration>
      ) : (
        <div className="rq-list">{data.items.map((q) => <RequestRow key={q.id} q={q} />)}</div>
      )}
      {data && (
        <div className="simple-pager">
          <button className="icon-btn" disabled={data.page <= 1} onClick={() => setParam({ page: data.page - 1 })}>←</button>
          <span>Trang {data.page}</span>
          <button className="icon-btn" disabled={data.page * data.limit >= data.total} onClick={() => setParam({ page: data.page + 1 })}>→</button>
        </div>
      )}
      {filterOpen && <FilterModal params={params} onClose={() => setFilterOpen(false)} onApply={(f) => { setParam(f); setFilterOpen(false); }} />}
    </div>
  );
}
