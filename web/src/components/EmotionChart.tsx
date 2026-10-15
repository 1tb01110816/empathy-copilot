import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import EChart from './EChart';
import type { EmotionCurve } from '../types';

const LEVEL_COLOR = (v: number) => (v >= 82 ? '#e11d48' : v >= 62 ? '#f97316' : v >= 45 ? '#f59e0b' : v >= 30 ? '#10b981' : '#0ea5e9');

export default function EmotionChart({ curve, height = 150 }: { curve: EmotionCurve; height?: number }) {
  const option = useMemo<EChartsOption>(() => {
    const pts = curve?.points || [];
    const xs = pts.map((p) => `#${p.seq}`);
    const ys = pts.map((p) => Math.round(p.value * 10) / 10);
    const color = LEVEL_COLOR(curve?.current?.value ?? ys[ys.length - 1] ?? 30);
    const markPoint = curve?.peak
      ? {
          data: [{ type: 'max' as const, name: '峰值' }],
          symbolSize: 44,
          itemStyle: { color: '#fff', borderColor: color, borderWidth: 2 },
          label: { color: '#334155', fontSize: 10, formatter: (p: unknown) => `${Math.round(Number((p as { value?: number })?.value ?? 0))}` },
        }
      : undefined;
    return {
      grid: { left: 6, right: 10, top: 18, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter: (ps: unknown) => {
          const arr = Array.isArray(ps) ? (ps as Array<{ dataIndex: number }>) : [];
          const i = arr[0]?.dataIndex ?? 0;
          const p = pts[i];
          if (!p) return '';
          return `#${p.seq} 情绪 ${Math.round(p.value)}<br/>${(p.hits || []).join('、') || '无明显情绪词'}`;
        },
      },
      xAxis: {
        type: 'category',
        data: xs,
        axisLabel: { fontSize: 9, color: '#94a3b8', interval: Math.max(0, Math.ceil(xs.length / 8) - 1) },
        axisLine: { lineStyle: { color: '#e2e8f0' } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        splitNumber: 4,
        axisLabel: { fontSize: 9, color: '#94a3b8' },
        splitLine: { lineStyle: { color: '#f1f5f9' } },
      },
      series: [
        {
          type: 'line',
          data: ys,
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { width: 2.5, color },
          itemStyle: { color },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${color}55` },
                { offset: 1, color: `${color}05` },
              ],
            },
          },
          markPoint,
          markLine: {
            silent: true,
            symbol: 'none',
            label: { show: false },
            lineStyle: { type: 'dashed', color: '#cbd5e1', width: 1 },
            data: [{ yAxis: 45 }, { yAxis: 62 }, { yAxis: 82 }],
          },
          markArea: {
            silent: true,
            itemStyle: { color: 'rgba(244,63,94,0.05)' },
            data: [[{ yAxis: 82 }, { yAxis: 100 }]] as unknown as never,
          },
        },
      ],
    };
  }, [curve]);

  return <EChart option={option} height={height} />;
}
