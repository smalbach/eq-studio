import { mixLabelIn } from "@/lib/load.mjs";
import { useState } from "react";
import { CheckCircle2, GitCompareArrows, Plus, Trash2, X, XCircle } from "lucide-react";
import { Badge, Button, Callout, IconButton, Spinner } from "@radix-ui/themes";
import { Card } from "@/components/ui/card";
import { Delta, Mini } from "@/components/common/stats";
import { PageHeader, type Crumb } from "@/components/common/page-header";
import { SidePanel } from "@/components/common/side-panel";
import { PrintButton } from "@/components/common/print-button";
import { LoadCompare } from "@/components/load/load-compare";
import { LoadReportView } from "@/components/load/load-report";
import { LoadHistoryTable, previousLoadRun } from "@/components/load/load-history-table";
import { LatestByType, LoadTrend } from "@/components/load/load-insights";
import { LoadLive } from "@/components/load/load-live";
import { TestTypePicker, TrafficProfile } from "@/components/load/load-profile";
import { LoadSettings } from "@/components/load/load-settings";
import { exportLoadReport, testTypeLabel, type LoadRunner } from "@/components/load/use-load-runner";
import { LOAD_LIMITS } from "@/lib/load.mjs";
import { reportBudget, type LoadRun } from "@/lib/load-types";
import { fileStamp, formatDate } from "@/lib/format";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    noReport: "Esta prueba se guardó sin reporte: solo quedan sus totales.",
    delete: "Borrar",
    versusPrevious: (type: string, env: string) => `Frente a la anterior de ${type.toLowerCase()} en ${env} `,
    before: (value: string) => `(antes ${value})`,
    errors: "errores", verdict: "veredicto",
    pass: "Pasa", fail: "No pasa", passLower: "pasa", failLower: "no pasa",
    p95Change: "Cambio de p95", throughputChange: " · cambio de rendimiento",
    title: "Carga y estrés",
    description: "Las pruebas de carga, estrés, pico y resistencia que se han corrido para este proyecto. Abre una para ver su veredicto, métricas y gráficas, o configura una nueva.",
    compareHint: "Marca dos pruebas en la tabla", compare: (n: number) => `Comparar (${n}/2)`, newTest: "Nueva prueba",
    running: (type: string, t: number, total: number) => `Prueba de ${type.toLowerCase()} en curso · ${t}/${total} s.`, viewProgress: "Ver progreso",
    notFound: "Prueba no encontrada", maybeDeleted: "Puede haberse borrado del historial del proyecto.",
    noSuchTest: "No hay una prueba con ese identificador en este proyecto.",
    comparison: "Comparación de pruebas",
    saved: (type: string, verdict: string) => `Prueba guardada · ${type} · ${verdict}`,
    savedSummary: (rps: number, p95: number, errors: string) => ` — ${rps} req/s, p95 ${p95} ms, ${errors} % errores.`,
    viewInHistory: "Ver en el historial", closeNotice: "Cerrar aviso",
    newTitle: "Nueva prueba de carga", against: "Contra ", withCredentials: ", con sus credenciales. Al terminar queda guardada en el historial.",
    limits: (rps: number, min: number, targets: number) => `Modelo abierto · solo GET · máx ${rps} req/s, ${min} min, ${targets} objetivos`,
    lastTest: "Última prueba",
  },
  en: {
    noReport: "This test was saved without a report: only its totals remain.",
    delete: "Delete",
    versusPrevious: (type: string, env: string) => `Against the previous ${type} test in ${env} `,
    before: (value: string) => `(before ${value})`,
    errors: "errors", verdict: "verdict",
    pass: "Pass", fail: "Fail", passLower: "pass", failLower: "fail",
    p95Change: "p95 change", throughputChange: " · throughput change",
    title: "Load and stress",
    description: "The load, stress, spike and soak tests that have been run for this project. Open one to see its verdict, metrics and charts, or set up a new one.",
    compareHint: "Tick two tests in the table", compare: (n: number) => `Compare (${n}/2)`, newTest: "New test",
    running: (type: string, t: number, total: number) => `${type} test running · ${t}/${total} s.`, viewProgress: "View progress",
    notFound: "Test not found", maybeDeleted: "It may have been deleted from the project's history.",
    noSuchTest: "There is no test with that id in this project.",
    comparison: "Test comparison",
    saved: (type: string, verdict: string) => `Test saved · ${type} · ${verdict}`,
    savedSummary: (rps: number, p95: number, errors: string) => ` — ${rps} req/s, p95 ${p95} ms, ${errors} % errors.`,
    viewInHistory: "View in history", closeNotice: "Close notice",
    newTitle: "New load test", against: "Against ", withCredentials: ", with its credentials. When it finishes it is saved in the history.",
    limits: (rps: number, min: number, targets: number) => `Open model · GET only · max ${rps} req/s, ${min} min, ${targets} targets`,
    lastTest: "Latest test",
  },
});

/** A saved test: how it compares with the previous one of its type, and its full report. */
function LoadRunDetail({ run, history, onDelete }: { run: LoadRun; history: LoadRun[]; onDelete: () => void }) {
  const locale = useLocale();
  const t = useMessages(MESSAGES);
  const previous = previousLoadRun(history, run);
  if (!run.report) return <Card className="p-8 text-center text-xs text-slate-500">{t.noReport}</Card>;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-slate-500">{mixLabelIn(run.mix, locale)} · {run.environment}{run.baseUrl && <> · <span className="font-mono">{run.baseUrl}</span></>}</p>
      <Button size="1" variant="soft" color="red" onClick={onDelete}><Trash2 className="size-3.5"/>{t.delete}</Button>
    </div>
    {previous && <Card className="p-4"><p className="mb-2 text-xs font-semibold text-slate-700">{t.versusPrevious(testTypeLabel(run.type, locale), run.environment)}<span className="font-normal text-slate-400">· {formatDate(previous.at, locale)}</span></p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Mini label="req/s" value={`${run.rps} ${t.before(String(previous.rps))}`}/>
        <Mini label="p95" value={`${run.p95} ms ${t.before(String(previous.p95))}`}/>
        <Mini label={t.errors} value={`${(run.errorRate * 100).toFixed(2)} % ${t.before((previous.errorRate * 100).toFixed(2))}`}/>
        <Mini label={t.verdict} value={`${run.pass ? t.pass : t.fail} ${t.before(previous.pass ? t.passLower : t.failLower)}`} tone={run.pass ? "good" : "bad"}/>
      </div>
      <p className="mt-2 text-[10px] text-slate-400">{t.p95Change}<Delta value={run.p95} previous={previous.p95} unit=" ms"/>{t.throughputChange}<Delta value={run.rps} previous={previous.rps} unit=" req/s" lowerIsBetter={false}/></p>
    </Card>}
    <LoadReportView report={run.report} type={run.type} budget={reportBudget(run.report)} title={testTypeLabel(run.type, locale)} subtitle={formatDate(run.at, locale)} onExport={() => exportLoadReport(run, run.report!)} runId={run.id} reportName={`eq-load-${fileStamp(run.at)}`}/>
  </div>;
}

/**
 * The load and stress section: the tests that were run, the latest of each type, the trend, and
 * the button to start a new one. A test opens in a panel over the list.
 */
export function LoadRunsPage({ load, crumbs, openRunId, now, onOpenRun, onCloseRun, onNewRun }: { load: LoadRunner; crumbs: Crumb[]; openRunId?: string; now: number; onOpenRun: (id: string) => void; onCloseRun: () => void; onNewRun: () => void }) {
  const locale = useLocale();
  const t = useMessages(MESSAGES);
  const { history } = load;
  const open = openRunId ? history.find((run) => run.id === openRunId) : undefined;
  const remove = (id: string) => { if (id === openRunId) onCloseRun(); load.deleteRun(id); };
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const toggleSelect = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(-2));
  const pair = selected.map((id) => history.find((run) => run.id === id)).filter((run): run is LoadRun => Boolean(run?.report)).sort((x, y) => x.at - y.at);
  return <>
    <PageHeader crumbs={crumbs} title={t.title} description={t.description} actions={<>
      <PrintButton/>
      <Button size="2" variant="surface" color="gray" disabled={pair.length !== 2} onClick={() => setComparing(true)} title={t.compareHint}><GitCompareArrows className="size-4"/>{t.compare(pair.length)}</Button>
      <Button size="2" variant="solid" onClick={onNewRun}><Plus className="size-4"/>{t.newTest}</Button>
    </>}/>
    {load.running && <Callout.Root size="1" color="blue" role="status" className="mb-5 grid-cols-[auto_1fr]"><Callout.Icon><Spinner size="2"/></Callout.Icon><Callout.Text className="flex flex-wrap items-center gap-3"><span className="flex-1">{t.running(testTypeLabel(load.type, locale), load.windows.at(-1)?.t ?? 0, load.duration)}</span><Button size="1" variant="surface" color="gray" onClick={onNewRun}>{t.viewProgress}</Button></Callout.Text></Callout.Root>}
    <div className="mb-5"><LatestByType history={history} now={now} onOpen={(run) => run.report && onOpenRun(run.id)}/></div>
    <div className="mb-5"><LoadTrend history={history}/></div>
    <LoadHistoryTable history={history} openId={openRunId} selected={selected} onToggleSelect={toggleSelect} onOpen={(run) => onOpenRun(run.id)} onDelete={remove} onClear={() => { if (openRunId) onCloseRun(); load.clearHistory(); }}/>
    <SidePanel open={Boolean(openRunId)} onClose={onCloseRun}
      title={open ? `${testTypeLabel(open.type, locale)} · ${mixLabelIn(open.mix, locale)}` : t.notFound}
      subtitle={open ? `${formatDate(open.at, locale)} · ${open.environment} · ${open.pass ? t.pass : t.fail}` : t.maybeDeleted}>
      {open ? <LoadRunDetail key={open.id} run={open} history={history} onDelete={() => remove(open.id)}/> : <p className="text-xs text-slate-500">{t.noSuchTest}</p>}
    </SidePanel>
    <SidePanel open={comparing && pair.length === 2 && !openRunId} onClose={() => setComparing(false)} title={t.comparison} subtitle={pair.length === 2 ? `${formatDate(pair[0].at, locale)} → ${formatDate(pair[1].at, locale)}` : undefined}>
      {pair.length === 2 && <LoadCompare a={pair[0]} b={pair[1]}/>}
    </SidePanel>
  </>;
}

function FinishedBanner({ run, onOpen, onDismiss }: { run: LoadRun; onOpen: () => void; onDismiss: () => void }) {
  const locale = useLocale();
  const t = useMessages(MESSAGES);
  return <Callout.Root size="1" color={run.pass ? "jade" : "ruby"} role="status" className="flex flex-wrap items-center gap-3">
    <Callout.Icon>{run.pass ? <CheckCircle2 className="size-5"/> : <XCircle className="size-5"/>}</Callout.Icon>
    <p className="min-w-0 flex-1 text-xs text-slate-700"><span className="font-semibold">{t.saved(testTypeLabel(run.type, locale), run.pass ? t.pass : t.fail)}</span>{t.savedSummary(run.rps, run.p95, (run.errorRate * 100).toFixed(2))}</p>
    <Button size="1" variant="solid" highContrast onClick={onOpen}>{t.viewInHistory}</Button>
    <IconButton type="button" size="1" variant="ghost" color="gray" aria-label={t.closeNotice} onClick={onDismiss}><X className="size-4"/></IconButton>
  </Callout.Root>;
}

/** Configuring and running a new load test, with its live charts and, at the end, its report. */
export function NewLoadPage({ load, crumbs, shared, tokenMinutesLeft, onOpenRun }: { load: LoadRunner; crumbs: Crumb[]; shared: boolean; tokenMinutesLeft: number | null; onOpenRun: (id: string) => void }) {
  const locale = useLocale();
  const t = useMessages(MESSAGES);
  const { lastRun } = load;
  return <>
    <PageHeader crumbs={crumbs} title={t.newTitle} description={<>{t.against}<span className="font-mono">{load.environmentName} · {load.baseUrl}</span>{t.withCredentials}</>} actions={<><PrintButton/><Badge size="1" variant="soft" color="gray">{t.limits(LOAD_LIMITS.maxRps, LOAD_LIMITS.maxDurationS / 60, LOAD_LIMITS.maxTargets)}</Badge></>}/>
    <div className="space-y-5">
      {lastRun && <FinishedBanner run={lastRun} onOpen={() => onOpenRun(lastRun.id)} onDismiss={load.dismissLastRun}/>}
      <Card className="p-5">
        <TestTypePicker load={load}/>
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
          <TrafficProfile load={load}/>
          <LoadSettings load={load} shared={shared} tokenMinutesLeft={tokenMinutesLeft}/>
        </div>
      </Card>
      <LoadLive load={load}/>
      {lastRun?.report && <LoadReportView report={lastRun.report} type={lastRun.type} budget={reportBudget(lastRun.report)} title={t.lastTest} subtitle={`${testTypeLabel(lastRun.type, locale)} · ${lastRun.environment}`} onExport={() => exportLoadReport(lastRun, lastRun.report!)} runId={lastRun.id} reportName={`eq-load-${fileStamp(lastRun.at)}`}/>}
    </div>
  </>;
}
