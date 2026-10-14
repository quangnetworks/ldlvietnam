import { useMemo, useState } from 'react';
import { Copy, Eye, FileDown, FileSpreadsheet, Link2, MailOpen, Pencil, Plus, Sheet, Trash2, Users } from 'lucide-react';
import { InvitationCard } from '../../components/invitation/InvitationCard';
import { useStudio } from '../../components/studio/StudioContext';
import { PageHeader } from '../../components/studio/StudioLayout';
import { Button, ButtonLink, IconButton } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { SearchInput, SelectField, TextField } from '../../components/ui/Field';
import { ScaledFrame } from '../../components/ui/ScaledFrame';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { guestGroups, salutations, statusMeta } from '../../data/demo';
import type { Guest } from '../../data/types';
import { api, inviteUrl } from '../../lib/api';
import { copyText, relTime } from '../../lib/clipboard';
import { downloadGuestList, downloadTemplate } from '../../lib/excel';
import { cx } from '../../lib/format';

export default function Guests() {
  const { guests, upsertGuests, removeGuests, design } = useStudio();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const [editing, setEditing] = useState<Guest | 'new' | null>(null);
  const [preview, setPreview] = useState<Guest | null>(null);

  const groups = useMemo(() => [...new Set([...guestGroups, ...guests.map((g) => g.guest_group).filter(Boolean)])], [guests]);
  const list = useMemo(() => {
    const k = q.trim().toLocaleLowerCase('vi');
    return guests.filter(
      (g) =>
        (group === 'all' || g.guest_group === group) &&
        (!k || [g.guest_id, g.guest_name, g.display_name, g.guest_group, g.note].some((v) => v.toLocaleLowerCase('vi').includes(k))),
    );
  }, [guests, q, group]);

  const copyLink = async (g: Guest) => {
    if (await copyText(inviteUrl(g))) {
      toast({ kind: 'success', title: 'Đã sao chép link thiệp', body: g.display_name });
      if (!g.link_sent_at) api.markSent([g.guest_id]).then(upsertGuests).catch(() => undefined);
    }
  };

  const run = async (fn: () => Promise<unknown>, fail = 'Không thực hiện được') => {
    try {
      await fn();
    } catch (e) {
      toast({ kind: 'warning', title: fail, body: (e as Error).message });
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Guest Management"
        title="Danh sách khách mời"
        description="Mỗi khách có mã riêng, link thiệp riêng, cách xưng hô và tên hiển thị do bạn chọn — hệ thống không tự suy đoán."
        actions={
          <>
            <Button variant="ghost" icon={<FileDown className="size-4" />} onClick={() => run(downloadTemplate)}>
              Tải mẫu Excel
            </Button>
            <Button variant="ghost" icon={<Sheet className="size-4" />} disabled={!guests.length} onClick={() => run(() => downloadGuestList(guests))}>
              Xuất danh sách
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
            {['all', ...groups].map((gr) => (
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
        <p className="mb-3 text-[13px] text-espresso-soft">
          <b className="font-semibold text-espresso">{list.length}</b> / {guests.length} khách
        </p>

        {!guests.length ? (
          <FirstRun onAdd={() => setEditing('new')} />
        ) : (
          <>
            {/* Bảng desktop */}
            <div className="hidden overflow-hidden rounded-[20px] border border-espresso/8 bg-white/60 md:block">
              <table className="w-full text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-espresso/8 bg-ivory-deep/70 text-[11.5px] tracking-[0.08em] text-espresso-soft uppercase">
                    <th className="px-5 py-3 font-medium">Mã khách</th>
                    <th className="px-5 py-3 font-medium">Tên khách mời</th>
                    <th className="px-5 py-3 font-medium">Xưng hô</th>
                    <th className="hidden px-5 py-3 font-medium xl:table-cell">Nhóm khách</th>
                    <th className="px-5 py-3 font-medium">Trạng thái thiệp</th>
                    <th className="hidden px-5 py-3 font-medium lg:table-cell">Link</th>
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
                      <td className="px-5 py-3.5 text-espresso">{g.salutation || '—'}</td>
                      <td className="hidden px-5 py-3.5 text-espresso-soft xl:table-cell">{g.guest_group || '—'}</td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={g.invitation_status} />
                      </td>
                      <td className="hidden px-5 py-3.5 text-[12px] lg:table-cell">
                        <LinkState g={g} />
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <IconButton label="Sao chép link thiệp" onClick={() => copyLink(g)}>
                          <Link2 className="size-4" />
                        </IconButton>
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
                        {[g.salutation, g.guest_group].filter(Boolean).join(' · ')}
                      </p>
                      <div className="mt-1 text-[12px]">
                        <LinkState g={g} />
                      </div>
                    </div>
                    <StatusBadge status={g.invitation_status} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-espresso/6 pt-3">
                    <Button size="sm" variant="secondary" icon={<Copy className="size-3.5" />} onClick={() => copyLink(g)}>
                      Link
                    </Button>
                    <Button size="sm" variant="ghost" icon={<Eye className="size-3.5" />} onClick={() => setPreview(g)}>
                      Xem
                    </Button>
                    <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(g)}>
                      Sửa
                    </Button>
                  </div>
                </li>
              ))}
              {!list.length && <Empty />}
            </ul>
          </>
        )}
      </div>

      {editing && (
        <GuestDialog
          guest={editing === 'new' ? null : editing}
          guests={guests}
          groups={groups}
          onClose={() => setEditing(null)}
          onSaved={(g, isNew) => {
            upsertGuests([g]);
            toast({ kind: 'success', title: isNew ? 'Đã thêm khách mời' : 'Đã lưu thay đổi', body: g.display_name });
            setEditing(null);
          }}
          onDeleted={(id) => {
            removeGuests([id]);
            toast({ kind: 'info', title: 'Đã xoá khách mời', body: id });
            setEditing(null);
          }}
        />
      )}

      <Dialog open={!!preview} onClose={() => setPreview(null)} eyebrow={preview?.guest_id} title="Xem trước thiệp" className="max-w-md">
        {preview && (
          <>
            <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-md shadow-[0_30px_60px_-30px_rgba(48,9,16,0.6)]">
              <ScaledFrame>
                <InvitationCard guestName={preview.display_name} design={design} />
              </ScaledFrame>
            </div>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button size="sm" variant="secondary" icon={<Copy className="size-3.5" />} onClick={() => copyLink(preview)}>
                Sao chép link
              </Button>
              <a
                href={`${inviteUrl(preview)}?xem-thu=1`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-2 rounded-full px-3 text-[13px] font-medium text-espresso-soft hover:bg-beige/60"
              >
                <MailOpen className="size-3.5" /> Mở như khách
              </a>
            </div>
          </>
        )}
      </Dialog>
    </>
  );
}

function LinkState({ g }: { g: Guest }) {
  if (g.opened_at)
    return (
      <span className="text-[#3d5a3a]">
        Đã mở {g.open_count} lần · {relTime(g.last_opened_at)}
      </span>
    );
  if (g.link_sent_at) return <span className="text-champagne-deep">Đã gửi {relTime(g.link_sent_at)} · chưa mở</span>;
  return <span className="text-espresso-soft/70">Chưa gửi link</span>;
}

function FirstRun({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-[20px] border border-dashed border-champagne bg-ivory/70 px-6 py-16 text-center">
      <Users className="mx-auto size-9 text-champagne" strokeWidth={1.2} />
      <p className="mt-4 font-serif text-[26px] text-burgundy-800">Chưa có khách mời nào</p>
      <p className="mx-auto mt-2 max-w-md text-[13.5px] text-espresso-soft">Thêm từng khách hoặc nhập cả danh sách từ Excel. Mỗi khách sẽ có một link thiệp riêng.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={onAdd}>
          Thêm khách mời
        </Button>
        <ButtonLink to="/studio/nhap-excel" variant="secondary" icon={<FileSpreadsheet className="size-4" />}>
          Nhập Excel
        </ButtonLink>
      </div>
    </div>
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

function GuestDialog({
  guest,
  guests,
  groups,
  onClose,
  onSaved,
  onDeleted,
}: {
  guest: Guest | null;
  guests: Guest[];
  groups: string[];
  onClose: () => void;
  onSaved: (g: Guest, isNew: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const nextId = () => {
    const max = guests.reduce((m, g) => Math.max(m, Number(g.guest_id.replace(/\D/g, '')) || 0), 0);
    return `HM-${String(max + 1).padStart(4, '0')}`;
  };
  const [f, setF] = useState<Guest>(
    guest ?? { guest_id: nextId(), guest_name: '', salutation: 'Anh', display_name: '', guest_group: groups[0] ?? '', note: '', invitation_status: 'ready' },
  );
  const [customDisplay, setCustomDisplay] = useState(!!guest && guest.display_name !== `${guest.salutation} ${guest.guest_name}`.trim());
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const display = customDisplay ? f.display_name : `${f.salutation} ${f.guest_name}`.trim();
  const dup = !guest && guests.some((g) => g.guest_id.toUpperCase() === f.guest_id.trim().toUpperCase());
  const valid = f.guest_id.trim() && f.guest_name.trim() && display.trim() && !dup;
  const set = (p: Partial<Guest>) => setF((s) => ({ ...s, ...p }));

  const save = async () => {
    setBusy(true);
    setError('');
    const payload = {
      guest_id: f.guest_id.trim().toUpperCase(),
      guest_name: f.guest_name.trim(),
      salutation: f.salutation,
      display_name: display.trim(),
      guest_group: f.guest_group,
      note: f.note,
      invitation_status: f.invitation_status,
    };
    try {
      onSaved(guest ? await api.updateGuest(guest.guest_id, payload) : await api.createGuest(payload), !guest);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!guest) return;
    setBusy(true);
    try {
      await api.deleteGuests([guest.guest_id]);
      onDeleted(guest.guest_id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow={guest ? guest.guest_id : 'Khách mới'}
      title={guest ? 'Sửa khách mời' : 'Thêm khách mời'}
      footer={
        <>
          {guest &&
            (confirmDelete ? (
              <Button variant="primary" className="mr-auto bg-burgundy-500" disabled={busy} onClick={remove} icon={<Trash2 className="size-4" />}>
                Xác nhận xoá
              </Button>
            ) : (
              <Button variant="ghost" className="mr-auto text-burgundy-600" onClick={() => setConfirmDelete(true)} icon={<Trash2 className="size-4" />}>
                Xoá
              </Button>
            ))}
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button variant="primary" disabled={!valid || busy} onClick={save}>
            {busy ? 'Đang lưu…' : guest ? 'Lưu thay đổi' : 'Thêm khách'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Mã khách"
          value={f.guest_id}
          disabled={!!guest}
          onChange={(e) => set({ guest_id: e.target.value.toUpperCase() })}
          hint={dup ? <span className="text-burgundy-600">Mã này đã tồn tại</span> : guest ? 'Mã khách không đổi được sau khi tạo.' : 'Duy nhất cho mỗi khách, dùng trong tên file ảnh.'}
        />
        <TextField label="Tên khách mời" placeholder="Ví dụ: Nguyễn Văn A" value={f.guest_name} onChange={(e) => set({ guest_name: e.target.value })} />
        <SelectField label="Cách xưng hô" value={f.salutation} onChange={(e) => set({ salutation: e.target.value })} options={['', ...salutations].map((s) => ({ value: s, label: s || '— Không dùng —' }))} />
        <div className="space-y-1.5">
          <TextField label="Nhóm khách" list="guest-groups" value={f.guest_group} onChange={(e) => set({ guest_group: e.target.value })} />
          <datalist id="guest-groups">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </div>
        <div className="sm:col-span-2">
          <TextField
            label="Tên hiển thị trên thiệp"
            value={display}
            disabled={!customDisplay}
            onChange={(e) => set({ display_name: e.target.value })}
            hint={
              <button
                type="button"
                className="font-medium text-burgundy-700 hover:underline"
                onClick={() => {
                  setCustomDisplay((v) => !v);
                  set({ display_name: display });
                }}
              >
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
      {error && <p className="mt-4 rounded-xl bg-rose-soft px-3.5 py-2.5 text-[13px] text-burgundy-700">{error}</p>}
      {guest?.token && (
        <p className="mt-4 rounded-xl bg-beige/50 px-3.5 py-3 text-[12.5px] leading-relaxed break-all text-espresso-soft">
          Link riêng: <span className="text-espresso">{inviteUrl(guest)}</span>
        </p>
      )}
    </Dialog>
  );
}
