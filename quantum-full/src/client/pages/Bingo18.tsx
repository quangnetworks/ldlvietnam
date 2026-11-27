import { useMemo, useState } from 'react';
import { Play, Wallet } from 'lucide-react';
import { apiFetch, ApiClientError } from '../lib/api';
import { useApi } from '../lib/hooks';
import { num, pct, pv, todayVn, vnd } from '../lib/format';
import { Badge, RecordLead, Button, Card, EmptyState, ErrorState, Field, Input, Kpi, LoadingBlock, Notice, PageHeader, Pagination, Select, Table, Tabs, Td } from '../components/ui';
import { Chart, CHART, axis } from '../components/Chart';
import { ObservedExpectedBar } from '../components/charts';
import { useToast } from '../components/toast';
import { BingoStrategyTab } from '../components/BingoStrategyTab';
import { BingoLiveTab } from '../components/BingoLiveTab';

type Tab = 'today' | 'live' | 'strategy' | 'models' | 'bets' | 'stats' | 'simulate' | 'results';
const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : 'Có lỗi xảy ra');

function Dice({ v }: { v: number }) {
  return (
    <span className="measured inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-pill)] border border-cool/45 bg-cool-soft text-sm font-medium text-ink" aria-label={`Số ${v}`}>
      {v}
    </span>
  );
}

function TodayTab() {
  const toast = useToast();
  const q = useApi<any>('/bingo18/decision');
  const [f, setF] = useState({ stake: '', prize: '', date: todayVn() });
  const [busy, setBusy] = useState(false);
  const record = async () => {
    setBusy(true);
    try {
      await apiFetch('/bingo18/ledger', { body: { stake: Number(f.stake || 0), prize: Number(f.prize || 0), entry_date: f.date } });
      toast('success', 'Đã ghi nhận vào sổ quỹ thực tế');
      setF({ ...f, stake: '', prize: '' });
      q.reload();
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingBlock rows={6} />;
  const d = q.data;
  return (
    <div className="space-y-5">
      <RecordLead
        badge={<Badge tone={d.action === 'play' ? 'warn' : 'default'}>{d.action === 'play' ? 'Kế hoạch hôm nay' : 'Khuyến nghị'}</Badge>}
        headline={d.headline}
        meta={
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            <div>
              <dt className="text-xs">Kỳ còn lại hôm nay</dt>
              <dd className="measured text-cool">
                {d.schedule.remaining}/{d.schedule.perDay}
              </dd>
            </div>
            {d.schedule.nextAt && (
              <div>
                <dt className="text-xs">Kỳ kế tiếp</dt>
                <dd className="measured text-cool">{d.schedule.nextAt}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs">Giới hạn phiên</dt>
              <dd className="measured text-ink-2">{d.sessionMinutes} phút</dd>
            </div>
          </dl>
        }
        reasons={d.reasons}
        reading={{ label: 'Ngân sách khả dụng hôm nay', value: vnd(d.allowance.available), note: `Hạn mức Bingo18 mỗi ngày ${vnd(d.allowance.dailyLimit)}. Lỗ kỳ vọng nếu chơi hết ${vnd(d.expectedLoss)}.` }}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Ngân sách khả dụng" value={vnd(d.allowance.available)} hint={`Hạn mức Bingo18/ngày ${vnd(d.allowance.dailyLimit)}`} />
        <Kpi label="Đã chi / đã thắng hôm nay" value={`${vnd(d.allowance.spentToday)}`} hint={`Thắng ${vnd(d.allowance.wonToday)}`} />
        <Kpi label="Lỗ kỳ vọng nếu chơi hết" value={vnd(d.expectedLoss)} tone="warn" />
        <Kpi label="Khả năng kết thúc ngày có lãi" value={d.outlook ? pct(d.outlook.probabilityProfit, 1) : '—'} hint={d.outlook ? `Trung vị ${vnd(d.outlook.median)}; 90% trong khoảng ${vnd(d.outlook.p5)} đến ${vnd(d.outlook.p95)}` : 'Mô phỏng 4.000 ngày'} />
      </div>
      {d.model && (
        <Notice tone={d.model.verdict === 'edge' ? 'warn' : 'info'}>
          <b>Mô hình dự báo:</b> {d.model.headline}
          {d.model.bestModel ? ` — tốt nhất: ${d.model.bestModel.name}, hoàn trả thực tế khi cược theo mô hình ${pct(d.model.bestModel.singleReturn, 1)}.` : ''} Đã chấm {num(d.model.scoredDraws)} kỳ{d.model.includeUnverified ? ' (gồm dữ liệu chưa xác minh)' : ''}.
        </Notice>
      )}
      {d.comparison && (
        <Card title="Mỗi 10.000đ trả lại bao nhiêu? — so sánh các trò chơi" subtitle="Kỳ vọng sau thuế. Trò chơi trả lại nhiều hơn = lỗ kỳ vọng ít hơn cho cùng số tiền.">
          <Table head={['Trò chơi', 'Cách chơi', 'Hoàn trả kỳ vọng', 'Lỗ kỳ vọng / 10.000đ', 'Ghi chú']}>
            {d.comparison.map((x: any) => (
              <tr key={`${x.game}-${x.option}`}>
                <Td className="whitespace-nowrap">{x.game}</Td>
                <Td className="text-xs">{x.option}</Td>
                <Td className="tabular">{pct(x.returnRatio, 1)}</Td>
                <Td className="tabular">{vnd(x.expectedLossPer10k)}</Td>
                <Td className="text-xs text-muted">{x.note}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Ghi nhận chi tiêu thực tế" subtitle="Sau khi bạn tự chơi qua Vietlott SMS. Hạn mức được kiểm tra trước khi ghi.">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Tiền đã chơi (bội số 10.000đ)">
              <Input type="number" min={0} step={10000} value={f.stake} onChange={(e) => setF({ ...f, stake: e.target.value })} />
            </Field>
            <Field label="Tiền thưởng nhận">
              <Input type="number" min={0} step={1000} value={f.prize} onChange={(e) => setF({ ...f, prize: e.target.value })} />
            </Field>
            <Field label="Ngày">
              <Input type="date" max={todayVn()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
            </Field>
          </div>
          <Button className="mt-3" variant="primary" loading={busy} disabled={!f.stake && !f.prize} onClick={record}>
            <Wallet className="h-4 w-4" aria-hidden /> Ghi nhận
          </Button>
        </Card>
        <Card title="Cảnh báo">
          <ul className="list-disc space-y-2 pl-4 text-xs text-ink-2">
            {d.warnings.map((w: string) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">Đổi hạn mức Bingo18 mỗi ngày và thời gian phiên tại Cài đặt.</p>
        </Card>
      </div>
    </div>
  );
}

function ModelsTab() {
  const [win, setWin] = useState('100');
  const [last, setLast] = useState('30000');
  const [inc, setInc] = useState('true');
  const q = useApi<any>(`/bingo18/models?last=${last}&window=${win}&include_unverified=${inc}`);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3 lg:w-2/3">
        <Field label="Số kỳ dùng để chấm">
          <Select value={last} onChange={(e) => setLast(e.target.value)}>
            <option value="10000">10.000</option>
            <option value="30000">30.000</option>
            <option value="100000">Toàn bộ</option>
          </Select>
        </Field>
        <Field label="Cửa sổ Nóng/Lạnh (kỳ)">
          <Select value={win} onChange={(e) => setWin(e.target.value)}>
            <option value="30">30</option>
            <option value="100">100</option>
            <option value="500">500</option>
          </Select>
        </Field>
        <Field label="Dữ liệu">
          <Select value={inc} onChange={(e) => setInc(e.target.value)}>
            <option value="false">Chỉ đã xác minh</option>
            <option value="true">Gồm chưa xác minh</option>
          </Select>
        </Field>
      </div>
      {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {!q.data && !q.error && <LoadingBlock rows={6} />}
      {q.data && (
        <>
          <section className={`rounded-xl border p-5 ${q.data.verdict === 'edge' ? 'border-warn/40 bg-warn/5' : 'border-line bg-surface'}`}>
            <Badge tone={q.data.verdict === 'edge' ? 'warn' : q.data.verdict === 'no_edge' ? 'info' : 'default'}>Kết luận</Badge>
            <h2 className="mt-2 text-lg font-semibold sm:text-xl">{q.data.headline}</h2>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-300">
              {q.data.explanation.map((x: string) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">
              {q.meta?.dataNotice} {q.meta?.cached ? 'Kết quả lưu đệm — tự tính lại khi có kỳ mới.' : ''}
            </p>
          </section>
          <Card title="Bảng chấm mô hình (walk-forward, Benjamini–Hochberg)" subtitle="Mỗi kỳ chỉ dùng dữ liệu các kỳ trước. Log-loss càng thấp càng tốt; ngẫu nhiên = ln 6 ≈ 1,7918.">
            <Table head={['Mô hình', 'Log-loss', 'Cải thiện', 'q', 'Vượt ngẫu nhiên', '“Chọn 1 số” theo mô hình', 'Lớn/Nhỏ theo mô hình']}>
              {q.data.models.map((m: any) => (
                <tr key={m.code}>
                  <Td className="whitespace-nowrap">
                    {m.name}
                    <div className="text-[11px] text-muted">{m.description}</div>
                  </Td>
                  <Td className="tabular">{num(m.logLoss, 5)}</Td>
                  <Td className="tabular">{m.code === 'uniform' ? '—' : `${m.improvement >= 0 ? '+' : ''}${num(m.improvement * 1000, 3)}‰`}</Td>
                  <Td className="tabular">{m.code === 'uniform' ? '—' : pv(m.qValue)}</Td>
                  <Td>{m.code === 'uniform' ? <Badge tone="info">Chuẩn</Badge> : m.beatsBaseline ? <Badge tone="warn">Có</Badge> : <Badge>Không</Badge>}</Td>
                  <Td className="tabular whitespace-nowrap">
                    {pct(m.single.returnRatio, 1)} <span className="text-xs text-muted">· trúng {pct(m.single.winRate, 1)}</span>
                  </Td>
                  <Td className="tabular whitespace-nowrap">
                    {pct(m.bigSmall.returnRatio, 1)} <span className="text-xs text-muted">· trúng {pct(m.bigSmall.winRate, 1)}</span>
                  </Td>
                </tr>
              ))}
            </Table>
            <p className="mt-3 text-xs text-muted">
              Lý thuyết cho mọi lựa chọn: “Chọn 1 số” hoàn trả {pct(q.data.theory.single.returnRatio, 2)} (trúng {pct(q.data.theory.single.winRate, 1)}); Lớn/Nhỏ hoàn trả {pct(q.data.theory.bigSmall.returnRatio, 2)} (trúng {pct(q.data.theory.bigSmall.winRate, 1)}). Để có lời cần hoàn trả trên 100%.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

function BetsTab() {
  const q = useApi<any>('/bingo18/rules');
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingBlock />;
  const d = q.data;
  return (
    <div className="space-y-5">
      <Notice tone="info">{d.note}</Notice>
      <Card title="Bảng cược, xác suất & tỷ lệ hoàn trả" subtitle={`Tính chính xác trên ${d.outcomes} kết quả đồng khả năng · cơ cấu giải theo vietlott.vn`}>
        <Table head={['Cách chơi', 'Xác suất trúng', 'Giải tối đa', 'Kỳ vọng / 10.000đ', 'Hoàn trả', 'Lợi thế nhà phát hành']}>
          {d.catalog.map((b: any) => (
            <tr key={b.label}>
              <Td className="whitespace-nowrap">
                {b.label} {b.label === d.bestReturn.label && <Badge tone="info">Hoàn trả cao nhất</Badge>}
              </Td>
              <Td className="measured whitespace-nowrap">
                {pct(b.winProbabilityValue, 2)} <span className="text-xs text-muted">({b.winProbability})</span>
              </Td>
              <Td className="measured">{vnd(b.maxPayout)}</Td>
              <Td className="measured">{vnd(b.expectedPayout)}</Td>
              <Td className="measured">{pct(b.returnRatio, 2)}</Td>
              <Td className="measured">{pct(b.houseEdge, 2)}</Td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-muted">
          Nguồn thể lệ: <a className="underline" href={d.game.rulesSourceUrl} target="_blank" rel="noreferrer">{d.game.rulesSourceUrl}</a>. {d.game.scheduleNote}
        </p>
      </Card>
    </div>
  );
}

function StatsTab() {
  const [last, setLast] = useState('10000');
  const [inc, setInc] = useState('false');
  const q = useApi<any>(`/bingo18/statistics?last=${last}&include_unverified=${inc}`);
  const faceOpt = useMemo(
    () =>
      q.data && {
        xAxis: { type: 'category', data: q.data.faces.map((f: any) => String(f.face)), ...axis() },
        yAxis: { type: 'value', scale: true, ...axis() },
        series: [
          {
            type: 'bar',
            data: q.data.faces.map((f: any) => f.count),
            itemStyle: { color: CHART.primary, borderRadius: [3, 3, 0, 0] },
            markLine: { symbol: 'none', lineStyle: { color: CHART.warn, type: 'dashed' }, label: { formatter: 'Kỳ vọng', color: CHART.warn, position: 'insideEndTop' }, data: [{ yAxis: q.data.faces[0].expected }] },
          },
        ],
      },
    [q.data],
  );
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3 lg:w-2/3">
        <Field label="Số kỳ gần nhất">
          <Select value={last} onChange={(e) => setLast(e.target.value)}>
            <option value="1000">1.000</option>
            <option value="10000">10.000</option>
            <option value="50000">50.000</option>
          </Select>
        </Field>
        <Field label="Dữ liệu">
          <Select value={inc} onChange={(e) => setInc(e.target.value)}>
            <option value="false">Chỉ đã xác minh</option>
            <option value="true">Gồm chưa xác minh</option>
          </Select>
        </Field>
      </div>
      {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {!q.data && !q.error && <LoadingBlock />}
      {q.data && q.data.draws === 0 && <EmptyState title="Chưa có dữ liệu phù hợp" description="Dữ liệu Bingo18 được đồng bộ tự động mỗi giờ; xác minh tại Data Center → Đồng bộ tự động, hoặc chọn “Gồm chưa xác minh”." />}
      {q.data && q.data.draws > 0 && (
        <>
          <Notice tone="info">
            {num(q.data.draws)} kỳ ({q.data.range.from} → {q.data.range.to}). {q.data.conclusion} {q.meta?.dataNotice}
          </Notice>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="χ² tần suất số 1–6" value={pv(q.data.facesChiSquare.pValue)} hint={`χ² = ${num(q.data.facesChiSquare.statistic, 2)}, df 5`} />
            <Kpi label="χ² phân phối tổng" value={pv(q.data.sumsChiSquare.pValue)} hint={`χ² = ${num(q.data.sumsChiSquare.statistic, 2)}, df 15`} />
            <Kpi label="Bộ ba trùng" value={pct(q.data.triples.rate, 2)} hint={`Lý thuyết 2,78% · ${q.data.triples.observed} lần`} />
            <Kpi label="Tương quan tổng kỳ liền kề" value={num(q.data.lag1SumCorrelation.r, 4)} hint={`p = ${pv(q.data.lag1SumCorrelation.pValue)}`} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Tần suất số 1–6">
              <Chart option={faceOpt} height={240} ariaLabel="Tần suất từng số 1 đến 6" />
            </Card>
            <Card title="Phân phối tổng: quan sát so với lý thuyết">
              <ObservedExpectedBar title="Phân phối tổng Bingo18" categories={q.data.sums.map((s: any) => ({ label: String(s.sum), observed: s.observed, expected: s.expected }))} />
            </Card>
            <Card title="Lớn / Nhỏ / Hoà">
              <Table head={['Loại', 'Quan sát', 'Tỷ lệ', 'Lý thuyết']}>
                {q.data.bigSmallDraw.map((r: any) => (
                  <tr key={r.label}>
                    <Td>{r.label}</Td>
                    <Td className="measured">{num(r.observed)}</Td>
                    <Td className="measured">{pct(r.share, 2)}</Td>
                    <Td className="measured text-muted">{pct(r.expectedShare, 2)}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
            <Card title="Ngụy biện con bạc: sau k kỳ “Lớn” liên tiếp" subtitle="Nếu các kỳ độc lập, tỷ lệ “Lớn” ở kỳ tiếp theo luôn ≈ 37,5% bất kể chuỗi trước đó.">
              <Table head={['Chuỗi Lớn', 'Số lần gặp', 'Kỳ sau là Lớn', 'Tỷ lệ']}>
                {q.data.bigAfterBigStreak.map((r: any) => (
                  <tr key={r.streak}>
                    <Td>{r.streak} kỳ</Td>
                    <Td className="measured">{num(r.total)}</Td>
                    <Td className="measured">{num(r.nextBig)}</Td>
                    <Td className="measured">{pct(r.rate, 1)}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

const BET_TYPES: Record<string, string> = { single: 'Chọn 1 số', pair: 'Hai số trùng', triple: 'Ba số trùng (đúng số)', any_triple: 'Ba số trùng bất kỳ', sum: 'Tổng', big: 'Lớn', small: 'Nhỏ', draw: 'Hoà' };

function SimulateTab() {
  const toast = useToast();
  const [f, setF] = useState({ type: 'single', value: '1', units: 1, draws: 30, sessions: 2000, stopLoss: '', seed: '' });
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<any | null>(null);
  const needsValue = ['single', 'pair', 'triple', 'sum'].includes(f.type);
  const run = async () => {
    setBusy(true);
    try {
      const res = await apiFetch('/bingo18/simulate', {
        body: { bets: [{ bet: { type: f.type, ...(needsValue ? { value: Number(f.value) } : {}) }, stakeUnits: f.units }], drawsPerSession: f.draws, sessions: f.sessions, stopLoss: f.stopLoss ? Number(f.stopLoss) : undefined, seed: f.seed || null },
      });
      setR(res.data);
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const histOpt = useMemo(
    () =>
      r && {
        xAxis: { type: 'category', data: r.histogram.map((h: any) => `${Math.round(h.from / 1000)}k`), ...axis({ axisLabel: { color: CHART.muted, fontSize: 10, rotate: 30 } }) },
        yAxis: { type: 'value', ...axis() },
        series: [{ type: 'bar', data: r.histogram.map((h: any) => ({ value: h.count, itemStyle: { color: h.to < 0 ? CHART.faint : CHART.accent } })) }],
      },
    [r],
  );
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <Card title="Mô phỏng phiên chơi">
        <div className="space-y-3">
          <Field label="Cách chơi">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, value: e.target.value === 'sum' ? '10' : '1' })}>
              {Object.entries(BET_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          {needsValue && (
            <Field label={f.type === 'sum' ? 'Tổng (3–18)' : 'Số (1–6)'}>
              <Input type="number" min={f.type === 'sum' ? 3 : 1} max={f.type === 'sum' ? 18 : 6} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lần tham gia/kỳ">
              <Input type="number" min={1} max={100} value={f.units} onChange={(e) => setF({ ...f, units: Number(e.target.value) })} />
            </Field>
            <Field label="Số kỳ/phiên">
              <Input type="number" min={1} max={200} value={f.draws} onChange={(e) => setF({ ...f, draws: Number(e.target.value) })} />
            </Field>
            <Field label="Số phiên mô phỏng">
              <Input type="number" min={10} max={20000} value={f.sessions} onChange={(e) => setF({ ...f, sessions: Number(e.target.value) })} />
            </Field>
            <Field label="Dừng khi lỗ (VND)">
              <Input type="number" min={0} value={f.stopLoss} onChange={(e) => setF({ ...f, stopLoss: e.target.value })} />
            </Field>
          </div>
          <Field label="Seed (tuỳ chọn)">
            <Input value={f.seed} onChange={(e) => setF({ ...f, seed: e.target.value })} />
          </Field>
          <Button variant="primary" className="w-full" loading={busy} onClick={run}>
            <Play className="h-4 w-4" aria-hidden /> Mô phỏng
          </Button>
        </div>
      </Card>
      <div className="min-w-0 space-y-5">
        {!r ? (
          <Card>
            <EmptyState title="Chưa có mô phỏng" description="Mô phỏng hàng nghìn phiên chơi để thấy phân phối thắng/thua thực tế của một kế hoạch cược." />
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Chi mỗi kỳ" value={vnd(r.costPerDraw)} hint={r.bets.map((b: any) => b.label).join(', ')} />
              <Kpi label="Kết quả TB / phiên" value={vnd(r.meanNet.mean)} hint={`KTC 95%: ${vnd(r.meanNet.low)} – ${vnd(r.meanNet.high)}`} tone="bad" />
              <Kpi label="Khả năng phiên có lãi" value={pct(r.probabilityProfit, 1)} />
              <Kpi label="Khả năng mất trên 50% vốn phiên" value={pct(r.probabilityLossOverHalf, 1)} tone="warn" />
            </div>
            <Card title="Phân phối kết quả ròng mỗi phiên" subtitle={`${num(r.sessions)} phiên, mỗi phiên ${r.drawsPerSession} kỳ. Seed ${r.seed}, lần chạy #${r.modelRunId}.`}>
              <Chart option={histOpt} height={260} ariaLabel="Phân phối kết quả ròng mỗi phiên chơi" />
              <p className="mt-2 text-xs text-muted">
                Phân vị 5%: <span className="measured">{vnd(r.percentiles.p5)}</span>. 25%: <span className="measured">{vnd(r.percentiles.p25)}</span>. Trung vị: <span className="measured">{vnd(r.percentiles.p50)}</span>. 75%: <span className="measured">{vnd(r.percentiles.p75)}</span>. 95%: <span className="measured">{vnd(r.percentiles.p95)}</span>.
                {r.stoppedEarly ? ` ${num(r.stoppedEarly)} phiên dừng vì chạm mức lỗ.` : ''}
              </p>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function ResultsTab() {
  const [page, setPage] = useState(1);
  const q = useApi<any[]>(`/bingo18/draws?page=${page}&page_size=30`);
  return (
    <Card title="Kết quả gần đây" subtitle={q.meta?.statusCounts ? `Đã xác minh ${num(q.meta.statusCounts.verified ?? 0)} · chưa xác minh ${num(q.meta.statusCounts.unverified ?? 0)} · từ ${q.meta.range.first ?? '—'} đến ${q.meta.range.last ?? '—'}` : undefined}>
      {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {!q.data && !q.error && <LoadingBlock />}
      {q.data?.length === 0 && <EmptyState title="Chưa có kết quả" description="Dữ liệu được đồng bộ tự động mỗi giờ từ nguồn mở." />}
      {!!q.data?.length && (
        <Table head={['Kỳ', 'Ngày', 'Kết quả', 'Tổng', 'Loại', 'Trạng thái']}>
          {q.data.map((d) => (
            <tr key={d.id}>
              <Td className="measured">#{d.draw_code}</Td>
              <Td className="text-xs text-muted">{d.draw_date}</Td>
              <Td>
                <div className="flex gap-1">
                  <Dice v={d.d1} />
                  <Dice v={d.d2} />
                  <Dice v={d.d3} />
                </div>
              </Td>
              <Td className="measured">{d.total}</Td>
              <Td>{d.total >= 12 ? 'Lớn' : d.total <= 9 ? 'Nhỏ' : 'Hoà'}</Td>
              <Td>{d.verification_status === 'verified' ? <Badge tone="good">Đã xác minh</Badge> : <Badge tone="warn">Chưa xác minh</Badge>}</Td>
            </tr>
          ))}
        </Table>
      )}
      <Pagination meta={q.meta as any} onPage={setPage} />
    </Card>
  );
}

export default function Bingo18() {
  const [tab, setTab] = useState<Tab>('today');
  return (
    <>
      <PageHeader title="Bingo18" description="3 số kết quả từ 1 đến 6, quay mỗi 6 phút. Trò chơi trả thưởng cố định: mọi cách chơi đều có tỷ lệ hoàn trả kỳ vọng khoảng 50 đến 57%." />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'today', label: 'Hôm nay' },
          { value: 'live', label: 'Phiên trực tiếp' },
          { value: 'strategy', label: 'Chiến thuật kiểm soát lỗ' },
          { value: 'models', label: 'Mô hình dự báo' },
          { value: 'bets', label: 'Bảng cược & xác suất' },
          { value: 'stats', label: 'Kiểm định ngẫu nhiên' },
          { value: 'simulate', label: 'Mô phỏng phiên chơi' },
          { value: 'results', label: 'Kết quả' },
        ]}
      />
      {tab === 'today' && <TodayTab />}
      {tab === 'live' && <BingoLiveTab />}
      {tab === 'strategy' && <BingoStrategyTab />}
      {tab === 'models' && <ModelsTab />}
      {tab === 'bets' && <BetsTab />}
      {tab === 'stats' && <StatsTab />}
      {tab === 'simulate' && <SimulateTab />}
      {tab === 'results' && <ResultsTab />}
    </>
  );
}
