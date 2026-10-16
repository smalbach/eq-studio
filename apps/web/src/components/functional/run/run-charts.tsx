import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { ColumnChart } from "@/components/charts/column-chart";
import { BudgetBars } from "@/components/charts/budget-bars";
import { SplitBar } from "@/components/common/stats";
import type { Summary } from "@/components/functional/run/run-summary";
import { CHART } from "@/lib/chart-colors";
import { assertionsByCategory, latencyHistogram, requestDurations } from "@/lib/run-analytics";
import type { RunEntry } from "@/lib/run-types";
import { categoryLabel } from "@/lib/results-summary.mjs";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    samples: (n: number) => `${n} muestra${n === 1 ? "" : "s"}`,
    histogram: "Distribución de latencia de las solicitudes", requests: "Solicitudes", noRequests: "Sin solicitudes",
    histogramNote: "Milisegundos por solicitud, incluidos los pasos de preparación y limpieza.",
    budget: "p95 de los GET frente al presupuesto", noGets: "No hubo GET de una sola solicitud.",
    byType: "Aserciones por tipo", noAssertions: "Sin aserciones.",
  },
  en: {
    samples: (n: number) => `${n} sample${n === 1 ? "" : "s"}`,
    histogram: "Request latency distribution", requests: "Requests", noRequests: "No requests",
    histogramNote: "Milliseconds per request, including the setup and cleanup steps.",
    budget: "GET p95 against the budget", noGets: "There were no single-request GETs.",
    byType: "Assertions by type", noAssertions: "No assertions.",
  },
});

type Slow = { id: string; method: string; path: string; p95: number; budgetMs: number | null; samples: number[] };

/** How the run's requests are spread in time, which GETs are over budget, and what the assertions check. */
export function RunCharts({ entries, summary }: { entries: RunEntry[]; summary: Summary }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const histogram = useMemo(() => latencyHistogram(requestDurations(entries)), [entries]);
  const categories = useMemo(() => assertionsByCategory(entries), [entries]);
  const slowest = (summary.slowest as Slow[]).map((row) => ({ key: row.id, label: `${row.method} ${row.path}`, detail: t.samples(row.samples.length), value: row.p95, budget: row.budgetMs }));
  return <div className="grid gap-5 xl:grid-cols-3">
    <Card className="p-5"><ColumnChart info="latencyHistogram" title={t.histogram} labels={histogram.map((row) => `${row.label}`)} series={[{ key: "count", label: t.requests, color: CHART.blue }]} values={{ count: histogram.map((row) => row.count) }} emptyLabel={t.noRequests}/><p className="mt-1 text-[10px] text-slate-400">{t.histogramNote}</p></Card>
    <Card className="p-5"><BudgetBars info="slowestGets" title={t.budget} rows={slowest} emptyLabel={t.noGets}/></Card>
    <Card className="p-5"><p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-slate-700">{t.byType}<InfoTip id="assertionsByType" size="xs"/></p>
      {categories.length ? <div className="space-y-0.5">{categories.map((row) => <SplitBar key={row.key} label={categoryLabel(row.key, locale)} passed={row.passed} failed={row.failed}/>)}</div> : <p className="text-[11px] text-slate-400">{t.noAssertions}</p>}
    </Card>
  </div>;
}
