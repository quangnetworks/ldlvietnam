import { useState } from 'react';
import { CheckCircle2, Download, HardDrive, KeyRound, TriangleAlert } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
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
          <p className="border-t border-espresso/8 bg-ivory-deep/50 px-6 py-3 text-[12px] text-espresso-soft">Hồ sơ cưới cố định theo thiệp tham chiếu (src/data/wedding.ts) để tránh chỉnh nhầm.</p>
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

          <PasswordPanel />

          <Panel className="p-6">
            <p className="flex items-center gap-2 font-serif text-[22px] text-burgundy-800">
              <HardDrive className="size-5 text-champagne-deep" strokeWidth={1.4} /> Lưu trữ dữ liệu
            </p>
            <p className="mt-3 text-[13.5px] leading-relaxed text-espresso-soft">
              Khách mời, link và thiết kế được lưu trên máy chủ Cloudflare (Durable Object của Worker <b className="text-espresso">hm-wedding</b>), dùng được trên mọi
              thiết bị khi đăng nhập. Hệ thống <b className="text-espresso">không tự sao lưu</b> — hãy tải bản sao lưu định kỳ. Ảnh PNG được tạo trên trình duyệt và
              không lưu trên máy chủ.
            </p>
            <a
              href="/api/backup"
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-full border border-espresso/15 bg-white/60 px-4 text-[13px] font-medium text-espresso hover:text-burgundy-700"
            >
              <Download className="size-4" /> Tải bản sao lưu (JSON)
            </a>
          </Panel>
        </div>
      </div>
    </>
  );
}

function PasswordPanel() {
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = again.length > 0 && again !== next;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.changePassword(cur, next);
      toast({ kind: 'success', title: 'Đã đổi mật khẩu', body: 'Các thiết bị khác đã bị đăng xuất.' });
      setCur('');
      setNext('');
      setAgain('');
    } catch (err) {
      toast({ kind: 'warning', title: 'Chưa đổi được mật khẩu', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel className="p-6">
      <p className="flex items-center gap-2 font-serif text-[22px] text-burgundy-800">
        <KeyRound className="size-5 text-champagne-deep" strokeWidth={1.4} /> Đổi mật khẩu Studio
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <TextField label="Mật khẩu hiện tại" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        <TextField label="Mật khẩu mới (ít nhất 10 ký tự)" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <TextField
          label="Nhập lại mật khẩu mới"
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          hint={mismatch ? <span className="text-burgundy-600">Không khớp</span> : undefined}
        />
        <Button type="submit" variant="primary" size="sm" disabled={busy || !cur || next.length < 10 || next !== again}>
          {busy ? 'Đang lưu…' : 'Đổi mật khẩu'}
        </Button>
      </form>
    </Panel>
  );
}
