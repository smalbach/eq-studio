import { useState } from "react";
import { Button, Callout, Spinner } from "@radix-ui/themes";
import { GitCompareArrows, Plus } from "lucide-react";
import { PageHeader, type Crumb } from "@/components/common/page-header";
import { SidePanel } from "@/components/common/side-panel";
import { PrintButton } from "@/components/common/print-button";
import { RunCompare } from "@/components/functional/run-compare";
import { StabilityMatrix } from "@/components/functional/stability-matrix";
import { RunDetail } from "@/components/functional/run/run-detail";
import { RunsTable } from "@/components/functional/runs-table";
import { RunsInsights, RunsStats } from "@/components/functional/runs-insights";
import type { FunctionalRunner } from "@/components/functional/use-functional-runner";
import { formatDate, percent } from "@/lib/format";
import { passRate } from "@/lib/run-entries";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    inProgress: (completed: number, total: number) => `Ejecución en curso · ${completed}/${total} casos. Se guardará en esta lista al terminar.`,
    showProgress: "Ver progreso",
    title: "Verificación funcional",
    description: "Las ejecuciones de la matriz de casos contra el contrato. Abre una para revisar sus métricas, fallos y cada caso con lo enviado y lo recibido, o corre una nueva.",
    compareTitle: "Marca dos ejecuciones en la tabla", compare: (n: number) => `Comparar (${n}/2)`, newRun: "Nueva ejecución",
    notFound: "Ejecución no encontrada",
    subtitle: (date: string, environment: string, passed: number, total: number, rate: string) => `${date} · ${environment} · ${passed}/${total} correctos (${rate})`,
    maybeDeleted: "Puede haberse borrado del historial del proyecto.",
    retryScope: (n: number, scope: string) => `Reintento de ${n} fallidos · ${scope}`,
    noRun: "No hay una ejecución con ese identificador en este proyecto.",
    comparison: "Comparación de ejecuciones",
  },
  en: {
    inProgress: (completed: number, total: number) => `Run in progress · ${completed}/${total} cases. It will be saved in this list when it finishes.`,
    showProgress: "Show progress",
    title: "Functional verification",
    description: "The runs of the case matrix against the contract. Open one to review its metrics, failures and every case with what was sent and received, or start a new one.",
    compareTitle: "Tick two runs in the table", compare: (n: number) => `Compare (${n}/2)`, newRun: "New run",
    notFound: "Run not found",
    subtitle: (date: string, environment: string, passed: number, total: number, rate: string) => `${date} · ${environment} · ${passed}/${total} passed (${rate})`,
    maybeDeleted: "It may have been deleted from the project's history.",
    retryScope: (n: number, scope: string) => `Retry of ${n} failed · ${scope}`,
    noRun: "There is no run with that id in this project.",
    comparison: "Run comparison",
  },
});

/** A run in flight, with the way back to its monitor. */
function RunningBanner({ runner, onShow }: { runner: FunctionalRunner; onShow: () => void }) {
  const t = useMessages(MESSAGES);
  if (!runner.busy) return null;
  return <Callout.Root size="1" color="blue" role="status" className="mb-5">
    <Callout.Icon><Spinner size="2"/></Callout.Icon>
    <Callout.Text className="flex flex-wrap items-center gap-3"><span className="flex-1">{t.inProgress(runner.progress.completed, runner.progress.total)}</span><Button size="1" variant="surface" color="gray" onClick={onShow}>{t.showProgress}</Button></Callout.Text>
  </Callout.Root>;
}

/**
 * The functional verification section: the runs that were made, what they say together, and
 * the button to start a new one. A run opens in a panel over the list.
 */
export function FunctionalRunsPage({ runner, crumbs, openRunId, now, onOpenRun, onCloseRun, onNewRun, onRerunCase, onRerunFailed }: { runner: FunctionalRunner; crumbs: Crumb[]; openRunId?: string; now: number; onOpenRun: (id: string) => void; onCloseRun: () => void; onNewRun: () => void; onRerunCase: (endpointId: string, scenarioId: string) => void; onRerunFailed: (keys: string[], scope: string) => void }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const { runs } = runner;
  // A flaky case opens the newest run that contains it, scrolled to that case.
  const [focusCase, setFocusCase] = useState<string | null>(null);
  const open = openRunId ? runs.find((run) => run.id === openRunId) : undefined;
  const openCase = (key: string) => {
    const run = runs.find((item) => item.cases?.some((entry) => `${entry.e}:${entry.s}` === key));
    if (!run) return;
    setFocusCase(key);
    onOpenRun(run.id);
  };
  const openCell = (runId: string, key: string) => { setComparing(false); setFocusCase(key); onOpenRun(runId); };
  // Two runs marked in the table open side by side; a third mark replaces the oldest one.
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const toggleSelect = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(-2));
  const pair = selected.map((id) => runs.find((run) => run.id === id)).filter((run): run is NonNullable<typeof run> => Boolean(run)).sort((x, y) => x.at - y.at);
  const close = () => { setFocusCase(null); onCloseRun(); };
  const remove = (id: string) => { if (id === openRunId) close(); runner.deleteRun(id); };

  return <>
    <PageHeader crumbs={crumbs} title={t.title} description={t.description} actions={<>
      <PrintButton/>
      <Button size="2" variant="surface" color="gray" disabled={pair.length !== 2} onClick={() => setComparing(true)} title={t.compareTitle}><GitCompareArrows className="size-4"/>{t.compare(pair.length)}</Button>
      <Button size="2" variant="solid" onClick={onNewRun}><Plus className="size-4"/>{t.newRun}</Button>
    </>}/>
    <RunningBanner runner={runner} onShow={onNewRun}/>
    <RunsStats runs={runs} now={now}/>
    <RunsInsights runs={runs} onOpenCase={openCase}/>
    <StabilityMatrix runs={runs} onOpenCell={openCell}/>
    <RunsTable runs={runs} openId={openRunId} selected={selected} onToggleSelect={toggleSelect} onOpen={(run) => { setFocusCase(null); onOpenRun(run.id); }} onDelete={remove} onClear={() => { if (openRunId) close(); runner.clearRuns(); }}/>
    <SidePanel open={Boolean(openRunId)} onClose={close}
      title={open ? open.scope : t.notFound}
      subtitle={open ? t.subtitle(formatDate(open.at, locale), open.environment, open.passed, open.total, percent(passRate(open))) : t.maybeDeleted}>
      {open ? <RunDetail key={`${open.id}:${focusCase ?? ""}`} run={open} runs={runs} initialCase={focusCase} busy={Boolean(runner.busy)} onRerun={onRerunCase} onRerunFailed={(keys) => onRerunFailed(keys, t.retryScope(keys.length, open.scope))} onDelete={() => remove(open.id)}/> : <p className="text-xs text-slate-500">{t.noRun}</p>}
    </SidePanel>
    <SidePanel open={comparing && pair.length === 2 && !openRunId} onClose={() => setComparing(false)} title={t.comparison} subtitle={pair.length === 2 ? `${formatDate(pair[0].at, locale)} → ${formatDate(pair[1].at, locale)}` : undefined}>
      {pair.length === 2 && <RunCompare a={pair[0]} b={pair[1]} onInspect={(runId, endpointId, scenarioId) => openCell(runId, `${endpointId}:${scenarioId}`)}/>}
    </SidePanel>
  </>;
}
