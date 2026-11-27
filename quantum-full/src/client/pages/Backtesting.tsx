import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import { apiFetch, ApiClientError } from '../lib/api';
import { useGame } from '../lib/game';
import { useApi } from '../lib/hooks';
import { dateTime, num, pct, vnd } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, Notice, PageHeader, Table, Td } from '../components/ui';
import { Chart, CHART, axis } from '../components/Chart';
import { useToast } from '../components/toast';
import { STRATEGY_LABEL } from './Generator';

/** Gọi tiếp một đoạn backtest; gặp 429 (giới hạn tốc độ) thì chờ rồi thử lại. */
async function continueRun(id: number): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await apiFetch(`/backtests/${id}/continue`, { body: {} })).data;
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 429 && attempt < 6) {
        await new Promise((r) => setTimeout(r, 10_000));
        continue;
      }
      throw e;
    }
  }
}

const COLORS = [CHART.muted, CHART.primary, CHART.accent, CHART.warn, CHART.ink];

function RunDetail({ id }: { id: number }) {
  const q = useApi<any>(`/backtests/${id}`);
  const d = q.data;
  const seriesOpt = useMemo(() => {
    if (!d?.series?.length) return null;
    const strategies: string[] = d.run.strategies;
    return {
      legend: { data: strategies.map((s) => STRATEGY_LABEL[s] ?? s), textStyle: { color: CHART.muted } },
      xAxis: { type: 'category', data: d.series.map((r: any) => r.drawCode), ...axis({ axisLabel: { color: CHART.muted, fontSize: 10 } }) },
      yAxis: { type: 'value', name: 'Số trùng TB/vé', ...axis() },
      dataZoom: [{ type: 'inside' }],
      series: strategies.map((s, i) => ({ name: STRATEGY_LABEL[s] ?? s, type: 'line', showSymbol: false, data: d.series.map((r: any) => (r[s] == null ? null : Number(r[s].toFixed(3)))), lineStyle: { width: 1.2, color: COLORS[i % COLORS.length] }, itemStyle: { color: COLORS[i % COLORS.length] } })),
    };
  }, [d]);
  const calOpt = useMemo(() => {
    const withCal = d?.summary?.strategies.filter((s: any) => s.calibration) ?? [];
    if (!withCal.length) return null;
    return {
      tooltip: { trigger: 'item' },
      legend: { data: withCal.map((s: any) => STRATEGY_LABEL[s.strategy]), textStyle: { color: CHART.muted } },
      xAxis: { type: 'value', name: 'Dự báo', scale: true, ...axis() },
      yAxis: { type: 'value', name: 'Quan sát', scale: true, ...axis() },
      series: [
        ...withCal.map((s: any, i: number) => ({ name: STRATEGY_LABEL[s.strategy], type: 'scatter', symbolSize: 9, data: s.calibration.map((c: any) => [Number(c.predicted.toFixed(4)), Number(c.observed.toFixed(4))]), itemStyle: { color: COLORS[(i + 1) % COLORS.length] } })),
        { type: 'line', name: 'Hiệu chỉnh hoàn hảo', data: [[0, 0], [0.4, 0.4]], showSymbol: false, lineStyle: { type: 'dashed', color: CHART.faint } },
      ],
    };
  }, [d]);
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!d) return <LoadingBlock rows={6} />;
  const s = d.summary;
  return (
    <div className="space-y-5">
      <Card title={`Phiên backtest #${d.run.id}`} subtitle={`${d.run.totalDraws} kỳ · ${d.run.ticketsPerDraw} vé/kỳ/chiến lược · lịch sử tối thiểu ${d.run.minHistory} kỳ · seed ${d.run.seed} · tạo ${dateTime(d.run.createdAt)}`}>
        {d.run.status === 'failed' && <Notice tone="bad">Thất bại: {d.run.error}</Notice>}
        {d.partial && d.run.status === 'running' && <Notice tone="warn">Kết quả tạm thời ({pct(d.run.progress.ratio, 0)}) — chưa phải kết luận cuối cùng.</Notice>}
        {s && (
          <div className="mt-2">
            <Notice tone={s.edgeProven ? 'warn' : 'info'}>
              <b>Kết luận:</b> {s.verdict}
            </Notice>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">Mã băm dữ liệu <span className="measured break-all text-ink-2">{d.run.datasetHash}</span></p>
      </Card>
      {s && (
        <Card title="So sánh chiến lược với baseline Random Uniform">
          <Table head={['Chiến lược', 'Kỳ', 'Trùng TB/vé (KTC 95%)', 'Lý thuyết', 'Tỷ lệ trúng giải', 'Jackpot', 'ROI (giải cố định)', 'Brier', 'Chênh vs baseline', '']}>
            {s.strategies.map((x: any) => (
              <tr key={x.strategy}>
                <Td className="whitespace-nowrap">
                  {STRATEGY_LABEL[x.strategy] ?? x.strategy} {x.strategy === 'random_uniform' && <Badge tone="info">Baseline</Badge>}
                </Td>
                <Td className="measured">{x.steps}</Td>
                <Td className="measured whitespace-nowrap">
                  {num(x.meanMatches.mean, 4)} <span className="text-xs text-muted">[{num(x.meanMatches.low, 4)}; {num(x.meanMatches.high, 4)}]</span>
                </Td>
                <Td className="measured text-muted">{num(x.theoreticalMeanMatches, 4)}</Td>
                <Td className="measured whitespace-nowrap">
                  {pct(x.hitRate.rate, 2)} <span className="text-xs text-muted">[{pct(x.hitRate.low, 2)}; {pct(x.hitRate.high, 2)}]</span>
                </Td>
                <Td className="measured">{x.jackpotHits}</Td>
                <Td className="measured">{pct(x.roi, 1)}</Td>
                <Td className="measured">{x.brier == null ? '—' : num(x.brier, 5)}</Td>
                <Td className="measured whitespace-nowrap text-xs">{x.vsBaseline ? `${num(x.vsBaseline.meanMatchesDiff.mean, 4)} [${num(x.vsBaseline.meanMatchesDiff.low, 4)}; ${num(x.vsBaseline.meanMatchesDiff.high, 4)}]` : '—'}</Td>
                <Td>{x.vsBaseline && (x.vsBaseline.significant ? <Badge tone="warn">Vượt (cần xác nhận)</Badge> : <Badge>Không vượt</Badge>)}</Td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-xs text-muted">
            Khoảng chênh lệch dùng mức ý nghĩa đã hiệu chỉnh Bonferroni α = {num(s.bonferroniLevel, 4)}. Tổng chi phí mô phỏng: {vnd(s.strategies[0]?.totalCost)} / chiến lược; giá vé {vnd(s.strategies[0]?.costPerTicket)}.
          </p>
        </Card>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {seriesOpt && (
          <Card title="Số trùng trung bình theo kỳ (200 kỳ cuối)">
            <Chart option={seriesOpt} height={280} ariaLabel="Số trùng trung bình mỗi kỳ theo chiến lược" />
          </Card>
        )}
        {calOpt && (
          <Card title="Hiệu chỉnh xác suất (calibration)" subtitle="Điểm nằm trên đường chéo = xác suất dự báo khớp tần suất quan sát.">
            <Chart option={calOpt} height={280} ariaLabel="Biểu đồ hiệu chỉnh xác suất dự báo" />
          </Card>
        )}
      </div>
      {s && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Ổn định theo cửa sổ thời gian">
            <Table head={['Chiến lược', 'Cửa sổ', 'Từ', 'Đến', 'Trùng TB', 'Tỷ lệ trúng']}>
              {s.strategies.flatMap((x: any) =>
                x.windows.map((w: any) => (
                  <tr key={`${x.strategy}-${w.index}`}>
                    <Td>{STRATEGY_LABEL[x.strategy]}</Td>
                    <Td>{w.index}</Td>
                    <Td className="text-xs text-muted">{dateTime(w.from)}</Td>
                    <Td className="text-xs text-muted">{dateTime(w.to)}</Td>
                    <Td className="measured">{num(w.meanMatches, 4)}</Td>
                    <Td className="measured">{pct(w.hitRate, 2)}</Td>
                  </tr>
                )),
              )}
            </Table>
          </Card>
          <Card title="Kiểm soát sai lệch">
            <ul className="list-disc space-y-1.5 pl-4 text-xs text-ink-2">
              {s.biasControls.map((b: string) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function Backtesting() {
  const { code } = useGame();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const selected = params.get('id') ? Number(params.get('id')) : null;
  const runs = useApi<any[]>(code ? `/backtests?game=${code}&page_size=20` : null);
  const [f, setF] = useState({ strategies: ['statistical', 'bayesian', 'balanced'] as string[], tickets: 10, minHistory: 50, maxDraws: '', seed: '', unverified: false });
  const [progress, setProgress] = useState<{ id: number; ratio: number } | null>(null);
  const cancel = useRef(false);
  useEffect(() => () => void (cancel.current = true), []);

  const start = async () => {
    cancel.current = false;
    try {
      let r = (
        await apiFetch('/backtests/run', {
          body: { game: code, strategies: f.strategies, tickets_per_draw: f.tickets, min_history: f.minHistory, max_draws: f.maxDraws ? Number(f.maxDraws) : undefined, seed: f.seed || null, include_unverified: f.unverified },
        })
      ).data;
      setProgress({ id: r.id, ratio: r.progress.ratio });
      while (r.status === 'running' && !cancel.current) {
        r = await continueRun(r.id);
        setProgress({ id: r.id, ratio: r.progress.ratio });
      }
      if (r.status === 'completed') toast('success', `Backtest #${r.id} hoàn tất`);
      setParams({ id: String(r.id) });
      runs.reload();
    } catch (e) {
      toast('error', e instanceof ApiClientError ? e.message : 'Backtest thất bại');
      runs.reload();
    } finally {
      setProgress(null);
    }
  };
  const resume = async (id: number) => {
    cancel.current = false;
    try {
      let r = await continueRun(id);
      setProgress({ id, ratio: r.progress.ratio });
      while (r.status === 'running' && !cancel.current) {
        r = await continueRun(id);
        setProgress({ id, ratio: r.progress.ratio });
      }
      setParams({ id: String(id) });
      runs.reload();
    } catch (e) {
      toast('error', e instanceof ApiClientError ? e.message : 'Lỗi');
    } finally {
      setProgress(null);
    }
  };
  const toggle = (s: string) => setF((x) => ({ ...x, strategies: x.strategies.includes(s) ? x.strategies.filter((y) => y !== s) : [...x.strategies, s] }));

  return (
    <>
      <PageHeader title="Backtesting Center" description="Walk-forward: mỗi kỳ chỉ dùng dữ liệu trước kỳ đó, luôn so với baseline Random Uniform. Nếu không vượt baseline có ý nghĩa thống kê, kết luận là KHÔNG CÓ LỢI THẾ DỰ BÁO ĐƯỢC CHỨNG MINH." />
      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <div className="min-w-0 space-y-5">
          <Card title="Phiên mới">
            <div className="space-y-3">
              <fieldset>
                <legend className="mb-1 text-xs font-medium text-muted">Chiến lược (baseline luôn được thêm)</legend>
                <div className="space-y-1.5">
                  {['balanced', 'statistical', 'bayesian', 'portfolio_optimized'].map((s) => (
                    <label key={s} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-accent" checked={f.strategies.includes(s)} onChange={() => toggle(s)} />
                      {STRATEGY_LABEL[s]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Vé / kỳ">
                  <Input type="number" min={1} max={50} value={f.tickets} onChange={(e) => setF({ ...f, tickets: Number(e.target.value) })} />
                </Field>
                <Field label="Lịch sử tối thiểu">
                  <Input type="number" min={10} value={f.minHistory} onChange={(e) => setF({ ...f, minHistory: Number(e.target.value) })} />
                </Field>
              </div>
              <Field label="Giới hạn số kỳ gần nhất (tuỳ chọn)">
                <Input type="number" min={20} value={f.maxDraws} onChange={(e) => setF({ ...f, maxDraws: e.target.value })} />
              </Field>
              <Field label="Seed (tuỳ chọn)">
                <Input value={f.seed} onChange={(e) => setF({ ...f, seed: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" className="h-4 w-4 accent-accent" checked={f.unverified} onChange={(e) => setF({ ...f, unverified: e.target.checked })} />
                Dùng cả dữ liệu chưa xác minh (không khuyến nghị)
              </label>
              <Button variant="primary" className="w-full" loading={!!progress} disabled={!f.strategies.length} onClick={start}>
                <FlaskConical className="h-4 w-4" aria-hidden /> Chạy backtest
              </Button>
              {progress && (
                <div>
                  <div className="h-2 overflow-hidden rounded-full bg-paper-3" role="progressbar" aria-valuenow={Math.round(progress.ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full bg-accent" style={{ width: `${progress.ratio * 100}%` }} />
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-muted">
                    <span>Phiên #{progress.id}: {pct(progress.ratio, 0)}</span>
                    <button className="underline" onClick={() => (cancel.current = true)}>
                      Tạm dừng
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Card>
          <Card title="Các phiên">
            {runs.error && <ErrorState error={runs.error} onRetry={runs.reload} />}
            {runs.loading && !runs.data && <LoadingBlock />}
            {runs.data?.length === 0 && <EmptyState title="Chưa có phiên nào" />}
            <ul className="divide-y divide-rule/60">
              {(runs.data ?? []).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <button className={selected === r.id ? 'text-accent' : 'hover:underline'} onClick={() => setParams({ id: String(r.id) })}>
                    #{r.id} · {r.totalDraws} kỳ
                  </button>
                  <span className="flex items-center gap-1">
                    {r.status === 'completed' ? (r.edgeProven ? <Badge tone="warn">Có tín hiệu</Badge> : <Badge>Không lợi thế</Badge>) : r.status === 'failed' ? <Badge tone="bad">Thất bại</Badge> : (
                      <Button variant="ghost" disabled={!!progress} onClick={() => resume(r.id)}>
                        Tiếp tục {pct(r.progress.ratio, 0)}
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="min-w-0">{selected ? <RunDetail key={`${selected}-${progress ? 'p' : 'd'}`} id={selected} /> : <Card><EmptyState title="Chọn hoặc chạy một phiên backtest" description="Yêu cầu dữ liệu đã xác minh: tối thiểu lịch sử + 10 kỳ." /></Card>}</div>
      </div>
    </>
  );
}
