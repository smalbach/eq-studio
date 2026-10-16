import { Check, ListTree, ShieldCheck, Timer, X } from "lucide-react";
import { Badge, Table } from "@radix-ui/themes";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { MethodBadge } from "@/components/common/method-badge";
import type { Inspect, Summary } from "@/components/functional/run/run-summary";
import { cn } from "@/lib/utils";
import { defineMessages, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    expects: "espera", receives: "recibe", failedAtStep: (step: number, steps: number) => `Falló en el paso ${step} de ${steps} del flujo encadenado`,
    failures: "Fallos", noFailures: (inTag: boolean) => `Sin fallos${inTag ? " en este tag" : ""}.`,
    declared: "Respuestas declaradas del contrato", declaredCol: "Declaradas", exercised: "Ejercitadas", verified: "Verificadas",
    coverage: "Solo las operaciones del contrato. Los 401/403 necesitan un entorno con autenticación activa; un status que ningún caso provoca (un 503, por ejemplo) queda sin verificar.",
    slowestCases: "Casos más lentos", steps: (n: number) => ` · ${n} pasos`,
    slowestGets: "GET más lentos frente al presupuesto", noSingleGets: "Sin casos GET de una sola solicitud.",
    p95Note: "p95 del caso con las muestras configuradas (1 muestra no es un p95). Presupuesto del proyecto.",
    perEndpoint: "Por endpoint", cases: "Casos", passed: "Correctos", failed: "Fallidos", requests: "Solicitudes", mean: "Media", max: "Máx",
  },
  en: {
    expects: "expects", receives: "receives", failedAtStep: (step: number, steps: number) => `Failed at step ${step} of ${steps} of the chained flow`,
    failures: "Failures", noFailures: (inTag: boolean) => `No failures${inTag ? " in this tag" : ""}.`,
    declared: "Contract's declared responses", declaredCol: "Declared", exercised: "Exercised", verified: "Verified",
    coverage: "Contract operations only. The 401/403 need an environment with authentication enabled; a status no case triggers (a 503, say) stays unverified.",
    slowestCases: "Slowest cases", steps: (n: number) => ` · ${n} steps`,
    slowestGets: "Slowest GETs against the budget", noSingleGets: "No single-request GET cases.",
    p95Note: "p95 of the case with the configured samples (1 sample is not a p95). Budget from the project.",
    perEndpoint: "Per endpoint", cases: "Cases", passed: "Passed", failed: "Failed", requests: "Requests", mean: "Mean", max: "Max",
  },
});

type Failure = Summary["failures"][number];

function FailureRow({ failure, onInspect }: { failure: Failure; onInspect: Inspect }) {
  const t = useMessages(MESSAGES);
  return <button onClick={() => onInspect(failure.endpointId, failure.scenarioId)} className="block w-full px-5 py-3 text-left hover:bg-slate-50">
    <div className="flex flex-wrap items-center gap-2"><MethodBadge method={failure.method}/><span className="font-mono text-xs font-semibold">{failure.path}</span><span className="text-[11px] text-slate-500">· {failure.scenario}</span><span className="ml-auto font-mono text-[11px]"><span className="text-slate-400">{t.expects}</span> {failure.expectedStatus} <span className="text-slate-400">{t.receives}</span> <span className="text-rose-600">{failure.actualStatus ?? "ERR"}</span></span></div>
    {failure.steps > 1 && <p className="mt-1 text-[10px] text-slate-400">{t.failedAtStep(failure.stepIndex + 1, failure.steps)}</p>}
    <ul className="mt-1 space-y-0.5">{failure.reasons.slice(0, 3).map((reason: string) => <li key={reason} className="flex gap-1.5 text-[11px] leading-5 text-slate-600"><X className="mt-1 size-3 shrink-0 text-rose-500"/><span className="line-clamp-2">{reason}</span></li>)}</ul>
  </button>;
}

/** Every failed case with its first reasons; a click opens it in the case explorer. */
export function FailureList({ summary, tagFilter, onInspect }: { summary: Summary; tagFilter: string | null; onInspect: Inspect }) {
  const t = useMessages(MESSAGES);
  const failures = tagFilter ? summary.failures.filter((failure) => failure.tag === tagFilter) : summary.failures;
  return <Card className="overflow-hidden">
    <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3"><p className="flex items-center gap-1.5 text-sm font-semibold">{t.failures}<InfoTip id="failuresList"/> {tagFilter && <span className="font-normal text-slate-500">· {tagFilter}</span>}</p><Badge size="1" variant="soft" color="red">{failures.length}</Badge></div>
    {failures.length ? <div className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">{failures.map((failure) => <FailureRow key={`${failure.endpointId}:${failure.scenarioId}`} failure={failure} onInspect={onInspect}/>)}</div> : <p className="flex items-center gap-2 px-5 py-6 text-xs text-emerald-700"><Check className="size-4"/>{t.noFailures(Boolean(tagFilter))}</p>}
  </Card>;
}

/** Declared responses exercised, the slowest cases and the slowest GETs against their budget. */
export function RunHighlights({ summary, onInspect }: { summary: Summary; onInspect: Inspect }) {
  const t = useMessages(MESSAGES);
  return <div className="space-y-5">
    <Card className="p-5"><p className="mb-3 flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-slate-400"/>{t.declared}<InfoTip id="declaredResponses"/></p>
      <Table.Root size="1" variant="ghost" className="w-full text-[11px]"><Table.Header><Table.Row className="text-left text-slate-400"><Table.ColumnHeaderCell className="pb-2 font-medium">Status</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="pb-2 text-right font-medium">{t.declaredCol}</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="pb-2 text-right font-medium">{t.exercised}</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="pb-2 text-right font-medium">{t.verified}</Table.ColumnHeaderCell></Table.Row></Table.Header>
        <Table.Body>{summary.coverage.map((row) => <Table.Row key={row.status}><Table.Cell className="py-1.5 font-mono">{row.status}</Table.Cell><Table.Cell className="py-1.5 text-right font-mono">{row.declared}</Table.Cell><Table.Cell className="py-1.5 text-right font-mono">{row.exercised}</Table.Cell><Table.Cell className={cn("py-1.5 text-right font-mono", row.verified === row.declared ? "text-emerald-700" : "text-slate-700")}>{row.verified}</Table.Cell></Table.Row>)}</Table.Body></Table.Root>
      <p className="mt-2 text-[10px] leading-4 text-slate-400">{t.coverage}</p></Card>
    <Card className="p-5"><p className="mb-3 flex items-center gap-2 text-sm font-semibold"><Timer className="size-4 text-slate-400"/>{t.slowestCases}<InfoTip id="slowestCases"/></p>
      <ul className="space-y-1.5">{summary.slowestCases.map((row) => <li key={`${row.endpointId}:${row.scenarioId}`}><button onClick={() => onInspect(row.endpointId, row.scenarioId)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 text-left text-[11px] hover:bg-slate-50"><span className="truncate" title={`${row.method} ${row.path} · ${row.scenario}`}><span className="font-mono text-slate-700">{row.method} {row.path}</span> <span className="text-slate-400">· {row.scenario}{row.steps > 1 ? t.steps(row.steps) : ""}</span></span><span className={cn("font-mono", row.ok ? "text-slate-600" : "text-rose-600")}>{row.durationMs} ms</span></button></li>)}</ul></Card>
    <Card className="p-5"><p className="mb-3 flex items-center gap-2 text-sm font-semibold"><Timer className="size-4 text-slate-400"/>{t.slowestGets}<InfoTip id="slowestGets"/></p>
      {summary.slowest.length ? <ul className="space-y-1.5">{summary.slowest.map((row) => { const over = row.budgetMs != null && row.p95 >= row.budgetMs; return <li key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-[11px]"><span className="truncate font-mono text-slate-700" title={row.path}>{row.path}</span><span className={cn("font-mono", over ? "text-rose-600" : "text-slate-600")}>{row.p95} ms{row.budgetMs != null && <span className="text-slate-400"> / {row.budgetMs}</span>}{over && " ✕"}</span></li>; })}</ul> : <p className="text-xs text-slate-400">{t.noSingleGets}</p>}
      <p className="mt-2 text-[10px] leading-4 text-slate-400">{t.p95Note}</p></Card>
  </div>;
}

/** One row per endpoint: cases, passed, failed, requests and timing. */
export function PerEndpointTable({ summary }: { summary: Summary }) {
  const t = useMessages(MESSAGES);
  return <Card className="overflow-hidden"><p className="flex items-center gap-2 border-b border-slate-200 px-5 py-3 text-sm font-semibold"><ListTree className="size-4 text-slate-400"/>{t.perEndpoint}<InfoTip id="perEndpoint"/> <span className="font-normal text-slate-400">· {summary.perEndpoint.length}</span></p>
    <div className="max-h-[480px] overflow-auto"><Table.Root size="1" variant="ghost" className="w-full text-[11px]"><Table.Header className="sticky top-0 z-10 bg-panel"><Table.Row className="text-left text-slate-400"><Table.ColumnHeaderCell className="px-5 py-2 font-medium">Endpoint</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="py-2 font-medium">Tag</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="py-2 text-right font-medium">{t.cases}</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="py-2 text-right font-medium">{t.passed}</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="py-2 text-right font-medium">{t.failed}</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="py-2 text-right font-medium">{t.requests}</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="py-2 text-right font-medium">{t.mean}</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="px-5 py-2 text-right font-medium">{t.max}</Table.ColumnHeaderCell></Table.Row></Table.Header>
      <Table.Body>{summary.perEndpoint.map((row) => <Table.Row key={row.id}><Table.Cell className="px-5 py-1.5"><span className="flex items-center gap-2"><MethodBadge method={row.method}/><span className="truncate font-mono" title={row.path}>{row.path}</span></span></Table.Cell><Table.Cell className="py-1.5 text-slate-500">{row.tag}</Table.Cell><Table.Cell className="py-1.5 text-right font-mono">{row.cases}</Table.Cell><Table.Cell className="py-1.5 text-right font-mono text-emerald-700">{row.passed}</Table.Cell><Table.Cell className={cn("py-1.5 text-right font-mono", row.failed && "text-rose-600")}>{row.failed}</Table.Cell><Table.Cell className="py-1.5 text-right font-mono">{row.requests}</Table.Cell><Table.Cell className="py-1.5 text-right font-mono">{row.meanMs} ms</Table.Cell><Table.Cell className="px-5 py-1.5 text-right font-mono">{row.maxMs} ms</Table.Cell></Table.Row>)}</Table.Body></Table.Root></div>
  </Card>;
}
