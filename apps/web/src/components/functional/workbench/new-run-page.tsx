import { Button, IconButton, Spinner } from "@radix-ui/themes";
import { CheckCircle2, Play, Square, X, XCircle } from "lucide-react";
import { PageHeader, type Crumb } from "@/components/common/page-header";
import type { Environment } from "@/components/environment/use-environment";
import type { FunctionalRunner } from "@/components/functional/use-functional-runner";
import { ExecutionMonitor } from "@/components/functional/workbench/execution-monitor";
import { ExecutionOrder } from "@/components/functional/workbench/execution-order";
import { EndpointList } from "@/components/functional/workbench/endpoint-list";
import { EndpointHeader } from "@/components/functional/workbench/endpoint-header";
import { ChainedFlow, RequestLog, RequestTabs } from "@/components/functional/workbench/request-panel";
import { VerificationSidebar } from "@/components/functional/workbench/verification-sidebar";
import type { Workbench } from "@/components/functional/workbench/use-workbench";
import type { RunRecord } from "@/lib/run-types";
import { percent } from "@/lib/format";
import { defineMessages, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    saved: (scope: string) => `Ejecución guardada · ${scope}`,
    passedOf: (passed: number, total: number, rate: string, failed: number) => ` — ${passed} de ${total} correctos (${rate})${failed ? `, ${failed} fallidos` : ""}.`,
    viewResults: "Ver resultados",
    dismiss: "Cerrar aviso",
    fullMatrix: "Matriz completa",
    getMatrix: "Matriz GET",
    selectionScope: (n: number) => `Selección de ${n} endpoints`,
    title: "Nueva ejecución",
    description: "Elige qué correr: la Matriz GET, la matriz completa, los endpoints marcados o un endpoint con sus casos. Cada ejecución queda guardada en el listado con todos sus casos.",
    stopTitle: "Termina el caso en curso, incluida su limpieza, y no inicia ninguno más",
    stopping: "Deteniendo…",
    stop: "Detener",
    runningMatrix: "Ejecutando matriz…",
    fullMatrixTitle: "Incluye escrituras. Cada flujo borra lo que crea.",
    selectionTitle: "Ejecuta solo los endpoints marcados en la lista, en el orden configurado.",
    runSelection: (n: number) => `Ejecutar selección (${n})`,
  },
  en: {
    saved: (scope: string) => `Run saved · ${scope}`,
    passedOf: (passed: number, total: number, rate: string, failed: number) => ` — ${passed} of ${total} passed (${rate})${failed ? `, ${failed} failed` : ""}.`,
    viewResults: "View results",
    dismiss: "Dismiss notice",
    fullMatrix: "Full matrix",
    getMatrix: "GET matrix",
    selectionScope: (n: number) => `Selection of ${n} endpoints`,
    title: "New run",
    description: "Choose what to run: the GET matrix, the full matrix, the ticked endpoints or one endpoint with its cases. Every run is saved in the list with all its cases.",
    stopTitle: "Finishes the case in flight, cleanup included, and starts no more",
    stopping: "Stopping…",
    stop: "Stop",
    runningMatrix: "Running matrix…",
    fullMatrixTitle: "Includes writes. Every flow deletes what it creates.",
    selectionTitle: "Runs only the endpoints ticked in the list, in the configured order.",
    runSelection: (n: number) => `Run selection (${n})`,
  },
});

/** The run that just finished, with the way to its saved results. */
function FinishedBanner({ run, onOpen, onDismiss }: { run: RunRecord; onOpen: () => void; onDismiss: () => void }) {
  const t = useMessages(MESSAGES);
  const ok = run.failed === 0 && !run.stopped;
  return <div role="status" className={`mb-5 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${ok ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
    {ok ? <CheckCircle2 className="size-5 text-emerald-600"/> : <XCircle className="size-5 text-rose-600"/>}
    <p className="min-w-0 flex-1 text-xs text-slate-700"><span className="font-semibold">{t.saved(run.scope)}</span>{t.passedOf(run.passed, run.total, run.total ? percent(run.passed / run.total) : "—", run.failed)}</p>
    <Button size="1" onClick={onOpen}>{t.viewResults}</Button>
    <IconButton type="button" size="1" variant="ghost" color="gray" aria-label={t.dismiss} onClick={onDismiss}><X className="size-4"/></IconButton>
  </div>;
}

/**
 * Starting a new functional run: the monitor, the order, the endpoint list and the endpoint on
 * screen. Every run it starts is saved and opens from the runs list.
 */
export function NewRunPage({ env, runner, bench, crumbs, onOpenRun }: { env: Environment; runner: FunctionalRunner; bench: Workbench; crumbs: Crumb[]; onOpenRun: (id: string) => void }) {
  const t = useMessages(MESSAGES);
  const busy = Boolean(runner.busy);
  const { selected, selectedScenario } = bench;
  const follow = { onCaseStart: ({ endpoint, scenario }: { endpoint: { id: string }; scenario: { id: string } }) => bench.followCase(endpoint.id, scenario.id) };
  const runMatrix = (scope: "read" | "all") => void runner.run(bench.matrixQueue(scope), { scope: scope === "all" ? t.fullMatrix : t.getMatrix, ...follow }).then(() => bench.setActiveTab("actual"));
  const runSelection = () => void runner.run(bench.selectionQueue, { scope: t.selectionScope(bench.selectedEndpointIds.length), ...follow }).then(() => bench.setActiveTab("actual"));
  const runEndpoint = () => {
    const items = selectedScenario ? [{ endpoint: selected, scenario: selectedScenario, parameters: bench.parameterValues, useEditorBody: true }] : bench.activeCases.map((scenario) => ({ endpoint: selected, scenario }));
    void runner.run(items, { scope: `${selected.method} ${selected.path}${selectedScenario ? ` · ${selectedScenario.name}` : ""}`, single: true, editorBody: bench.bodyText }).then(() => bench.setActiveTab("actual"));
  };
  const scenarioResult = selectedScenario ? runner.scenarioResults[`${selected.id}:${selectedScenario.id}`] : undefined;
  const current = scenarioResult?.steps.at(-1) ?? runner.results[selected.id];
  const hasResult = (scenarioId?: string) => scenarioId ? Boolean(runner.scenarioResults[`${selected.id}:${scenarioId}`]) : Boolean(runner.results[selected.id]);

  return <>
    <PageHeader crumbs={crumbs} title={t.title} description={t.description} actions={<>
      {busy && <Button onClick={runner.requestStop} disabled={runner.stopping} size="2" variant="surface" color="red" title={t.stopTitle}>{runner.stopping ? <Spinner size="2"/> : <Square className="size-3.5 fill-current"/>}{runner.stopping ? t.stopping : t.stop}</Button>}
      <Button onClick={() => runMatrix("read")} size="2" disabled={busy}><Play className="size-4 fill-current"/>{runner.busy === "suite" ? t.runningMatrix : t.getMatrix}</Button>
      <Button onClick={() => runMatrix("all")} size="2" disabled={busy} title={t.fullMatrixTitle}><Play className="size-4 fill-current"/>{t.fullMatrix}</Button>
      <Button onClick={runSelection} size="2" disabled={busy || !bench.selectionQueue.length} title={t.selectionTitle}><Play className="size-4 fill-current"/>{t.runSelection(bench.selectionQueue.length)}</Button>
    </>}/>
    {runner.lastRun && <FinishedBanner run={runner.lastRun} onOpen={() => onOpenRun(runner.lastRun!.id)} onDismiss={runner.dismissLastRun}/>}
    <ExecutionMonitor runner={runner} env={env}/>
    <ExecutionOrder bench={bench} busy={busy}/>
    <div className="grid min-h-[690px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:grid-cols-[460px_minmax(0,1fr)]">
      <EndpointList bench={bench} busy={busy} operationStates={runner.operationStates} results={runner.results}/>
      <section className="min-w-0">
        <EndpointHeader bench={bench} busy={busy} singleRunning={runner.busy === "single"} progress={runner.progress} operationStates={runner.operationStates} hasResult={hasResult} onRun={runEndpoint}/>
        <div className="grid gap-5 p-5 lg:p-7 2xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <RequestTabs bench={bench} env={env} current={current}/>
            {scenarioResult && scenarioResult.steps.length > 1 && <ChainedFlow result={scenarioResult}/>}
            {current && <RequestLog current={current}/>}
          </div>
          <VerificationSidebar current={current} endpoint={selected} env={env}/>
        </div>
      </section>
    </div>
  </>;
}
