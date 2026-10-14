import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from '../../lib/format';

const control =
  'w-full rounded-xl border border-espresso/12 bg-white/70 px-3.5 py-2.5 text-sm text-espresso placeholder:text-espresso-soft/50 transition-colors focus:border-burgundy-600/50 focus:bg-white focus:outline-none focus:ring-4 focus:ring-burgundy-600/8';

interface Wrap {
  label: string;
  hint?: ReactNode;
  className?: string;
}

function FieldWrap({ id, label, hint, className, children }: Wrap & { id: string; children: ReactNode }) {
  return (
    <div className={cx('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[12px] font-medium text-espresso-soft">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11.5px] leading-relaxed text-espresso-soft/80">{hint}</p>}
    </div>
  );
}

export function TextField({ label, hint, className, ...rest }: Wrap & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <FieldWrap id={id} label={label} hint={hint} className={className}>
      <input id={id} className={control} {...rest} />
    </FieldWrap>
  );
}

export function TextArea({ label, hint, className, ...rest }: Wrap & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <FieldWrap id={id} label={label} hint={hint} className={className}>
      <textarea id={id} className={cx(control, 'min-h-20 resize-y leading-relaxed')} {...rest} />
    </FieldWrap>
  );
}

export function SelectField({
  label,
  hint,
  className,
  options,
  ...rest
}: Wrap & SelectHTMLAttributes<HTMLSelectElement> & { options: Array<string | { value: string; label: string }> }) {
  const id = useId();
  return (
    <FieldWrap id={id} label={label} hint={hint} className={className}>
      <select id={id} className={cx(control, 'appearance-none bg-[length:12px] bg-[right_14px_center] bg-no-repeat pr-9')} style={{ backgroundImage: chevron }} {...rest}>
        {options.map((o) => {
          const v = typeof o === 'string' ? { value: o, label: o } : o;
          return (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          );
        })}
      </select>
    </FieldWrap>
  );
}

const chevron = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5 6 8l3.5-3.5' fill='none' stroke='%236b5548' stroke-width='1.4'/%3E%3C/svg%3E")`;

export function SearchInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cx('relative', className)}>
      <svg viewBox="0 0 20 20" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-espresso-soft/70" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="9" cy="9" r="5.5" />
        <path d="m13.5 13.5 3.5 3.5" strokeLinecap="round" />
      </svg>
      <input type="search" className={cx(control, 'rounded-full pl-10')} {...rest} />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: ReactNode }>;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="tablist" className={cx('inline-flex rounded-full border border-espresso/10 bg-beige/50 p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-full font-medium transition-all duration-300',
            size === 'sm' ? 'px-3 py-1 text-[12px]' : 'px-4 py-1.5 text-[13px]',
            value === o.value ? 'bg-white text-burgundy-700 shadow-[0_2px_10px_-4px_rgba(59,42,34,0.35)]' : 'text-espresso-soft hover:text-espresso',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors duration-300', checked ? 'bg-burgundy-600' : 'bg-espresso/15')}
    >
      <span className={cx('absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform duration-300', checked && 'translate-x-4')} />
    </button>
  );
}
