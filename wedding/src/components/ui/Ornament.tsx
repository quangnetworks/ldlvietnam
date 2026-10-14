import { cx } from '../../lib/format';

/** Nhành lá tinh giản, vẽ bằng nét mảnh. */
export function Sprig({ className, animated = false }: { className?: string; animated?: boolean }) {
  return (
    <svg viewBox="0 0 220 60" fill="none" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" className={className} aria-hidden>
      <path className={animated ? 'animate-draw' : undefined} style={{ ['--len' as string]: 260 }} d="M6 42 C 60 40, 120 30, 214 14" />
      {[
        [40, 39, -18],
        [64, 36, -28],
        [88, 33, -20],
        [112, 29, -30],
        [136, 25, -22],
        [160, 21, -32],
        [184, 18, -24],
      ].map(([x, y, r], i) => (
        <g key={i}>
          <ellipse cx={x} cy={y - 7} rx="9" ry="3.2" transform={`rotate(${r} ${x} ${y - 7})`} />
          <ellipse cx={x + 6} cy={y + 5} rx="8" ry="2.8" transform={`rotate(${-r - 6} ${x + 6} ${y + 5})`} />
        </g>
      ))}
      <circle cx="214" cy="14" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Đường phân cách mảnh với điểm nhấn hình thoi. */
export function Divider({ className }: { className?: string }) {
  return (
    <div className={cx('flex items-center gap-3', className)} aria-hidden>
      <span className="h-px flex-1 bg-current opacity-40" />
      <svg viewBox="0 0 12 12" className="size-2.5">
        <path d="M6 0 12 6 6 12 0 6Z" fill="currentColor" />
      </svg>
      <span className="h-px flex-1 bg-current opacity-40" />
    </div>
  );
}

/** Góc khung trang trí cho thiệp. */
export function CornerFlourish({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="0.9" className={className} aria-hidden>
      <path d="M2 62 V18 C2 9 9 2 18 2 H62" />
      <path d="M8 62 V22 C8 14 14 8 22 8 H62" opacity=".55" />
      <circle cx="18" cy="18" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
