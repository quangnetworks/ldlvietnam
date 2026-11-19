import { useMemo } from 'react';
import { Chart, CHART, axis } from './Chart';
import { two } from '../lib/format';

/** Heatmap tần suất: lưới 10 cột, màu theo z-score (lệch so với kỳ vọng) — không phải "độ nóng" dự báo. */
export function FrequencyHeatmap({ numbers, height = 240 }: { numbers: { number: number; count: number; expected: number; zScore: number }[]; height?: number }) {
  const option = useMemo(() => {
    const cols = 10;
    const rows = Math.ceil(numbers.length / cols);
    const data = numbers.map((n, i) => [i % cols, rows - 1 - Math.floor(i / cols), Number(n.zScore.toFixed(2)), n.number, n.count, n.expected]);
    return {
      tooltip: {
        trigger: 'item',
        formatter: (p: { data: number[] }) => `Số <b>${two(p.data[3])}</b><br/>Xuất hiện: ${p.data[4]}<br/>Kỳ vọng: ${p.data[5].toFixed(1)}<br/>z = ${p.data[2]}`,
      },
      grid: { left: 8, right: 8, top: 8, bottom: 48 },
      xAxis: { type: 'category', show: false, data: Array.from({ length: cols }, (_, i) => i) },
      yAxis: { type: 'category', show: false, data: Array.from({ length: rows }, (_, i) => i) },
      visualMap: { dimension: 2, min: -3, max: 3, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 120, text: ['z +3', 'z −3'], textStyle: { color: CHART.muted }, inRange: { color: ['#1e3a8a', '#172033', '#14532d'] } },
      series: [
        {
          type: 'heatmap',
          data,
          label: { show: true, color: '#E2E8F0', fontSize: 11, formatter: (p: { data: number[] }) => two(p.data[3]) },
          itemStyle: { borderColor: '#080D19', borderWidth: 2, borderRadius: 4 },
        },
      ],
    };
  }, [numbers]);
  return <Chart option={option} height={height} ariaLabel="Bản đồ nhiệt tần suất xuất hiện từng số so với kỳ vọng" />;
}

export function ObservedExpectedBar({ categories, height = 240, title }: { categories: { label: string; observed: number; expected: number }[]; height?: number; title: string }) {
  const option = useMemo(
    () => ({
      legend: { data: ['Quan sát', 'Kỳ vọng (H0)'], textStyle: { color: CHART.muted }, top: 0 },
      xAxis: { type: 'category', data: categories.map((c) => c.label), ...axis({ axisLabel: { color: CHART.muted, fontSize: 10, interval: 0, rotate: categories.length > 6 ? 30 : 0 } }) },
      yAxis: { type: 'value', ...axis() },
      grid: { left: 44, right: 12, top: 32, bottom: categories.length > 6 ? 64 : 36 },
      series: [
        { name: 'Quan sát', type: 'bar', data: categories.map((c) => c.observed), itemStyle: { color: CHART.primary, borderRadius: [3, 3, 0, 0] } },
        { name: 'Kỳ vọng (H0)', type: 'bar', data: categories.map((c) => Number(c.expected.toFixed(2))), itemStyle: { color: '#475569', borderRadius: [3, 3, 0, 0] } },
      ],
    }),
    [categories],
  );
  return <Chart option={option} height={height} ariaLabel={title} />;
}

export function SumTrend({ series, expectedMean, height = 240 }: { series: { drawCode: string; sum: number }[]; expectedMean: number; height?: number }) {
  const option = useMemo(
    () => ({
      xAxis: { type: 'category', data: series.map((s) => s.drawCode), ...axis({ axisLabel: { color: CHART.muted, fontSize: 10 } }) },
      yAxis: { type: 'value', scale: true, ...axis() },
      series: [
        {
          type: 'line',
          name: 'Tổng các số',
          data: series.map((s) => s.sum),
          showSymbol: false,
          lineStyle: { color: CHART.primary, width: 1.5 },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: CHART.warn, type: 'dashed' }, label: { color: CHART.warn, formatter: 'Kỳ vọng', position: 'insideEndTop' }, data: [{ yAxis: expectedMean }] },
        },
      ],
    }),
    [series, expectedMean],
  );
  return <Chart option={option} height={height} ariaLabel="Xu hướng tổng các số theo kỳ quay" />;
}
