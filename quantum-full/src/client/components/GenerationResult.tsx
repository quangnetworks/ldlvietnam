import { useState } from 'react';
import { Copy, Save } from 'lucide-react';
import { apiFetch, ApiClientError } from '../lib/api';
import { useGame } from '../lib/game';
import { dateTime, num, oneIn, pct, todayVn, two, vnd } from '../lib/format';
import { Badge, Balls, Button, Card, Field, Input, Kpi, Notice, Select } from './ui';
import { useToast } from './toast';
import { PortfolioOdds } from './PortfolioOdds';

export function GenerationResult({ r, onSaved, gameCode }: { r: any; onSaved?: () => void; gameCode?: string }) {
  const { game, code } = useGame();
  const toast = useToast();
  const [saveOpen, setSaveOpen] = useState(false);
  const [save, setSave] = useState({ name: `Danh mục ${new Date().toLocaleDateString('vi-VN')}`, mode: 'simulated', date: r.target_draw_date ?? todayVn(), time: r.target_draw_time ?? '' });
  const [busy, setBusy] = useState(false);
  const copy = async () => {
    const text = r.tickets.map((t: any, i: number) => `${i + 1}. ${t.main.map(two).join(' ')}${t.special != null ? ` | ${two(t.special)}` : ''}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('success', 'Đã sao chép bộ số');
    } catch {
      toast('error', 'Trình duyệt không cho phép sao chép');
    }
  };
  const doSave = async () => {
    setBusy(true);
    try {
      const res = await apiFetch('/portfolios', { body: { recommendation_id: r.recommendationId, name: save.name, mode: save.mode, target_draw_date: save.date, target_draw_time: save.time || null } });
      toast('success', `Đã lưu danh mục #${res.data.id}${save.mode === 'real' ? ' — ghi nhận mua tại trang Danh mục sau khi bạn tự mua vé' : ''}`);
      setSaveOpen(false);
      onSaved?.();
    } catch (e) {
      toast('error', e instanceof ApiClientError ? e.message : 'Không lưu được');
    } finally {
      setBusy(false);
    }
  };
  const c = r.coverage;
  return (
    <div className="space-y-5">
      <Card
        title={`${r.tickets.length} bộ số · ${r.algorithm.name}`}
        subtitle={`Bản ghi #${r.recommendationId} · ${dateTime(r.createdAt)} · seed ${r.seed}`}
        actions={
          <>
            <Button onClick={copy}>
              <Copy className="h-4 w-4" aria-hidden /> Sao chép
            </Button>
            <Button variant="primary" onClick={() => setSaveOpen((v) => !v)}>
              <Save className="h-4 w-4" aria-hidden /> Lưu danh mục
            </Button>
          </>
        }
      >
        <ol className="grid gap-2 xl:grid-cols-2">
          {r.tickets.map((t: any, i: number) => (
            <li key={i} className="flex items-center gap-3 rounded-lg border border-line bg-bg/60 px-3 py-2.5">
              <span className="tabular w-6 text-xs text-muted">{i + 1}</span>
              <Balls main={t.main} special={t.special} size="md" />
              <span className="ml-auto text-[11px] text-muted" title="Ước lượng mức phổ biến (heuristic)">
                phổ biến {Math.round(t.popularity)}%
              </span>
            </li>
          ))}
        </ol>
        {saveOpen && (
          <div className="mt-4 grid gap-3 rounded-lg border border-line bg-surface-2 p-4 sm:grid-cols-5">
            <Field label="Tên danh mục">
              <Input value={save.name} onChange={(e) => setSave({ ...save, name: e.target.value })} />
            </Field>
            <Field label="Loại">
              <Select value={save.mode} onChange={(e) => setSave({ ...save, mode: e.target.value })}>
                <option value="simulated">Mô phỏng (không tốn tiền)</option>
                <option value="real">Thực tế (tôi sẽ tự mua)</option>
              </Select>
            </Field>
            <Field label="Ngày quay mục tiêu">
              <Input type="date" min={todayVn()} value={save.date} disabled={!!r.target_draw_date} onChange={(e) => setSave({ ...save, date: e.target.value })} />
            </Field>
            <Field label="Giờ quay (nếu nhiều kỳ/ngày)">
              <Input type="time" value={save.time} onChange={(e) => setSave({ ...save, time: e.target.value })} />
            </Field>
            <div className="flex items-end">
              <Button variant="primary" loading={busy} onClick={doSave} className="w-full">
                Xác nhận lưu
              </Button>
            </div>
          </div>
        )}
      </Card>
      <PortfolioOdds game={gameCode ?? code} tickets={r.tickets} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Tổng chi phí" value={vnd(r.totalCost)} hint={`${r.tickets.length} × ${vnd(game?.ticketPrice)}`} />
        <Kpi label="Xác suất Jackpot (danh mục)" value={oneIn(r.probability.jackpotOneIn)} hint={`= ${r.probability.jackpotExact}`} />
        <Kpi label="Độ phủ số" value={`${c.numbersCovered}/${(game?.mainMax ?? 0) - (game?.mainMin ?? 0) + 1}`} hint={`Cặp số phủ: ${num(c.pairsCovered)} (${pct(c.pairCoverage, 1)})`} />
        <Kpi label="Số cặp trùng giữa các vé" value={num(c.repeatedPairs)} hint={`Trùng tối đa ${c.maxOverlap} số / 2 vé`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Cách sinh & trạng thái kiểm định">
          <p className="text-sm leading-relaxed text-slate-300">{r.explanation}</p>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <dt className="text-muted">Thuật toán</dt>
            <dd>
              {r.algorithm.code} v{r.algorithm.version} {r.algorithm.baseline && <Badge tone="info">Baseline</Badge>}
            </dd>
            <dt className="text-muted">Dữ liệu dùng</dt>
            <dd>
              {num(r.dataCutoff.drawCount)} kỳ {r.dataCutoff.includeUnverified ? '(gồm chưa xác minh)' : '(đã xác minh)'}
            </dd>
            <dt className="text-muted">Kỳ cuối trong dữ liệu</dt>
            <dd>{dateTime(r.dataCutoff.lastDrawAt)}</dd>
            <dt className="text-muted">Mốc cắt dữ liệu</dt>
            <dd>{r.dataCutoff.before ? dateTime(r.dataCutoff.before) : 'Toàn bộ dữ liệu hiện có'}</dd>
            <dt className="text-muted">Dataset hash</dt>
            <dd className="truncate font-mono" title={r.datasetHash}>
              {r.datasetHash.slice(0, 16)}…
            </dd>
          </dl>
          <div className="mt-4">
            <Notice tone={/KHÔNG|CHƯA/.test(r.validationStatus) ? 'warn' : 'info'}>Trạng thái kiểm định: {r.validationStatus}</Notice>
          </div>
          {r.relaxedConstraints && (
            <div className="mt-2">
              <Notice tone="warn">Không tìm được đủ vé thoả giới hạn trùng lặp — đã nới ràng buộc cho một số vé.</Notice>
            </div>
          )}
        </Card>
        <Card title="Xác suất & kỳ vọng">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Tổng số tổ hợp</dt>
            <dd className="tabular">{Number(r.probability.totalCombinations).toLocaleString('vi-VN')}</dd>
            <dt className="text-muted">P(Jackpot) danh mục</dt>
            <dd className="tabular">{oneIn(r.probability.jackpotOneIn)}</dd>
            <dt className="text-muted">P(≥1 vé trúng giải) ≈</dt>
            <dd className="tabular">{pct(r.probability.anyPrizeAtLeastOneApprox, 2)}</dd>
            <dt className="text-muted">Kỳ vọng tiền thưởng / vé</dt>
            <dd className="tabular">{vnd(r.probability.expectedValuePerTicket.expectedPrize)}</dd>
            <dt className="text-muted">Kỳ vọng ròng / vé</dt>
            <dd className="tabular text-amber-300">{vnd(r.probability.expectedValuePerTicket.expectedNet)}</dd>
          </dl>
          <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-muted">
            {r.probability.expectedValuePerTicket.notes.map((n: string) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <div className="mt-3">
            <Notice tone="warn">{r.disclaimer}</Notice>
          </div>
        </Card>
      </div>
    </div>
  );
}
