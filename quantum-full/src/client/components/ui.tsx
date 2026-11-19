import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { two } from '../lib/format';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function Card({ title, subtitle, actions, children, className }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('min-w-0 rounded-xl border border-line bg-surface p-4 sm:p-5', className)}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-text">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
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
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Kpi({ label, value, hint, tone = 'default' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  const color = tone === 'good' ? 'text-accent' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-danger' : 'text-text';
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cx('tabular mt-1.5 text-xl font-semibold', color)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'secondary', loading, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean }) {
  const styles: Record<BtnVariant, string> = {
    primary: 'bg-primary text-white hover:bg-blue-500 disabled:bg-primary/50',
    secondary: 'border border-line bg-surface-2 text-text hover:border-slate-500',
    ghost: 'text-muted hover:text-text hover:bg-surface-2',
    danger: 'border border-danger/40 bg-danger/10 text-red-300 hover:bg-danger/20',
  };
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx('inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60', styles[variant], className)}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Badge({ tone = 'default', children }: { tone?: 'default' | 'good' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  const t = {
    default: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
    good: 'bg-accent/10 text-green-300 border-accent/30',
    warn: 'bg-warn/10 text-amber-300 border-warn/30',
    bad: 'bg-danger/10 text-red-300 border-danger/30',
    info: 'bg-primary/10 text-blue-300 border-primary/30',
  }[tone];
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium', t)}>{children}</span>;
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
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <Inbox className="h-8 w-8 text-muted" aria-hidden />
      <div className="mt-3 text-sm font-medium">{title}</div>
      {description && <div className="mt-1 max-w-md text-xs text-muted">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm sm:flex-row sm:items-center">
      <AlertTriangle className="h-5 w-5 shrink-0 text-danger" aria-hidden />
      <div className="flex-1">
        <div className="font-medium text-red-200">Không tải được dữ liệu</div>
        <div className="text-xs text-red-300/80">{error.message}</div>
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
  const t = { info: 'border-primary/30 bg-primary/5 text-blue-100', warn: 'border-warn/30 bg-warn/5 text-amber-100', good: 'border-accent/30 bg-accent/5 text-green-100', bad: 'border-danger/30 bg-danger/5 text-red-100' }[tone];
  return <div className={cx('rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed', t)}>{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted/80">{hint}</span>}
    </label>
  );
}

const inputCls = 'h-9 w-full rounded-lg border border-line bg-bg px-3 text-sm text-text placeholder:text-slate-600 focus:border-primary focus:outline-none';
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, 'pr-8', props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, 'h-auto py-2 font-mono text-xs', props.className)} />;
}

export function Ball({ n, special, size = 'md', highlight }: { n: number; special?: boolean; size?: 'sm' | 'md' | 'lg'; highlight?: boolean }) {
  const s = { sm: 'h-7 w-7 text-xs', md: 'h-9 w-9 text-sm', lg: 'h-12 w-12 text-lg' }[size];
  return (
    <span
      className={cx(
        'tabular inline-flex shrink-0 items-center justify-center rounded-full border font-semibold',
        s,
        special ? 'border-warn/60 bg-warn/15 text-amber-200' : highlight ? 'border-accent/70 bg-accent/20 text-green-100' : 'border-primary/50 bg-primary/10 text-blue-100',
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
          <span className="px-0.5 text-muted">|</span>
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
        Trang {meta.page}/{meta.total_pages} · {meta.total} bản ghi
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
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-2 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <td className={cx('px-2 py-2 align-middle', className)} title={title}>
      {children}
    </td>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[] }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-line bg-surface p-1">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cx('whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors', value === it.value ? 'bg-surface-2 text-text' : 'text-muted hover:text-text')}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
