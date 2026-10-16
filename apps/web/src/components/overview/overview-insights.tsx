import { useMemo } from "react";
import { CalendarDays, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { ColumnChart } from "@/components/charts/column-chart";
import { SplitBar } from "@/components/common/stats";
import { CHART } from "@/lib/chart-colors";
import { useEndpoints } from "@/lib/endpoints";
import { summarizeResults } from "@/lib/results-summary.mjs";
import { entriesOfRun } from "@/lib/run-entries";
import { activityByDay } from "@/lib/run-analytics";
import type { LoadRun } from "@/lib/load-types";
import type { RunRecord } from "@/lib/run-types";
import { formatDate } from "@/lib/format";
import { useHydrated } from "@/lib/use-hydrated";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    activity: "Actividad · últimos 14 días", runs: (n: number) => `${n} ejecuciones`, perDay: "Ejecuciones por día",
    clean: "Funcional sin fallos", failed: "Funcional con fallos", load: "Carga y estrés",
    coverage: "Cobertura del contrato", byStatus: "Respuestas declaradas por status (verificadas · sin verificar)", byTag: "Casos por tag (correctos · fallidos)",
    noDetail: "Sin ejecuciones con detalle por caso.",
  },
  en: {
    activity: "Activity · last 14 days", runs: (n: number) => `${n} runs`, perDay: "Runs per day",
    clean: "Functional, no failures", failed: "Functional, with failures", load: "Load and stress",
    coverage: "Contract coverage", byStatus: "Declared responses by status (verified · unverified)", byTag: "Cases by tag (passed · failed)",
    noDetail: "No runs with per-case detail.",
  },
});

/** Runs per day over the last two weeks: functional clean, functional with failures, load tests. */
export function ActivityCard({ runs, loadRuns, now }: { runs: RunRecord[]; loadRuns: LoadRun[]; now: number }) {
  // Days are local: computed only in the browser, never against the server's UTC clock.
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const hydrated = useHydrated();
  const activity = useMemo(() => hydrated ? activityByDay(runs, loadRuns, now, 14, locale) : { labels: [], values: { clean: [], failed: [], load: [] }, total: 0 }, [hydrated, runs, loadRuns, now, locale]);
  return <Card className="p-5">
    <p className="mb-3 flex items-center gap-2 text-sm font-semibold"><CalendarDays className="size-4 text-slate-400"/>{t.activity}<InfoTip id="activity"/><span className="font-normal text-slate-400">· {t.runs(activity.total)}</span></p>
    <ColumnChart title={t.perDay} labels={activity.labels} maxLabels={7} series={[{ key: "clean", label: t.clean, color: CHART.green }, { key: "failed", label: t.failed, color: CHART.rose }, { key: "load", label: t.load, color: CHART.violet }]} values={activity.values}/>
  </Card>;
}

type Coverage = { status: number; declared: number; exercised: number; verified: number };
type Split = { key: string; passed: number; failed: number };

/** The latest run with case detail: which declared responses it verified, and each tag's result. */
export function CoverageCard({ runs }: { runs: RunRecord[] }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const latest = runs.find((run) => run.cases?.length);
  const endpoints = useEndpoints();
  const summary = useMemo(() => latest ? summarizeResults(entriesOfRun(latest, locale), endpoints) : null, [latest, locale, endpoints]);
  return <Card className="p-5">
    <p className="mb-3 flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-slate-400"/>{t.coverage}<InfoTip id="declaredResponses"/></p>
    {latest && summary ? <>
      <p className="mb-2 text-[11px] text-slate-500">{latest.scope} · {formatDate(latest.at, locale)} · {latest.environment}</p>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t.byStatus}</p>
      <div className="space-y-0.5">{(summary.coverage as Coverage[]).map((row) => <SplitBar key={row.status} label={String(row.status)} passed={row.verified} failed={row.declared - row.verified} neutral/>)}</div>
      <p className="mb-1 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t.byTag}</p>
      <div className="space-y-0.5">{(summary.byTag as Split[]).map((row) => <SplitBar key={row.key} label={row.key} passed={row.passed} failed={row.failed}/>)}</div>
    </> : <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">{t.noDetail}</p>}
  </Card>;
}
