import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from '../../lib/format';

export function Dialog({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-6">
      <div className="animate-fade-in absolute inset-0 bg-burgundy-900/45 backdrop-blur-[3px]" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'animate-fade-up paper relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] border border-champagne/30 shadow-[0_40px_80px_-30px_rgba(48,9,16,0.6)] sm:rounded-[28px]',
          className,
        )}
      >
        <header className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 sm:px-8 sm:pt-7">
          <div>
            {eyebrow && <p className="eyebrow mb-1.5 text-champagne-deep">{eyebrow}</p>}
            <h2 className="font-serif text-[28px] leading-tight font-medium text-burgundy-800">{title}</h2>
          </div>
          <button aria-label="Đóng" onClick={onClose} className="-mr-2 rounded-full p-2 text-espresso-soft hover:bg-beige">
            <X className="size-4" />
          </button>
        </header>
        <div className="scrollbar-thin overflow-y-auto px-6 pb-6 sm:px-8">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-espresso/8 bg-ivory-deep/60 px-6 py-4 sm:px-8">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
