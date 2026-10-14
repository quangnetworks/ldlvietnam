import { useMemo, useState } from 'react';
import { Eye, FileDown, FileSpreadsheet, MailOpen, Pencil, Plus, Users } from 'lucide-react';
import { InvitationCard } from '../../components/invitation/InvitationCard';
import { useStudio } from '../../components/studio/StudioContext';
import { PageHeader } from '../../components/studio/StudioLayout';
import { Button, ButtonLink, IconButton } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { SearchInput, SelectField, TextField } from '../../components/ui/Field';
import { ScaledFrame } from '../../components/ui/ScaledFrame';
import { DemoTag, StatusBadge } from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { guestGroups, salutations, statusMeta } from '../../data/demo';
import type { Guest } from '../../data/types';
import { cx } from '../../lib/format';

export default function Guests() {
  const { guests, setGuests, design } = useStudio();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const [editing, setEditing] = useState<Guest | 'new' | null>(null);
  const [preview, setPreview] = useState<Guest | null>(null);

  const list = useMemo(() => {
    const k = q.trim().toLocaleLowerCase('vi');
    return guests.filter(
      (g) =>
        (group === 'all' || g.guest_group === group) &&
        (!k || [g.guest_id, g.guest_name, g.display_name, g.guest_group].some((v) => v.toLocaleLowerCase('vi').includes(k))),
    );
  }, [guests, q, group]);

  const save = (g: Guest) => {
    setGuests((s) => (s.some((x) => x.guest_id === g.guest_id) ? s.map((x) => (x.guest_id === g.guest_id ? g : x)) : [...s, g]));
    toast({ kind: 'success', title: editing === 'new' ? 'Đã thêm khách mời' : 'Đã cập nhật khách mời', body: `${g.display_name} · chỉ lưu tạm trong phiên làm việc này.` });
    setEditing(null);
  };

  return (
    <>
      <PageHeader
        eyebrow="Guest Management"
        title="Danh sách khách mời"
        description="Mỗi khách có mã riêng, cách xưng hô và tên hiển thị trên thiệp do bạn chọn — hệ thống không tự suy đoán."
        actions={
          <>
            <Button variant="ghost" soon icon={<FileDown className="size-4" />}>
              Tải mẫu Excel
            </Button>
            <ButtonLink to="/studio/nhap-excel" variant="secondary" icon={<FileSpreadsheet className="size-4" />}>
              Nhập Excel
            </ButtonLink>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Thêm khách mời
            </Button>
          </>
        }
      >
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput placeholder="Tìm theo tên, mã khách, nhóm…" value={q} onChange={(e) => setQ(e.target.value)} className="sm:max-w-sm sm:flex-1" aria-label="Tìm kiếm khách mời" />
          <div className="scrollbar-thin -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:pb-0">
            {['all', ...guestGroups].map((gr) => (
              <button
                key={gr}
                onClick={() => setGroup(gr)}
                className={cx(
                  'shrink-0 rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors',
                  group === gr ? 'border-burgundy-700 bg-burgundy-700 text-ivory' : 'border-espresso/12 bg-white/50 text-espresso-soft hover:text-espresso',
                )}
              >
                {gr === 'all' ? 'Tất cả nhóm' : gr}
              </button>
            ))}
          </div>
        </div>
      </PageHeader>

      <div className="px-4 py-6 sm:px-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[13px] text-espresso-soft">
            <b className="font-semibold text-espresso">{list.length}</b> / {guests.length} khách
          </p>
          <DemoTag>Khách mời minh họa · chưa lưu</DemoTag>
        </div>

        {/* Bảng desktop */}
        <div className="hidden overflow-hidden rounded-[20px] border border-espresso/8 bg-white/60 md:block">
          <table className="w-full text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-espresso/8 bg-ivory-deep/70 text-[11.5px] tracking-[0.08em] text-espresso-soft uppercase">
                <th className="px-5 py-3 font-medium">Mã khách</th>
                <th className="px-5 py-3 font-medium">Tên khách mời</th>
                <th className="px-5 py-3 font-medium">Cách xưng hô</th>
                <th className="px-5 py-3 font-medium">Nhóm khách</th>
                <th className="px-5 py-3 font-medium">Trạng thái thiệp</th>
                <th className="px-5 py-3 text-right font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {list.map((g) => (
                <tr key={g.guest_id} className="border-b border-espresso/6 transition-colors last:border-0 hover:bg-ivory/80">
                  <td className="px-5 py-3.5 font-mono text-[12.5px] text-espresso-soft">{g.guest_id}</td>
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-espresso">{g.guest_name}</p>
                    <p className="text-[12px] text-espresso-soft">Trên thiệp: {g.display_name}</p>
                  </td>
                  <td className="px-5 py-3.5 text-espresso">{g.salutation}</td>
                  <td className="px-5 py-3.5 text-espresso-soft">{g.guest_group}</td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={g.invitation_status} />
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <IconButton label="Xem trước thiệp" onClick={() => setPreview(g)}>
                      <Eye className="size-4" />
                    </IconButton>
                    <IconButton label="Sửa" onClick={() => setEditing(g)}>
                      <Pencil className="size-4" />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <Empty />}
        </div>

        {/* Thẻ mobile */}
        <ul className="space-y-2.5 md:hidden">
          {list.map((g) => (
            <li key={g.guest_id} className="rounded-2xl border border-espresso/8 bg-white/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[11.5px] text-espresso-soft">{g.guest_id}</p>
                  <p className="mt-0.5 text-[15px] font-medium text-espresso">{g.display_name}</p>
                  <p className="mt-0.5 text-[12.5px] text-espresso-soft">
                    {g.salutation} · {g.guest_group}
                  </p>
                </div>
                <StatusBadge status={g.invitation_status} />
              </div>
              <div className="mt-3 flex gap-2 border-t border-espresso/6 pt-3">
                <Button size="sm" variant="secondary" icon={<Eye className="size-3.5" />} onClick={() => setPreview(g)}>
                  Xem thiệp
                </Button>
                <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(g)}>
                  Sửa
                </Button>
              </div>
            </li>
          ))}
          {!list.length && <Empty />}
        </ul>
      </div>

      {editing && <GuestDialog guest={editing === 'new' ? null : editing} guests={guests} onClose={() => setEditing(null)} onSave={save} />}

      <Dialog open={!!preview} onClose={() => setPreview(null)} eyebrow={preview?.guest_id} title="Xem trước thiệp" className="max-w-md">
        {preview && (
          <>
            <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-md shadow-[0_30px_60px_-30px_rgba(48,9,16,0.6)]">
              <ScaledFrame>
                <InvitationCard guestName={preview.display_name} design={design} />
              </ScaledFrame>
            </div>
            <div className="mt-5 flex justify-center gap-2">
              <ButtonLink to={`/thiep?khach=${preview.guest_id}`} target="_blank" size="sm" variant="secondary" icon={<MailOpen className="size-3.5" />}>
                Mở thiệp tương tác
              </ButtonLink>
            </div>
          </>
        )}
      </Dialog>
    </>
  );
}

function Empty() {
  return (
    <div className="px-6 py-16 text-center">
      <Users className="mx-auto size-8 text-champagne" strokeWidth={1.2} />
      <p className="mt-3 font-serif text-[20px] text-burgundy-800">Không tìm thấy khách mời</p>
      <p className="mt-1 text-[13px] text-espresso-soft">Thử từ khoá khác hoặc chọn “Tất cả nhóm”.</p>
    </div>
  );
}

function GuestDialog({ guest, guests, onClose, onSave }: { guest: Guest | null; guests: Guest[]; onClose: () => void; onSave: (g: Guest) => void }) {
  const nextId = () => {
    const max = guests.reduce((m, g) => Math.max(m, Number(g.guest_id.replace(/\D/g, '')) || 0), 0);
    return `HM-${String(max + 1).padStart(4, '0')}`;
  };
  const [f, setF] = useState<Guest>(
    guest ?? { guest_id: nextId(), guest_name: '', salutation: 'Anh', display_name: '', guest_group: guestGroups[0], note: '', invitation_status: 'draft' },
  );
  const [customDisplay, setCustomDisplay] = useState(!!guest && guest.display_name !== `${guest.salutation} ${guest.guest_name}`);
  const display = customDisplay ? f.display_name : `${f.salutation} ${f.guest_name}`.trim();
  const valid = f.guest_name.trim().length > 0 && display.trim().length > 0;
  const set = (p: Partial<Guest>) => setF((s) => ({ ...s, ...p }));

  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow={f.guest_id}
      title={guest ? 'Sửa khách mời' : 'Thêm khách mời'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button variant="primary" disabled={!valid} onClick={() => onSave({ ...f, guest_name: f.guest_name.trim(), display_name: display.trim() })}>
            {guest ? 'Lưu thay đổi' : 'Thêm khách'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField className="sm:col-span-2" label="Tên khách mời" placeholder="Ví dụ: Nguyễn Văn A" value={f.guest_name} onChange={(e) => set({ guest_name: e.target.value })} />
        <SelectField label="Cách xưng hô" value={f.salutation} onChange={(e) => set({ salutation: e.target.value })} options={salutations} />
        <SelectField label="Nhóm khách" value={f.guest_group} onChange={(e) => set({ guest_group: e.target.value })} options={guestGroups} />
        <div className="sm:col-span-2">
          <TextField
            label="Tên hiển thị trên thiệp"
            value={display}
            disabled={!customDisplay}
            onChange={(e) => set({ display_name: e.target.value })}
            hint={
              <button type="button" className="font-medium text-burgundy-700 hover:underline" onClick={() => { setCustomDisplay((v) => !v); set({ display_name: display }); }}>
                {customDisplay ? 'Dùng mặc định: xưng hô + tên' : 'Tự nhập tên hiển thị (ví dụ: “Gia đình anh …”)'}
              </button>
            }
          />
        </div>
        <SelectField
          label="Trạng thái thiệp"
          value={f.invitation_status}
          onChange={(e) => set({ invitation_status: e.target.value as Guest['invitation_status'] })}
          options={Object.entries(statusMeta).map(([value, m]) => ({ value, label: m.label }))}
        />
        <TextField label="Ghi chú" value={f.note} onChange={(e) => set({ note: e.target.value })} />
      </div>
      <p className="mt-5 rounded-xl bg-beige/50 px-3.5 py-3 text-[12.5px] leading-relaxed text-espresso-soft">
        Giai đoạn giao diện: khách mới chỉ lưu tạm trong phiên làm việc, tải lại trang sẽ mất.
      </p>
    </Dialog>
  );
}
