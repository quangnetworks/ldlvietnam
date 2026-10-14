import { useMemo, useState } from 'react';
import { AlertCircle, Archive, CheckCircle2, Download, ImageDown, Loader2, RotateCw } from 'lucide-react';
import { InvitationCard } from '../../components/invitation/InvitationCard';
import { useStudio } from '../../components/studio/StudioContext';
import { PageHeader, Panel } from '../../components/studio/StudioLayout';
import { Button, ButtonLink } from '../../components/ui/Button';
import { ScaledFrame } from '../../components/ui/ScaledFrame';
import { DemoTag } from '../../components/ui/StatusBadge';
import { cx } from '../../lib/format';

type Phase = 'ready' | 'processing' | 'success' | 'failed';

export default function BulkExport() {
  const { guests, selected, setSelected, design } = useStudio();
  const [phase, setPhase] = useState<Phase>('ready');
  const chosen = useMemo(() => guests.filter((g) => selected.includes(g.guest_id)), [guests, selected]);
  const done = phase === 'processing' ? Math.ceil(chosen.length * 0.5) : phase === 'ready' ? 0 : chosen.length;
  const failedIdx = phase === 'failed' ? new Set([1, 4].filter((i) => i < chosen.length)) : new Set<number>();
  const pct = chosen.length ? Math.round((done / chosen.length) * 100) : 0;

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <>
      <PageHeader
        eyebrow="Bulk Export"
        title="Xuất thiệp hàng loạt"
        description="Mỗi khách một ảnh PNG 9:16, tên file chứa mã khách. Tải từng ảnh hoặc cả gói ZIP."
        actions={
          <Button variant="primary" soon icon={<ImageDown className="size-4" />}>
            Bắt đầu xuất {chosen.length} thiệp
          </Button>
        }
      />

      <div className="grid gap-6 px-4 py-8 sm:px-8 xl:grid-cols-12">
        {/* Cấu hình */}
        <div className="space-y-6 xl:col-span-4">
          <Panel className="p-6">
            <dl className="divide-y divide-espresso/6 text-[13.5px]">
              {[
                ['Khách được chọn', `${chosen.length} / ${guests.length}`],
                ['Mẫu thiệp', design.templateName],
                ['Kích thước ảnh', '1080 × 1920 px · 9:16'],
                ['Định dạng', 'PNG'],
                ['Tên file', `${chosen[0]?.guest_id ?? 'HM-0001'}_thiep-cuoi-HM.png`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <dt className="shrink-0 text-espresso-soft">{k}</dt>
                  <dd className="truncate text-right font-medium text-espresso">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel className="p-6">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-medium text-espresso">Trạng thái giao diện</p>
              <DemoTag>Mô phỏng</DemoTag>
            </div>
            <div role="tablist" className="mt-3 grid grid-cols-2 gap-1 rounded-2xl border border-espresso/10 bg-beige/50 p-1">
              {(
                [
                  ['ready', 'Sẵn sàng'],
                  ['processing', 'Đang xử lý'],
                  ['success', 'Thành công'],
                  ['failed', 'Thất bại'],
                ] as Array<[Phase, string]>
              ).map(([v, l]) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={phase === v}
                  onClick={() => setPhase(v)}
                  className={cx(
                    'rounded-xl px-3 py-1.5 text-[12.5px] font-medium transition-all',
                    phase === v ? 'bg-white text-burgundy-700 shadow-[0_2px_10px_-4px_rgba(59,42,34,0.35)]' : 'text-espresso-soft hover:text-espresso',
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-espresso-soft">Chuyển qua lại để duyệt từng trạng thái. Xuất ảnh thật sẽ được triển khai ở giai đoạn 2.</p>

            {/* Tiến trình */}
            <div className="mt-6">
              <div className="flex items-end justify-between">
                <p className="font-serif text-[34px] leading-none text-burgundy-800">{pct}%</p>
                <p className="text-[12.5px] text-espresso-soft">
                  {done} / {chosen.length} thiệp
                </p>
              </div>
              <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-espresso/8">
                <div
                  className={cx('h-full rounded-full transition-[width] duration-700', phase === 'failed' ? 'bg-burgundy-500' : 'bg-burgundy-700')}
                  style={{ width: `${pct}%` }}
                />
                {phase === 'processing' && <div className="animate-shimmer absolute inset-0" />}
              </div>
              {phase !== 'ready' && (
                <div className="mt-4 grid grid-cols-2 gap-2 text-[12.5px]">
                  <p className="flex items-center gap-1.5 text-[#3d5a3a]">
                    <CheckCircle2 className="size-3.5" /> Thành công: {done - failedIdx.size}
                  </p>
                  <p className={cx('flex items-center gap-1.5', failedIdx.size ? 'text-burgundy-600' : 'text-espresso-soft')}>
                    <AlertCircle className="size-3.5" /> Thất bại: {failedIdx.size}
                  </p>
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <Button size="sm" variant="primary" soon icon={<Archive className="size-3.5" />}>
                Tải ZIP
              </Button>
              {phase === 'failed' && (
                <Button size="sm" variant="secondary" soon icon={<RotateCw className="size-3.5" />}>
                  Xuất lại ảnh lỗi
                </Button>
              )}
            </div>
          </Panel>
        </div>

        {/* Danh sách xem trước */}
        <div className="xl:col-span-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-medium text-espresso">Danh sách thiệp</p>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setSelected(guests.map((g) => g.guest_id))}>Chọn tất cả</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Bỏ chọn</Button>
              <ButtonLink size="sm" variant="ghost" to="/studio/khach-moi">Quản lý khách</ButtonLink>
            </div>
          </div>
          {chosen.length === 0 && (
            <Panel className="mb-4 px-6 py-8 text-center text-[13.5px] text-espresso-soft">Chưa chọn khách nào — chọn ít nhất một thiệp bên dưới.</Panel>
          )}
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {guests.map((g) => {
              const on = selected.includes(g.guest_id);
              const idx = chosen.findIndex((c) => c.guest_id === g.guest_id);
              const failed = failedIdx.has(idx);
              const st: Phase | null = !on ? null : phase === 'ready' ? 'ready' : phase === 'processing' ? (idx < done ? 'success' : 'processing') : failed ? 'failed' : 'success';
              return (
                <li key={g.guest_id} className={cx('group rounded-2xl border p-2.5 transition-colors', on ? 'border-burgundy-600/30 bg-white/70' : 'border-espresso/8 bg-white/30 opacity-60 hover:opacity-100')}>
                  <button onClick={() => toggle(g.guest_id)} className="block w-full text-left" aria-pressed={on} aria-label={`${on ? 'Bỏ chọn' : 'Chọn'} ${g.display_name}`}>
                    <div className="relative overflow-hidden rounded-lg">
                      <ScaledFrame>
                        <InvitationCard guestName={g.display_name} design={design} />
                      </ScaledFrame>
                      {st === 'processing' && (
                        <div className="absolute inset-0 grid place-items-center bg-ivory/70 backdrop-blur-[1px]">
                          <Loader2 className="size-6 animate-spin text-burgundy-700" />
                        </div>
                      )}
                      {st === 'failed' && (
                        <div className="absolute inset-0 grid place-items-center bg-burgundy-900/55 p-3 text-center text-[11.5px] text-ivory">
                          <span>
                            <AlertCircle className="mx-auto mb-1 size-5" />
                            Font chưa tải xong
                          </span>
                        </div>
                      )}
                      <span className={cx('absolute top-2 left-2 grid size-5 place-items-center rounded-full border text-ivory', on ? 'border-burgundy-700 bg-burgundy-700' : 'border-espresso/30 bg-white/80')}>
                        {on && <CheckCircle2 className="size-3.5" />}
                      </span>
                    </div>
                    <p className="mt-2 truncate px-0.5 text-[12.5px] font-medium text-espresso">{g.display_name}</p>
                  </button>
                  <div className="mt-0.5 flex items-center justify-between px-0.5">
                    <span className="font-mono text-[11px] text-espresso-soft">{g.guest_id}</span>
                    {st === 'success' && (
                      <button disabled title="Sẽ hoạt động ở giai đoạn 2" className="inline-flex cursor-not-allowed items-center gap-1 text-[11px] text-espresso-soft/70">
                        <Download className="size-3" /> PNG
                      </button>
                    )}
                    {st === 'failed' && <span className="text-[11px] font-medium text-burgundy-600">Lỗi</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </>
  );
}
