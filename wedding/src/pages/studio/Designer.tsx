import { useEffect, useState, type ReactNode } from 'react';
import { Download, Eye, EyeOff, Lock, PanelsTopLeft, Redo2, Save, Undo2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../components/ui/Toast';
import { InvitationCard } from '../../components/invitation/InvitationCard';
import { useStudio } from '../../components/studio/StudioContext';
import { Button, IconButton } from '../../components/ui/Button';
import { Segmented, SelectField, TextArea, TextField } from '../../components/ui/Field';
import { ScaledFrame } from '../../components/ui/ScaledFrame';
import { palettes, sectionMeta, type InvitationDesign, type SectionId } from '../../data/design';
import { ThemeSwatch } from '../../components/ui/ThemeSwatch';
import { ceremony, reception, wedding } from '../../data/wedding';
import { cx, dotDate } from '../../lib/format';
import { useHistory } from '../../lib/useHistory';

export default function Designer() {
  const { design, setDesign, guests, saveDesign, dirty } = useStudio();
  const toast = useToast();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await saveDesign();
      toast({ kind: 'success', title: 'Đã lưu thiết kế', body: 'Link thiệp và ảnh xuất sẽ dùng bản này.' });
    } catch (e) {
      toast({ kind: 'warning', title: 'Chưa lưu được', body: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };
  const h = useHistory(design, setDesign);
  const [selected, setSelected] = useState<SectionId>('guest');
  const [previewOnly, setPreviewOnly] = useState(false);
  const [guestId, setGuestId] = useState(guests[0]?.guest_id ?? '');
  const [nameDraft, setNameDraft] = useState(design.templateName);
  useEffect(() => setNameDraft(design.templateName), [design.templateName]);
  const guestName = guests.find((g) => g.guest_id === guestId)?.display_name ?? 'Nguyễn Văn A';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.target as HTMLElement).closest('input,textarea')) return;
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) h.redo();
        else h.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [h]);

  const update = (patch: Partial<InvitationDesign>) => h.commit({ ...design, ...patch });
  const updateText = (k: keyof InvitationDesign['text'], v: string) => h.commit({ ...design, text: { ...design.text, [k]: v } });

  return (
    <div className="flex min-h-[calc(100dvh-56px)] flex-col lg:min-h-dvh">
      {/* Thanh công cụ */}
      <div className="sticky top-14 z-30 flex flex-wrap items-center gap-2 border-b border-champagne/35 bg-ivory/90 px-4 py-3 backdrop-blur-md sm:px-6 lg:top-0">
        <div className="mr-auto min-w-0">
          <p className="eyebrow text-champagne-deep">Invitation Designer</p>
          <input
            aria-label="Tên mẫu thiết kế"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => (nameDraft.trim() && nameDraft !== design.templateName ? update({ templateName: nameDraft.trim() }) : setNameDraft(design.templateName))}
            className="w-full max-w-[260px] truncate rounded-md bg-transparent font-serif text-[22px] leading-tight text-burgundy-800 hover:bg-white/60 focus:bg-white focus:outline-none"
          />
        </div>
        <div className="flex items-center rounded-full border border-espresso/10 bg-white/60 p-0.5">
          <IconButton label="Hoàn tác (Ctrl+Z)" onClick={h.undo} disabled={!h.canUndo}>
            <Undo2 className="size-4" />
          </IconButton>
          <IconButton label="Làm lại (Ctrl+Shift+Z)" onClick={h.redo} disabled={!h.canRedo}>
            <Redo2 className="size-4" />
          </IconButton>
        </div>
        <Button size="sm" variant={previewOnly ? 'primary' : 'secondary'} onClick={() => setPreviewOnly((v) => !v)} icon={previewOnly ? <PanelsTopLeft className="size-4" /> : <Eye className="size-4" />}>
          {previewOnly ? 'Thoát xem trước' : 'Xem trước'}
        </Button>
        <Button size="sm" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty || saving} onClick={save} icon={<Save className="size-4" />}>
          {saving ? 'Đang lưu…' : dirty ? 'Lưu thiết kế' : 'Đã lưu'}
        </Button>
        <Button size="sm" variant="secondary" disabled={dirty} title={dirty ? 'Lưu thiết kế trước khi xuất' : undefined} onClick={() => navigate('/studio/xuat-thiep')} icon={<Download className="size-4" />}>
          Xuất thiệp
        </Button>
      </div>

      <div
        className={cx(
          'grid flex-1 gap-0',
          previewOnly ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[250px_minmax(0,1fr)_320px] xl:grid-cols-[270px_minmax(0,1fr)_340px]',
        )}
      >
        {/* Trái: cấu trúc */}
        {!previewOnly && (
          <aside className="order-2 border-champagne/30 px-4 py-6 sm:px-6 lg:order-1 lg:border-r lg:px-4">
            <PanelTitle>Cấu trúc thiệp</PanelTitle>
            <ul className="mt-3 space-y-1">
              {sectionMeta.map((s, i) => {
                const visible = design.sections[s.id];
                return (
                  <li key={s.id}>
                    <div
                      className={cx(
                        'group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors',
                        selected === s.id ? 'bg-white shadow-[0_1px_0_rgba(201,169,110,0.4),0_6px_18px_-12px_rgba(59,42,34,0.4)]' : 'hover:bg-white/50',
                      )}
                    >
                      <button onClick={() => setSelected(s.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                        <span className="w-5 font-serif text-[15px] text-champagne-deep">{String(i + 1).padStart(2, '0')}</span>
                        <span className="min-w-0">
                          <span className={cx('block truncate text-[13.5px] font-medium', visible ? 'text-espresso' : 'text-espresso-soft/60 line-through')}>{s.label}</span>
                          <span className="block truncate text-[11.5px] text-espresso-soft/80">{s.hint}</span>
                        </span>
                      </button>
                      {s.locked ? (
                        <Lock className="size-3.5 text-espresso-soft/50" aria-label="Thành phần bắt buộc" />
                      ) : (
                        <button
                          aria-label={visible ? `Ẩn ${s.label}` : `Hiện ${s.label}`}
                          onClick={() => h.commit({ ...design, sections: { ...design.sections, [s.id]: !visible } })}
                          className="rounded-full p-1 text-espresso-soft hover:bg-beige"
                        >
                          {visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            <PanelTitle className="mt-8">Chủ đề màu</PanelTitle>
            <p className="mt-1 text-[11.5px] leading-relaxed text-espresso-soft">Theo màu cưới truyền thống — áp dụng cho thiệp tĩnh, thiệp động và ảnh PNG.</p>
            <div className="mt-3 space-y-2">
              {palettes.map((p) => (
                <button
                  key={p.id}
                  onClick={() => update({ palette: p.id, templateName: p.name })}
                  aria-pressed={design.palette === p.id}
                  className={cx(
                    'flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                    design.palette === p.id ? 'border-burgundy-600/40 bg-white shadow-[0_6px_18px_-12px_rgba(59,42,34,0.4)]' : 'border-transparent hover:bg-white/50',
                  )}
                >
                  <ThemeSwatch t={p} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-espresso">{p.name}</span>
                    <span className="block text-[11.5px] leading-snug text-espresso-soft">{p.meaning}</span>
                  </span>
                </button>
              ))}
            </div>
          </aside>
        )}

        {/* Giữa: xem trước */}
        <section className="order-1 flex flex-col items-center bg-[radial-gradient(ellipse_at_top,rgba(237,226,208,0.7),transparent_70%)] px-4 py-8 lg:order-2">
          <div className="mb-5 flex w-full max-w-[380px] items-end gap-3">
            <SelectField
              className="flex-1"
              label="Xem với tên khách"
              value={guestId}
              onChange={(e) => setGuestId(e.target.value)}
              options={guests.length ? guests.map((g) => ({ value: g.guest_id, label: g.display_name })) : [{ value: '', label: 'Nguyễn Văn A (mẫu)' }]}
            />
          </div>
          <div className={cx('w-full rounded-[38px] bg-espresso p-[9px] shadow-[0_50px_90px_-45px_rgba(48,9,16,0.75)]', previewOnly ? 'max-w-[460px]' : 'max-w-[380px]')}>
            <div className="overflow-hidden rounded-[30px]">
              <ScaledFrame>
                <InvitationCard guestName={guestName} design={design} highlight={previewOnly ? null : selected} />
              </ScaledFrame>
            </div>
          </div>
          <p className="mt-4 text-[12px] text-espresso-soft">9:16 · 1080 × 1920 px khi xuất</p>
        </section>

        {/* Phải: thuộc tính */}
        {!previewOnly && (
          <aside className="order-3 border-champagne/30 px-4 py-6 sm:px-6 lg:border-l lg:px-5">
            <PanelTitle>Thuộc tính</PanelTitle>
            <p className="mt-1 font-serif text-[22px] text-burgundy-800">{sectionMeta.find((s) => s.id === selected)?.label}</p>
            <div className="mt-5 space-y-5">
              <Properties
                id={selected}
                design={design}
                update={update}
                updateText={updateText}
              />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function Properties({
  id,
  design,
  update,
  updateText,
}: {
  id: SectionId;
  design: InvitationDesign;
  update: (p: Partial<InvitationDesign>) => void;
  updateText: (k: keyof InvitationDesign['text'], v: string) => void;
}) {
  switch (id) {
    case 'monogram':
      return (
        <>
          <ReadOnly label="Chữ viết tắt" value={`${wedding.monogram.left} & ${wedding.monogram.right}`} />
          <ReadOnly label="Dòng concept" value={wedding.concept} />
          <Note>Monogram dùng hiệu ứng ép kim champagne — điểm nhấn kim loại duy nhất ở phần trên thiệp.</Note>
        </>
      );
    case 'announce':
      return (
        <>
          <DraftField label="Dòng mở đầu" value={design.text.announce} onCommit={(v) => updateText('announce', v)} />
          <DraftField label="Dòng sự kiện" value={design.text.announceEvent} onCommit={(v) => updateText('announceEvent', v)} />
        </>
      );
    case 'couple':
      return (
        <>
          <div className="space-y-1.5">
            <p className="text-[12px] font-medium text-espresso-soft">Kiểu chữ tên</p>
            <Segmented
              value={design.nameStyle}
              onChange={(v) => update({ nameStyle: v })}
              options={[
                { value: 'script', label: 'Thư pháp bay lượn' },
                { value: 'serif', label: 'Serif cổ điển' },
              ]}
            />
          </div>
          <ReadOnly label={`Chú rể · ${wedding.groom.role}`} value={wedding.groom.fullName} />
          <ReadOnly label={`Cô dâu · ${wedding.bride.role}`} value={wedding.bride.fullName} />
          <Note>Tên cô dâu chú rể đã được xác nhận và được khoá để tránh chỉnh nhầm.</Note>
        </>
      );
    case 'families':
      return (
        <>
          {[wedding.families.groom, wedding.families.bride].map((f) => (
            <ReadOnly key={f.side} label={f.label} value={`${f.father.title} ${f.father.name}\n${f.mother.title} ${f.mother.name}\n${f.addressLines.join(' ')}`} />
          ))}
          <Note>Thông tin gia đình lấy từ hồ sơ cưới, giữ nguyên theo thiệp tham chiếu.</Note>
        </>
      );
    case 'ceremony':
      return (
        <>
          <ReadOnly label="Sự kiện" value={ceremony.title} />
          <ReadOnly label="Thời gian" value={`${ceremony.time} · ${ceremony.weekday} ${dotDate(ceremony.date)}`} />
          <ReadOnly label="Âm lịch" value={ceremony.lunarText} />
          <ReadOnly label="Địa điểm" value={`${ceremony.venueKind} ${ceremony.venueName.toLowerCase()}`} />
          <Note tone="warn">Thiệp gốc không nêu rõ tư gia nhà trai hay nhà gái — cần chủ tiệc xác nhận.</Note>
        </>
      );
    case 'guest':
      return (
        <>
          <DraftField label="Lời mời" value={design.text.inviteHeading} onCommit={(v) => updateText('inviteHeading', v)} />
          <DraftField label="Câu dẫn" value={design.text.inviteLine} onCommit={(v) => updateText('inviteLine', v)} multiline />
          <div className="space-y-1.5">
            <label className="flex items-center justify-between text-[12px] font-medium text-espresso-soft">
              Cỡ chữ tên khách <span className="text-espresso">{Math.round(design.guestNameScale * 100)}%</span>
            </label>
            <input
              type="range"
              min={0.85}
              max={1.15}
              step={0.05}
              value={design.guestNameScale}
              onChange={(e) => update({ guestNameScale: Number(e.target.value) })}
              className="w-full accent-burgundy-700"
            />
          </div>
          <Note>Tên dài tự giảm cỡ chữ và xuống tối đa hai dòng. Thử với khách “Gia đình Ông Bà Huỳnh Ngọc Phương Anh G”.</Note>
        </>
      );
    case 'reception':
      return (
        <>
          <ReadOnly label="Địa điểm" value={`${reception.venueKind}\n${reception.venueName} — ${reception.venueHall}\n${reception.venueAddressLines.join(' ')}`} />
          <ReadOnly label="Thời gian" value={`${reception.weekday} ${dotDate(reception.date)} · ${reception.schedule.map((s) => `${s.label} ${s.time}`).join(' · ')}`} />
          <ReadOnly label="Âm lịch" value={reception.lunarText} />
        </>
      );
    case 'thanks':
      return <DraftField label="Lời cảm ơn" value={design.text.thanks} onCommit={(v) => updateText('thanks', v)} multiline />;
  }
}

/** Ô nhập lưu vào lịch sử khi rời khỏi ô (để hoàn tác theo từng lần sửa). */
function DraftField({ label, value, onCommit, multiline }: { label: string; value: string; onCommit: (v: string) => void; multiline?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const props = {
    label,
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: () => draft !== value && onCommit(draft.trim() || value),
  };
  return multiline ? <TextArea {...props} rows={3} /> : <TextField {...props} />;
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-espresso-soft">
        <Lock className="size-3" /> {label}
      </p>
      <p className="mt-1.5 rounded-xl border border-dashed border-espresso/12 bg-ivory-deep/50 px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-line text-espresso">{value}</p>
    </div>
  );
}

function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <p className={cx('rounded-xl px-3.5 py-3 text-[12.5px] leading-relaxed', tone === 'warn' ? 'bg-rose-soft text-burgundy-700' : 'bg-beige/50 text-espresso-soft')}>
      {children}
    </p>
  );
}

function PanelTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('eyebrow text-espresso-soft', className)}>{children}</p>;
}


