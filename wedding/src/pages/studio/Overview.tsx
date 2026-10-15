import { CheckCircle2, Download, FileSpreadsheet, Palette, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { InvitationCard } from '../../components/invitation/InvitationCard';
import { PageHeader, Panel } from '../../components/studio/StudioLayout';
import { useStudio } from '../../components/studio/StudioContext';
import { ButtonLink } from '../../components/ui/Button';
import { ScaledFrame } from '../../components/ui/ScaledFrame';
import { ceremony, reception } from '../../data/wedding';
import { cx, daysUntil, dotDate } from '../../lib/format';
import { relTime } from '../../lib/clipboard';

export default function Overview() {
  const { savedDesign: design, guests } = useStudio();
  const total = guests.length;
  const created = guests.filter((g) => g.invitation_status !== 'draft').length;
  const exported = guests.filter((g) => g.invitation_status === 'exported').length;
  const pending = guests.filter((g) => g.invitation_status === 'error' || g.invitation_status === 'draft').length;
  const sent = guests.filter((g) => g.link_sent_at).length;
  const opened = guests.filter((g) => g.opened_at).length;
  const groups = new Set(guests.map((g) => g.guest_group).filter(Boolean)).size;
  const stats = [
    { label: 'Tổng khách mời', value: total, note: `${groups} nhóm khách` },
    { label: 'Thiệp đã tạo', value: created, note: total ? `${Math.round((created / total) * 100)}% danh sách` : '—' },
    { label: 'Thiệp đã xuất ảnh', value: exported, note: 'PNG 1080 × 1920' },
    { label: 'Thiệp cần xử lý', value: pending, note: 'Chưa tạo hoặc xuất lỗi', alert: pending > 0 },
  ];
  const recent = [...guests]
    .filter((g) => g.last_opened_at)
    .sort((a, b) => (b.last_opened_at ?? '').localeCompare(a.last_opened_at ?? ''))
    .slice(0, 5);

  return (
    <>
      <PageHeader
        eyebrow="Tổng quan"
        title={
          <>
            Chào mừng trở lại, <em className="text-champagne-deep">H&amp;M</em>
          </>
        }
        description="Toàn cảnh thiệp mời cho lễ tân hôn và tiệc cưới."
        actions={
          <>
            <ButtonLink to="/studio/khach-moi" variant="secondary" icon={<Users className="size-4" />}>
              Khách mời
            </ButtonLink>
            <ButtonLink to="/studio/thiet-ke" variant="primary" icon={<Palette className="size-4" />}>
              Thiết kế thiệp
            </ButtonLink>
          </>
        }
      />

      <div className="space-y-8 px-4 py-8 sm:px-8">
        {/* Chỉ số */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-medium text-espresso-soft">Tiến độ thiệp mời</h2>
            <p className="text-[12.5px] text-espresso-soft">
              Link đã gửi <b className="text-espresso">{sent}</b> · đã mở <b className="text-[#3d5a3a]">{opened}</b>
            </p>
          </div>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[20px] border border-espresso/8 bg-espresso/8 xl:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="bg-ivory p-5 sm:p-6">
                <p className="text-[12.5px] text-espresso-soft">{s.label}</p>
                <p className={cx('mt-2 font-serif text-[44px] leading-none font-medium', s.alert ? 'text-burgundy-600' : 'text-espresso')}>{s.value}</p>
                <p className="mt-2 text-[12px] text-espresso-soft/80">{s.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-12">
          {/* Sự kiện */}
          <Panel className="p-6 xl:col-span-7">
            <h2 className="font-serif text-[24px] font-medium text-burgundy-800">Lịch sự kiện</h2>
            <p className="mt-1 text-[13px] text-espresso-soft">Hai sự kiện được quản lý riêng — không gộp ngày.</p>
            <ol className="mt-6 space-y-px overflow-hidden rounded-2xl bg-espresso/8">
              {[ceremony, reception].map((e) => {
                const d = daysUntil(e.date);
                return (
                  <li key={e.id} className="grid grid-cols-[auto_1fr] items-center gap-5 bg-ivory p-5 sm:grid-cols-[auto_1fr_auto]">
                    <div className="w-16 border-r border-champagne/50 pr-4 text-center">
                      <p className="font-serif text-[34px] leading-none font-medium text-burgundy-700">{e.date.slice(8)}</p>
                      <p className="mt-1 text-[11px] tracking-[0.14em] text-espresso-soft uppercase">Th {e.date.slice(5, 7)}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-espresso">{e.title}</p>
                      <p className="mt-0.5 text-[13px] text-espresso-soft">
                        {e.weekday} {dotDate(e.date)} · {e.schedule.map((s) => `${s.label} ${s.time}`).join(' · ')}
                      </p>
                      <p className="mt-0.5 truncate text-[13px] text-espresso-soft">
                        {e.venueKind.replace('Hôn lễ được cử hành tại', 'Tại')} {e.venueName}
                        {e.venueHall ? ` — ${e.venueHall}` : ''}
                      </p>
                    </div>
                    <p className="col-span-2 text-[12px] font-medium text-champagne-deep sm:col-span-1 sm:text-right">{d > 0 ? `Còn ${d} ngày` : d === 0 ? 'Hôm nay' : 'Đã diễn ra'}</p>
                  </li>
                );
              })}
            </ol>

          </Panel>

          {/* Mẫu đang dùng */}
          <Panel className="flex gap-5 p-6 xl:col-span-5">
            <div className="w-[120px] shrink-0 self-start overflow-hidden rounded-md shadow-[0_18px_30px_-18px_rgba(48,9,16,0.55)] sm:w-[150px]">
              <ScaledFrame>
                <InvitationCard guestName={guests[0]?.display_name ?? 'Tên khách mời'} salutation={guests[0]?.salutation} design={design} />
              </ScaledFrame>
            </div>
            <div className="flex min-w-0 flex-col">
              <p className="eyebrow text-champagne-deep">Mẫu đang dùng</p>
              <p className="mt-2 font-serif text-[24px] leading-tight text-burgundy-800">{design.templateName}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-espresso-soft">Thiệp dọc 9:16 · một trang · vùng tên khách riêng.</p>
              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                <ButtonLink to="/studio/thiet-ke" size="sm" variant="secondary">Chỉnh sửa</ButtonLink>
                <ButtonLink to="/xem-truoc" size="sm" variant="ghost">Xem trước</ButtonLink>
              </div>
            </div>
          </Panel>

          {/* Bước tiếp theo */}
          <Panel className="p-6 xl:col-span-7">
            <h2 className="font-serif text-[24px] font-medium text-burgundy-800">Quy trình</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                { to: '/studio/thiet-ke', icon: Palette, n: '01', t: 'Hoàn thiện mẫu', d: 'Duyệt bố cục, màu và lời mời.' },
                { to: '/studio/nhap-excel', icon: FileSpreadsheet, n: '02', t: 'Nhập khách mời', d: 'Từ Excel hoặc thêm thủ công.' },
                { to: '/studio/xuat-thiep', icon: Download, n: '03', t: 'Gửi thiệp', d: 'Link riêng hoặc ảnh PNG từng khách.' },
              ].map(({ to, icon: Icon, n, t, d }) => (
                <Link key={to} to={to} className="group rounded-2xl border border-espresso/8 bg-ivory p-4 transition-colors hover:border-champagne">
                  <div className="flex items-center justify-between">
                    <span className="font-serif text-[20px] text-champagne-deep">{n}</span>
                    <Icon className="size-4 text-espresso-soft transition-colors group-hover:text-burgundy-700" strokeWidth={1.6} />
                  </div>
                  <p className="mt-4 text-[14px] font-semibold text-espresso">{t}</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-espresso-soft">{d}</p>
                </Link>
              ))}
            </div>
          </Panel>

          {/* Lượt mở thiệp */}
          <Panel className="p-6 xl:col-span-5">
            <h2 className="font-serif text-[24px] font-medium text-burgundy-800">Khách vừa mở thiệp</h2>
            {recent.length ? (
              <ul className="mt-5 space-y-4">
                {recent.map((g) => (
                  <li key={g.guest_id} className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-champagne-deep" strokeWidth={1.6} />
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] text-espresso">{g.display_name}</p>
                      <p className="text-[12px] text-espresso-soft/80">
                        {relTime(g.last_opened_at)} · {g.open_count} lượt
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-[13.5px] leading-relaxed text-espresso-soft">Chưa có ai mở link. Gửi link riêng ở mục “Gửi &amp; xuất thiệp” để theo dõi tại đây.</p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
