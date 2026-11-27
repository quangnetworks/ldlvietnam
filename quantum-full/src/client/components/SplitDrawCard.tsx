import { useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { apiFetch, ApiClientError } from '../lib/api';
import { dateTime, num, pct, todayVn, vnd } from '../lib/format';
import { Badge, Button, Card, Field, Input, Kpi, Notice, Table, Td } from './ui';
import { useToast } from './toast';

const TIERS: { code: string; label: string }[] = [
  { code: 'first', label: 'Nhất' },
  { code: 'second', label: 'Nhì' },
  { code: 'third', label: 'Ba' },
  { code: 'fourth', label: 'Tư' },
  { code: 'fifth', label: 'Năm' },
];
const STATUS: Record<string, { label: string; tone: 'info' | 'good' | 'default' }> = {
  upcoming: { label: 'Sắp diễn ra', tone: 'info' },
  today: { label: 'Hôm nay', tone: 'good' },
  past: { label: 'Đã qua', tone: 'default' },
};
const mil = (x: number | null | undefined) => (x == null ? '—' : `${(x / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} triệu`);
const parseNum = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

/** Kỳ "Chia giải Độc đắc": cấu hình (admin) + đánh giá kỳ vọng. */
export function SplitDrawCard({ split, onSaved }: { split: any; onSaved: () => void }) {
  const toast = useToast();
  const cfg = split?.config ?? null;
  const [f, setF] = useState(() => ({
    date: cfg?.date ?? todayVn(),
    time: cfg?.time ?? '21:00',
    jackpot: cfg ? String(cfg.jackpot / 1e9).replace('.', ',') : '',
    winners: Object.fromEntries(TIERS.map((t) => [t.code, cfg?.reference_winners?.[t.code] != null ? String(cfg.reference_winners[t.code]) : ''])) as Record<string, string>,
    override: cfg?.tickets_override ? String(cfg.tickets_override / 1e6).replace('.', ',') : '',
    growth: String(Math.round((cfg?.sales_growth ?? 0.3) * 100)),
    note: cfg?.reference_note ?? '',
  }));
  const [busy, setBusy] = useState('');
  const save = async () => {
    setBusy('save');
    try {
      const winners = Object.fromEntries(Object.entries(f.winners).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Math.round(parseNum(v))]));
      await apiFetch('/admin/split-draw', {
        method: 'PUT',
        body: {
          game: 'lotto535',
          date: f.date,
          time: f.time,
          jackpot: Math.round(parseNum(f.jackpot) * 1e9),
          ...(Object.keys(winners).length ? { reference_winners: winners } : {}),
          tickets_override: f.override.trim() ? Math.round(parseNum(f.override) * 1e6) : null,
          sales_growth: parseNum(f.growth) / 100,
          ...(f.note.trim() ? { reference_note: f.note.trim() } : {}),
        },
      });
      toast('success', 'Đã lưu kỳ Chia giải Độc đắc');
      onSaved();
    } catch (e) {
      toast('error', e instanceof ApiClientError ? e.message : 'Không lưu được');
    } finally {
      setBusy('');
    }
  };
  const clear = async () => {
    setBusy('clear');
    try {
      await apiFetch('/admin/split-draw', { method: 'DELETE' });
      toast('success', 'Đã xoá cấu hình kỳ chia giải');
      onSaved();
    } catch (e) {
      toast('error', e instanceof ApiClientError ? e.message : 'Không xoá được');
    } finally {
      setBusy('');
    }
  };
  const ok = split?.tickets != null;
  const st = split?.status ? STATUS[split.status] : null;
  return (
    <Card
      title="Kỳ Chia giải Độc đắc — Lotto 5/35"
      subtitle="Khi Độc đắc vượt 12 tỷ mà chưa ai trúng, kỳ 21:00 hôm sau là kỳ chia giải: toàn bộ Độc đắc được trả cho người chơi kỳ đó (Nhất 2/6, Nhì–Năm mỗi hạng 1/6, cộng thêm vào giải cố định). Đây là thời điểm duy nhất kỳ vọng mỗi vé có thể vượt giá vé."
      actions={st && <Badge tone={st.tone}>{st.label}</Badge>}
    >
      <div className="space-y-4">
        {ok ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Kỳ vọng / vé (ước tính)" value={pct(split.returnRatioEstimate, 0)} tone={split.returnRatioEstimate >= 1 ? 'good' : 'warn'} hint={`≈ ${mil(split.tickets)} lần dự thưởng`} />
              <Kpi label="Kỳ vọng / vé (thận trọng)" value={pct(split.returnRatioConservative, 0)} tone={split.returnRatioConservative >= 1 ? 'good' : 'warn'} hint={`≈ ${mil(split.ticketsConservative)} (+${num((cfg.sales_growth ?? 0) * 100)}% doanh số)`} />
              <Kpi label="Còn có lợi khi số vé dưới" value={mil(split.breakEvenTickets)} hint="Điểm hoà vốn (sau thuế)" />
              <Kpi label="Khả năng thực sự chia" value={pct(split.pSplitHappens, 1)} hint="Không ai trúng Độc đắc kỳ đó" />
            </div>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-muted">Kỳ chia giải</dt>
                <dd className="measured text-cool">
                  {cfg.date} {cfg.time}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Độc đắc sẽ chia</dt>
                <dd className="measured text-ink">{(cfg.jackpot / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ</dd>
              </div>
              {split.estimate && (
                <div>
                  <dt className="text-xs text-muted">Ước lượng từ {num(split.estimate.winnersUsed)} vé trúng kỳ tham chiếu (95%)</dt>
                  <dd className="measured text-ink-2">
                    {mil(split.estimate.low)} đến {mil(split.estimate.high)}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted">Cập nhật</dt>
                <dd className="measured text-cool">{dateTime(cfg.updatedAt)}</dd>
              </div>
            </dl>
            {cfg.reference_note && <p className="text-xs text-muted">Nguồn: {cfg.reference_note}</p>}
            <Table head={['Hạng', 'Xác suất / vé', 'Người khác cùng trúng (kỳ vọng)', 'Bạn nhận nếu trúng (kỳ vọng)']}>
              {split.tiers.map((t: any) => (
                <tr key={t.code}>
                  <Td>{t.name}</Td>
                  <Td className="measured">1 / {num(1 / t.probability)}</Td>
                  <Td className="measured">{num(t.expectedOtherWinners, 1)}</Td>
                  <Td className="measured">{vnd(t.expectedAmountIfWin)}</Td>
                </tr>
              ))}
            </Table>
          </>
        ) : (
          <Notice tone="info">Chưa có kỳ chia giải nào được xác nhận. Khi Vietlott công bố Độc đắc vượt 12 tỷ, hãy nhập thông tin bên dưới.</Notice>
        )}

        <details className="rounded-[var(--radius-pill)] border border-rule p-3" open={!ok}>
          <summary className="cursor-pointer text-sm font-medium">Cập nhật kỳ chia giải (quản trị viên)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <Field label="Ngày kỳ chia giải">
              <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
            </Field>
            <Field label="Giờ quay">
              <Input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
            </Field>
            <Field label="Độc đắc sẽ chia (tỷ)">
              <Input inputMode="decimal" placeholder="16,9" value={f.jackpot} onChange={(e) => setF({ ...f, jackpot: e.target.value })} />
            </Field>
            <Field label="Doanh số tăng thêm (%)" hint="So với kỳ tham chiếu; dùng cho kỳ vọng thận trọng">
              <Input inputMode="numeric" value={f.growth} onChange={(e) => setF({ ...f, growth: e.target.value })} />
            </Field>
          </div>
          <p className="mt-3 text-xs text-muted">Số vé trúng từng hạng của kỳ chia giải gần nhất (bảng “Số lượng giải” trên trang kết quả Vietlott) — dùng để ước lượng số lần dự thưởng:</p>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {TIERS.map((t) => (
              <Field key={t.code} label={`Giải ${t.label}`}>
                <Input inputMode="numeric" value={f.winners[t.code]} onChange={(e) => setF({ ...f, winners: { ...f.winners, [t.code]: e.target.value } })} />
              </Field>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Hoặc nhập trực tiếp số lần dự thưởng (triệu)" hint="Ưu tiên giá trị này nếu có">
              <Input inputMode="decimal" placeholder="1,2" value={f.override} onChange={(e) => setF({ ...f, override: e.target.value })} />
            </Field>
            <Field label="Ghi chú nguồn">
              <Input placeholder="vd: kỳ 00038 ngày 17/7/2025" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" loading={busy === 'save'} onClick={save}>
              <Save className="h-4 w-4" aria-hidden /> Lưu kỳ chia giải
            </Button>
            {cfg && (
              <Button loading={busy === 'clear'} onClick={clear}>
                <Trash2 className="h-4 w-4" aria-hidden /> Xoá
              </Button>
            )}
          </div>
        </details>
        <p className="text-xs text-muted">
          Lợi thế chỉ thành hiện thực qua nhiều kỳ chia giải: mỗi vé chỉ ≈ 1,4% trúng từ hạng Năm trở lên, nên đa số kỳ sẽ không trúng gì. Khi người chơi đổ xô mua vé, số lần dự thưởng tăng và lợi thế giảm — luôn cập nhật số liệu kỳ gần nhất. Thể lệ tổng hợp từ thông tin Vietlott công bố trên báo chí; đối chiếu thể lệ chính thức trước khi mua.
        </p>
      </div>
    </Card>
  );
}
