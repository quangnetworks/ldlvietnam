import { wedding } from '../../data/wedding';
import { cx } from '../../lib/format';

/**
 * Monogram H&M — chữ H và M serif lớn, dấu & viết tay nằm giữa,
 * đặt trong vòng cung mảnh như con dấu ép kim.
 */
export function Monogram({ className, tone = 'foil', ring = true }: { className?: string; tone?: 'foil' | 'burgundy' | 'ivory'; ring?: boolean }) {
  const text = tone === 'foil' ? 'foil' : tone === 'burgundy' ? 'text-burgundy-700' : 'text-ivory';
  const stroke = tone === 'ivory' ? 'text-champagne-light/70' : tone === 'burgundy' ? 'text-burgundy-600/40' : 'text-champagne';
  return (
    <div className={cx('relative inline-grid aspect-square place-items-center', className)} aria-label="Monogram H và M">
      {ring && (
        <svg viewBox="0 0 100 100" className={cx('absolute inset-0 size-full', stroke)} fill="none" stroke="currentColor" aria-hidden>
          <circle cx="50" cy="50" r="48.5" strokeWidth="0.6" />
          <circle cx="50" cy="50" r="45" strokeWidth="0.35" strokeDasharray="0.6 2.2" />
        </svg>
      )}
      <div className="relative flex items-center leading-none" style={{ fontSize: '0.42em' }}>
        <span className={cx('font-serif font-medium', text)} style={{ fontSize: '1em' }}>
          {wedding.monogram.left}
        </span>
        <span className={cx('font-script -mx-[0.04em] translate-y-[0.06em]', text)} style={{ fontSize: '0.62em' }}>
          &amp;
        </span>
        <span className={cx('font-serif font-medium', text)} style={{ fontSize: '1em' }}>
          {wedding.monogram.right}
        </span>
      </div>
    </div>
  );
}
