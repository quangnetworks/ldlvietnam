import { useState } from 'react';
import { Expand, MailOpen, Smartphone } from 'lucide-react';
import { InvitationCard } from '../components/invitation/InvitationCard';
import { SiteNav } from '../components/site/SiteNav';
import { ButtonLink } from '../components/ui/Button';
import { Segmented, SelectField } from '../components/ui/Field';
import { PhoneFrame, ScaledFrame } from '../components/ui/ScaledFrame';
import { DemoTag } from '../components/ui/StatusBadge';
import { demoGuests } from '../data/demo';
import { defaultDesign } from '../data/design';
import { themes, type ThemeId } from '../data/themes';
import { ThemeSwatch } from '../components/ui/ThemeSwatch';
import { cx } from '../lib/format';

const zones = [
  { id: 'monogram', n: '01', title: 'Monogram H&M', text: 'Dấu ép kim mở đầu, khẳng định bản sắc của hai bạn.' },
  { id: 'announce', n: '02', title: 'Tiêu đề lời mời', text: 'Trân trọng báo tin lễ tân hôn của con chúng tôi.' },
  { id: 'couple', n: '03', title: 'Tên cô dâu & chú rể', text: 'Trọng tâm thị giác — Trần Minh Huy & Tiêu Bảo Muội.' },
  { id: 'guest', n: '04', title: 'Tên khách mời', text: 'Vùng riêng, tự co chữ & xuống dòng với tên dài.' },
  { id: 'families', n: '05', title: 'Gia đình hai bên', text: 'Nhà trai và nhà gái, kèm địa chỉ.' },
  { id: 'ceremony', n: '06', title: 'Lễ tân hôn', text: '14:00 · Thứ Bảy 07.11.2026 · tại tư gia.' },
  { id: 'reception', n: '07', title: 'Tiệc cưới & địa điểm', text: 'Adora Luxury · Sảnh Diamond · 14.11.2026.' },
  { id: 'thanks', n: '08', title: 'Lời cảm ơn', text: 'Lời kết trân trọng gửi Quý Khách.' },
];

export default function InvitationPreview() {
  const [guestId, setGuestId] = useState(demoGuests[0].guest_id);
  const [mode, setMode] = useState<'static' | 'interactive'>('static');
  const [focus, setFocus] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeId>('burgundy');
  const design = { ...defaultDesign, palette: theme };
  const guest = demoGuests.find((g) => g.guest_id === guestId)!;

  return (
    <div className="paper min-h-dvh">
      <SiteNav />
      <main className="mx-auto max-w-7xl px-4 pt-24 pb-20 sm:px-8 lg:pt-28">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
          {/* Thiệp */}
          <div className="order-2 lg:order-1 lg:col-span-6 xl:col-span-5">
            <div className="lg:sticky lg:top-24">
              {mode === 'static' ? (
                <div className="mx-auto w-full max-w-[min(440px,calc((100dvh-140px)*0.5625))] shadow-[0_50px_90px_-45px_rgba(48,9,16,0.7)]">
                  <ScaledFrame>
                    <InvitationCard guestName={guest.display_name} design={design} highlight={focus} />
                  </ScaledFrame>
                </div>
              ) : (
                <PhoneFrame className="mx-auto w-full max-w-[340px]">
                  <iframe
                    key={guestId + theme}
                    title="Thiệp tương tác"
                    src={`/thiep?khach=${guestId}&chu-de=${theme}`}
                    className="block aspect-[9/19.5] w-full bg-burgundy-800"
                  />
                </PhoneFrame>
              )}
              <p className="mt-5 text-center text-[12px] text-espresso-soft">
                {mode === 'static' ? 'Thiệp tĩnh 9:16 · xuất PNG 1080 × 1920' : 'Thiệp tương tác · chạm vào phong bì để mở'}
              </p>
            </div>
          </div>

          {/* Thông tin */}
          <div className="order-1 lg:order-2 lg:col-span-6 lg:col-start-7 xl:col-span-6 xl:col-start-7">
            <p className="eyebrow text-champagne-deep">Invitation Preview</p>
            <h1 className="mt-3 font-serif text-[clamp(38px,5vw,60px)] leading-[1.02] font-medium text-burgundy-800">
              Thiệp cưới <em className="text-champagne-deep">H&amp;M</em>
            </h1>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-espresso-soft">
              Hai chế độ trình bày dùng chung một nguồn dữ liệu: thiệp tĩnh để gửi ảnh, và phong bì tương tác để khách mở trên điện thoại.
            </p>

            <div className="mt-8 grid gap-4 rounded-[20px] border border-champagne/40 bg-ivory/70 p-5 sm:grid-cols-[1fr_auto] sm:items-end">
              <SelectField
                label="Xem với tên khách"
                value={guestId}
                onChange={(e) => setGuestId(e.target.value)}
                options={demoGuests.map((g) => ({ value: g.guest_id, label: g.display_name }))}
              />
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'static', label: 'Thiệp tĩnh' },
                  { value: 'interactive', label: 'Tương tác' },
                ]}
              />
              <div className="sm:col-span-2">
                <p className="text-[12px] font-medium text-espresso-soft">Chủ đề màu</p>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {themes.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTheme(t.id)}
                      aria-pressed={theme === t.id}
                      title={t.meaning}
                      className={cx(
                        'flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors',
                        theme === t.id ? 'border-burgundy-600/40 bg-white shadow-[0_6px_18px_-12px_rgba(59,42,34,0.4)]' : 'border-espresso/8 bg-white/40 hover:bg-white/70',
                      )}
                    >
                      <ThemeSwatch t={t} className="mt-0 h-9 w-7" />
                      <span className="text-[12.5px] leading-tight font-medium text-espresso">{t.name}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-espresso-soft">{themes.find((t) => t.id === theme)?.meaning}</p>
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <DemoTag>Tên khách là dữ liệu minh họa</DemoTag>
              </div>
            </div>

            <ol className="mt-10 grid gap-px overflow-hidden rounded-[2px] bg-champagne/30 sm:grid-cols-2">
              {zones.map((z) => (
                <li key={z.id}>
                  <button
                    onMouseEnter={() => setFocus(z.id)}
                    onMouseLeave={() => setFocus(null)}
                    onFocus={() => setFocus(z.id)}
                    onBlur={() => setFocus(null)}
                    onClick={() => { setMode('static'); setFocus((f) => (f === z.id ? null : z.id)); }}
                    className={cx('flex h-full w-full gap-4 p-5 text-left transition-colors', focus === z.id ? 'bg-rose-soft' : 'bg-ivory hover:bg-ivory-deep')}
                  >
                    <span className="font-serif text-[22px] leading-none text-champagne-deep">{z.n}</span>
                    <span>
                      <span className="block text-[14px] font-semibold text-espresso">{z.title}</span>
                      <span className="mt-1 block text-[13px] leading-relaxed text-espresso-soft">{z.text}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>

            <div className="mt-10 flex flex-wrap gap-3">
              <ButtonLink to={`/thiep?khach=${guestId}&chu-de=${theme}`} variant="primary" icon={<MailOpen className="size-4" />}>
                Mở thiệp tương tác
              </ButtonLink>
              <ButtonLink to={`/thiep?khach=${guestId}&che-do=tinh&chu-de=${theme}`} variant="secondary" icon={<Expand className="size-4" />}>
                Thiệp tĩnh toàn màn hình
              </ButtonLink>
              <ButtonLink to="/studio/thiet-ke" variant="ghost" icon={<Smartphone className="size-4" />}>
                Chỉnh trong Studio
              </ButtonLink>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
