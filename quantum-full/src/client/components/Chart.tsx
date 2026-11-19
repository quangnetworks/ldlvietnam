import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent, DataZoomComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([BarChart, LineChart, HeatmapChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, MarkLineComponent, DataZoomComponent, CanvasRenderer]);

export const CHART = {
  primary: '#3B82F6',
  accent: '#22C55E',
  warn: '#F59E0B',
  muted: '#94A3B8',
  grid: '#1F2A3D',
  text: '#CBD5E1',
};

export const baseOption: EChartsCoreOption = {
  backgroundColor: 'transparent',
  textStyle: { color: CHART.text, fontFamily: 'Inter, system-ui, sans-serif' },
  grid: { left: 44, right: 16, top: 28, bottom: 36 },
  tooltip: { trigger: 'axis', backgroundColor: '#172033', borderColor: '#2A3650', textStyle: { color: '#F8FAFC' } },
  legend: { textStyle: { color: CHART.muted }, top: 0 },
};

export const axis = (extra: Record<string, unknown> = {}) => ({
  axisLine: { lineStyle: { color: CHART.grid } },
  axisLabel: { color: CHART.muted, fontSize: 11 },
  splitLine: { lineStyle: { color: CHART.grid } },
  ...extra,
});

export function Chart({ option, height = 260, ariaLabel }: { option: EChartsCoreOption; height?: number; ariaLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    inst.current = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    const ro = new ResizeObserver(() => inst.current?.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      inst.current?.dispose();
    };
  }, []);
  useEffect(() => {
    inst.current?.setOption({ ...baseOption, animation: false, ...option }, true);
  }, [option]);
  return <div ref={ref} style={{ height }} role="img" aria-label={ariaLabel} className="w-full" />;
}
