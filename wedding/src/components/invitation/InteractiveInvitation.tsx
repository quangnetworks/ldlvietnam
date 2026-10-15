import { useEffect, useState } from 'react';
import { Expand, MapPin, Minimize, RotateCcw } from 'lucide-react';
import type { WeddingEvent } from '../../data/types';
import type { InvitationDesign } from '../../data/design';
import { themeStyle } from '../../data/themes';
import { copy, ceremony, reception, wedding } from '../../data/wedding';
import { cx, dotDate, mapsUrl, parts } from '../../lib/format';
import { Monogram } from '../ui/Monogram';
import { Divider, Sprig } from '../ui/Ornament';
import { Reveal } from '../ui/Reveal';

/**
 * Thiệp điện tử tương tác (Chế độ A) — mobile-first.
 * Bước 1: phong bì có tên khách. Bước 2: mở ra và cuộn khám phá nội dung.
 * Dùng chung nguồn dữ liệu với thiệp tĩnh (data/wedding.ts).
 */
export function InteractiveInvitation({ guestName, design }: { guestName: string; design?: InvitationDesign }) {
  const text = { ...copy, ...(design?.text ?? {}) };
  const [stage, setStage] = useState<'sealed' | 'opening' | 'open'>('sealed');
  const fs = useFullscreen();

  const open = () => {
    if (stage !== 'sealed') return;
    setStage('opening');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => setStage('open'), reduce ? 0 : 1500);
  };

  return (
    <div className="relative min-h-dvh" style={themeStyle(design?.palette)}>
      <div className="fixed top-[max(12px,env(safe-area-inset-top))] right-3 z-40 flex gap-2">
        {stage === 'open' && (
          <RoundBtn label="Xem lại phong bì" onClick={() => { setStage('sealed'); window.scrollTo({ top: 0 }); }}>
            <RotateCcw className="size-4" />
          </RoundBtn>
        )}
        {fs.supported && (
          <RoundBtn label={fs.active ? 'Thoát toàn màn hình' : 'Toàn màn hình'} onClick={fs.toggle} dark={stage !== 'open'}>
            {fs.active ? <Minimize className="size-4" /> : <Expand className="size-4" />}
          </RoundBtn>
        )}
      </div>

      {stage !== 'open' ? <Envelope guestName={guestName} opening={stage === 'opening'} onOpen={open} /> : <Story guestName={guestName} text={text} />}
    </div>
  );
}

function RoundBtn({ label, onClick, children, dark }: { label: string; onClick: () => void; children: React.ReactNode; dark?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx(
        'grid size-10 place-items-center rounded-full border backdrop-blur transition-colors',
        dark ? 'border-champagne-light/30 bg-burgundy-900/30 text-champagne-light hover:bg-burgundy-900/50' : 'border-espresso/10 bg-ivory/80 text-espresso hover:bg-ivory',
      )}
    >
      {children}
    </button>
  );
}

function Envelope({ guestName, opening, onOpen }: { guestName: string; opening: boolean; onOpen: () => void }) {
  return (
    <div className="velvet flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5 py-14 text-ivory">
      <p className="eyebrow animate-fade-up text-champagne-light/80">{wedding.concept}</p>
      <p className="animate-fade-up mt-3 text-center font-serif text-[22px] text-ivory/90 italic" style={{ animationDelay: '120ms' }}>
        Một lời mời dành riêng cho
      </p>
      <p
        className="animate-fade-up mt-1 max-w-[20ch] text-center font-serif text-[32px] leading-tight font-medium text-champagne-light [text-wrap:balance] sm:text-[38px]"
        style={{ animationDelay: '200ms' }}
      >
        {guestName}
      </p>

      {/* Phong bì */}
      <button
        onClick={onOpen}
        aria-label="Mở thiệp cưới"
        className="animate-fade-up group relative mt-10 w-full max-w-[340px] [perspective:1200px]"
        style={{ animationDelay: '320ms' }}
      >
        <div className="relative aspect-[1.45] w-full">
          {/* Mặt sau phong bì */}
          <div className="absolute inset-0 rounded-[6px] bg-[#e2d2b9]" />
          {/* Thiệp trượt ra */}
          <div
            className={cx(
              'paper absolute inset-x-[7%] top-[8%] bottom-[6%] flex flex-col items-center justify-center rounded-[4px] text-burgundy-700 shadow-lg transition-transform duration-[1100ms] ease-[var(--ease-silk)]',
              opening ? '-translate-y-[58%] delay-500' : 'translate-y-0',
            )}
          >
            <Monogram className="size-12 text-[48px]" tone="burgundy" />
            <p className="mt-1 font-sans text-[10px] tracking-[0.3em] uppercase">{dotDate(reception.date)}</p>
          </div>
          {/* Thân phong bì */}
          <div className="absolute inset-0 rounded-[6px] bg-[#f3e9da] shadow-[0_30px_60px_-25px_rgba(0,0,0,0.6)]" style={{ clipPath: 'polygon(0 30%, 50% 62%, 100% 30%, 100% 100%, 0 100%)' }} />
          <div className="absolute inset-0 rounded-[6px] bg-[#eadcc6]" style={{ clipPath: 'polygon(0 30%, 50% 62%, 0 100%)' }} />
          <div className="absolute inset-0 rounded-[6px] bg-[#eadcc6]" style={{ clipPath: 'polygon(100% 30%, 50% 62%, 100% 100%)' }} />
          {/* Nắp */}
          <div
            className={cx(
              'absolute inset-x-0 top-0 h-[64%] origin-top bg-[#f6eee1] transition-transform duration-700 ease-[var(--ease-silk)] [backface-visibility:hidden]',
              opening ? '[transform:rotateX(180deg)]' : '',
            )}
            style={{ clipPath: 'polygon(0 0, 100% 0, 50% 100%)', zIndex: opening ? 0 : 3 }}
          />
          {/* Dấu sáp */}
          <div
            className={cx(
              'absolute top-[50%] left-1/2 z-[4] grid size-[68px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,var(--color-burgundy-500),var(--color-burgundy-800)_70%)] shadow-[0_6px_16px_-4px_rgba(0,0,0,0.5),inset_0_0_0_3px_rgba(0,0,0,0.12)] transition-all duration-500',
              opening ? 'scale-75 opacity-0' : 'group-hover:scale-105',
            )}
          >
            <Monogram className="size-[54px] text-[54px]" tone="ivory" />
          </div>
        </div>
      </button>

      <p className={cx('mt-8 font-sans text-[13px] tracking-[0.2em] text-ivory/75 uppercase transition-opacity', opening && 'opacity-0')}>
        Chạm để mở thiệp
      </p>
    </div>
  );
}

function Story({ guestName, text: copy }: { guestName: string; text: typeof import('../../data/wedding').copy }) {
  return (
    <main className="paper animate-fade-in text-espresso">
      {/* Cover */}
      <section className="relative flex min-h-[92dvh] flex-col items-center justify-center overflow-hidden px-6 py-16 text-center">
        <Sprig animated className="absolute top-10 -left-6 h-14 w-56 text-champagne" />
        <Sprig animated className="absolute right-[-24px] bottom-12 h-14 w-56 rotate-180 text-champagne" />
        <Monogram className="animate-fade-up size-24 text-[96px]" />
        <p className="eyebrow animate-fade-up mt-6 text-espresso-soft" style={{ animationDelay: '150ms' }}>
          {copy.announce}
        </p>
        <p className="animate-fade-up mt-1 font-sans text-[13px] font-semibold tracking-[0.16em] text-burgundy-700 uppercase" style={{ animationDelay: '200ms' }}>
          {copy.announceEvent}
        </p>
        <h1 className="animate-fade-up mt-8 font-script text-[clamp(36px,11vw,60px)] leading-[1.25] whitespace-nowrap text-burgundy-700" style={{ animationDelay: '300ms' }}>
          {wedding.groom.fullName}
        </h1>
        <p className="eyebrow mt-2 text-espresso-soft">{wedding.groom.role}</p>
        <p className="my-1 font-serif text-[34px] leading-none text-champagne-deep italic">&amp;</p>
        <h1 className="animate-fade-up font-script text-[clamp(36px,11vw,60px)] leading-[1.25] whitespace-nowrap text-burgundy-700" style={{ animationDelay: '420ms' }}>
          {wedding.bride.fullName}
        </h1>
        <p className="eyebrow mt-2 text-espresso-soft">{wedding.bride.role}</p>
        <p className="mt-10 font-serif text-[22px] tracking-[0.2em] text-espresso">{dotDate(reception.date)}</p>
        <p className="mt-10 animate-bounce font-sans text-[11px] tracking-[0.3em] text-espresso-soft/70 uppercase">Cuộn xuống</p>
      </section>

      {/* Lời mời cá nhân */}
      <section className="velvet px-6 py-20 text-center text-ivory">
        <Reveal>
          <p className="eyebrow text-champagne-light/85">{copy.inviteHeading}</p>
          <p className="mx-auto mt-4 max-w-[18ch] font-serif text-[36px] leading-tight font-medium text-ivory italic [text-wrap:balance] sm:text-[44px]">
            {guestName}
          </p>
          <Divider className="mx-auto mt-6 max-w-[180px] text-champagne-light/70" />
          <p className="mx-auto mt-6 max-w-sm text-[15px] leading-relaxed text-ivory/80">{copy.inviteLine}</p>
          <p className="mt-2 font-serif text-[30px] font-semibold tracking-[0.06em] uppercase foil">{reception.venueName}</p>
        </Reveal>
      </section>

      {/* Gia đình */}
      <section className="px-6 py-20">
        <Reveal className="text-center">
          <p className="eyebrow text-champagne-deep">Hai gia đình</p>
          <h2 className="mt-2 font-serif text-[34px] font-medium text-burgundy-800">Trân trọng báo tin</h2>
        </Reveal>
        <div className="mx-auto mt-10 grid max-w-xl gap-6 sm:grid-cols-2">
          {[wedding.families.groom, wedding.families.bride].map((f, i) => (
            <Reveal key={f.side} delay={i * 120} className="border-t border-champagne/50 pt-6 text-center">
              <p className="eyebrow text-burgundy-600">{f.label}</p>
              <p className="mt-3 text-[16px] leading-relaxed">
                {f.father.title} <b className="font-semibold">{f.father.name}</b>
                <br />
                {f.mother.title} <b className="font-semibold">{f.mother.name}</b>
              </p>
              <p className="mt-2 font-serif text-[16px] leading-snug text-espresso-soft italic">{f.addressLines.join(' ')}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Lịch trình */}
      <section className="bg-ivory-deep/70 px-5 py-20">
        <Reveal className="text-center">
          <p className="eyebrow text-champagne-deep">Lịch trình</p>
          <h2 className="mx-auto mt-2 max-w-[13em] font-serif text-[30px] leading-tight font-medium text-burgundy-800 [text-wrap:balance] sm:text-[36px]">Ngày vui của con chúng tôi</h2>
          <Divider className="mx-auto mt-5 max-w-[140px] text-champagne" />
        </Reveal>
        <ol className="mx-auto mt-12 max-w-xl">
          {[ceremony, reception].map((e, i, all) => (
            <Reveal as="li" key={e.id} delay={i * 120}>
              <ScheduleDay e={e} last={i === all.length - 1} />
            </Reveal>
          ))}
        </ol>
      </section>

      {/* Lời cảm ơn */}
      <section className="px-6 pt-20 pb-24 text-center">
        <Reveal>
          <Sprig className="mx-auto h-8 w-40 text-champagne" />
          <p className="mx-auto mt-6 max-w-md font-serif text-[24px] leading-snug text-espresso italic">{copy.thanks}</p>
          <Monogram className="mx-auto mt-10 size-16 text-[64px]" tone="burgundy" />
        </Reveal>
      </section>
    </main>
  );
}

/** Một ngày trong lịch trình: cột ngày bên trái, các mốc giờ và địa điểm bên phải. */
function ScheduleDay({ e, last }: { e: WeddingEvent; last: boolean }) {
  const d = parts(e.date);
  const featured = e.id === 'reception';
  return (
    <div className="grid grid-cols-[76px_1fr] gap-x-5 sm:grid-cols-[96px_1fr] sm:gap-x-8">
      {/* Cột ngày */}
      <div className="relative flex flex-col items-center text-center">
        <p className="eyebrow text-[10px] text-espresso-soft">{e.weekday}</p>
        <p className={cx('mt-1 font-serif text-[52px] leading-none font-semibold sm:text-[60px]', featured ? 'text-burgundy-700' : 'text-burgundy-600')}>{d.day}</p>
        <p className="mt-1.5 font-sans text-[12px] font-medium tracking-[0.12em] text-espresso uppercase">Tháng {d.month}</p>
        <p className="font-sans text-[11px] tracking-[0.2em] text-espresso-soft">{d.year}</p>
        {!last && <span className="mt-4 w-px flex-1 bg-gradient-to-b from-champagne to-champagne/0" aria-hidden />}
      </div>

      {/* Nội dung */}
      <div className={cx('pb-12', last && 'pb-0')}>
        <div className={cx('rounded-[2px] border p-5 sm:p-6', featured ? 'velvet border-burgundy-900 text-ivory' : 'border-champagne/50 bg-ivory text-espresso')}>
          <p className={cx('eyebrow', featured ? 'text-champagne-light' : 'text-burgundy-600')}>{e.title}</p>
          <p className={cx('mt-1 font-serif text-[15px] italic', featured ? 'text-ivory/70' : 'text-espresso-soft')}>({e.lunarText})</p>

          <ul className={cx('mt-4 space-y-2 border-t pt-4', featured ? 'border-champagne-light/25' : 'border-champagne/40')}>
            {e.schedule.map((s) => (
              <li key={s.label} className="flex items-baseline gap-4">
                <span className={cx('w-[62px] shrink-0 font-serif text-[26px] leading-none font-semibold', featured ? 'text-champagne-light' : 'text-burgundy-700')}>{s.time}</span>
                <span className={cx('text-[15px]', featured ? 'text-ivory/90' : 'text-espresso')}>{s.label}</span>
              </li>
            ))}
          </ul>

          <div className={cx('mt-4 border-t pt-4', featured ? 'border-champagne-light/25' : 'border-champagne/40')}>
            <p className={cx('flex items-start gap-2 text-[13px]', featured ? 'text-ivory/70' : 'text-espresso-soft')}>
              <MapPin className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {e.venueKind}{' '}
                <b className={cx('font-semibold', featured ? 'text-ivory' : 'text-espresso')}>{featured ? e.venueName : e.venueName.toLowerCase()}</b>
                {e.venueHall && <span className={cx('block font-semibold tracking-[0.06em]', featured && 'text-champagne-light')}>{e.venueHall}</span>}
                {e.venueAddressLines.length > 0 && <span className="block">{e.venueAddressLines.join(' ')}</span>}
              </span>
            </p>
            {e.venueAddressLines.length > 0 && (
              <a
                href={mapsUrl(e)}
                target="_blank"
                rel="noreferrer"
                className={cx(
                  'mt-4 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium transition-colors',
                  featured ? 'border-champagne-light/40 text-ivory hover:bg-ivory hover:text-burgundy-800' : 'border-burgundy-600/30 text-burgundy-700 hover:bg-burgundy-700 hover:text-ivory',
                )}
              >
                <MapPin className="size-4" /> Chỉ đường
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function useFullscreen() {
  const supported = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen && document.fullscreenEnabled;
  const [active, setActive] = useState(false);
  useEffect(() => {
    const on = () => setActive(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  };
  return { supported, active, toggle };
}
