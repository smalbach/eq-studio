import { useMemo } from "react";
import { BarChart3, Clock3, History, Repeat, TrendingUp } from "lucide-react";
import { CHART } from "@/lib/chart-colors";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { LineChart } from "@/components/charts/line-chart";
import { ColumnChart } from "@/components/charts/column-chart";
import { Stat } from "@/components/common/stats";
import { flakyCases } from "@/lib/run-snapshot.mjs";
import { caseName, passRate } from "@/lib/run-entries";
import type { RunRecord } from "@/lib/run-types";
import { ago, percent, seconds } from "@/lib/format";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    saved: "Ejecuciones guardadas", lastAgo: (age: string) => `última ${age}`, noneYet: "ninguna todavía",
    last: "Última ejecución", average: "Éxito medio (últimas 5)", runs: (n: number) => `${n} ejecuciones`,
    flaky: "Casos inestables", flakyHint: "pasan y fallan entre corridas",
    meanDuration: "Duración media", perRun: "por ejecución",
    trend: "Tendencia de las ejecuciones", rate: "Tasa de éxito", success: "Éxito", perRunCases: "Casos por ejecución", passed: "Correctos", failed: "Fallidos", duration: "Duración", caseMean: "Duración media por caso", mean: "Media",
    trendNote: "De la más antigua (#1) a la más reciente. Todas las ejecuciones guardadas, de cualquier alcance y entorno.",
    needTwo: "Se necesitan al menos dos ejecuciones guardadas.", noFlaky: "Ningún caso cambió de resultado en las últimas 5 ejecuciones.",
    flakyNote: "Casos que pasaron en unas ejecuciones y fallaron en otras (últimas 5). Clic abre la última ejecución que lo contiene.",
  },
  en: {
    saved: "Saved runs", lastAgo: (age: string) => `last ${age}`, noneYet: "none yet",
    last: "Last run", average: "Mean pass rate (last 5)", runs: (n: number) => `${n} runs`,
    flaky: "Flaky cases", flakyHint: "pass and fail across runs",
    meanDuration: "Mean duration", perRun: "per run",
    trend: "Run trend", rate: "Pass rate", success: "Passed", perRunCases: "Cases per run", passed: "Passed", failed: "Failed", duration: "Duration", caseMean: "Mean duration per case", mean: "Mean",
    trendNote: "From oldest (#1) to newest. Every saved run, of any scope and environment.",
    needTwo: "At least two saved runs are needed.", noFlaky: "No case changed result in the last 5 runs.",
    flakyNote: "Cases that passed in some runs and failed in others (last 5). Click opens the latest run that contains it.",
  },
});

/** The headline numbers of the whole history: how many runs, the last one, the average. */
export function RunsStats({ runs, now }: { runs: RunRecord[]; now: number }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const last = runs[0];
  const recent = runs.slice(0, 5).filter((run) => run.total > 0);
  const average = recent.length ? recent.reduce((sum, run) => sum + passRate(run), 0) / recent.length : 0;
  const flaky = useMemo(() => flakyCases(runs), [runs]);
  const meanDuration = runs.length ? runs.reduce((sum, run) => sum + run.durationMs, 0) / runs.length : 0;
  return <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
    <Stat label={t.saved} info="runsList" value={String(runs.length)} hint={last ? t.lastAgo(ago(last.at, now, locale)) : t.noneYet} icon={<History className="size-6"/>}/>
    <Stat label={t.last} info="colSuccess" value={last ? percent(passRate(last)) : "—"} tone={!last ? "neutral" : last.failed ? "bad" : "good"} hint={last ? `${last.passed}/${last.total} · ${last.scope}` : undefined} icon={<BarChart3 className="size-6"/>}/>
    <Stat label={t.average} info="trendRate" value={recent.length ? percent(average) : "—"} tone={!recent.length ? "neutral" : average === 1 ? "good" : average < 0.9 ? "bad" : "warn"} hint={t.runs(recent.length)} icon={<TrendingUp className="size-6"/>}/>
    <Stat label={t.flaky} info="flaky" value={String(flaky.length)} tone={flaky.length ? "warn" : "neutral"} hint={t.flakyHint} icon={<Repeat className="size-6"/>}/>
    <Stat label={t.meanDuration} info="totalTime" value={runs.length ? seconds(meanDuration) : "—"} hint={t.perRun} icon={<Clock3 className="size-6"/>}/>
  </section>;
}

/** The trend of the saved runs and the cases that alternate between pass and fail. */
export function RunsInsights({ runs, onOpenCase }: { runs: RunRecord[]; onOpenCase: (key: string) => void }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const trend = useMemo(() => [...runs].reverse().filter((item) => item.total > 0), [runs]);
  const flaky = useMemo(() => flakyCases(runs), [runs]);
  if (runs.length < 2) return null;
  const x = trend.map((_, index) => index + 1);
  return <div className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
    <Card className="p-5"><p className="mb-3 text-sm font-semibold">{t.trend}</p>
      <div className="grid gap-6 lg:grid-cols-2">
        <LineChart info="trendRate" title={t.rate} unit="%" ceiling={100} x={x} minX={1} xFormat={(value) => `#${value}`} series={[{ key: "rate", label: t.success, color: CHART.blue, values: trend.map((item) => Math.round(passRate(item) * 1000) / 10) }]}/>
        <ColumnChart info="trendFailed" title={t.perRunCases} labels={trend.map((_, index) => `#${index + 1}`)} series={[{ key: "passed", label: t.passed, color: CHART.green }, { key: "failed", label: t.failed, color: CHART.rose }]} values={{ passed: trend.map((item) => item.passed), failed: trend.map((item) => item.failed) }}/>
        <LineChart info="totalTime" title={t.duration} unit="s" x={x} minX={1} xFormat={(value) => `#${value}`} series={[{ key: "seconds", label: t.duration, color: CHART.violet, values: trend.map((item) => Math.round(item.durationMs / 100) / 10) }]}/>
        <LineChart info="caseMeanTrend" title={t.caseMean} unit="ms" x={x} minX={1} xFormat={(value) => `#${value}`} series={[{ key: "mean", label: t.mean, color: CHART.blue, values: trend.map((item) => item.total ? Math.round(item.durationMs / item.total) : null) }]}/>
      </div>
      <p className="mt-2 text-[10px] text-slate-400">{t.trendNote}</p>
    </Card>
    <Card className="p-5"><p className="mb-3 flex items-center gap-2 text-sm font-semibold"><Repeat className="size-4 text-slate-400"/>{t.flaky}<InfoTip id="flaky"/></p>
      {flaky.length ? <ul className="max-h-64 space-y-1 overflow-y-auto">{flaky.map((row) => { const name = caseName(row.key, locale); return <li key={row.key}><button onClick={() => onOpenCase(row.key)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-2 rounded px-1 py-0.5 text-left text-[11px] hover:bg-slate-50"><span className="truncate" title={`${name.label} · ${name.scenario}`}><span className="font-mono text-slate-700">{name.label}</span> <span className="text-slate-400">· {name.scenario}</span></span><span className="font-mono text-amber-700">{row.passed}/{row.runs}</span></button></li>; })}</ul> : <p className="text-[11px] text-slate-400">{runs.filter((item) => item.cases?.length).length < 2 ? t.needTwo : t.noFlaky}</p>}
      <p className="mt-2 text-[10px] leading-4 text-slate-400">{t.flakyNote}</p>
    </Card>
  </div>;
}
