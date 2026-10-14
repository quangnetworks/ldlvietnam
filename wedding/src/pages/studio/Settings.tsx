import { CheckCircle2, HardDrive, TriangleAlert } from 'lucide-react';
import { PageHeader, Panel } from '../../components/studio/StudioLayout';
import { Badge } from '../../components/ui/StatusBadge';
import { ceremony, dataFlags, reception, wedding } from '../../data/wedding';
import { dotDate } from '../../lib/format';

export default function Settings() {
  const rows: Array<[string, string]> = [
    ['Chú rể', `${wedding.groom.fullName} · ${wedding.groom.role}`],
    ['Cô dâu', `${wedding.bride.fullName} · ${wedding.bride.role}`],
    ['Monogram', `${wedding.monogram.left} & ${wedding.monogram.right}`],
    ...[wedding.families.groom, wedding.families.bride].map(
      (f) => [f.label, `${f.father.title} ${f.father.name} · ${f.mother.title} ${f.mother.name}\n${f.addressLines.join(' ')}`] as [string, string],
    ),
    [ceremony.title, `${ceremony.time} · ${ceremony.weekday} ${dotDate(ceremony.date)} · ${ceremony.venueKind.toLowerCase()} ${ceremony.venueName.toLowerCase()}\n${ceremony.lunarText}`],
    [reception.title, `${reception.venueKind} ${reception.venueName} — ${reception.venueHall}\n${reception.venueAddressLines.join(' ')}\n${reception.weekday} ${dotDate(reception.date)} · ${reception.schedule.map((s) => `${s.label} ${s.time}`).join(' · ')}\n${reception.lunarText}`],
  ];
  return (
    <>
      <PageHeader eyebrow="Settings" title="Cài đặt & hồ sơ cưới" description="Nguồn dữ liệu chung cho landing page, thiệp tương tác và thiệp tĩnh." />
      <div className="grid gap-6 px-4 py-8 sm:px-8 xl:grid-cols-12">
        <Panel className="overflow-hidden xl:col-span-7">
          <div className="flex items-center justify-between border-b border-espresso/8 px-6 py-4">
            <p className="font-serif text-[22px] text-burgundy-800">Hồ sơ cưới</p>
            <Badge tone="gold">Theo thiệp tham chiếu</Badge>
          </div>
          <dl className="divide-y divide-espresso/6">
            {rows.map(([k, v]) => (
              <div key={k} className="grid gap-1 px-6 py-4 sm:grid-cols-[150px_1fr] sm:gap-6">
                <dt className="text-[12.5px] font-medium text-espresso-soft">{k}</dt>
                <dd className="text-[14px] leading-relaxed whitespace-pre-line text-espresso">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-espresso/8 bg-ivory-deep/50 px-6 py-3 text-[12px] text-espresso-soft">Chỉnh sửa hồ sơ trực tiếp sẽ có ở giai đoạn 2.</p>
        </Panel>

        <div className="space-y-6 xl:col-span-5">
          <Panel className="p-6">
            <p className="font-serif text-[22px] text-burgundy-800">Đối chiếu dữ liệu</p>
            <ul className="mt-4 space-y-4">
              {dataFlags.map((f) => (
                <li key={f.field} className="flex gap-3">
                  {f.status === 'verified' ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#3d5a3a]" />
                  ) : (
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-burgundy-600" />
                  )}
                  <div>
                    <p className="text-[13.5px] font-semibold text-espresso">
                      {f.field} {f.status === 'needs-confirmation' && <Badge tone="danger" className="ml-1">Cần xác nhận</Badge>}
                    </p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-espresso-soft">{f.message}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel className="p-6">
            <p className="flex items-center gap-2 font-serif text-[22px] text-burgundy-800">
              <HardDrive className="size-5 text-champagne-deep" strokeWidth={1.4} /> Lưu trữ dữ liệu
            </p>
            <p className="mt-3 text-[13.5px] leading-relaxed text-espresso-soft">
              Hiện tại <b className="font-semibold text-espresso">chưa có lưu trữ</b>: mọi thay đổi trong Studio chỉ nằm trong bộ nhớ của tab đang mở và sẽ mất khi tải lại trang. Không có đồng
              bộ hay sao lưu. Cơ chế lưu trữ (trên thiết bị hoặc máy chủ) sẽ được chọn ở giai đoạn 2.
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}
