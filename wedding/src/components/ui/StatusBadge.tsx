import type { GuestStatus } from '../../data/types';
import { statusMeta } from '../../data/demo';
import { cx } from '../../lib/format';

const tones = {
  neutral: 'bg-espresso/6 text-espresso-soft ring-espresso/10',
  gold: 'bg-champagne/15 text-champagne-deep ring-champagne/35',
  success: 'bg-[#e7efe6] text-[#3d5a3a] ring-[#3d5a3a]/15',
  danger: 'bg-burgundy-50 text-burgundy-600 ring-burgundy-600/20',
  info: 'bg-rose-soft text-burgundy-700 ring-rose',
} as const;

export type Tone = keyof typeof tones;

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ring-1 ring-inset', tones[tone], className)}>
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: GuestStatus }) {
  const m = statusMeta[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function DemoTag({ className, children = 'Dữ liệu minh họa' }: { className?: string; children?: React.ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full border border-dashed border-champagne-deep/50 px-2.5 py-0.5 text-[11px] font-medium text-champagne-deep', className)}>
      {children}
    </span>
  );
}
