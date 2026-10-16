import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { BudgetBars } from "@/components/charts/budget-bars";
import { ColumnChart } from "@/components/charts/column-chart";
import { ScatterChart } from "@/components/charts/scatter-chart";
import { CHART } from "@/lib/chart-colors";
import { saturationKnee } from "@/lib/run-analytics";
import type { LoadReport } from "@/lib/load-types";
import { defineMessages, useMessages } from "@/lib/i18n";

const PERCENTILES = ["p50", "p75", "p90", "p95", "p99", "p999", "max"] as const;

const MESSAGES = defineMessages({
  es: {
    percentiles: { p50: "p50", p75: "p75", p90: "p90", p95: "p95", p99: "p99", p999: "p99.9", max: "máx" } as Record<(typeof PERCENTILES)[number], string>,
    second: (t: number) => `Segundo ${t}`,
    saturation: "Curva de saturación: p95 frente a rendimiento", underLoad: "Con carga", drain: "Drenaje", delivered: "Entregado",
    limit: (ms: number) => `Límite ${ms} ms`, knee: (rps: number) => `Codo ≈ ${rps} req/s`,
    kneeText: (byBudget: boolean, limit: number, rps: number) => `La latencia supera ${byBudget ? "el límite" : "el doble de la latencia en calma"} (${limit} ms) a partir de ≈ ${rps} req/s, en dos segundos seguidos: la capacidad útil está por debajo.`,
    noKnee: "La latencia no se dispara con el rendimiento alcanzado: el límite del servicio está por encima de esta prueba.",
    perSecond: " Un punto por segundo.",
    ladder: "Escalera de percentiles", latency: "Latencia",
    ladderNote: "Un salto grande entre p95 y p99 o máx es una cola larga: pocas solicitudes muy lentas.",
    byTarget: "p95 por objetivo frente a su límite",
  },
  en: {
    percentiles: { p50: "p50", p75: "p75", p90: "p90", p95: "p95", p99: "p99", p999: "p99.9", max: "max" } as Record<(typeof PERCENTILES)[number], string>,
    second: (t: number) => `Second ${t}`,
    saturation: "Saturation curve: p95 against throughput", underLoad: "Under load", drain: "Drain", delivered: "Delivered",
    limit: (ms: number) => `Limit ${ms} ms`, knee: (rps: number) => `Knee ≈ ${rps} req/s`,
    kneeText: (byBudget: boolean, limit: number, rps: number) => `Latency exceeds ${byBudget ? "the limit" : "twice the calm latency"} (${limit} ms) from ≈ ${rps} req/s on, two seconds in a row: the useful capacity is below it.`,
    noKnee: "Latency does not shoot up at the throughput reached: the service's limit is above this test.",
    perSecond: " One point per second.",
    ladder: "Percentile ladder", latency: "Latency",
    ladderNote: "A big jump between p95 and p99 or max is a long tail: a few very slow requests.",
    byTarget: "p95 per target against its limit",
  },
});

/**
 * What the per-second windows say together: how latency answers to throughput (and where it
 * bends), how the tail grows percentile by percentile, and which target is over its limit.
 */
export function LoadAnalysis({ report, budget }: { report: LoadReport; budget: number | null }) {
  const t = useMessages(MESSAGES);
  const points = useMemo(() => report.windows.filter((window) => window.completed > 0).map((window) => ({ x: Math.round(window.rps * 10) / 10, y: window.p95, group: window.drain ? "drain" : "measured", note: t.second(window.t) })), [report.windows, t]);
  const knee = useMemo(() => saturationKnee(report.windows, budget), [report.windows, budget]);
  const overall = report.overall as unknown as Record<string, number | undefined>;
  const ladder = PERCENTILES.map((key) => ({ label: t.percentiles[key], value: overall[key] ?? 0 }));
  const targets = [...report.targets].sort((a, b) => b.p95 - a.p95).slice(0, 12).map((target, index) => ({ key: `${target.path}:${index}`, label: target.label, detail: target.path, value: target.p95, budget: target.budgetMs }));
  return <div className="grid gap-5 xl:grid-cols-3">
    <Card className="p-5 xl:col-span-2">
      <ScatterChart info="saturationCurve" title={t.saturation} points={points} groups={[{ key: "measured", label: t.underLoad, color: CHART.violet }, { key: "drain", label: t.drain, color: CHART.muted }]} xLabel={t.delivered} xUnit="req/s" yLabel="p95" yUnit="ms" reference={budget != null ? { label: t.limit(budget), value: budget } : null} marker={knee ? { label: t.knee(knee.rps), value: knee.rps } : null}/>
      <p className="mt-1 text-[10px] leading-4 text-slate-400">{knee ? t.kneeText(knee.byBudget, knee.limit, knee.rps) : t.noKnee}{t.perSecond}</p>
    </Card>
    <Card className="p-5"><ColumnChart info="percentileLadder" title={t.ladder} unit="ms" labels={ladder.map((row) => row.label)} series={[{ key: "ms", label: t.latency, color: CHART.violet }]} values={{ ms: ladder.map((row) => row.value) }} reference={budget != null ? { label: t.limit(budget), value: budget } : null}/>
      <p className="mt-1 text-[10px] leading-4 text-slate-400">{t.ladderNote}</p></Card>
    {targets.length > 1 && <Card className="p-5 xl:col-span-3"><BudgetBars info="targetsBudget" title={t.byTarget} rows={targets}/></Card>}
  </div>;
}
