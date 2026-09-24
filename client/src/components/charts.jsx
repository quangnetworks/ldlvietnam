/**
 * Bộ biểu đồ SVG dùng chung (không phụ thuộc thư viện).
 * Quy ước: nét mảnh, cột ≤ 24px bo 4px ở đầu dữ liệu, khe 2px màu nền giữa các phần, lưới mảnh nét liền,
 * chữ luôn dùng màu chữ (không dùng màu dữ liệu), chú thích luôn có khi ≥ 2 chuỗi, tooltip khi rê / focus.
 * Màu dữ liệu lấy từ biến CSS (--viz-*) nên tự đổi theo giao diện sáng / tối.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '../utils.js';

/** Nhóm trạng thái công việc — thứ tự đã kiểm tra khả năng phân biệt màu (kể cả mù màu) ở cả 2 chế độ. */
export const TASK_BUCKETS = [
  { key: 'on_time', label: 'HT đúng hạn', short: 'Đúng hạn', color: 'var(--viz-on-time)' },
  { key: 'doing', label: 'Đang xử lý', short: 'Đang làm', color: 'var(--viz-doing)' },
  { key: 'overdue', label: 'Quá hạn', short: 'Quá hạn', color: 'var(--viz-overdue)' },
  { key: 'review', label: 'Chờ đánh giá', short: 'Chờ ĐG', color: 'var(--viz-review)' },
  { key: 'late', label: 'Hoàn thành muộn', short: 'HT muộn', color: 'var(--viz-late)' },
  { key: 'failed', label: 'Thất bại', short: 'Thất bại', color: 'var(--viz-failed)' },
];

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('vi-VN'));

/** Bước chia trục tròn số (1, 2, 5 × 10^n). */
export function niceMax(max, ticks = 4) {
  if (max <= 0) return { top: ticks, step: 1 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const s = step < 1 ? 1 : step;
  return { top: Math.ceil(max / s) * s, step: s };
}

function useTip() {
  const [tip, setTip] = useState(null);
  const box = useRef(null);
  const show = (e, content) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const src = e.clientX != null && e.clientX !== 0 ? e : e.currentTarget.getBoundingClientRect();
    const x = (src.clientX ?? src.left + src.width / 2) - r.left;
    const y = (src.clientY ?? src.top) - r.top;
    setTip({ x, y, content, flip: x > r.width * 0.62 });
  };
  return { tip, box, show, hide: () => setTip(null) };
}

function Tip({ tip }) {
  if (!tip) return null;
  return (
    <div className={cx('viz-tip', tip.flip && 'flip')} style={{ left: tip.x, top: tip.y }} role="status">
      {tip.content}
    </div>
  );
}

/** Dòng tooltip: số liệu nổi bật, tên chuỗi phía sau, khoá bằng vạch màu ngắn. */
export function TipRows({ title, rows }) {
  return (
    <>
      {title && <div className="viz-tip-title">{title}</div>}
      {rows.map((r) => (
        <div key={r.label} className="viz-tip-row">
          <i style={{ background: r.color }} /><b>{fmt(r.value)}</b><span>{r.label}</span>
        </div>
      ))}
    </>
  );
}

/** Chú thích: ô màu + nhãn + giá trị (nhận dạng không chỉ dựa vào màu). */
export function Legend({ series, values, total, className, onHover }) {
  return (
    <div className={cx('viz-legend', className)}>
      {series.map((s) => (
        <span key={s.key} className="viz-legend-item" onMouseEnter={() => onHover?.(s.key)} onMouseLeave={() => onHover?.(null)}>
          <i style={{ background: s.color }} />
          {values && <b>{fmt(values[s.key] || 0)}</b>}
          <span>{s.label}</span>
          {values && total > 0 && <small>{Math.round(((values[s.key] || 0) / total) * 100)}%</small>}
        </span>
      ))}
    </div>
  );
}

/** Biểu đồ tròn phần–tổng (≤ 6 phần), số tổng ở giữa, khe 2px giữa các phần. */
export function Donut({ series, values, size = 168, thickness = 22, centerValue, centerLabel, legend = true }) {
  const { tip, box, show, hide } = useTip();
  const [active, setActive] = useState(null);
  const total = series.reduce((s, x) => s + (values[x.key] || 0), 0);
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  const segs = series.filter((s) => values[s.key] > 0);
  const gap = segs.length > 1 ? 2 : 0;
  let offset = 0;
  return (
    <div className="viz-donut-wrap">
      <div className="viz-donut" ref={box} style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
          aria-label={`${centerLabel || 'Tổng'} ${total}: ${segs.map((s) => `${s.label} ${values[s.key]}`).join(', ')}`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--viz-track)" strokeWidth={thickness} />
          {segs.map((s) => {
            const len = (values[s.key] / total) * C;
            const dash = Math.max(0.01, len - gap);
            const el = (
              <circle key={s.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
                strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-offset} transform={`rotate(-90 ${size / 2} ${size / 2})`}
                className={cx('viz-seg', active && active !== s.key && 'dim')} tabIndex={0}
                onMouseMove={(e) => { setActive(s.key); show(e, <TipRows rows={[{ label: s.label, value: values[s.key], color: s.color }]} />); }}
                onFocus={(e) => { setActive(s.key); show(e, <TipRows rows={[{ label: s.label, value: values[s.key], color: s.color }]} />); }}
                onMouseLeave={() => { setActive(null); hide(); }} onBlur={() => { setActive(null); hide(); }} />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="viz-donut-center"><b>{fmt(centerValue ?? total)}</b><span>{centerLabel}</span></div>
        <Tip tip={tip} />
      </div>
      {legend && <Legend series={series} values={values} total={total} onHover={setActive} />}
    </div>
  );
}

/** Vòng phần trăm (một giá trị) — tô theo mức độ. */
export function RingMeter({ pct, color = 'var(--viz-overdue)', size = 64, stroke = 7, label }) {
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct || 0));
  return (
    <div className="viz-ring" style={{ width: size, height: size }} role="img" aria-label={`${label || ''} ${v}%`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--viz-track)" strokeWidth={stroke} />
        {v > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(v / 100) * C} ${C}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      </svg>
      <span>{Math.round(v * 10) / 10}%</span>
    </div>
  );
}

/** Thanh chồng ngang nhỏ trong bảng (khe 2px giữa các phần). */
export function MiniStack({ series, values, width = 96 }) {
  const total = series.reduce((s, x) => s + (values[x.key] || 0), 0);
  if (!total) return <span className="viz-mini empty" style={{ width }} />;
  return (
    <span className="viz-mini" style={{ width }} role="img"
      aria-label={series.filter((s) => values[s.key]).map((s) => `${s.label} ${values[s.key]}`).join(', ')}>
      {series.filter((s) => values[s.key] > 0).map((s) => (
        <i key={s.key} style={{ flexGrow: values[s.key], background: s.color }} title={`${s.label}: ${values[s.key]}`} />
      ))}
    </span>
  );
}

/**
 * Cột chồng theo trục thời gian / danh mục. rows: [{ label, tip, values: {key: n} }].
 * Một trục duy nhất, lưới mảnh, cột ≤ 24px bo 4px ở đầu, khe 2px giữa các phần; rê chuột để xem đủ các chuỗi.
 */
export function StackedColumns({ series, rows, height = 240, yLabel, labelEvery, showTotal = true }) {
  const { tip, box, show, hide } = useTip();
  const [hover, setHover] = useState(null);
  const wrap = useRef(null);
  const avail = useWidth(wrap);
  const W = Math.max(avail, rows.length * 14 + 56);
  const padL = 44; const padR = 12; const padT = 16; const padB = 30;
  const plotW = W - padL - padR; const plotH = height - padT - padB;
  const totals = rows.map((r) => series.reduce((s, x) => s + (r.values[x.key] || 0), 0));
  const { top, step } = niceMax(Math.max(1, ...totals));
  const band = plotW / Math.max(1, rows.length);
  const barW = Math.max(4, Math.min(24, band * 0.62));
  const y = (v) => padT + plotH - (v / top) * plotH;
  const every = labelEvery || Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor(plotW / 64))));
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  const lastIdx = totals.reduce((m, t, i) => (t > 0 ? i : m), -1);
  return (
    <div className="viz-cols" ref={box}>
      <div className="viz-scroll" ref={wrap}>
        <svg viewBox={`0 0 ${W} ${height}`} width={W} height={height}
          role="img" aria-label={yLabel || 'Biểu đồ cột'}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} className={v === 0 ? 'viz-base' : 'viz-grid'} />
              <text x={padL - 8} y={y(v) + 4} textAnchor="end" className="viz-axis">{fmt(v)}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const cx0 = padL + band * i + band / 2;
            let acc = 0;
            const parts = series.filter((s) => r.values[s.key] > 0);
            const tipRows = [...series].reverse().map((s) => ({ label: s.label, value: r.values[s.key] || 0, color: s.color }));
            const onTip = (e) => { setHover(i); show(e, <TipRows title={r.tip || r.label} rows={[{ label: 'Tổng', value: totals[i], color: 'transparent' }, ...tipRows]} />); };
            return (
              <g key={r.label + i}>
                <rect x={padL + band * i} y={padT} width={band} height={plotH} fill="transparent" tabIndex={0} className="viz-hit"
                  onMouseMove={onTip} onFocus={onTip} onMouseLeave={() => { setHover(null); hide(); }} onBlur={() => { setHover(null); hide(); }} />
                {parts.map((s, j) => {
                  const v = r.values[s.key];
                  const y0 = y(acc); const y1 = y(acc + v);
                  acc += v;
                  const isTop = j === parts.length - 1;
                  const h = Math.max(0, y0 - y1 - (isTop ? 0 : 2));
                  const x = cx0 - barW / 2;
                  if (isTop && h > 4) {
                    const rr = Math.min(4, h, barW / 2);
                    return <path key={s.key} className={cx('viz-bar', hover != null && hover !== i && 'dim')} fill={s.color} pointerEvents="none"
                      d={`M${x},${y0} V${y1 + rr} Q${x},${y1} ${x + rr},${y1} H${x + barW - rr} Q${x + barW},${y1} ${x + barW},${y1 + rr} V${y0} Z`} />;
                  }
                  return <rect key={s.key} className={cx('viz-bar', hover != null && hover !== i && 'dim')} x={x} y={y0 - h} width={barW} height={h} fill={s.color} pointerEvents="none" />;
                })}
                {showTotal && i === lastIdx && totals[i] > 0 && <text x={cx0} y={y(totals[i]) - 6} textAnchor="middle" className="viz-cap">{fmt(totals[i])}</text>}
                {i % every === 0 && <text x={cx0} y={height - 10} textAnchor="middle" className="viz-axis">{r.label}</text>}
              </g>
            );
          })}
        </svg>
      </div>
      {yLabel && <div className="viz-ylabel">{yLabel}</div>}
      <Tip tip={tip} />
    </div>
  );
}

/** Bề rộng thực của khung (vẽ SVG đúng pixel để chữ trên trục không bị co giãn). */
function useWidth(ref, fallback = 600) {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Nút chuyển "Biểu đồ / Bảng" — mọi biểu đồ có dạng bảng tương đương. */
export function useChartTable() {
  const [mode, setMode] = useState('chart');
  const toggle = (
    <div className="segmented sm" role="tablist" aria-label="Kiểu hiển thị">
      {[['chart', 'Biểu đồ'], ['table', 'Bảng']].map(([k, l]) => (
        <button key={k} role="tab" aria-selected={mode === k} className={cx(mode === k && 'active')} onClick={() => setMode(k)}>{l}</button>
      ))}
    </div>
  );
  return [mode, toggle];
}

/** Bảng dữ liệu tương đương biểu đồ cột chồng. */
export function SeriesTable({ series, rows, labelHead = 'Mốc' }) {
  const totals = useMemo(() => rows.map((r) => series.reduce((s, x) => s + (r.values[x.key] || 0), 0)), [rows, series]);
  return (
    <div className="table-wrap viz-table">
      <table className="table compact">
        <thead><tr><th>{labelHead}</th>{series.map((s) => <th key={s.key} className="num" title={s.label}><i className="viz-key" style={{ background: s.color }} />{s.short || s.label}</th>)}<th className="num">Tổng</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.label + i}><td>{r.tip || r.label}</td>{series.map((s) => <td key={s.key} className="num">{fmt(r.values[s.key] || 0)}</td>)}<td className="num"><b>{fmt(totals[i])}</b></td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}
