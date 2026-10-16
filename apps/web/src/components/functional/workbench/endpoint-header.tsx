import { Badge, Button, Checkbox, Spinner } from "@radix-ui/themes";
import { Play } from "lucide-react";
import { MethodBadge } from "@/components/common/method-badge";
import type { Workbench } from "@/components/functional/workbench/use-workbench";
import type { OperationStatus } from "@/lib/run-types";
import { cn } from "@/lib/utils";
import { defineMessages, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    statusNames: { 401: "No autenticado", 403: "Sin permisos", 404: "No encontrado", 422: "Validación", 409: "Conflicto", 503: "No disponible" } as Record<number, string>,
    success: "Éxito",
    generated: "Casos de prueba generados",
    cases: (count: string | number) => `${count} casos`,
    allCases: "Todos los casos",
    tests: (n: number) => `${n} pruebas`,
    include: (name: string) => `Incluir el caso ${name}`,
    expects: (status: number) => `espera ${status}`,
    willRun: (active: number, total: number) => `Se ejecutarán ${active} de los ${total} casos de este endpoint, en orden y respetando el delay configurado.`,
    implemented: "Implementado",
    pending: "Pendiente",
    running: "Ejecutando",
    runningProgress: (completed: number, total: number) => `Ejecutando ${completed}/${total}…`,
    runSelected: "Ejecutar caso seleccionado",
    runTicked: (n: number) => `Ejecutar marcados (${n})`,
    runAll: (n: number) => `Ejecutar todos (${n})`,
    declared: "Respuestas declaradas",
  },
  en: {
    statusNames: { 401: "Unauthenticated", 403: "Forbidden", 404: "Not found", 422: "Validation", 409: "Conflict", 503: "Unavailable" } as Record<number, string>,
    success: "Success",
    generated: "Generated test cases",
    cases: (count: string | number) => `${count} cases`,
    allCases: "All cases",
    tests: (n: number) => `${n} tests`,
    include: (name: string) => `Include the case ${name}`,
    expects: (status: number) => `expects ${status}`,
    willRun: (active: number, total: number) => `${active} of this endpoint's ${total} cases will run, in order and honoring the configured delay.`,
    implemented: "Implemented",
    pending: "Pending",
    running: "Running",
    runningProgress: (completed: number, total: number) => `Running ${completed}/${total}…`,
    runSelected: "Run selected case",
    runTicked: (n: number) => `Run ticked (${n})`,
    runAll: (n: number) => `Run all (${n})`,
    declared: "Declared responses",
  },
});
const DOT: Record<OperationStatus, string> = { running: "animate-pulse bg-sky-500", passed: "bg-emerald-500", failed: "bg-rose-500", queued: "bg-amber-400" };

/** The endpoint's cases as chips: tick to include in a run, click to put one on screen. */
function CaseChips({ bench, busy, operationStates, hasResult }: { bench: Workbench; busy: boolean; operationStates: Record<string, OperationStatus>; hasResult: (scenarioId?: string) => boolean }) {
  const t = useMessages(MESSAGES);
  const { selected, scenarios, selectedScenario, activeCases, caseSelection } = bench;
  return <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
    <div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold text-slate-700">{t.generated}</p><Badge size="1" variant="surface" color="gray">{t.cases(caseSelection[selected.id] ? `${activeCases.length}/${scenarios.length}` : scenarios.length)}</Badge></div>
    <div className="flex gap-2 overflow-x-auto pb-2">
      <button onClick={() => bench.selectAllScenarios(hasResult())} disabled={busy} className={cn("flex shrink-0 items-center gap-2 rounded-lg border bg-panel px-3 py-2 text-left text-[11px] transition-colors", !selectedScenario ? "border-accent-8 ring-2 ring-accent-4" : "border-slate-200 hover:border-slate-300")}><span className="size-2 rounded-full bg-slate-400"/><span><span className="block font-medium text-slate-700">{t.allCases}</span><span className="text-slate-400">{t.tests(activeCases.length)}</span></span></button>
      {scenarios.map((scenario) => {
        const state = operationStates[`${selected.id}:${scenario.id}`];
        const included = activeCases.some((item) => item.id === scenario.id);
        return <div key={scenario.id} className={cn("flex shrink-0 items-center gap-2 rounded-lg border bg-panel pl-2.5 transition-colors", selectedScenario?.id === scenario.id ? "border-accent-8 ring-2 ring-accent-4" : "border-slate-200 hover:border-slate-300", !included && "opacity-60")}>
          <Checkbox size="1" aria-label={t.include(scenario.name)} checked={included} disabled={busy} onCheckedChange={() => bench.toggleCase(selected, scenario.id)} className="shrink-0"/>
          <button onClick={() => bench.selectScenario(scenario, hasResult(scenario.id))} disabled={busy} className="flex items-center gap-2 py-2 pr-3 text-left text-[11px]"><span className={cn("size-2 rounded-full", state ? DOT[state] : "bg-slate-200")}/><span><span className="block font-medium text-slate-700">{scenario.name}</span><span className="text-slate-400">{t.expects(scenario.expectedStatus)}</span></span></button>
        </div>;
      })}
    </div>
    <p className="mt-1 text-xs text-slate-500">{selectedScenario ? selectedScenario.description : t.willRun(activeCases.length, scenarios.length)}</p>
  </div>;
}

/** The endpoint on screen: method and path, its declared responses, its cases and the run button. */
export function EndpointHeader({ bench, busy, singleRunning, progress, operationStates, hasResult, onRun }: { bench: Workbench; busy: boolean; singleRunning: boolean; progress: { completed: number; total: number }; operationStates: Record<string, OperationStatus>; hasResult: (scenarioId?: string) => boolean; onRun: () => void }) {
  const t = useMessages(MESSAGES);
  const { selected, selectedScenario, caseSelection, activeCases, scenarios } = bench;
  const running = Object.entries(operationStates).some(([key, status]) => key.startsWith(`${selected.id}:`) && status === "running");
  return <div className="border-b border-slate-200 px-5 py-5 lg:px-7">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2"><MethodBadge method={selected.method} size="2"/><h2 className="font-mono text-lg font-semibold sm:text-xl">{selected.path}</h2>{selected.implemented ? <Badge size="1" variant="soft" color="jade">{t.implemented}</Badge> : <Badge size="1" variant="soft" color="gray">{t.pending}</Badge>}{running && <Badge size="1" variant="soft" color="sky"><Spinner size="1"/>{t.running}</Badge>}</div>
        <p className="mt-2 text-sm text-slate-500">{selected.summary} · <span className="font-medium text-slate-700">{selected.id}</span></p>
      </div>
      <Button size="2" onClick={onRun} disabled={busy}><Play className="size-4 fill-current"/>{singleRunning ? t.runningProgress(progress.completed, progress.total) : selectedScenario ? t.runSelected : caseSelection[selected.id] ? t.runTicked(activeCases.length) : t.runAll(scenarios.length)}</Button>
    </div>
    <div className="mt-5 flex flex-wrap gap-2"><span className="mr-1 self-center text-[11px] font-medium uppercase tracking-wider text-slate-400">{t.declared}</span>{selected.statuses.map((status) => <Badge key={status} size="1" variant="soft" color={status >= 200 && status < 300 ? "jade" : status === 404 ? "amber" : "gray"}>{status} · {t.statusNames[status] ?? t.success}</Badge>)}</div>
    <CaseChips bench={bench} busy={busy} operationStates={operationStates} hasResult={hasResult}/>
  </div>;
}
