import type { CSSProperties } from 'react';
import type { InvitationDesign } from '../../data/design';
import { resolveTheme, themeStyle } from '../../data/themes';
import { defaultDesign } from '../../data/design';
import { ceremony, reception, wedding } from '../../data/wedding';
import { cx, dotDate, parts } from '../../lib/format';
import { Monogram } from '../ui/Monogram';
import { CornerFlourish, Sprig } from '../ui/Ornament';

/** Kích thước dựng gốc. Xuất PNG ở hệ số 2 → 1080 × 1920. */
export const CARD_W = 540;
export const CARD_H = 960;

/** Biến màu riêng của thiệp tĩnh, suy ra từ chủ đề. */
function cardVars(palette: string): CSSProperties {
  const t = resolveTheme(palette);
  const rich = t.panel.kind === 'rich';
  return {
    ...themeStyle(palette),
    ['--paper' as string]: t.paper,
    ['--ink' as string]: '#3b2a22',
    ['--ink-soft' as string]: '#6b5548',
    ['--accent' as string]: t.scale[700],
    ['--line' as string]: t.gold.base,
    ['--panel' as string]: t.panel.kind === 'light' ? t.panel.bg : t.scale[800],
    ['--panel-ink' as string]: rich ? t.paper : '#3b2a22',
    ['--panel-soft' as string]: rich ? 'color-mix(in srgb, ' + t.paper + ' 82%, transparent)' : '#6b5548',
    ['--panel-accent' as string]: rich ? t.gold.light : t.scale[700],
  };
}

/** Cỡ chữ tên khách tự giảm theo độ dài để không tràn, tối đa 2 dòng. */
export function guestNameSize(name: string, scale = 1) {
  const n = name.length;
  const base = n <= 18 ? 36 : n <= 26 ? 32 : n <= 34 ? 28 : n <= 44 ? 25 : 22;
  return Math.round(base * scale);
}

/**
 * Thiệp tĩnh 9:16 (Chế độ B) — một trang chứa đủ thông tin, dùng cho xem trước và xuất PNG.
 * Phần trên: báo hỷ (monogram, tên, gia đình, lễ tân hôn). Phần dưới: lời mời cá nhân & tiệc cưới.
 */
export function InvitationCard({
  guestName,
  design = defaultDesign,
  highlight,
  className,
}: {
  guestName: string;
  design?: InvitationDesign;
  highlight?: string | null;
  className?: string;
}) {
  const s = design.sections;
  const r = parts(reception.date);
  const hl = (id: string) =>
    highlight === id ? 'outline outline-[1.5px] outline-offset-[6px] outline-[var(--color-champagne)] rounded-[6px] [box-shadow:0_0_0_9999px_rgba(251,247,240,0)]' : '';
  const isLight = resolveTheme(design.palette).panel.kind === 'light';

  return (
    <div
      className={cx('paper relative flex flex-col overflow-hidden text-[color:var(--ink)]', className)}
      style={{ width: CARD_W, height: CARD_H, background: 'var(--paper)', ...cardVars(design.palette) }}
    >
      {/* Khung viền mảnh */}
      <div className="pointer-events-none absolute inset-[14px] border border-[color:var(--line)]/60" />
      <CornerFlourish className="pointer-events-none absolute top-[8px] left-[8px] size-14 text-[color:var(--line)]" />
      <CornerFlourish className="pointer-events-none absolute top-[8px] right-[8px] size-14 -scale-x-100 text-[color:var(--line)]" />

      {/* ——— PHẦN BÁO HỶ ——— */}
      <section className="relative flex flex-1 flex-col items-center px-[44px] pt-[38px] text-center">
        {s.monogram && (
          <div className={cx('flex flex-col items-center', hl('monogram'))}>
            <p className="font-sans text-[9.5px] font-medium tracking-[0.42em] text-[color:var(--ink-soft)] uppercase">
              {wedding.concept}
            </p>
            <Monogram className="mt-[10px] size-[78px] text-[78px]" />
          </div>
        )}

        {s.announce && (
          <div className={cx('mt-[14px]', hl('announce'))}>
            <p className="font-sans text-[11.5px] tracking-[0.28em] text-[color:var(--ink-soft)] uppercase">{design.text.announce}</p>
            <p className="mt-[3px] font-sans text-[13px] font-semibold tracking-[0.16em] text-[color:var(--accent)] uppercase">
              {design.text.announceEvent}
            </p>
          </div>
        )}

        <div className={cx('mt-[16px] w-full', hl('couple'))}>
          <CoupleName name={wedding.groom.fullName} role={wedding.groom.role} style={design.nameStyle} />
          <div className="my-0 flex items-center justify-center gap-4 text-[color:var(--line)]">
            <span className="h-px w-16 bg-current opacity-60" />
            <span className="font-serif text-[26px] leading-none text-[color:var(--accent)] italic">&amp;</span>
            <span className="h-px w-16 bg-current opacity-60" />
          </div>
          <CoupleName name={wedding.bride.fullName} role={wedding.bride.role} style={design.nameStyle} />
        </div>

        {s.families && (
          <div className={cx('mt-[12px] grid w-full grid-cols-2 gap-x-6', hl('families'))}>
            {[wedding.families.groom, wedding.families.bride].map((f) => (
              <div key={f.side} className="text-center">
                <p className="font-sans text-[9.5px] font-semibold tracking-[0.34em] text-[color:var(--accent)] uppercase">{f.label}</p>
                <p className="mt-[5px] font-sans text-[12.5px] leading-[1.45] text-[color:var(--ink)]">
                  {f.father.title} <b className="font-semibold">{f.father.name}</b>
                  <br />
                  {f.mother.title} <b className="font-semibold">{f.mother.name}</b>
                </p>
                <p className="mt-[3px] font-serif text-[12.5px] leading-[1.3] text-[color:var(--ink-soft)] italic">
                  {f.addressLines.map((l) => (
                    <span key={l} className="block">
                      {l}
                    </span>
                  ))}
                </p>
              </div>
            ))}
          </div>
        )}

        {s.ceremony && (
          <div className={cx('mt-[10px] w-full', hl('ceremony'))}>
            <div className="flex items-center gap-3 text-[color:var(--line)]">
              <span className="h-px flex-1 bg-current opacity-60" />
              <span className="font-sans text-[9.5px] font-semibold tracking-[0.34em] text-[color:var(--accent)] uppercase">{ceremony.title}</span>
              <span className="h-px flex-1 bg-current opacity-60" />
            </div>
            <p className="mt-[5px] font-sans text-[12.5px] text-[color:var(--ink)]">
              {ceremony.venueKind} <b className="font-semibold">{ceremony.venueName.toLowerCase()}</b> · vào lúc{' '}
              <b className="font-semibold">{ceremony.time}</b>
            </p>
            <p className="font-sans text-[12.5px] text-[color:var(--ink)]">
              {ceremony.weekday}, <b className="font-semibold text-[color:var(--accent)]">{dotDate(ceremony.date)}</b>
              <span className="font-serif text-[13px] text-[color:var(--ink-soft)] italic"> ({ceremony.lunarText})</span>
            </p>
          </div>
        )}
      </section>

      {/* ——— PHẦN LỜI MỜI & TIỆC CƯỚI ——— */}
      <section
        className="relative mx-[14px] mb-[14px] flex flex-col items-center px-[30px] pt-[30px] pb-[22px] text-center text-[color:var(--panel-ink)]"
        style={{ background: 'var(--panel)', borderTopLeftRadius: '50% 64px', borderTopRightRadius: '50% 64px' }}
      >
        {!isLight && <div className="velvet pointer-events-none absolute inset-0" style={{ borderRadius: 'inherit' }} />}
        <div className="relative flex w-full flex-col items-center">
          {s.guest && (
            <div className={cx('w-full', hl('guest'))}>
              <p className="font-sans text-[10.5px] font-medium tracking-[0.38em] text-[color:var(--panel-accent)] uppercase">
                {design.text.inviteHeading}
              </p>
              <div className="mx-auto mt-[6px] flex min-h-[54px] max-w-[420px] items-center justify-center border-b border-dashed border-[color:var(--panel-accent)]/45 pb-[4px]">
                <p
                  className="font-serif leading-[1.08] font-medium text-[color:var(--panel-ink)] italic [text-wrap:balance]"
                  style={{ fontSize: guestNameSize(guestName, design.guestNameScale) }}
                  data-guest-name
                >
                  {guestName}
                </p>
              </div>
              <p className="mt-[8px] font-sans text-[12px] text-[color:var(--panel-soft)]">{design.text.inviteLine}</p>
            </div>
          )}

          <div className={cx('mt-[10px] w-full', hl('reception'))}>
            <p className="font-sans text-[9.5px] font-medium tracking-[0.3em] text-[color:var(--panel-soft)] uppercase">{reception.venueKind}</p>
            <p className={cx('font-serif text-[38px] leading-[1.05] font-semibold tracking-[0.06em] uppercase', isLight ? 'foil-burgundy' : 'foil')}>
              {reception.venueName}
            </p>
            <p className="font-sans text-[11.5px] font-semibold tracking-[0.2em] text-[color:var(--panel-accent)] uppercase">{reception.venueHall}</p>
            <p className="mt-[3px] font-sans text-[12px] leading-[1.45] text-[color:var(--panel-soft)]">
              {reception.venueAddressLines.join(' ')}
            </p>

            <div className="mx-auto mt-[10px] grid max-w-[380px] grid-cols-[1fr_auto_1fr] items-center">
              <div className="border-r border-[color:var(--panel-accent)]/40 pr-4 text-right">
                <p className="font-sans text-[11px] font-medium tracking-[0.22em] uppercase">{reception.weekday}</p>
                <p className="font-sans text-[11px] text-[color:var(--panel-soft)]">Lúc {reception.time}</p>
              </div>
              <div className="px-5 leading-none">
                <p className="font-serif text-[54px] font-semibold text-[color:var(--panel-accent)]">{r.day}</p>
              </div>
              <div className="border-l border-[color:var(--panel-accent)]/40 pl-4 text-left">
                <p className="font-sans text-[11px] font-medium tracking-[0.22em] uppercase">Tháng {r.month}</p>
                <p className="font-sans text-[11px] text-[color:var(--panel-soft)]">Năm {r.year}</p>
              </div>
            </div>
            <p className="mt-[4px] font-serif text-[13.5px] text-[color:var(--panel-soft)] italic">({reception.lunarText})</p>
            <div className="mt-[8px] flex items-center justify-center gap-6 font-sans text-[11px] tracking-[0.14em] uppercase">
              {reception.schedule.map((it) => (
                <span key={it.label}>
                  <span className="text-[color:var(--panel-soft)]">{it.label}</span>{' '}
                  <b className="font-semibold text-[color:var(--panel-accent)]">{it.time}</b>
                </span>
              ))}
            </div>
          </div>

          {s.thanks && (
            <div className={cx('mt-[10px] w-full', hl('thanks'))}>
              <Sprig className="mx-auto h-[16px] w-[110px] text-[color:var(--panel-accent)] opacity-70" />
              <p className="mx-auto mt-[4px] max-w-[360px] font-serif text-[14px] leading-[1.35] text-[color:var(--panel-soft)] italic">
                {design.text.thanks}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function CoupleName({ name, role, style }: { name: string; role: string; style: 'serif' | 'script' }) {
  return (
    <div>
      {style === 'serif' ? (
        <p className="font-serif text-[44px] leading-[1.1] font-medium text-[color:var(--accent)]">{name}</p>
      ) : (
        <p className="font-script text-[46px] leading-[1.02] whitespace-nowrap text-[color:var(--accent)]">{name}</p>
      )}
      <p className="font-sans text-[9.5px] font-medium tracking-[0.36em] text-[color:var(--ink-soft)] uppercase">{role}</p>
    </div>
  );
}
