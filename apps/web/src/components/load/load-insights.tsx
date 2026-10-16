import { Gauge } from "lucide-react";
import { CHART } from "@/lib/chart-colors";
import { Card } from "@/components/ui/card";
import { LineChart } from "@/components/charts/line-chart";
import { VerdictPill } from "@/components/common/stats";
import { localized, TEST_TYPES } from "@/lib/load.mjs";
import { reportBudget, type LoadRun } from "@/lib/load-types";
import { degradationReport } from "@/components/load/load-degradation";
import { ago } from "@/lib/format";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const MESSAGES = defineMessages({
  es: {
    noTests: "sin pruebas", errors: "errores", passed: (passed: number, count: number) => `${passed} de ${count} pasan`,
    pass: "Pasa", fail: "No pasa",
    trend: "Tendencia de las pruebas", p95: "Latencia p95", meanThroughput: "Rendimiento medio", errorRate: "Tasa de error", maxError: "Máx. 0,1 %", errorsSeries: "Errores",
    trendNote: "De la más antigua (#1) a la más reciente, de cualquier tipo y entorno.",
    capacityTitle: "Estrés: capacidad sana y primera señal de degradación", stressN: (n: number) => `estrés #${n}`, capacity: "Capacidad sana", firstSignal: "Primera señal",
    capacityNote: "Solo pruebas de estrés guardadas con su reporte. Sin punto: no hubo etapa sana o no hubo señal.",
  },
  en: {
    noTests: "no tests", errors: "errors", passed: (passed: number, count: number) => `${passed} of ${count} pass`,
    pass: "Pass", fail: "Fail",
    trend: "Test trend", p95: "p95 latency", meanThroughput: "Mean throughput", errorRate: "Error rate", maxError: "Max. 0.1 %", errorsSeries: "Errors",
    trendNote: "From the oldest (#1) to the most recent, of any type and environment.",
    capacityTitle: "Stress: healthy capacity and first sign of degradation", stressN: (n: number) => `stress #${n}`, capacity: "Healthy capacity", firstSignal: "First signal",
    capacityNote: "Only stress tests saved with their report. No point: there was no healthy stage or no signal.",
  },
});

/** The latest test of each type: verdict, throughput, p95 and errors at a glance. */
export function LatestByType({ history, now, onOpen, columns = "sm:grid-cols-2 xl:grid-cols-4" }: { history: LoadRun[]; now: number; onOpen?: (run: LoadRun) => void; columns?: string }) {
  const locale = useLocale();
  const t = useMessages(MESSAGES);
  return <div className={cn("grid gap-3", columns)}>{TEST_TYPES.map((entry) => localized(entry, locale)).map((type) => {
    const run = history.find((item) => item.type === type.id);
    const count = history.filter((item) => item.type === type.id).length;
    const passed = history.filter((item) => item.type === type.id && item.pass).length;
    return <Card key={type.id} className={cn("p-4", run && onOpen && "cursor-pointer transition-colors hover:border-slate-300")} onClick={() => run && onOpen?.(run)}>
      <div className="flex items-start justify-between gap-2"><div><p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"><Gauge className="size-3.5 text-slate-400"/>{type.label}</p><p className="mt-0.5 text-[10px] text-slate-400">{run ? `${ago(run.at, now, locale)} · ${run.environment}` : t.noTests}</p></div>{run && <VerdictPill pass={run.pass} label={run.pass ? t.pass : t.fail}/>}</div>
      {run ? <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <div><dt className="text-[10px] uppercase tracking-wider text-slate-400">req/s</dt><dd className="font-mono font-semibold text-slate-700">{run.rps}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-wider text-slate-400">p95</dt><dd className="font-mono font-semibold text-slate-700">{run.p95} ms</dd></div>
        <div><dt className="text-[10px] uppercase tracking-wider text-slate-400">{t.errors}</dt><dd className={cn("font-mono font-semibold", run.errorRate > 0.001 ? "text-rose-600" : "text-slate-700")}>{(run.errorRate * 100).toFixed(2)} %</dd></div>
      </dl> : <p className="mt-3 text-[11px] text-slate-400">{type.question}</p>}
      {count > 0 && <p className="mt-2 text-[10px] text-slate-400">{t.passed(passed, count)}</p>}
    </Card>;
  })}</div>;
}

/** p95 and throughput across the saved tests, oldest to newest. */
export function LoadTrend({ history }: { history: LoadRun[] }) {
  const t = useMessages(MESSAGES);
  if (history.length < 2) return null;
  const ordered = [...history].reverse();
  const x = ordered.map((_, index) => index + 1);
  const label = (value: number) => `#${value}`;
  return <Card className="p-5"><p className="mb-3 text-sm font-semibold">{t.trend}</p>
    <div className="grid gap-6 xl:grid-cols-2">
      <LineChart info="colDelta" title={t.p95} unit="ms" x={x} minX={1} xFormat={label} series={[{ key: "p95", label: "p95", color: CHART.violet, values: ordered.map((run) => run.p95) }, { key: "p50", label: "p50", color: CHART.blue, dashed: true, values: ordered.map((run) => run.p50 ?? null) }]}/>
      <LineChart info="rpsMean" title={t.meanThroughput} unit="req/s" x={x} minX={1} xFormat={label} series={[{ key: "rps", label: "req/s", color: CHART.blue, values: ordered.map((run) => run.rps) }]}/>
      <LineChart info="colError" title={t.errorRate} unit="%" x={x} minX={1} xFormat={label} reference={{ label: t.maxError, value: 0.1 }} series={[{ key: "errors", label: t.errorsSeries, color: CHART.rose, values: ordered.map((run) => Math.round(run.errorRate * 10000) / 100) }]}/>
      <LineChart info="apdex" title="Apdex" unit="" ceiling={1} x={x} minX={1} xFormat={label} series={[{ key: "apdex", label: "Apdex", color: CHART.green, values: ordered.map((run) => run.apdex ?? null) }]}/>
    </div>
    <p className="mt-2 text-[10px] text-slate-400">{t.trendNote}</p>
    <CapacityTrend history={ordered}/>
  </Card>;
}

/**
 * The stress tests only, oldest to newest: the rate the service held healthy and the rate at
 * which the first sign of degradation showed. A drop between two runs is a regression in
 * capacity even when both verdicts pass.
 */
function CapacityTrend({ history }: { history: LoadRun[] }) {
  const locale = useLocale();
  const t = useMessages(MESSAGES);
  const runs = history.filter((run) => run.type === "stress" && run.report).map((run) => ({ run, analysis: degradationReport("stress", run.report!, reportBudget(run.report!), locale) }));
  if (runs.length < 2) return null;
  const x = runs.map((_, index) => index + 1);
  return <div className="mt-6 border-t border-slate-100 pt-5">
    <LineChart info="capacityTrend" title={t.capacityTitle} unit="req/s" x={x} minX={1} xFormat={t.stressN}
      series={[{ key: "capacity", label: t.capacity, color: CHART.green, values: runs.map(({ analysis }) => analysis.capacity?.rps ?? null) }, { key: "signal", label: t.firstSignal, color: CHART.amber, dashed: true, values: runs.map(({ analysis }) => analysis.signals[0]?.rps ?? null) }]}/>
    <p className="mt-1 text-[10px] text-slate-400">{t.capacityNote}</p>
  </div>;
}
