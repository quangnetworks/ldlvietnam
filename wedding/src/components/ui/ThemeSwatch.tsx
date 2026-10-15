import type { ThemeDef } from '../../data/themes';
import { cx } from '../../lib/format';

/** Ô màu thu nhỏ: nền giấy, khối lời mời và đường kim. */
export function ThemeSwatch({ t, className }: { t: ThemeDef; className?: string }) {
  const panel = t.panel.kind === 'light' ? t.panel.bg : t.scale[800];
  return (
    <span className={cx('relative mt-0.5 block h-11 w-8 shrink-0 overflow-hidden rounded-[4px] ring-1 ring-espresso/10', className)} style={{ background: t.paper }} aria-hidden>
      <span className="absolute inset-[3px] rounded-[2px] border" style={{ borderColor: t.gold.base }} />
      <span className="absolute top-[7px] left-1/2 h-[3px] w-4 -translate-x-1/2 rounded-full" style={{ background: t.scale[700] }} />
      <span className="absolute inset-x-[3px] bottom-[3px] h-[45%] rounded-t-[10px]" style={{ background: panel }} />
      <span className="absolute bottom-[9px] left-1/2 h-[2px] w-3 -translate-x-1/2 rounded-full" style={{ background: t.panel.kind === 'light' ? t.scale[700] : t.gold.light }} />
    </span>
  );
}
