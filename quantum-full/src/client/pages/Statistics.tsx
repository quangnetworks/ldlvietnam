import { useMemo, useState } from 'react';
import { useGame } from '../lib/game';
import { useApi } from '../lib/hooks';
import { num, pct, pv, two } from '../lib/format';
import { Badge, Balls, Card, EmptyState, ErrorState, Field, Kpi, LoadingBlock, Notice, PageHeader, Select, Table, Tabs, Td } from '../components/ui';
import { Chart, CHART, axis } from '../components/Chart';
import { FrequencyHeatmap, ObservedExpectedBar } from '../components/charts';

type Tab = 'frequency' | 'distribution' | 'combos' | 'rolling';

function SampleNotice({ meta, sample }: { meta?: Record<string, any>; sample?: any }) {
  if (!sample) return null;
  const tone = sample.reliability === 'good' ? 'good' : sample.reliability === 'moderate' ? 'info' : 'warn';
  return (
    <Notice tone={tone}>
      Cỡ mẫu: <b className="measured">{num(sample.draws)}</b> kỳ. Độ tin cậy: <b>{{ insufficient: 'không đủ', low: 'thấp', moderate: 'trung bình', good: 'tốt' }[sample.reliability as string]}</b>. {sample.note} {meta?.dataNotice}
    </Notice>
  );
}

function FrequencyTab({ path }: { path: string }) {
  const q = useApi<any>(`/statistics/frequency?${path}`);
  const d = q.data;
  const specialOption = useMemo(
    () =>
      d?.special && {
        xAxis: { type: 'category', data: d.special.numbers.map((n: any) => two(n.number)), ...axis() },
        yAxis: { type: 'value', ...axis() },
        series: [
          {
            type: 'bar',
            data: d.special.numbers.map((n: any) => n.count),
            itemStyle: { color: CHART.warn, borderRadius: [3, 3, 0, 0] },
            markLine: { symbol: 'none', lineStyle: { color: CHART.muted, type: 'dashed' }, data: [{ yAxis: d.special.numbers[0]?.expected ?? 0 }], label: { formatter: 'Kỳ vọng', color: CHART.muted } },
          },
        ],
      },
    [d],
  );
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!d) return <LoadingBlock rows={6} />;
  if (d.sample.draws === 0) return <EmptyState title="Chưa có dữ liệu phù hợp bộ lọc" description="Nhập và xác minh kết quả quay tại Data Center, hoặc bật “bao gồm dữ liệu chưa xác minh”." />;
  const sorted = [...d.numbers].sort((a: any, b: any) => Math.abs(b.zScore) - Math.abs(a.zScore));
  return (
    <div className="space-y-5">
      <SampleNotice meta={q.meta} sample={d.sample} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="χ² (hiệu chỉnh)" value={num(d.chiSquare.adjustedStatistic, 2)} hint={`df = ${d.chiSquare.df}`} />
        <Kpi label="p-value" value={pv(d.chiSquare.pValue)} tone={d.chiSquare.pValue < 0.05 ? 'warn' : 'default'} />
        <Kpi label="Độ lệch chuẩn quan sát" value={num(d.variance.observedSd, 2)} hint={`Lý thuyết: ${num(d.variance.expectedSd, 2)}`} />
        <Kpi label="Kỳ vọng mỗi số" value={num(d.numbers[0].expected, 1)} hint="n·K/N" />
      </div>
      <Notice tone="info">{d.chiSquare.conclusion} {d.disclaimer}</Notice>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Bản đồ nhiệt z-score" subtitle="Màu thể hiện độ lệch so với kỳ vọng, không phải xác suất tương lai.">
          <FrequencyHeatmap numbers={d.numbers} height={280} />
        </Card>
        <Card title="Các số lệch nhiều nhất" subtitle="|z| > 2 vẫn xảy ra ngẫu nhiên ở khoảng 5% số, nên cần hiệu chỉnh đa kiểm định.">
          <Table head={['Số', 'Lần', 'Kỳ vọng', 'Tỷ lệ', 'z', 'Kỳ chưa về']}>
            {sorted.slice(0, 10).map((n: any) => (
              <tr key={n.number}>
                <Td className="measured font-medium">{two(n.number)}</Td>
                <Td className="measured">{n.count}</Td>
                <Td className="measured text-muted">{num(n.expected, 1)}</Td>
                <Td className="measured text-muted">{pct(n.relative, 1)}</Td>
                <Td className="measured">{num(n.zScore, 2)}</Td>
                <Td className="measured text-muted">{n.lastSeenAgo ?? '—'}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      {d.special && (
        <Card title={`Tần suất số đặc biệt (${two(d.special.pool[0])}–${two(d.special.pool[1])})`} subtitle={`χ² = ${num(d.special.chiSquare.statistic, 2)}, df = ${d.special.chiSquare.df}, p = ${pv(d.special.chiSquare.pValue)}`}>
          <Chart option={specialOption} height={220} ariaLabel="Biểu đồ tần suất số đặc biệt" />
        </Card>
      )}
    </div>
  );
}

function DistributionTab({ path }: { path: string }) {
  const q = useApi<any>(`/statistics/distribution?${path}`);
  const d = q.data;
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!d) return <LoadingBlock rows={6} />;
  if (d.sample.draws === 0) return <EmptyState title="Chưa có dữ liệu phù hợp bộ lọc" />;
  return (
    <div className="space-y-5">
      <SampleNotice meta={q.meta} sample={d.sample} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Chẵn / lẻ" subtitle={`p = ${pv(d.oddEven.chiSquare.pValue)}`}>
          <ObservedExpectedBar title="Phân phối chẵn lẻ" categories={d.oddEven.categories} />
        </Card>
        <Card title="Thấp / cao" subtitle={`Thấp ≤ ${d.lowHigh.lowMax} · p = ${pv(d.lowHigh.chiSquare.pValue)}`}>
          <ObservedExpectedBar title="Phân phối thấp cao" categories={d.lowHigh.categories} />
        </Card>
        <Card title="Phân phối tổng các số" subtitle={`TB quan sát ${num(d.sum.observedMean, 1)} · kỳ vọng ${num(d.sum.expectedMean, 1)} ± ${num(d.sum.expectedSd, 1)} · p = ${pv(d.sum.pValueMean)}`}>
          <ObservedExpectedBar title="Histogram tổng các số" categories={d.sum.histogram.map((h: any) => ({ label: `${h.from}–${h.to}`, observed: h.observed, expected: h.expected }))} />
        </Card>
        <Card title="Số liên tiếp & khoảng cách">
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Kỳ có ≥1 cặp liên tiếp" value={pct(d.consecutive.observedShare, 1)} hint={`Lý thuyết ${pct(d.consecutive.expectedShare, 1)} · p = ${pv(d.consecutive.pValue)}`} />
            <Kpi label="Khoảng cách TB kỳ vọng" value={num(d.expectedMeanGap, 1)} hint="N/K kỳ giữa 2 lần xuất hiện" />
          </div>
          <div className="mt-4 max-h-64 overflow-auto">
            <Table head={['Số', 'Chưa về (kỳ)', 'Khoảng cách TB', 'Lớn nhất']}>
              {[...d.gaps].sort((a: any, b: any) => (b.currentGap ?? -1) - (a.currentGap ?? -1)).slice(0, 12).map((g: any) => (
                <tr key={g.number}>
                  <Td className="measured font-medium">{two(g.number)}</Td>
                  <Td className="measured">{g.currentGap ?? '—'}</Td>
                  <Td className="measured text-muted">{g.meanGap == null ? '—' : num(g.meanGap, 1)}</Td>
                  <Td className="measured text-muted">{g.maxGap}</Td>
                </tr>
              ))}
            </Table>
          </div>
          <p className="mt-2 text-xs text-muted">Số “lâu chưa về” không có xác suất cao hơn ở kỳ tới (ngụy biện con bạc).</p>
        </Card>
      </div>
    </div>
  );
}

function CombosTab({ path, hasTriplets }: { path: string; hasTriplets: boolean }) {
  const pairs = useApi<any>(`/statistics/pairs?${path}&top=20`);
  const triplets = useApi<any>(hasTriplets ? `/statistics/triplets?${path}&top=20` : null);
  const render = (q: typeof pairs, title: string) => (
    <Card title={title} subtitle={q.data ? `${num(q.data.observedDistinct)}/${num(q.data.totalCombos)} tổ hợp đã xuất hiện · kỳ vọng mỗi tổ hợp ${num(q.data.expectedPerCombo, 3)}` : undefined}>
      {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {!q.data && !q.error && <LoadingBlock />}
      {q.data && (
        <>
          <Notice tone={q.data.significantAfterFdr ? 'warn' : 'info'}>{q.data.note}</Notice>
          <div className="mt-3">
            <Table head={['Tổ hợp', 'Lần', 'p (Poisson)', 'q (FDR)']}>
              {q.data.top.map((r: any) => (
                <tr key={r.numbers.join('-')}>
                  <Td>
                    <Balls main={r.numbers} size="sm" />
                  </Td>
                  <Td className="measured">{r.count}</Td>
                  <Td className="measured text-muted">{pv(r.pValue)}</Td>
                  <Td className="measured">{r.qValue < 0.05 ? <Badge tone="warn">{pv(r.qValue)}</Badge> : pv(r.qValue)}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </Card>
  );
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {render(pairs, 'Cặp số xuất hiện nhiều nhất')}
      {hasTriplets && render(triplets, 'Bộ ba xuất hiện nhiều nhất')}
    </div>
  );
}

function RollingTab({ path }: { path: string }) {
  const q = useApi<any>(`/statistics/frequency?${path}`);
  const option = useMemo(() => {
    if (!q.data) return null;
    const r = q.data.rolling;
    const labels = r[0].numbers.map((n: any) => two(n.number));
    const colors = [CHART.primary, CHART.accent, CHART.warn];
    return {
      legend: { data: r.map((w: any) => `${w.window} kỳ (${w.drawsUsed})`), textStyle: { color: CHART.muted } },
      xAxis: { type: 'category', data: labels, ...axis({ axisLabel: { color: CHART.muted, fontSize: 9 } }) },
      yAxis: { type: 'value', name: 'z-score', ...axis() },
      dataZoom: [{ type: 'inside' }],
      series: r.map((w: any, i: number) => ({ name: `${w.window} kỳ (${w.drawsUsed})`, type: 'bar', data: w.numbers.map((n: any) => Number(n.zScore.toFixed(2))), itemStyle: { color: colors[i] } })),
    };
  }, [q.data]);
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingBlock />;
  if (q.data.sample.draws === 0) return <EmptyState title="Chưa có dữ liệu" />;
  return (
    <Card title="Cửa sổ trượt 30 / 60 / 100 kỳ" subtitle="z-score của từng số trong mỗi cửa sổ. Cửa sổ càng ngắn, nhiễu ngẫu nhiên càng lớn.">
      <Chart option={option!} height={320} ariaLabel="So sánh z-score theo cửa sổ trượt" />
    </Card>
  );
}

export default function Statistics() {
  const { code, game } = useGame();
  const [tab, setTab] = useState<Tab>('frequency');
  const [unverified, setUnverified] = useState('false');
  const [last, setLast] = useState('');
  const path = `game=${code}&include_unverified=${unverified}${last ? `&last=${last}` : ''}`;
  return (
    <>
      <PageHeader title="Statistical Intelligence" description="Thống kê mô tả và kiểm định giả thuyết H0 “kỳ quay ngẫu nhiên đồng đều”. Luôn hiển thị cỡ mẫu và mức tin cậy." />
      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:w-2/3">
        <Field label="Dữ liệu">
          <Select value={unverified} onChange={(e) => setUnverified(e.target.value)}>
            <option value="false">Chỉ dữ liệu đã xác minh</option>
            <option value="true">Bao gồm chưa xác minh</option>
          </Select>
        </Field>
        <Field label="Phạm vi">
          <Select value={last} onChange={(e) => setLast(e.target.value)}>
            <option value="">Toàn bộ lịch sử</option>
            <option value="100">100 kỳ gần nhất</option>
            <option value="300">300 kỳ gần nhất</option>
            <option value="1000">1.000 kỳ gần nhất</option>
          </Select>
        </Field>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'frequency', label: 'Tần suất' },
          { value: 'distribution', label: 'Phân phối' },
          { value: 'combos', label: 'Cặp & bộ ba' },
          { value: 'rolling', label: 'Cửa sổ trượt' },
        ]}
      />
      {tab === 'frequency' && <FrequencyTab path={path} />}
      {tab === 'distribution' && <DistributionTab path={path} />}
      {tab === 'combos' && <CombosTab path={path} hasTriplets={(game?.mainPicks ?? 0) >= 3} />}
      {tab === 'rolling' && <RollingTab path={path} />}
    </>
  );
}
