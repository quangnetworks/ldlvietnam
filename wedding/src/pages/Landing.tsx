import { ArrowRight, Clock, MapPin, Sparkles } from 'lucide-react';
import { InvitationCard } from '../components/invitation/InvitationCard';
import { SiteFooter, SiteNav } from '../components/site/SiteNav';
import { ButtonLink } from '../components/ui/Button';
import { Monogram } from '../components/ui/Monogram';
import { Divider, Sprig } from '../components/ui/Ornament';
import { Reveal } from '../components/ui/Reveal';
import { ScaledFrame } from '../components/ui/ScaledFrame';
import { demoGuestPreview } from '../data/demo';
import { ceremony, copy, reception, wedding } from '../data/wedding';
import { daysUntil, dotDate, mapsUrl, parts } from '../lib/format';

export default function Landing() {
  const r = parts(reception.date);
  const c = parts(ceremony.date);
  const days = daysUntil(reception.date);

  return (
    <div className="paper">
      <SiteNav />

      {/* ——— HERO ——— */}
      <section className="relative mx-auto grid min-h-[100svh] max-w-7xl items-center gap-10 px-4 pt-24 pb-14 sm:px-8 lg:grid-cols-12 lg:gap-6 lg:pt-20">
        <div className="lg:col-span-7">
          <p className="eyebrow animate-fade-up text-champagne-deep">The Art of Forever — H&amp;M Wedding</p>
          <h1 className="mt-6 font-script leading-[1.15] text-burgundy-800">
            <span className="animate-fade-up block text-[clamp(38px,10.5vw,76px)] whitespace-nowrap lg:text-[clamp(40px,5.2vw,76px)]" style={{ animationDelay: '120ms' }}>
              {wedding.groom.fullName}
            </span>
            <span className="animate-fade-up my-0 block pl-[6%] font-serif text-[clamp(36px,4vw,56px)] leading-none italic text-champagne-deep" style={{ animationDelay: '260ms' }}>
              &amp;
            </span>
            <span className="animate-fade-up block pl-[10%] text-[clamp(38px,10.5vw,76px)] whitespace-nowrap lg:text-[clamp(40px,5.2vw,76px)]" style={{ animationDelay: '380ms' }}>
              {wedding.bride.fullName}
            </span>
          </h1>
          <div className="animate-fade-up mt-10 flex max-w-xl items-start gap-5" style={{ animationDelay: '520ms' }}>
            <span className="mt-3 h-px w-12 shrink-0 bg-champagne" />
            <p className="text-[15.5px] leading-relaxed text-espresso-soft">
              {copy.announce} <span className="text-espresso">{copy.announceEvent.toLowerCase()}</span> — một buổi chiều thu tháng Mười Một, tại Sài Gòn, cùng
              những người thân yêu nhất.
            </p>
          </div>
          <div className="animate-fade-up mt-10 flex flex-wrap items-center gap-3" style={{ animationDelay: '640ms' }}>
            <ButtonLink to="/xem-truoc" variant="primary" size="lg" icon={<Sparkles className="size-4" />}>
              Khám phá thiệp cưới
            </ButtonLink>
            <ButtonLink to={`/thiep?khach=${demoGuestPreview.guest_id}`} variant="ghost" size="lg">
              Mở thiệp tương tác <ArrowRight className="size-4" />
            </ButtonLink>
          </div>
        </div>

        {/* Vòm ngày cưới */}
        <div className="animate-fade-up lg:col-span-5" style={{ animationDelay: '300ms' }}>
          <div className="velvet relative mx-auto flex aspect-[4/5] w-full max-w-[420px] flex-col items-center justify-center overflow-hidden rounded-t-[999px] px-8 text-center text-ivory shadow-[0_60px_100px_-50px_rgba(48,9,16,0.75)]">
            <div className="pointer-events-none absolute inset-3 rounded-t-[999px] border border-champagne-light/30" />
            <Monogram className="size-28 text-[112px] sm:size-32 sm:text-[128px]" />
            <p className="eyebrow mt-8 text-champagne-light/80">Saturday · November</p>
            <p className="mt-2 font-serif text-[64px] leading-none font-medium">
              {r.day}
              <span className="mx-2 text-champagne">·</span>
              {r.month}
            </p>
            <p className="mt-2 font-serif text-[22px] tracking-[0.5em] text-ivory/80">{r.year}</p>
            <Divider className="mt-6 w-32 text-champagne-light/50" />
            {days >= 0 && (
              <p className="mt-5 text-[13px] text-ivory/75">
                {days === 0 ? 'Hôm nay là ngày vui' : (
                  <>
                    Còn <b className="font-serif text-[20px] font-semibold text-champagne-light">{days}</b> ngày
                  </>
                )}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ——— GIA ĐÌNH ——— */}
      <section id="gia-dinh" className="scroll-mt-16 border-y border-champagne/30 bg-ivory-deep/60">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-8 lg:py-32">
          <div className="grid gap-12 lg:grid-cols-12">
            <Reveal className="lg:col-span-4">
              <p className="eyebrow text-champagne-deep">01 — Hai gia đình</p>
              <h2 className="mt-4 font-serif text-[clamp(36px,5vw,56px)] leading-[1.02] font-medium text-burgundy-800">
                Hai mái nhà,
                <br />
                <em className="text-champagne-deep">một niềm vui.</em>
              </h2>
              <Sprig className="mt-8 h-10 w-52 text-champagne" />
            </Reveal>
            <div className="grid gap-px overflow-hidden bg-champagne/30 sm:grid-cols-2 lg:col-span-8">
              {[wedding.families.groom, wedding.families.bride].map((f, i) => {
                const child = f.side === 'groom' ? wedding.groom : wedding.bride;
                return (
                  <Reveal key={f.side} delay={i * 140} className="bg-ivory p-8 sm:p-10">
                    <p className="eyebrow text-burgundy-600">{f.label}</p>
                    <div className="mt-6 space-y-1.5 text-[17px] text-espresso">
                      <p>
                        {f.father.title} <b className="font-semibold">{f.father.name}</b>
                      </p>
                      <p>
                        {f.mother.title} <b className="font-semibold">{f.mother.name}</b>
                      </p>
                    </div>
                    <p className="mt-4 font-serif text-[17px] leading-snug text-espresso-soft italic">
                      {f.addressLines.map((l) => (
                        <span className="block" key={l}>{l}</span>
                      ))}
                    </p>
                    <div className="mt-10 border-t border-champagne/40 pt-6">
                      <p className="eyebrow text-espresso-soft">{child.role}</p>
                      <p className="mt-2 font-script text-[34px] leading-[1.3] whitespace-nowrap text-burgundy-700 sm:text-[40px]">{child.fullName}</p>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ——— LỄ TÂN HÔN ——— */}
      <section id="le-tan-hon" className="scroll-mt-16">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-24 sm:px-8 lg:grid-cols-12 lg:py-32">
          <Reveal className="relative lg:col-span-5">
            <p className="font-serif text-[clamp(160px,26vw,300px)] leading-[0.8] font-light text-transparent [-webkit-text-stroke:1px_var(--color-champagne)]">
              {c.day}
            </p>
            <p className="eyebrow absolute bottom-2 left-2 text-burgundy-600">
              Tháng {c.month} · {c.year}
            </p>
          </Reveal>
          <Reveal delay={120} className="lg:col-span-6 lg:col-start-7">
            <p className="eyebrow text-champagne-deep">02 — {ceremony.title}</p>
            <h2 className="mt-4 font-serif text-[clamp(34px,4.5vw,52px)] leading-[1.05] font-medium text-burgundy-800">
              {ceremony.venueKind.replace(/ tại$/, '')} <em className="whitespace-nowrap text-champagne-deep">tại {ceremony.venueName.toLowerCase()}</em>
            </h2>
            <dl className="mt-10 grid max-w-md grid-cols-2 gap-6 border-t border-champagne/40 pt-8">
              <div>
                <dt className="eyebrow text-espresso-soft">Vào lúc</dt>
                <dd className="mt-2 font-serif text-[30px] font-medium text-burgundy-700">{ceremony.time}</dd>
              </div>
              <div>
                <dt className="eyebrow text-espresso-soft">{ceremony.weekday}</dt>
                <dd className="mt-2 font-serif text-[30px] font-medium text-burgundy-700">{dotDate(ceremony.date)}</dd>
              </div>
            </dl>
            <p className="mt-6 font-serif text-[18px] text-espresso-soft italic">({ceremony.lunarText})</p>
          </Reveal>
        </div>
      </section>

      {/* ——— TIỆC CƯỚI ——— */}
      <section id="tiec-cuoi" className="velvet scroll-mt-16 text-ivory">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-8 lg:py-32">
          <Reveal className="text-center">
            <p className="eyebrow text-champagne-light/80">03 — {reception.title}</p>
            <p className="mt-6 text-[13px] tracking-[0.3em] text-ivory/70 uppercase">{reception.venueKind}</p>
            <h2 className="foil mt-3 font-serif text-[clamp(46px,8vw,104px)] leading-none font-semibold tracking-[0.04em] uppercase">{reception.venueName}</h2>
            <p className="mt-4 text-[14px] font-semibold tracking-[0.24em] text-champagne-light uppercase">{reception.venueHall}</p>
            <p className="mt-3 text-[16px] text-ivory/80">{reception.venueAddressLines.join(' ')}</p>
          </Reveal>

          <Reveal delay={100} className="mx-auto mt-16 grid max-w-4xl grid-cols-1 border-y border-champagne-light/25 sm:grid-cols-3">
            <div className="py-8 text-center sm:border-r sm:border-champagne-light/25">
              <p className="eyebrow text-ivory/60">{reception.weekday}</p>
              <p className="mt-2 font-serif text-[44px] leading-none font-medium">{dotDate(reception.date)}</p>
              <p className="mt-2 font-serif text-[15px] text-ivory/70 italic">({reception.lunarText})</p>
            </div>
            {reception.schedule.map((s, i) => (
              <div key={s.label} className={'py-8 text-center ' + (i === 0 ? 'border-t border-champagne-light/25 sm:border-t-0 sm:border-r' : 'border-t border-champagne-light/25 sm:border-t-0')}>
                <p className="eyebrow text-ivory/60">
                  <Clock className="mr-1.5 inline size-3.5 -translate-y-px" />
                  {s.label}
                </p>
                <p className="mt-2 font-serif text-[44px] leading-none font-medium text-champagne-light">{s.time}</p>
              </div>
            ))}
          </Reveal>

          <Reveal className="mt-12 text-center">
            <a
              href={mapsUrl(reception)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-12 items-center gap-2 rounded-full border border-champagne-light/40 px-7 text-[14.5px] font-medium transition-colors hover:bg-ivory hover:text-burgundy-800"
            >
              <MapPin className="size-4" /> Xem bản đồ đến {reception.venueName}
            </a>
          </Reveal>
        </div>
      </section>

      {/* ——— THIỆP MỜI ——— */}
      <section className="overflow-hidden">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 py-24 sm:px-8 lg:grid-cols-12 lg:py-32">
          <Reveal className="lg:col-span-5">
            <p className="eyebrow text-champagne-deep">04 — Thiệp mời</p>
            <h2 className="mt-4 font-serif text-[clamp(34px,4.5vw,52px)] leading-[1.05] font-medium text-burgundy-800">
              Mỗi vị khách,
              <br />
              <em className="text-champagne-deep">một tấm thiệp riêng.</em>
            </h2>
            <p className="mt-6 max-w-md text-[15.5px] leading-relaxed text-espresso-soft">
              Tên khách mời được đặt trang trọng trong vùng riêng của thiệp, không bao giờ chồng lên tên cô dâu chú rể. Mở dưới dạng phong bì tương tác, hoặc gửi ảnh tĩnh 9:16
              qua Zalo, Messenger.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink to="/xem-truoc" variant="primary" icon={<Sparkles className="size-4" />}>
                Xem trước thiệp
              </ButtonLink>
              <ButtonLink to="/studio" variant="secondary">
                Vào Wedding Studio
              </ButtonLink>
            </div>
          </Reveal>
          <Reveal delay={150} className="relative lg:col-span-6 lg:col-start-7">
            <div className="absolute inset-x-[10%] top-[8%] bottom-[2%] rotate-[-5deg] rounded-[2px] bg-beige" />
            <div className="relative mx-auto w-full max-w-[360px] rotate-[2deg] shadow-[0_50px_80px_-40px_rgba(48,9,16,0.6)]">
              <ScaledFrame>
                <InvitationCard guestName={demoGuestPreview.display_name} salutation={demoGuestPreview.salutation} />
              </ScaledFrame>
            </div>
            <p className="relative mt-10 text-center text-[12px] text-espresso-soft">Tên khách “{demoGuestPreview.display_name}” là dữ liệu minh họa.</p>
          </Reveal>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
