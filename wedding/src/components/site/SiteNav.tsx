import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { cx } from '../../lib/format';
import { Monogram } from '../ui/Monogram';
import { wedding } from '../../data/wedding';

const links = [
  { to: '/#gia-dinh', label: 'Gia đình' },
  { to: '/#le-tan-hon', label: 'Lễ tân hôn' },
  { to: '/#tiec-cuoi', label: 'Tiệc cưới' },
  { to: '/xem-truoc', label: 'Thiệp mời' },
];

export function SiteNav({ overDark = false }: { overDark?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const light = overDark && !scrolled && !open;
  return (
    <header
      className={cx(
        'fixed inset-x-0 top-0 z-50 transition-[background,box-shadow,color] duration-500',
        scrolled || open ? 'bg-ivory/90 shadow-[0_1px_0_rgba(201,169,110,0.35)] backdrop-blur-md' : 'bg-transparent',
        light ? 'text-ivory' : 'text-espresso',
      )}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-8">
        <Link to="/" className="flex items-center gap-3" aria-label="Trang chủ H&M">
          <Monogram className="size-10 text-[40px]" tone={light ? 'ivory' : 'burgundy'} />
          <span className="hidden font-serif text-[17px] tracking-[0.04em] sm:inline">The Art of Forever</span>
        </Link>
        <div className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <Link key={l.to} to={l.to} className="eyebrow opacity-80 transition-opacity hover:opacity-100">
              {l.label}
            </Link>
          ))}
          <NavLink
            to="/studio"
            className={cx(
              'rounded-full border px-4 py-1.5 text-[12.5px] font-medium transition-colors',
              light ? 'border-ivory/40 hover:bg-ivory hover:text-burgundy-800' : 'border-espresso/15 hover:border-burgundy-600/40 hover:text-burgundy-700',
            )}
          >
            Wedding Studio
          </NavLink>
        </div>
        <button className="grid size-10 place-items-center rounded-full md:hidden" aria-label={open ? 'Đóng menu' : 'Mở menu'} onClick={() => setOpen((v) => !v)}>
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>
      {open && (
        <div className="animate-fade-in border-t border-champagne/30 px-4 pt-2 pb-6 md:hidden">
          {[...links, { to: '/studio', label: 'Wedding Studio' }].map((l) => (
            <Link key={l.to} to={l.to} onClick={() => setOpen(false)} className="block border-b border-espresso/6 py-3.5 font-serif text-[22px] text-burgundy-800">
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-champagne/40 bg-ivory px-4 py-12 text-center sm:px-8">
      <Monogram className="mx-auto size-14 text-[56px]" tone="burgundy" />
      <p className="mt-4 font-script text-[30px] leading-[1.35] text-burgundy-800">
        <span className="whitespace-nowrap">{wedding.groom.fullName}</span> <span className="font-serif text-[22px] text-champagne-deep italic">&amp;</span>{' '}
        <span className="whitespace-nowrap">{wedding.bride.fullName}</span>
      </p>
      <p className="eyebrow mt-2 text-espresso-soft">14 · 11 · 2026 — The Art of Forever</p>
      <div className="mt-6 flex justify-center gap-6 text-[13px] text-espresso-soft">
        <Link to="/xem-truoc" className="hover:text-burgundy-700">Thiệp mời</Link>
        <Link to="/studio" className="hover:text-burgundy-700">Wedding Studio</Link>
      </div>
    </footer>
  );
}
