import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cx } from '../../lib/format';

type Variant = 'primary' | 'secondary' | 'ghost' | 'gold' | 'ivory';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-sans font-medium tracking-[0.02em] transition-[background,color,border-color,box-shadow,transform] duration-300 ease-[var(--ease-silk)] disabled:cursor-not-allowed disabled:opacity-45 active:scale-[0.985]';

const variants: Record<Variant, string> = {
  primary: 'bg-burgundy-700 text-ivory hover:bg-burgundy-800 shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_24px_-12px_rgba(74,14,24,0.6)]',
  secondary: 'border border-espresso/15 bg-white/60 text-espresso hover:border-burgundy-600/40 hover:text-burgundy-700',
  ghost: 'text-espresso-soft hover:bg-beige/60 hover:text-espresso',
  gold: 'bg-champagne text-burgundy-900 hover:bg-champagne-light',
  ivory: 'border border-champagne-light/40 text-ivory hover:bg-ivory hover:text-burgundy-800',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-full',
  md: 'h-10 px-5 text-sm rounded-full',
  lg: 'h-12 px-7 text-[15px] rounded-full',
};

interface Common {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  /** Nhãn nhỏ cho tính năng chưa triển khai (giai đoạn 2). */
  soon?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & Common>(
  ({ variant = 'secondary', size = 'md', icon, soon, className, children, disabled, title, ...rest }, ref) => (
    <button
      ref={ref}
      className={cx(base, variants[variant], sizes[size], className)}
      disabled={disabled || soon}
      title={soon ? 'Sẽ hoạt động ở giai đoạn 2 — hiện chỉ là giao diện' : title}
      {...rest}
    >
      {icon}
      {children}
      {soon && <SoonTag />}
    </button>
  ),
);
Button.displayName = 'Button';

export function ButtonLink({ variant = 'secondary', size = 'md', icon, className, children, ...rest }: LinkProps & Common) {
  return (
    <Link className={cx(base, variants[variant], sizes[size], className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

export function SoonTag() {
  return (
    <span className="rounded-full border border-current/30 px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.12em] opacity-80">
      GĐ 2
    </span>
  );
}

export function IconButton({ className, label, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        'inline-grid size-9 place-items-center rounded-full text-espresso-soft transition-colors hover:bg-beige/70 hover:text-espresso disabled:opacity-35 disabled:hover:bg-transparent',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
