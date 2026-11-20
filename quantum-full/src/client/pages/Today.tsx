import { useState } from 'react';
import { CalendarCheck, Save, Sparkles } from 'lucide-react';
import { apiFetch, ApiClientError } from '../lib/api';
import { useApi } from '../lib/hooks';
import { dateTime, num, pct, vnd } from '../lib/format';
import { Badge, Button, Card, ErrorState, Field, Input, Kpi, LoadingBlock, Notice, PageHeader, Select, Table, Td } from '../components/ui';
import { GenerationResult } from '../components/GenerationResult';
import { useToast } from '../components/toast';
import { PredictabilitySummary } from './Predictability';
import { SplitDrawCard } from '../components/SplitDrawCard';
import { useGame } from '../lib/game';

const MODE_LABEL: Record<string, string> = {
  discipline: 'Kỷ luật ngân sách — mua theo mức cho phép mỗi ngày',
  value: 'Chỉ mua khi giá trị kỳ vọng đủ cao (Jackpot lớn)',
  minimal: 'Tối thiểu — 1 vé/ngày cho kỳ có giá trị tốt nhất',
  split_only: 'Chỉ mua kỳ Chia giải Độc đắc có kỳ vọng dương (để dành ngân sách)',
};

const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : 'Có lỗi xảy ra');
const ty = (v: number | null | undefined) => (v == null ? '—' : `${(v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ`);

function JackpotEditor({ games, jackpots, onSaved }: { games: any[]; jackpots: any; onSaved: () => void }) {
  const toast = useToast();
  const [vals, setVals] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(games.map((g) => [g.code, Object.fromEntries(g.jackpotTiers.map((t: any) => [t.code, String(jackpots[g.code]?.values?.[t.code] ?? '')]))])),
  );
  const [busy, setBusy] = useState('');
  const save = async (code: string) => {
    setBusy(code);
    try {
      const values = Object.fromEntries(Object.entries(vals[code]).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Math.round(Number(v.replace(/[^\d]/g, '')))]));
      await apiFetch('/admin/jackpots', { method: 'PUT', body: { game: code, values } });
      toast('success', 'Đã cập nhật giá trị Jackpot');
      onSaved();
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <Card title="Giá trị Jackpot hiện tại" subtitle="Nhập theo số liệu hiển thị trên vietlott.vn trước kỳ quay. Để trống ⇒ dùng mức tối thiểu.">
      <div className="space-y-4">
        {games.map((g) => (
          <div key={g.code} className="rounded-lg border border-line p-3">
            <div className="mb-2 flex items-center justify-between text-sm font-medium">
              {g.name}
              <span className="text-xs font-normal text-muted">{jackpots[g.code]?.updatedAt ? `Cập nhật ${dateTime(jackpots[g.code].updatedAt)}` : 'Chưa cập nhật'}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {g.jackpotTiers.map((t: any) => (
                <Field key={t.code} label={`${t.name} (tối thiểu ${ty(t.minimum)})`}>
                  <Input inputMode="numeric" placeholder={String(t.minimum)} value={vals[g.code]?.[t.code] ?? ''} onChange={(e) => setVals({ ...vals, [g.code]: { ...vals[g.code], [t.code]: e.target.value } })} />
                </Field>
              ))}
            </div>
            <Button className="mt-2" loading={busy === g.code} onClick={() => save(g.code)}>
              Lưu {g.name}
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function Today() {
  const toast = useToast();
  const { code } = useGame();
  const [mode, setMode] = useState('');
  const [threshold, setThreshold] = useState('');
  const q = useApi<any>(`/decision/today?${mode ? `mode=${mode}&` : ''}${threshold ? `threshold=${Number(threshold) / 100}` : ''}`);
  const [gen, setGen] = useState<any | null>(null);
  const [busy, setBusy] = useState('');
  const d = q.data?.decision;

  const generate = async () => {
    if (!d?.pick) return;
    setBusy('gen');
    try {
      const r = await apiFetch('/portfolio/optimize', {
        body: { game: d.pick.game, budget: d.cost, ticket_count: d.tickets, target_draw_date: d.pick.date, params: { avoidPopular: true, candidates: 300 } },
      });
      setGen({ ...r.data, gameCode: d.pick.game, target_draw_date: d.pick.date, target_draw_time: d.pick.time });
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy('');
    }
  };
  const record = async () => {
    setBusy('rec');
    try {
      const r = await apiFetch(`/decision/today?${mode ? `mode=${mode}&` : ''}${threshold ? `threshold=${Number(threshold) / 100}` : ''}`, { body: {} });
      toast('success', `Đã ghi nhận quyết định (lần chạy #${r.data.modelRunId})`);
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy('');
    }
  };
  const saveDefault = async () => {
    try {
      await apiFetch('/admin/settings', { method: 'PUT', body: { decision_mode: mode || q.data.settings.mode, ...(threshold ? { decision_value_threshold: Number(threshold) / 100 } : {}) } });
      toast('success', 'Đã lưu chế độ mặc định');
    } catch (e) {
      toast('error', errMsg(e));
    }
  };

  return (
    <>
      <PageHeader title="Quyết định hôm nay" description="Gợi ý có nên mua hôm nay, mua kỳ nào và bao nhiêu vé — dựa trên lịch quay, giá trị kỳ vọng sau thuế với Jackpot hiện tại và kỷ luật ngân sách. Không dự đoán số." />
      {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {!q.data && !q.error && <LoadingBlock rows={6} />}
      {q.data && d && (
        <div className="space-y-5">
          <section className={`rounded-xl border p-5 ${d.action === 'buy' ? 'border-primary/40 bg-primary/5' : 'border-line bg-surface'}`} aria-live="polite">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Badge tone={d.action === 'buy' ? 'info' : 'default'}>{d.action === 'buy' ? 'Đề xuất' : 'Khuyến nghị'}</Badge>
                <h2 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">{d.headline}</h2>
                {d.pick && (
                  <p className="mt-1 text-sm text-muted">
                    Ngày {d.pick.date} · quay {d.pick.time} · ngừng bán sau khoảng {Math.max(0, Math.floor(d.pick.minutesUntilClose / 60))} giờ {d.pick.minutesUntilClose % 60} phút
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {d.action === 'buy' && (
                  <Button variant="primary" loading={busy === 'gen'} onClick={generate}>
                    <Sparkles className="h-4 w-4" aria-hidden /> Sinh {d.tickets} bộ số
                  </Button>
                )}
                <Button loading={busy === 'rec'} onClick={record}>
                  <CalendarCheck className="h-4 w-4" aria-hidden /> Ghi nhận quyết định
                </Button>
              </div>
            </div>
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-300">
              {d.reasons.map((r: string) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Chi phí đề xuất" value={vnd(d.cost)} hint={`${d.tickets} vé`} />
            <Kpi label="Tiền thưởng kỳ vọng" value={vnd(d.expectedReturn)} hint={q.data.settings.applyTax ? 'Sau thuế TNCN' : 'Trước thuế'} />
            {d.expectedLoss < 0 ? <Kpi label="Lãi kỳ vọng" value={vnd(-d.expectedLoss)} tone="good" hint="Trung bình qua nhiều kỳ tương tự" /> : <Kpi label="Lỗ kỳ vọng" value={vnd(d.expectedLoss)} tone="warn" />}
            <Kpi label="Ngân sách khả dụng hôm nay" value={vnd(d.allowance.available)} hint={`Đã chi hôm nay ${vnd(d.allowance.spentToday)}`} />
          </div>

          {gen && <GenerationResult r={gen} gameCode={gen.gameCode} />}

          <div className="grid gap-5 lg:grid-cols-3">
            <Card title="Các kỳ còn mở bán hôm nay" className="lg:col-span-2" subtitle="Xếp theo tỷ lệ hoàn vốn kỳ vọng (cao → thấp). Mọi tổ hợp số có xác suất như nhau.">
              {d.candidates.length === 0 ? (
                <p className="text-sm text-muted">Không còn kỳ quay nào mở bán hôm nay.</p>
              ) : (
                <Table head={['Game', 'Giờ quay', 'Jackpot dùng', 'Hoàn vốn kỳ vọng', 'Lỗ kỳ vọng/vé', 'Jackpot hoà vốn']}>
                  {d.candidates.map((c: any) => (
                    <tr key={`${c.game}-${c.time}`}>
                      <Td className="whitespace-nowrap">
                        {c.gameName} {c.split && <Badge tone="good">Chia giải</Badge>} {d.pick && d.pick.game === c.game && d.pick.time === c.time && <Badge tone="info">Chọn</Badge>}
                      </Td>
                      <Td>{c.time}</Td>
                      <Td className="tabular whitespace-nowrap">
                        {ty(c.jackpotUsed)} {c.jackpotIsMinimum && <span className="text-xs text-amber-300">(tối thiểu)</span>}
                      </Td>
                      <Td className="tabular">{pct(c.returnRatio, 1)}</Td>
                      <Td className="tabular">{c.expectedLossPerTicket < 0 ? <span className="text-accent">lãi {vnd(-c.expectedLossPerTicket)}</span> : vnd(c.expectedLossPerTicket)}</Td>
                      <Td className="tabular whitespace-nowrap">{c.split ? `≤ ${(c.split.breakEvenTickets / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} triệu vé` : ty(c.breakEvenJackpot)}</Td>
                    </tr>
                  ))}
                </Table>
              )}
              <p className="mt-3 text-xs text-muted">
                “Jackpot hoà vốn” là giá trị Jackpot (trước thuế) để kỳ vọng sau thuế bằng giá vé, chưa tính khả năng phải chia giải với người khác — nên trên thực tế cần cao hơn nữa.
              </p>
            </Card>
            <Card title="Chế độ quyết định">
              <div className="space-y-3">
                <Field label="Chế độ">
                  <Select value={mode || q.data.settings.mode} onChange={(e) => setMode(e.target.value)}>
                    {Object.entries(MODE_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
                {(mode || q.data.settings.mode) === 'value' && (
                  <Field label="Ngưỡng hoàn vốn kỳ vọng (%)">
                    <Input type="number" min={0} max={200} value={threshold || String(Math.round(q.data.settings.valueThreshold * 100))} onChange={(e) => setThreshold(e.target.value)} />
                  </Field>
                )}
                <Button variant="secondary" onClick={saveDefault}>
                  <Save className="h-4 w-4" aria-hidden /> Lưu làm mặc định
                </Button>
                <dl className="grid grid-cols-2 gap-1 pt-2 text-xs">
                  <dt className="text-muted">Hạn mức/kỳ</dt>
                  <dd className="tabular">{vnd(d.allowance.budgetPerDraw)}</dd>
                  <dt className="text-muted">Tháng còn lại ÷ ngày</dt>
                  <dd className="tabular">
                    {vnd(d.allowance.dailyFromMonth)} ({num(d.allowance.daysLeftInMonth)} ngày)
                  </dd>
                  <dt className="text-muted">Hạn mức năm còn</dt>
                  <dd className="tabular">{vnd(d.allowance.yearRemaining)}</dd>
                </dl>
              </div>
            </Card>
          </div>

          <SplitDrawCard key={q.data.split?.config?.updatedAt ?? 'none'} split={q.data.split} onSaved={q.reload} />

          <div className="grid gap-5 lg:grid-cols-2">
            <JackpotEditor games={q.data.games} jackpots={q.data.jackpots} onSaved={q.reload} />
            <div className="space-y-5">
              <PredictabilitySummary game={d.pick?.game ?? d.candidates[0]?.game ?? code} />
              <Card title="Nguyên tắc">
              <ul className="list-disc space-y-2 pl-4 text-xs text-slate-300">
                {d.principles.map((p: string) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <Notice tone="info">Bộ số được sinh bằng “Tối ưu danh mục” với ưu tiên bộ số ít phổ biến: không tăng xác suất trúng, nhưng giảm khả năng phải chia giải nếu trúng Jackpot.</Notice>
              </Card>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
