import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent, DataZoomComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([BarChart, LineChart, HeatmapChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, MarkLineComponent, DataZoomComponent, CanvasRenderer]);

/**
 * Chart colours come from the Console tokens (styles.css @theme). ECharts paints on canvas and cannot read CSS custom
 * properties, so each token is resolved once to sRGB by painting it into a 1px canvas.
 */
function token(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();
  if (!v) return fallback;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return fallback;
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return fallback;
  }
}

/** cool = what the instrument measured (the series); amber = the reference a person set (expected, threshold); ok/bad = status. */
export const CHART = {
  primary: token('cool', 'rgb(110, 176, 240)'),
  accent: token('ok', 'rgb(90, 200, 120)'),
  warn: token('accent', 'rgb(240, 180, 60)'),
  bad: token('bad', 'rgb(235, 110, 100)'),
  muted: token('muted', 'rgb(160, 166, 176)'),
  grid: token('rule', 'rgb(52, 58, 68)'),
  faint: token('rule-2', 'rgb(80, 88, 100)'),
  text: token('ink-2', 'rgb(205, 210, 216)'),
  ink: token('ink', 'rgb(240, 242, 245)'),
  paper: token('paper', 'rgb(22, 25, 30)'),
  panel: token('paper-2', 'rgb(30, 33, 39)'),
  coolSoft: token('cool-soft', 'rgb(30, 45, 66)'),
  okSoft: token('ok-soft', 'rgb(28, 44, 32)'),
};

export const baseOption: EChartsCoreOption = {
  backgroundColor: 'transparent',
  textStyle: { color: CHART.text, fontFamily: "'IBM Plex Mono', ui-monospace, monospace" },
  grid: { left: 44, right: 16, top: 28, bottom: 36 },
  tooltip: { trigger: 'axis', backgroundColor: CHART.panel, borderColor: CHART.faint, textStyle: { color: CHART.ink, fontFamily: "'Be Vietnam Pro', system-ui, sans-serif" } },
  legend: { textStyle: { color: CHART.muted, fontFamily: "'Be Vietnam Pro', system-ui, sans-serif" }, top: 0 },
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
