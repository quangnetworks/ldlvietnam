import { useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import type { Game } from '../../shared/game';
import { apiFetch, ApiClientError } from '../lib/api';
import { todayVn, two, vnd } from '../lib/format';
import { Balls, Button, Field, Input, Notice, Select, Textarea } from './ui';
import { useToast } from './toast';

export interface ManualTicket {
  main: number[];
  special: number | null;
}

/** Một vé mỗi dòng; mọi ký tự không phải số là dấu tách. Game có số đặc biệt riêng: số cuối dòng là số đặc biệt. */
export function parseTicketLines(game: Pick<Game, 'mainPicks' | 'mainMin' | 'mainMax' | 'specialMode' | 'specialMin' | 'specialMax'>, text: string): { tickets: ManualTicket[]; errors: string[] } {
  const tickets: ManualTicket[] = [];
  const errors: string[] = [];
  const withSpecial = game.specialMode === 'separate_pool';
  const need = game.mainPicks + (withSpecial ? 1 : 0);
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const nums = (line.match(/\d+/g) ?? []).map(Number);
    if (nums.length !== need) {
      errors.push(`Dòng ${i + 1}: cần ${need} số${withSpecial ? ` (${game.mainPicks} số chính và số đặc biệt ở cuối)` : ''}, đang có ${nums.length}.`);
      return;
    }
    const main = nums.slice(0, game.mainPicks);
    const special = withSpecial ? nums[game.mainPicks] : null;
    if (new Set(main).size !== main.length) errors.push(`Dòng ${i + 1}: số chính bị trùng.`);
    else if (main.some((n) => n < game.mainMin || n > game.mainMax)) errors.push(`Dòng ${i + 1}: số chính phải từ ${two(game.mainMin)} đến ${two(game.mainMax)}.`);
    else if (withSpecial && special != null && (special < (game.specialMin ?? 0) || special > (game.specialMax ?? 0))) errors.push(`Dòng ${i + 1}: số đặc biệt phải từ ${two(game.specialMin ?? 0)} đến ${two(game.specialMax ?? 0)}.`);
    else tickets.push({ main: [...main].sort((a, b) => a - b), special });
  });
  return { tickets, errors };
}

export function ticketsToText(tickets: ManualTicket[]): string {
  return tickets.map((t) => `${t.main.map(two).join(' ')}${t.special != null ? ` | ${two(t.special)}` : ''}`).join('\n');
}

interface Initial {
  id: number;
  name: string;
  mode: 'simulated' | 'real';
  status: string;
  target_draw_date: string | null;
  target_draw_time: string | null;
  notes?: string | null;
  tickets: ManualTicket[];
}

/**
 * Nhập danh mục bằng tay (vé đã mua thật hoặc bộ số tự chọn), hoặc sửa một danh mục đã lưu.
 * Sửa vé chỉ khi còn nháp; danh mục đã mua chỉ sửa tên, ghi chú, ngày và giờ quay (máy chủ cũng kiểm tra).
 */
export function ManualPortfolioForm({ game, initial, onSaved, onCancel }: { game: Game; initial?: Initial; onSaved: (id: number) => void; onCancel?: () => void }) {
  const toast = useToast();
  const times = game.drawSchedule?.times ?? [];
  const editing = !!initial;
  const ticketsEditable = !editing || initial.status === 'draft';
  const [f, setF] = useState({
    name: initial?.name ?? `Vé ${new Date().toLocaleDateString('vi-VN')}`,
    mode: initial?.mode ?? ('real' as 'real' | 'simulated'),
    date: initial?.target_draw_date ?? todayVn(),
    time: initial?.target_draw_time ?? (times.length === 1 ? times[0] : ''),
    text: initial ? ticketsToText(initial.tickets) : '',
    notes: initial?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseTicketLines(game, f.text), [game, f.text]);
  const needTime = times.length > 1 && !f.time;
  const canSave = f.name.trim() && f.date && !needTime && (!ticketsEditable || (parsed.tickets.length > 0 && parsed.errors.length === 0));
  const save = async () => {
    setBusy(true);
    try {
      if (editing) {
        await apiFetch(`/portfolios/${initial.id}`, {
          method: 'PUT',
          body: { name: f.name.trim(), target_draw_date: f.date, target_draw_time: f.time || null, notes: f.notes.trim() || null, ...(ticketsEditable ? { tickets: parsed.tickets } : {}) },
        });
        toast('success', 'Đã lưu thay đổi danh mục');
        onSaved(initial.id);
      } else {
        const r = await apiFetch('/portfolios/manual', {
          body: { game: game.code, name: f.name.trim(), mode: f.mode, target_draw_date: f.date, target_draw_time: f.time || null, tickets: parsed.tickets, ...(f.notes.trim() ? { notes: f.notes.trim() } : {}) },
        });
        toast('success', `Đã lưu danh mục #${r.data.id}${r.data.enteredAfterDraw ? ' (nhập sau giờ quay)' : ''}`);
        onSaved(r.data.id);
      }
    } catch (e) {
      toast('error', e instanceof ApiClientError ? e.message : 'Không lưu được danh mục');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Tên danh mục">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Loại" hint={editing ? 'Không đổi được sau khi lưu' : f.mode === 'real' ? 'Vé bạn đã hoặc sẽ tự mua' : 'Không tốn tiền, chỉ để theo dõi'}>
          <Select value={f.mode} disabled={editing} onChange={(e) => setF({ ...f, mode: e.target.value as 'real' | 'simulated' })}>
            <option value="real">Thực tế (vé đã mua)</option>
            <option value="simulated">Mô phỏng</option>
          </Select>
        </Field>
        <Field label="Ngày quay">
          <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="Giờ quay" hint={times.length > 1 ? 'Bắt buộc: một ngày có nhiều kỳ' : undefined}>
          <Select value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })}>
            {times.length !== 1 && (
              <option value="" disabled={times.length > 1}>
                {times.length > 1 ? 'Chọn giờ quay' : 'Không có'}
              </option>
            )}
            {times.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Field
          label={`Vé, mỗi dòng một vé${game.specialMode === 'separate_pool' ? ': 5 số chính rồi số đặc biệt' : ''}`}
          hint={ticketsEditable ? `Ví dụ: ${game.specialMode === 'separate_pool' ? '02 05 08 23 26 | 08' : '03 11 19 27 38 45'}` : 'Danh mục đã mua: không sửa vé (chi phí đã ghi sổ quỹ).'}
        >
          <Textarea rows={8} value={f.text} disabled={!ticketsEditable} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder={game.specialMode === 'separate_pool' ? '02 05 08 23 26 | 08\n06 10 26 29 35 | 05' : ''} />
        </Field>
        <div className="min-w-0 space-y-2">
          <div className="text-xs font-medium text-muted">
            Xem trước: <span className="measured text-ink">{parsed.tickets.length}</span> vé, <span className="measured text-ink">{vnd(parsed.tickets.length * game.ticketPrice)}</span>
          </div>
          <ol className="max-h-56 space-y-1.5 overflow-y-auto">
            {parsed.tickets.map((t, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="measured w-6 text-xs text-muted">{i + 1}</span>
                <Balls main={t.main} special={t.special} size="sm" />
              </li>
            ))}
          </ol>
          {parsed.errors.length > 0 && (
            <Notice tone="bad">
              {parsed.errors.slice(0, 5).map((e) => (
                <div key={e}>{e}</div>
              ))}
            </Notice>
          )}
        </div>
      </div>
      <Field label="Ghi chú (tuỳ chọn)">
        <Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
      {!editing && f.mode === 'real' && <Notice tone="info">Lưu xong, mở danh mục và bấm “Ghi nhận đã mua” để trừ vào hạn mức vốn. Vé thật nhập sau giờ quay vẫn được chấm, và được đánh dấu “nhập sau giờ quay”.</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={busy} disabled={!canSave} onClick={save}>
          <Save className="h-4 w-4" aria-hidden /> {editing ? 'Lưu thay đổi' : 'Lưu vé đã nhập'}
        </Button>
        {onCancel && <Button onClick={onCancel}>Huỷ sửa</Button>}
      </div>
    </div>
  );
}
