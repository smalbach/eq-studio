import { useMemo, useState } from "react";
import { InfoTip } from "@/components/info-tip";
import type { GlossaryKey } from "@/lib/glossary";
import { CHART } from "@/lib/chart-colors";
import { defineMessages, useMessages } from "@/lib/i18n";
import { logRatio, logTicks, niceMax, quarterTicks, tickLabel, withUnit } from "@/components/charts/scale";

/**
 * One y-axis, a few series over time, a crosshair and a tooltip — the two load-test charts.
 *
 * One axis on purpose: req/s and milliseconds are two measures of different scale, and putting
 * them on two y-axes is how a chart invents a correlation. They are two charts instead.
 *
 * Series colors are fixed by role (`lib/chart-colors.ts`, one validated set per theme);
 * a dashed stroke is the second encoding, so "requested" and "delivered" do not rely on hue.
 */
export type ChartSeries = { key: string; label: string; color: string; dashed?: boolean; values: (number | null)[] };
export type ChartReference = { label: string; value: number };
/** A moment worth pointing at on the x axis — the first sign of degradation, the end of a peak. */
export type ChartMarker = { x: number; label: string };

const MESSAGES = defineMessages({
  es: { empty: "Sin datos todavía", offScale: "fuera de escala" },
  en: { empty: "No data yet", offScale: "off scale" },
});

const WIDTH = 640;
const HEIGHT = 200;
const PAD = { top: 12, right: 12, bottom: 24, left: 44 };

export function LineChart({ title, unit, x, series, reference, emptyLabel, xFormat = (value: number) => `${value} s`, minX = 0, info, ceiling, markers = [], log = false }: { info?: GlossaryKey; ceiling?: number; markers?: ChartMarker[]; log?: boolean; title: string; unit: string; x: number[]; series: ChartSeries[]; reference?: ChartReference | null; emptyLabel?: string; xFormat?: (value: number) => string; minX?: number }) {
  const t = useMessages(MESSAGES);
  const [hover, setHover] = useState<number | null>(null);
  const { maxY, maxX, ticks, showReference } = useMemo(() => {
    const values = series.flatMap((item) => item.values.filter((value): value is number => value != null));
    const dataMax = Math.max(...values, 0);
    // A budget far above the data would flatten it into the floor — 5 ms drawn under a 70 ms
    // line reads as "nothing". The line is drawn only when it is within reach of the data;
    // otherwise the legend says it is off the scale.
    const showReference = reference != null && (dataMax === 0 || reference.value <= dataMax * 3);
    // A bounded measure (a success rate) never draws an axis past its bound.
    // A log axis (ratios to a baseline) keeps a ×1.5 onset readable next to a ×80 collapse.
    if (log) { const logged = logTicks(Math.max(showReference ? reference.value : 0, dataMax)); return { maxY: logged.at(-1)!, showReference, maxX: Math.max(1, x.at(-1) ?? 1), ticks: logged }; }
    const top = Math.min(ceiling ?? Infinity, niceMax(Math.max(showReference ? reference.value : 0, dataMax) * 1.1));
    return { maxY: top, showReference, maxX: Math.max(1, x.at(-1) ?? 1), ticks: quarterTicks(top) };
  }, [series, reference, x, ceiling, log]);
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const sx = (value: number) => PAD.left + ((value - minX) / Math.max(1, maxX - minX)) * plotW;
  const sy = (value: number) => PAD.top + plotH - (log ? logRatio(value, maxY) : value / maxY) * plotH;
  const path = (values: (number | null)[]) => values.reduce((d, value, index) => value == null ? d : `${d}${d && values[index - 1] != null ? "L" : "M"}${sx(x[index]).toFixed(1)},${sy(value).toFixed(1)}`, "");
  const onMove = (event: React.MouseEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    const target = minX + ratio * (maxX - minX);
    let best = 0;
    x.forEach((value, index) => { if (Math.abs(value - target) < Math.abs(x[best] - target)) best = index; });
    setHover(x.length ? best : null);
  };
  const format = (value: number | null) => withUnit(value, unit);

  return <figure className="min-w-0">
    <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-1 text-xs font-semibold text-slate-700">{title}{info && <InfoTip id={info} size="xs"/>}{info && <InfoTip id="chartPoint" size="xs"/>}</span>
      <span className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
        {series.map((item) => <span key={item.key} className="flex items-center gap-1.5"><svg width="16" height="6" aria-hidden><line x1="0" y1="3" x2="16" y2="3" style={{ stroke: item.color }} strokeWidth="2" strokeDasharray={item.dashed ? "4 3" : undefined}/></svg>{item.label}</span>)}
        {reference && <span className="flex items-center gap-1.5">{showReference && <svg width="16" height="6" aria-hidden><line x1="0" y1="3" x2="16" y2="3" style={{ stroke: CHART.reference }} strokeWidth="1" strokeDasharray="2 2"/></svg>}{reference.label}{!showReference && ` · ${t.offScale}`}</span>}
      </span>
    </figcaption>
    <div className="relative">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img" aria-label={title}>
        {ticks.map((tick) => <g key={tick}><line x1={PAD.left} x2={WIDTH - PAD.right} y1={sy(tick)} y2={sy(tick)} style={{ stroke: CHART.grid }} strokeWidth="1"/><text x={PAD.left - 6} y={sy(tick) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">{log ? String(tick) : tickLabel(tick, maxY)}</text></g>)}
        <text x={PAD.left} y={HEIGHT - 6} className="fill-slate-400 text-[10px]">{xFormat(minX)}</text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end" className="fill-slate-400 text-[10px]">{xFormat(maxX)}</text>
        {reference && showReference && <line x1={PAD.left} x2={WIDTH - PAD.right} y1={sy(reference.value)} y2={sy(reference.value)} style={{ stroke: CHART.reference }} strokeWidth="1" strokeDasharray="2 2"/>}
        {markers.filter((marker) => marker.x >= minX && marker.x <= maxX).map((marker, index) => { const at = sx(marker.x); const right = at > WIDTH * 0.7; return <g key={`${marker.x}:${index}`}><line x1={at} x2={at} y1={PAD.top} y2={PAD.top + plotH} style={{ stroke: CHART.rose }} strokeWidth="1" strokeDasharray="4 3"/><text x={right ? at - 4 : at + 4} y={PAD.top + 10 + index * 12} textAnchor={right ? "end" : "start"} className="fill-rose-600 text-[10px] font-semibold">{marker.label}</text></g>; })}
        {x.length === 0 && <text x={WIDTH / 2} y={HEIGHT / 2} textAnchor="middle" className="fill-slate-400 text-xs">{emptyLabel ?? t.empty}</text>}
        {series.map((item) => <path key={item.key} d={path(item.values)} fill="none" style={{ stroke: item.color }} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={item.dashed ? "5 4" : undefined}/>)}
        {hover != null && <g>
          <line x1={sx(x[hover])} x2={sx(x[hover])} y1={PAD.top} y2={PAD.top + plotH} style={{ stroke: CHART.muted }} strokeWidth="1"/>
          {series.map((item) => item.values[hover] != null && <circle key={item.key} cx={sx(x[hover])} cy={sy(item.values[hover] as number)} r="4" style={{ fill: item.color, stroke: CHART.surface }} strokeWidth="2"/>)}
        </g>}
        <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)}/>
      </svg>
      {hover != null && <div className="pointer-events-none absolute top-1 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[10px] shadow-sm" style={{ left: `${Math.min(70, (sx(x[hover]) / WIDTH) * 100)}%` }}>
        <p className="font-semibold text-slate-700">{xFormat(x[hover])}</p>
        {series.map((item) => <p key={item.key} className="flex items-center gap-1.5 text-slate-600"><span className="inline-block size-2 rounded-full" style={{ background: item.color }}/>{item.label}: <span className="font-mono">{format(item.values[hover])}</span></p>)}
      </div>}
    </div>
  </figure>;
}
