import { useMemo, useState } from "react";
import { InfoTip } from "@/components/info-tip";
import type { GlossaryKey } from "@/lib/glossary";
import { CHART } from "@/lib/chart-colors";
import { defineMessages, useMessages } from "@/lib/i18n";
import { LOG_FLOOR, logRatio, logTicks, niceMax, quarterTicks, tickLabel, withUnit } from "@/components/charts/scale";

/**
 * Vertical columns over categories: a histogram, a count per run or per day. With several
 * series the columns stack, bottom to top in the order given, separated by a 2 px gap so the
 * segments never read as one block. Hovering a column shows every value of it.
 */
export type ColumnSeries = { key: string; label: string; color: string };

const MESSAGES = defineMessages({
  es: { empty: "Sin datos todavía", total: "Total" },
  en: { empty: "No data yet", total: "Total" },
});

const WIDTH = 640;
const HEIGHT = 190;
const PAD = { top: 12, right: 8, bottom: 30, left: 40 };

export function ColumnChart({ title, info, unit = "", labels, series, values, reference, onSelect, emptyLabel, maxLabels = 10, log = false }: {
  title: string; info?: GlossaryKey; unit?: string; labels: string[]; series: ColumnSeries[];
  /** One array per series key, aligned with `labels`. */
  values: Record<string, number[]>;
  reference?: { label: string; value: number } | null; onSelect?: (index: number) => void; emptyLabel?: string; maxLabels?: number;
  /** Log axis from ×0.5, for ratios; only with one series (log columns do not stack). */
  log?: boolean;
}) {
  const t = useMessages(MESSAGES);
  const [hover, setHover] = useState<number | null>(null);
  const totals = useMemo(() => labels.map((_, index) => series.reduce((sum, item) => sum + (values[item.key]?.[index] ?? 0), 0)), [labels, series, values]);
  const dataTop = Math.max(...totals, reference?.value ?? 0, 0);
  const ticks = log ? logTicks(dataTop) : quarterTicks(niceMax(dataTop * 1.08));
  const top = ticks.at(-1)!;
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = labels.length ? plotW / labels.length : plotW;
  const barW = Math.max(2, Math.min(36, slot * 0.72));
  const sy = (value: number) => PAD.top + plotH - (log ? logRatio(value, top) : value / top) * plotH;
  const every = Math.max(1, Math.ceil(labels.length / maxLabels));
  const hovered = hover != null ? labels[hover] : null;

  return <figure className="min-w-0">
    <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-1 text-xs font-semibold text-slate-700">{title}{info && <InfoTip id={info} size="xs"/>}</span>
      {series.length > 1 && <span className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">{series.map((item) => <span key={item.key} className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: item.color }}/>{item.label}</span>)}</span>}
    </figcaption>
    <div className="relative">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
        {ticks.map((tick) => <g key={tick}><line x1={PAD.left} x2={WIDTH - PAD.right} y1={sy(tick)} y2={sy(tick)} style={{ stroke: CHART.grid }} strokeWidth="1"/><text x={PAD.left - 6} y={sy(tick) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">{log ? String(tick) : tickLabel(tick, top)}</text></g>)}
        {reference && <g><line x1={PAD.left} x2={WIDTH - PAD.right} y1={sy(reference.value)} y2={sy(reference.value)} style={{ stroke: CHART.reference }} strokeWidth="1" strokeDasharray="3 3"/><text x={PAD.left + 4} y={sy(reference.value) - 4} className="fill-slate-400 text-[10px]">{reference.label}</text></g>}
        {!labels.length && <text x={WIDTH / 2} y={HEIGHT / 2} textAnchor="middle" className="fill-slate-400 text-xs">{emptyLabel ?? t.empty}</text>}
        {labels.map((label, index) => {
          const x = PAD.left + slot * index + (slot - barW) / 2;
          let base = 0;
          return <g key={`${label}:${index}`}>
            {hover === index && <rect x={PAD.left + slot * index} y={PAD.top} width={slot} height={plotH} className="fill-slate-100"/>}
            {series.map((item) => {
              const value = values[item.key]?.[index] ?? 0;
              if (value <= 0) return null;
              const y1 = sy(base + value);
              const y0 = log ? sy(LOG_FLOOR) : sy(base);
              base += value;
              // The gap is taken from the top of every segment but the first: stacked fills never touch.
              const height = Math.max(1, y0 - y1 - (base - value > 0 ? 2 : 0));
              return <rect key={item.key} x={x} y={y1} width={barW} height={height} rx={Math.min(3, barW / 3)} style={{ fill: item.color }}/>;
            })}
            {index % every === 0 && <text x={PAD.left + slot * index + slot / 2} y={HEIGHT - 12} textAnchor="middle" className="fill-slate-400 text-[10px]">{label}</text>}
            <rect x={PAD.left + slot * index} y={PAD.top} width={slot} height={plotH} fill="transparent" className={onSelect ? "cursor-pointer" : undefined} onMouseEnter={() => setHover(index)} onClick={() => onSelect?.(index)}/>
          </g>;
        })}
      </svg>
      {hover != null && hovered != null && <div className="pointer-events-none absolute top-1 z-10 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[10px] shadow-sm" style={{ left: `${Math.min(68, ((PAD.left + slot * hover + slot) / WIDTH) * 100)}%` }}>
        <p className="font-semibold text-slate-700">{hovered}</p>
        {series.map((item) => <p key={item.key} className="flex items-center gap-1.5 text-slate-600"><span className="inline-block size-2 rounded-sm" style={{ background: item.color }}/>{item.label}: <span className="font-mono">{withUnit(values[item.key]?.[hover] ?? 0, unit)}</span></p>)}
        {series.length > 1 && <p className="mt-0.5 text-slate-500">{t.total}: <span className="font-mono">{withUnit(totals[hover], unit)}</span></p>}
      </div>}
    </div>
  </figure>;
}
