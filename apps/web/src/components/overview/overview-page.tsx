import { mixLabelIn } from "@/lib/load.mjs";
import { useMemo } from "react";
import { Badge, Button, Spinner } from "@radix-ui/themes";
import { ArrowRight, Braces, Gauge, Play, ShieldCheck } from "lucide-react";
import { CHART } from "@/lib/chart-colors";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { LineChart } from "@/components/charts/line-chart";
import { Mini, VerdictPill } from "@/components/common/stats";
import { PageHeader, type Crumb } from "@/components/common/page-header";
import { PrintButton } from "@/components/common/print-button";
import { ActivityCard, CoverageCard } from "@/components/overview/overview-insights";
import { LatestByType } from "@/components/load/load-insights";
import { testTypeLabel, type LoadRunner } from "@/components/load/use-load-runner";
import type { FunctionalRunner } from "@/components/functional/use-functional-runner";
import { useEndpoints } from "@/lib/endpoints";
import { summarizeResults } from "@/lib/results-summary.mjs";
import { compareRuns, flakyCases } from "@/lib/run-snapshot.mjs";
import { entriesOfRun, passRate, previousRun } from "@/lib/run-entries";
import type { LoadRun } from "@/lib/load-types";
import type { RunRecord } from "@/lib/run-types";
import { ago, percent, seconds } from "@/lib/format";
import { cn } from "@/lib/utils";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    contract: "Contrato", operations: "operaciones", internalTitle: "Operaciones que la API enruta pero el documento OpenAPI no declara", internal: (n: number) => `+${n} internas fuera del contrato`, implemented: "Implementados",
    functional: "Verificación funcional", functionalDetail: (n: number) => `Casos por endpoint contra el contrato · ${n} ejecuciones guardadas`, running: "En curso",
    lastRun: "Última ejecución", passedOf: (passed: number, total: number) => `${passed}/${total} correctos`, successPerRun: "Éxito por ejecución", success: "Éxito",
    failed: "fallidos", newFailures: "nuevos fallos", flaky: "inestables", duration: "duración", requests: "solicitudes", p95: "p95 solicitudes", verified: "respuestas verif.", failedAssertions: "aserciones fallidas",
    recent: "Recientes", noRuns: "Todavía no hay ejecuciones. Corre la Matriz GET para empezar.", runNew: "Correr nueva",
    load: "Carga y estrés", loadDetail: (n: number, passed: number | null) => `Load, stress, spike y soak · ${n} pruebas${passed == null ? "" : ` · ${passed} pasan`}`, testRunning: "Prueba en curso",
    pass: "Pasa", fail: "No pasa", newTest: "Nueva prueba",
    dashboard: "Panel de control", dashboardDescription: "Resultados principales de las ejecuciones del proyecto. Elige una sección para revisar el historial completo o correr una nueva.",
  },
  en: {
    contract: "Contract", operations: "operations", internalTitle: "Operations the API routes but the OpenAPI document does not declare", internal: (n: number) => `+${n} internal, outside the contract`, implemented: "Implemented",
    functional: "Functional verification", functionalDetail: (n: number) => `Cases per endpoint against the contract · ${n} saved runs`, running: "Running",
    lastRun: "Last run", passedOf: (passed: number, total: number) => `${passed}/${total} passed`, successPerRun: "Success per run", success: "Success",
    failed: "failed", newFailures: "new failures", flaky: "flaky", duration: "duration", requests: "requests", p95: "p95 requests", verified: "verified responses", failedAssertions: "failed assertions",
    recent: "Recent", noRuns: "No runs yet. Run the GET Matrix to get started.", runNew: "Run new",
    load: "Load and stress", loadDetail: (n: number, passed: number | null) => `Load, stress, spike and soak · ${n} tests${passed == null ? "" : ` · ${passed} pass`}`, testRunning: "Test running",
    pass: "Pass", fail: "Fail", newTest: "New test",
    dashboard: "Dashboard", dashboardDescription: "Main results of the project's runs. Pick a section to review the full history or start a new one.",
  },
});

/** Counted from the active project, never written by hand: a literal goes stale the day an
 * endpoint is added and then reports coverage that does not exist. */
function ContractStats() {
  const t = useMessages(MESSAGES);
  const endpoints = useEndpoints();
  const contract = endpoints.filter((item) => !item.internal);
  const internal = endpoints.length - contract.length;
  const implemented = contract.filter((item) => item.implemented).length;
  return <section className="mb-5 grid gap-3 sm:grid-cols-2">
    <Card className="flex items-center justify-between p-5"><div><p className="flex items-center gap-1 text-xs font-medium text-slate-500">{t.contract}<InfoTip id="statContract" size="xs"/></p><p className="mt-1 text-2xl font-semibold">{contract.length} <span className="text-sm font-normal text-slate-400">{t.operations}</span></p>{internal > 0 && <p className="mt-1 text-[11px] text-slate-400" title={t.internalTitle}>{t.internal(internal)}</p>}</div><Braces className="size-7 text-slate-300"/></Card>
    <Card className="p-5"><p className="flex items-center gap-1 text-xs font-medium text-slate-500">{t.implemented}<InfoTip id="statImplemented" size="xs"/></p><p className="mt-1 text-2xl font-semibold text-emerald-600">{implemented} <span className="text-sm font-normal text-slate-400">/ {contract.length}</span></p><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${contract.length ? Math.round((implemented / contract.length) * 100) : 0}%` }}/></div></Card>
  </section>;
}

function RecentRow({ title, detail, pass, label, onClick }: { title: string; detail: string; pass: boolean; label: string; onClick: () => void }) {
  return <li><button type="button" onClick={onClick} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[11px] outline-none hover:bg-accent-2 focus-visible:ring-2 focus-visible:ring-accent-8"><span className="min-w-0"><span className="block truncate font-medium text-slate-700">{title}</span><span className="block truncate text-slate-400">{detail}</span></span><VerdictPill pass={pass} label={label}/></button></li>;
}

/** The last functional run and how the history looks, with the way into the section. */
function FunctionalCard({ runs, busy, progress, now, onOpenSection, onNewRun, onOpenRun }: { runs: RunRecord[]; busy: boolean; progress: { completed: number; total: number }; now: number; onOpenSection: () => void; onNewRun: () => void; onOpenRun: (id: string) => void }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const last = runs[0];
  const endpoints = useEndpoints();
  const summary = useMemo(() => last?.cases ? summarizeResults(entriesOfRun(last, locale), endpoints) : null, [last, locale, endpoints]);
  const previous = last ? previousRun(runs, last) : undefined;
  const comparison = last?.cases && previous ? compareRuns(last, previous) : null;
  const flaky = useMemo(() => flakyCases(runs).length, [runs]);
  const trend = [...runs].reverse().filter((run) => run.total > 0);
  return <Card className="flex flex-col p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-emerald-600"/>{t.functional}</p><p className="mt-0.5 text-[11px] text-slate-500">{t.functionalDetail(runs.length)}</p></div>
      {busy && <Badge size="2" variant="soft" color="sky" radius="full"><Spinner size="1"/>{t.running} {progress.completed}/{progress.total}</Badge>}
    </div>
    {last ? <>
      <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-2">
        <div><p className="text-[10px] uppercase tracking-wider text-slate-400">{t.lastRun} · {ago(last.at, now, locale)}</p><p className={cn("text-4xl font-semibold", last.failed ? "text-rose-600" : "text-emerald-600")}>{percent(passRate(last))}</p><p className="text-[11px] text-slate-500">{t.passedOf(last.passed, last.total)} · {last.scope} · {last.environment}</p></div>
        {trend.length >= 2 && <div className="min-w-56 flex-1"><LineChart title={t.successPerRun} unit="%" ceiling={100} x={trend.map((_, index) => index + 1)} minX={1} xFormat={(value) => `#${value}`} series={[{ key: "rate", label: t.success, color: CHART.blue, values: trend.map((run) => Math.round(passRate(run) * 1000) / 10) }]}/></div>}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Mini label={t.failed} value={String(last.failed)} tone={last.failed ? "bad" : "good"}/>
        <Mini label={t.newFailures} value={comparison ? String(comparison.newFailures.length) : "—"} tone={comparison?.newFailures.length ? "bad" : "neutral"}/>
        <Mini label={t.flaky} value={String(flaky)} tone={flaky ? "warn" : "neutral"}/>
        <Mini label={t.duration} value={seconds(last.durationMs)}/>
        {summary && <>
          <Mini label={t.requests} value={String(summary.requests.total)}/>
          <Mini label={t.p95} value={`${summary.requests.latency.p95} ms`}/>
          <Mini label={t.verified} value={`${summary.coverageTotals.verified}/${summary.coverageTotals.declared}`}/>
          <Mini label={t.failedAssertions} value={String(summary.assertions.failed)} tone={summary.assertions.failed ? "bad" : "neutral"}/>
        </>}
      </div>
      <p className="mb-1 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t.recent}</p>
      <ul className="space-y-0.5">{runs.slice(0, 4).map((run) => <RecentRow key={run.id} title={run.scope} detail={`${ago(run.at, now, locale)} · ${run.environment} · ${run.passed}/${run.total}`} pass={run.failed === 0} label={percent(passRate(run), 0)} onClick={() => onOpenRun(run.id)}/>)}</ul>
    </> : <p className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">{t.noRuns}</p>}
    <div className="mt-auto flex flex-wrap gap-2 pt-5">
      <Button size="2" variant="solid" onClick={onOpenSection}><ShieldCheck className="size-4"/>{t.functional}<ArrowRight className="size-4"/></Button>
      <Button size="2" variant="surface" color="gray" onClick={onNewRun}><Play className="size-4"/>{t.runNew}</Button>
    </div>
  </Card>;
}

/** The latest test of each type and the recent ones, with the way into the section. */
function LoadCard({ history, running, now, onOpenSection, onNewRun, onOpenRun }: { history: LoadRun[]; running: boolean; now: number; onOpenSection: () => void; onNewRun: () => void; onOpenRun: (id: string) => void }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const passed = history.filter((run) => run.pass).length;
  return <Card className="flex flex-col p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="flex items-center gap-2 text-sm font-semibold"><Gauge className="size-4 text-violet-600"/>{t.load}</p><p className="mt-0.5 text-[11px] text-slate-500">{t.loadDetail(history.length, history.length ? passed : null)}</p></div>
      {running && <Badge size="2" variant="soft" color="sky" radius="full"><Spinner size="1"/>{t.testRunning}</Badge>}
    </div>
    <div className="mt-4"><LatestByType history={history} now={now} columns="sm:grid-cols-2" onOpen={(run) => run.report && onOpenRun(run.id)}/></div>
    {history.length > 0 && <>
      <p className="mb-1 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t.recent}</p>
      <ul className="space-y-0.5">{history.slice(0, 4).map((run) => <RecentRow key={run.id} title={`${testTypeLabel(run.type, locale)} · ${mixLabelIn(run.mix, locale)}`} detail={`${ago(run.at, now, locale)} · ${run.environment} · ${run.rps} req/s · p95 ${run.p95} ms`} pass={run.pass} label={run.pass ? t.pass : t.fail} onClick={() => onOpenRun(run.id)}/>)}</ul>
    </>}
    <div className="mt-auto flex flex-wrap gap-2 pt-5">
      <Button size="2" variant="solid" onClick={onOpenSection}><Gauge className="size-4"/>{t.load}<ArrowRight className="size-4"/></Button>
      <Button size="2" variant="surface" color="gray" onClick={onNewRun}><Play className="size-4"/>{t.newTest}</Button>
    </div>
  </Card>;
}

export type OverviewActions = { openFunctional: () => void; newFunctional: () => void; openFunctionalRun: (id: string) => void; openLoad: () => void; newLoad: () => void; openLoadRun: (id: string) => void };

/** The landing screen: the main results of both kinds of runs, and where to go next. */
export function OverviewPage({ crumbs, runner, load, now, actions }: { crumbs: Crumb[]; runner: FunctionalRunner; load: LoadRunner; now: number; actions: OverviewActions }) {
  const t = useMessages(MESSAGES);
  return <>
    <PageHeader crumbs={crumbs} title={t.dashboard} description={t.dashboardDescription} actions={<PrintButton/>}/>
    <ContractStats/>
    <div className="grid gap-5 xl:grid-cols-2">
      <FunctionalCard runs={runner.runs} busy={Boolean(runner.busy)} progress={runner.progress} now={now} onOpenSection={actions.openFunctional} onNewRun={actions.newFunctional} onOpenRun={actions.openFunctionalRun}/>
      <LoadCard history={load.history} running={load.running} now={now} onOpenSection={actions.openLoad} onNewRun={actions.newLoad} onOpenRun={actions.openLoadRun}/>
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <ActivityCard runs={runner.runs} loadRuns={load.history} now={now}/>
      <CoverageCard runs={runner.runs}/>
    </div>
  </>;
}
