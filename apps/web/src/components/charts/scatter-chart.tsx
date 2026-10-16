import { useState } from "react";
import { InfoTip } from "@/components/info-tip";
import type { GlossaryKey } from "@/lib/glossary";
import { CHART } from "@/lib/chart-colors";
import { defineMessages, useMessages } from "@/lib/i18n";
import { niceMax, quarterTicks, tickLabel, withUnit } from "@/components/charts/scale";

/**
 * One measure against another, one dot per observation — throughput against latency, to see
 * where a service stops absorbing load. A dot is 8 px with a surface ring, so overlapping dots
 * stay countable; an optional vertical marker points at a value of x (the estimated knee).
 */
export type ScatterPoint = { x: number; y: number; group: string; note?: string };
export type ScatterGroup = { key: string; label: string; color: string };

const MESSAGES = defineMessages({
  es: { empty: "Sin datos todavía", offScale: "fuera de escala" },
  en: { empty: "No data yet", offScale: "off scale" },
});

const WIDTH = 640;
const HEIGHT = 230;
const PAD = { top: 14, right: 14, bottom: 36, left: 46 };

export function ScatterChart({ title, info, points, groups, xLabel, yLabel, xUnit, yUnit, reference, marker, emptyLabel }: {
  title: string; info?: GlossaryKey; points: ScatterPoint[]; groups: ScatterGroup[]; xLabel: string; yLabel: string; xUnit: string; yUnit: string;
  reference?: { label: string; value: number } | null; marker?: { label: string; value: number } | null; emptyLabel?: string;
}) {
  const t = useMessages(MESSAGES);
  const [hover, setHover] = useState<number | null>(null);
  const maxX = niceMax(Math.max(...points.map((point) => point.x), marker?.value ?? 0, 1) * 1.05);
  const dataMaxY = Math.max(...points.map((point) => point.y), 0);
  const showReference = reference != null && reference.value <= Math.max(dataMaxY, 1) * 3;
  const maxY = niceMax(Math.max(dataMaxY, showReference ? reference.value : 0, 1) * 1.08);
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const sx = (value: number) => PAD.left + (value / maxX) * plotW;
  const sy = (value: number) => PAD.top + plotH - (value / maxY) * plotH;
  const colorOf = (key: string) => groups.find((group) => group.key === key)?.color ?? CHART.muted;
  const onMove = (event: React.MouseEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = PAD.left + ((event.clientX - box.left) / box.width) * plotW;
    const py = PAD.top + ((event.clientY - box.top) / box.height) * plotH;
    let best: number | null = null;
    let distance = 18 ** 2;
    points.forEach((point, index) => { const d = (sx(point.x) - px) ** 2 + (sy(point.y) - py) ** 2; if (d < distance) { distance = d; best = index; } });
    setHover(best);
  };
  const active = hover != null ? points[hover] : null;

  return <figure className="min-w-0">
    <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-1 text-xs font-semibold text-slate-700">{title}{info && <InfoTip id={info} size="xs"/>}</span>
      <span className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
        {groups.length > 1 && groups.map((group) => <span key={group.key} className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-full" style={{ background: group.color }}/>{group.label}</span>)}
        {reference && <span>{reference.label}{!showReference && ` · ${t.offScale}`}</span>}
      </span>
    </figcaption>
    <div className="relative">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img" aria-label={title}>
        {quarterTicks(maxY).map((tick) => <g key={`y${tick}`}><line x1={PAD.left} x2={WIDTH - PAD.right} y1={sy(tick)} y2={sy(tick)} style={{ stroke: CHART.grid }} strokeWidth="1"/><text x={PAD.left - 6} y={sy(tick) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">{tickLabel(tick, maxY)}</text></g>)}
        {quarterTicks(maxX).map((tick) => <text key={`x${tick}`} x={sx(tick)} y={PAD.top + plotH + 14} textAnchor="middle" className="fill-slate-400 text-[10px]">{tickLabel(tick, maxX)}</text>)}
        <text x={PAD.left + plotW / 2} y={HEIGHT - 4} textAnchor="middle" className="fill-slate-500 text-[10px]">{xLabel} ({xUnit})</text>
        <text x={10} y={PAD.top + plotH / 2} textAnchor="middle" transform={`rotate(-90 10 ${PAD.top + plotH / 2})`} className="fill-slate-500 text-[10px]">{yLabel} ({yUnit})</text>
        {reference && showReference && <line x1={PAD.left} x2={WIDTH - PAD.right} y1={sy(reference.value)} y2={sy(reference.value)} style={{ stroke: CHART.reference }} strokeWidth="1" strokeDasharray="3 3"/>}
        {marker && <g><line x1={sx(marker.value)} x2={sx(marker.value)} y1={PAD.top} y2={PAD.top + plotH} style={{ stroke: CHART.rose }} strokeWidth="1" strokeDasharray="4 3"/><text x={Math.min(sx(marker.value) + 4, WIDTH - PAD.right - 4)} y={PAD.top + 10} textAnchor={sx(marker.value) > WIDTH * 0.75 ? "end" : "start"} className="fill-rose-600 text-[10px] font-semibold">{marker.label}</text></g>}
        {!points.length && <text x={WIDTH / 2} y={HEIGHT / 2} textAnchor="middle" className="fill-slate-400 text-xs">{emptyLabel ?? t.empty}</text>}
        {points.map((point, index) => <circle key={index} cx={sx(point.x)} cy={sy(point.y)} r={hover === index ? 6 : 4} style={{ fill: colorOf(point.group), stroke: CHART.surface }} strokeWidth="2" fillOpacity={0.85}/>)}
        <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)}/>
      </svg>
      {active && <div className="pointer-events-none absolute top-1 z-10 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[10px] shadow-sm" style={{ left: `${Math.min(66, (sx(active.x) / WIDTH) * 100)}%` }}>
        {active.note && <p className="font-semibold text-slate-700">{active.note}</p>}
        <p className="text-slate-600">{xLabel}: <span className="font-mono">{withUnit(active.x, xUnit)}</span></p>
        <p className="text-slate-600">{yLabel}: <span className="font-mono">{withUnit(active.y, yUnit)}</span></p>
        {groups.length > 1 && <p className="text-slate-500">{groups.find((group) => group.key === active.group)?.label}</p>}
      </div>}
    </div>
  </figure>;
}
