/**
 * Bộ giao diện LDL HRM: banner, thẻ chỉ số, thẻ nội dung có biểu tượng màu, nhãn trạng thái, biểu đồ gọn.
 * Màu nhận diện (tone) chỉ dùng cho biểu tượng / điểm nhấn; chữ và số luôn dùng màu chữ để dễ đọc.
 * Biểu đồ dùng bảng màu phân loại đã kiểm định (--hr-cat-1…5, sáng / tối) theo thứ tự cố định.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../utils.js';

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('vi-VN'));

/** Trạng thái làm việc → màu cố định (màu đi theo trạng thái, không theo thứ hạng). */
export const WORK_TONE = { working: 'blue', probation: 'amber', leave: 'violet', resigned: 'gray' };
export const WORK_COLOR = { working: 'var(--hr-cat-1)', probation: 'var(--hr-cat-4)', leave: 'var(--hr-cat-7)', resigned: 'var(--viz-neutral)' };

export function HrHero({ icon: Icon, title, subtitle, children, tone = 'brand' }) {
  return (
    <section className={cx('hr-hero', `tone-${tone}`)}>
      <div className="hr-hero-glow" aria-hidden />
      {Icon && <span className="hr-hero-icon"><Icon size={26} /></span>}
      <div className="grow hr-hero-text">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="hr-hero-actions">{children}</div>}
    </section>
  );
}

/** Thẻ chỉ số: biểu tượng màu + nhãn + số lớn (+ dòng phụ). Có `to` / `onClick` thì bấm được. */
export function Kpi({ icon: Icon, label, value, sub, tone = 'blue', to, onClick, active, i = 0 }) {
  const body = (
    <>
      <span className="hr-kpi-icon"><Icon size={18} /></span>
      <span className="hr-kpi-label">{label}</span>
      <b className="hr-kpi-value">{typeof value === 'number' ? fmt(value) : value}</b>
      {sub && <small className="hr-kpi-sub">{sub}</small>}
    </>
  );
  const cls = cx('hr-kpi', `tone-${tone}`, (to || onClick) && 'clickable', active && 'active', 'hr-rise');
  const style = { '--i': i };
  if (to) return <Link to={to} className={cls} style={style}>{body}</Link>;
  if (onClick) return <button type="button" className={cls} style={style} onClick={onClick}>{body}</button>;
  return <div className={cls} style={style}>{body}</div>;
}

export function HrCard({ icon: Icon, tone = 'blue', title, count, action, children, className, i = 0 }) {
  return (
    <section className={cx('hr-card', `tone-${tone}`, 'hr-rise', className)} style={{ '--i': i }}>
      {(title || action) && (
        <header className="hr-card-head">
          {Icon && <span className="hr-card-icon"><Icon size={16} /></span>}
          <h3>{title}{count != null && <span className="hr-count">{count}</span>}</h3>
          <div className="grow" />
          {action}
        </header>
      )}
      <div className="hr-card-body">{children}</div>
    </section>
  );
}

export function Pill({ tone = 'gray', children }) {
  return <span className={cx('hr-pill', `tone-${tone}`)}><i />{children}</span>;
}

/** Phân bố theo độ lớn: một màu (tuần tự), nhãn + số + % bên phải; rê chuột để xem tỷ lệ. */
export function HBars({ items, color = 'var(--hr-cat-1)', total }) {
  const max = Math.max(1, ...items.map((x) => x.c));
  const sum = total ?? items.reduce((s, x) => s + x.c, 0);
  if (!items.length) return <p className="muted small">Chưa có dữ liệu</p>;
  return (
    <div className="hr-hbars">
      {items.map((d) => (
        <div key={d.name} className="hr-hbar" title={`${d.name}: ${fmt(d.c)}${sum ? ` (${Math.round((d.c / sum) * 100)}%)` : ''}`}>
          <span className="hr-hbar-label ellipsis">{d.name}</span>
          <span className="hr-hbar-track"><span style={{ width: `${(d.c / max) * 100}%`, background: color }} /></span>
          <b>{fmt(d.c)}</b>
          <small className="muted">{sum ? `${Math.round((d.c / sum) * 100)}%` : ''}</small>
        </div>
      ))}
    </div>
  );
}

/** Thanh phần–tổng nằm ngang (≤ 5 phần) + chú thích có số và %. */
export function StackBar({ parts }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const [hover, setHover] = useState(null);
  return (
    <div className="hr-stack-wrap">
      <div className="hr-stack" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
        {parts.filter((p) => p.value > 0).map((p) => (
          <span key={p.key} style={{ flexGrow: p.value, background: p.color }} className={cx(hover && hover !== p.key && 'dim')}
            onMouseEnter={() => setHover(p.key)} onMouseLeave={() => setHover(null)} title={`${p.label}: ${p.value}`} />
        ))}
        {!total && <span className="empty" />}
      </div>
      <div className="viz-legend">
        {parts.map((p) => (
          <span key={p.key} className="viz-legend-item" onMouseEnter={() => setHover(p.key)} onMouseLeave={() => setHover(null)}>
            <i style={{ background: p.color }} /><b>{fmt(p.value)}</b><span>{p.label}</span>
            {total > 0 && <small>{Math.round((p.value / total) * 100)}%</small>}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Cột ghép theo tháng (2 chuỗi đặt cạnh nhau, không cộng dồn) + chú thích + tooltip khi rê chuột. */
export function GroupedColumns({ rows, series, height = 180 }) {
  const [tip, setTip] = useState(null);
  const max = Math.max(1, ...rows.flatMap((r) => series.map((s) => r[s.key] || 0)));
  const top = Math.max(2, Math.ceil(max / 2) * 2);
  return (
    <div className="hr-cols-wrap">
      <div className="viz-legend">{series.map((s) => <span key={s.key} className="viz-legend-item"><i style={{ background: s.color }} /><span>{s.label}</span></span>)}</div>
      <div className="hr-cols" style={{ height }}>
        <div className="hr-cols-grid" aria-hidden>{[top, top / 2, 0].map((v) => <span key={v}><small>{v}</small></span>)}</div>
        {rows.map((r) => (
          <div key={r.label} className={cx('hr-col-group', tip?.label === r.label && 'hover')}
            onMouseEnter={() => setTip(r)} onMouseLeave={() => setTip(null)} tabIndex={0} onFocus={() => setTip(r)} onBlur={() => setTip(null)}
            aria-label={`${r.tip || r.label}: ${series.map((s) => `${s.label} ${r[s.key] || 0}`).join(', ')}`}>
            <div className="hr-col-bars">
              {series.map((s) => <span key={s.key} style={{ height: `${((r[s.key] || 0) / top) * 100}%`, background: s.color }} />)}
            </div>
            <small className="hr-col-label">{r.label}</small>
            {tip?.label === r.label && (
              <div className="viz-tip hr-col-tip">
                <div className="viz-tip-title">{r.tip || r.label}</div>
                {series.map((s) => <div key={s.key} className="viz-tip-row"><i style={{ background: s.color }} /><b>{fmt(r[s.key] || 0)}</b><span>{s.label}</span></div>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Số ngày còn lại tới một ngày (dùng cho cảnh báo hết hạn). */
export function daysLeft(date) {
  if (!date) return null;
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 864e5);
}
