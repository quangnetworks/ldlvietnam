import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { two } from '../lib/format';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

/** Console: a hairline panel, paper-2 inside a 1px rule, radius 10px, no shadow. */
export function Card({ title, subtitle, actions, children, className }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('min-w-0 rounded-[var(--radius-card)] border border-rule bg-paper-2 p-4 sm:p-5', className)}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title && <h2 className="text-base font-medium text-ink">{title}</h2>}
            {subtitle && <p className="mt-1 max-w-[72ch] text-xs leading-relaxed text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-rule pb-5">
      <div className="min-w-0">
        <h1 className="text-[length:var(--text-2xl)] font-medium leading-tight tracking-[var(--tracking-display)] text-ink">{title}</h1>
        {description && <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** A figure and its label: the label in the body face, the figure in the measured face. */
export function Kpi({ label, value, hint, tone = 'default' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  const color = tone === 'good' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-ink';
  return (
    <div className="min-w-0 rounded-[var(--radius-card)] border border-rule bg-paper-2 p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cx('measured mt-2 text-xl font-medium leading-none', color)}>{value}</div>
      {hint && <div className="mt-2 text-xs leading-snug text-muted">{hint}</div>}
    </div>
  );
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
/** Console's pair: an amber fill beside a 1px outline, both at 6px. Eight states: rest, hover, active, focus-visible, disabled, loading (and the two fills). */
export function Button({ variant = 'secondary', loading, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean }) {
  const styles: Record<BtnVariant, string> = {
    primary: 'border border-accent bg-accent text-accent-ink hover:bg-accent/90 active:bg-accent/80',
    secondary: 'border border-rule-2 bg-paper-2 text-ink hover:bg-paper-3 active:bg-paper',
    ghost: 'border border-transparent text-muted hover:bg-paper-3 hover:text-ink active:bg-paper',
    danger: 'border border-bad/50 bg-bad-soft text-bad hover:border-bad active:bg-paper',
  };
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius-pill)] px-3.5 text-sm font-medium transition-[background-color,border-color,color] duration-[var(--dur-micro)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-55',
        styles[variant],
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/** A chip carries state only: the label face inside a 1px rule at 4px, tinted by meaning (amber a person or deviation, cool an instrument). */
export function Badge({ tone = 'default', children }: { tone?: 'default' | 'good' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  const t = {
    default: 'border-rule bg-paper-3 text-ink-2',
    good: 'border-ok/35 bg-ok-soft text-ok',
    warn: 'border-accent/35 bg-accent-soft text-accent',
    bad: 'border-bad/35 bg-bad-soft text-bad',
    info: 'border-cool/35 bg-cool-soft text-cool',
  }[tone];
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-[var(--radius-chip)] border px-2 py-0.5 text-xs font-medium', t)}>{children}</span>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className ?? 'h-4 w-full')} aria-hidden />;
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Đang tải">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={i === 0 ? 'h-6 w-1/3' : 'h-4 w-full'} />
      ))}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-[var(--radius-card)] border border-dashed border-rule-2 px-5 py-8">
      <Inbox className="h-5 w-5 text-muted" aria-hidden />
      <div className="mt-2 text-sm font-medium text-ink">{title}</div>
      {description && <div className="max-w-md text-xs leading-relaxed text-muted">{description}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] border border-bad/40 bg-bad-soft p-4 text-sm sm:flex-row sm:items-center">
      <AlertTriangle className="h-5 w-5 shrink-0 text-bad" aria-hidden />
      <div className="flex-1">
        <div className="font-medium text-ink">Không tải được dữ liệu</div>
        <div className="text-xs text-ink-2">{error.message}</div>
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Thử lại
        </Button>
      )}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'good' | 'bad'; children: ReactNode }) {
  const t = {
    info: 'border-cool/30 bg-cool-soft text-ink-2',
    warn: 'border-accent/30 bg-accent-soft text-ink-2',
    good: 'border-ok/30 bg-ok-soft text-ink-2',
    bad: 'border-bad/30 bg-bad-soft text-ink-2',
  }[tone];
  return <div className={cx('rounded-[var(--radius-pill)] border px-3.5 py-2.5 text-xs leading-relaxed', t)}>{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-muted">{hint}</span>}
    </label>
  );
}

const inputCls =
  'h-9 w-full rounded-[var(--radius-pill)] border border-rule bg-paper-3 px-3 text-sm text-ink placeholder:text-rule-2 transition-[border-color] duration-[var(--dur-micro)] hover:border-rule-2 focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-55';
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, 'pr-8', props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, 'measured h-auto py-2 text-xs', props.className)} />;
}

/** A drawn number is an instrument reading (cool); the special number is set apart (amber); a matched number is ok. */
export function Ball({ n, special, size = 'md', highlight }: { n: number; special?: boolean; size?: 'sm' | 'md' | 'lg'; highlight?: boolean }) {
  const s = { sm: 'h-7 w-7 text-xs', md: 'h-9 w-9 text-sm', lg: 'h-12 w-12 text-lg' }[size];
  return (
    <span
      className={cx(
        'measured inline-flex shrink-0 items-center justify-center rounded-full border font-medium',
        s,
        special ? 'border-accent/60 bg-accent-soft text-accent' : highlight ? 'border-ok/70 bg-ok-soft text-ok' : 'border-cool/45 bg-cool-soft text-ink',
      )}
      aria-label={special ? `Số đặc biệt ${two(n)}` : `Số ${two(n)}`}
    >
      {two(n)}
    </span>
  );
}

export function Balls({ main, special, size, matchSet }: { main: number[]; special?: number | null; size?: 'sm' | 'md' | 'lg'; matchSet?: Set<number> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {main.map((n) => (
        <Ball key={n} n={n} size={size} highlight={matchSet?.has(n)} />
      ))}
      {special != null && (
        <>
          <span className="mx-0.5 h-5 w-px bg-rule-2" aria-hidden />
          <Ball n={special} special size={size} />
        </>
      )}
    </div>
  );
}

export function Pagination({ meta, onPage }: { meta?: { page: number; total_pages: number; total: number }; onPage: (p: number) => void }) {
  if (!meta || meta.total_pages <= 1) return meta ? <div className="mt-3 text-xs text-muted">{meta.total} bản ghi</div> : null;
  return (
    <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted">
      <span>
        Trang <span className="measured text-ink-2">{meta.page}/{meta.total_pages}</span>, {meta.total} bản ghi
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          Trước
        </Button>
        <Button variant="secondary" disabled={meta.page >= meta.total_pages} onClick={() => onPage(meta.page + 1)}>
          Sau
        </Button>
      </div>
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-rule-2 text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} scope="col" className="whitespace-nowrap px-2.5 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule [&_tr]:transition-[background-color] [&_tr]:duration-[var(--dur-micro)] [&_tr:hover]:bg-paper-3/60">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <td className={cx('px-2.5 py-2.5 align-middle', className)} title={title}>
      {children}
    </td>
  );
}

/** Tabs as a row of chips cut from one surface; the chosen one on the amber tint (the current selection). */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[] }) {
  return (
    <div role="tablist" className="mb-5 inline-flex max-w-full gap-px overflow-x-auto rounded-[var(--radius-pill)] border border-rule bg-rule">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cx(
            'whitespace-nowrap px-3.5 py-2 text-sm transition-[background-color,color] duration-[var(--dur-micro)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
            value === it.value ? 'bg-accent-soft font-medium text-ink' : 'bg-paper-2 text-muted hover:bg-paper-3 hover:text-ink active:bg-paper',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** A list of reasons in the body face, marked by a hairline tick rather than a bullet. */
export function Reasons({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 text-sm leading-relaxed text-ink-2">
      {items.map((r) => (
        <li key={r} className="relative pl-4 before:absolute before:left-0 before:top-[0.7em] before:h-px before:w-2 before:bg-rule-2 before:content-['']">
          {r}
        </li>
      ))}
    </ul>
  );
}

/**
 * The screen's lead record (Console "Readings"): the verdict and its reasons in one panel, the one figure that
 * carries it set large in the measured face beside them, cut from one surface.
 */
export function RecordLead({
  badge,
  headline,
  meta,
  reasons,
  children,
  actions,
  reading,
}: {
  badge: ReactNode;
  headline: ReactNode;
  meta?: ReactNode;
  reasons?: string[];
  children?: ReactNode;
  actions?: ReactNode;
  reading?: { label: string; value: ReactNode; note?: ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' };
}) {
  const tone = reading?.tone === 'good' ? 'text-ok' : reading?.tone === 'warn' ? 'text-warn' : reading?.tone === 'bad' ? 'text-bad' : 'text-ink';
  return (
    <section aria-live="polite" className={cx('panels', reading && 'lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]')}>
      <div className="flex flex-col gap-5 p-5 sm:p-7">
        <div>
          {badge}
          <h2 className="mt-3 max-w-[28ch] text-[length:var(--text-2xl)] font-medium leading-[1.08] tracking-[var(--tracking-display)] text-ink">{headline}</h2>
          {meta && <div className="mt-3 text-sm text-muted">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        {reasons && reasons.length > 0 && (
          <div className="border-t border-rule pt-4">
            <Reasons items={reasons} />
          </div>
        )}
        {children}
      </div>
      {reading && (
        <div className="flex flex-col justify-between gap-4 bg-paper-3 p-5 sm:p-7">
          <div>
            <div className="text-xs font-medium text-muted">{reading.label}</div>
            <div className={cx('reading mt-3 text-[clamp(2.25rem,5vw,3.75rem)]', tone)}>{reading.value}</div>
          </div>
          {reading.note && <div className="text-xs leading-relaxed text-muted">{reading.note}</div>}
        </div>
      )}
    </section>
  );
}
