import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Download, FileSpreadsheet, LayoutGrid, Menu, Palette, Settings, Users, X, ExternalLink } from 'lucide-react';
import { cx, daysUntil } from '../../lib/format';
import { reception, wedding } from '../../data/wedding';
import { Monogram } from '../ui/Monogram';
import { StudioProvider } from './StudioContext';

const nav = [
  { to: '/studio', end: true, label: 'Tổng quan', icon: LayoutGrid },
  { to: '/studio/thiet-ke', label: 'Thiết kế thiệp', icon: Palette },
  { to: '/studio/khach-moi', label: 'Danh sách khách mời', icon: Users },
  { to: '/studio/nhap-excel', label: 'Nhập Excel', icon: FileSpreadsheet },
  { to: '/studio/xuat-thiep', label: 'Xuất thiệp', icon: Download },
  { to: '/studio/cai-dat', label: 'Cài đặt', icon: Settings },
];

export function StudioLayout() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const days = daysUntil(reception.date);

  const sidebar = (
    <div className="flex h-full flex-col">
      <Link to="/" className="flex items-center gap-3 px-6 pt-7 pb-8">
        <Monogram className="size-11 text-[44px]" tone="burgundy" />
        <div>
          <p className="font-serif text-[19px] leading-none text-burgundy-800">Wedding Studio</p>
          <p className="mt-1 text-[11px] tracking-[0.18em] text-espresso-soft uppercase">The Art of Forever</p>
        </div>
      </Link>
      <nav className="flex-1 space-y-0.5 px-3">
        {nav.map(({ to, end, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cx(
                'group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[14px] transition-colors',
                isActive ? 'bg-white/80 font-medium text-burgundy-700 shadow-[0_1px_0_rgba(201,169,110,0.35)]' : 'text-espresso-soft hover:bg-white/50 hover:text-espresso',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className={cx('absolute top-2.5 bottom-2.5 left-0 w-[2px] rounded-full bg-champagne transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} />
                <Icon className="size-[17px]" strokeWidth={1.6} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="m-4 rounded-2xl velvet p-5 text-ivory">
        <p className="eyebrow text-champagne-light/75">Tiệc cưới</p>
        <p className="mt-2 font-serif text-[18px] leading-tight">
          {wedding.groom.fullName}
          <br />
          <span className="font-script text-[22px] text-champagne-light">&amp;</span> {wedding.bride.fullName}
        </p>
        {days >= 0 && <p className="mt-3 text-[12px] text-ivory/70">Còn {days} ngày · 14.11.2026</p>}
        <Link to="/" className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-champagne-light hover:text-ivory">
          Xem website cưới <ExternalLink className="size-3" />
        </Link>
      </div>
    </div>
  );

  return (
    <StudioProvider>
      <div className="paper min-h-dvh lg:pl-[264px]">
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-[264px] border-r border-champagne/35 bg-ivory-deep/80 lg:block">{sidebar}</aside>

        {/* Thanh trên mobile/tablet */}
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-champagne/35 bg-ivory/90 px-4 backdrop-blur-md lg:hidden">
          <Link to="/studio" className="flex items-center gap-2.5">
            <Monogram className="size-8 text-[32px]" tone="burgundy" />
            <span className="font-serif text-[17px] text-burgundy-800">Wedding Studio</span>
          </Link>
          <button aria-label="Mở menu" onClick={() => setOpen(true)} className="grid size-10 place-items-center rounded-full hover:bg-beige">
            <Menu className="size-5" />
          </button>
        </header>
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="animate-fade-in absolute inset-0 bg-burgundy-900/40" onClick={() => setOpen(false)} />
            <aside className="animate-fade-up absolute inset-y-0 left-0 w-[86%] max-w-[300px] bg-ivory-deep shadow-2xl">
              <button aria-label="Đóng menu" onClick={() => setOpen(false)} className="absolute top-4 right-3 grid size-9 place-items-center rounded-full hover:bg-beige">
                <X className="size-4" />
              </button>
              {sidebar}
            </aside>
          </div>
        )}

        <Outlet />
      </div>
    </StudioProvider>
  );
}

export function PageHeader({ eyebrow, title, description, actions, children }: { eyebrow: string; title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="border-b border-champagne/30 px-4 pt-8 pb-6 sm:px-8 lg:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="eyebrow text-champagne-deep">{eyebrow}</p>
          <h1 className="mt-2 font-serif text-[clamp(30px,3.6vw,42px)] leading-[1.05] font-medium text-burgundy-800">{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-espresso-soft">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('rounded-[20px] border border-espresso/8 bg-white/55', className)}>{children}</section>;
}
