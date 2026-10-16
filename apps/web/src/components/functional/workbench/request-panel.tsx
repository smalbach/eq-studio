import { Badge, Tabs, TextField } from "@radix-ui/themes";
import { Clock3, FlaskConical } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MethodBadge } from "@/components/common/method-badge";
import { CredentialsCard } from "@/components/functional/workbench/credentials-card";
import type { RequestTab, Workbench } from "@/components/functional/workbench/use-workbench";
import { resolvePath } from "@/components/functional/use-functional-runner";
import type { Environment } from "@/components/environment/use-environment";
import type { RunResult, ScenarioResult } from "@/lib/run-types";
import { cn } from "@/lib/utils";
import { defineMessages, useMessages } from "@/lib/i18n";

const TABS: RequestTab[] = ["request", "expected", "actual"];

const MESSAGES = defineMessages({
  es: {
    tabs: { request: "Datos enviados", expected: "Respuesta esperada", actual: "Respuesta recibida" },
    empty: "Sin contenido",
    finalUrl: "URL final",
    parameters: "Parámetros",
    optional: "Opcional",
    allCases: "Todos los casos del endpoint",
    schemaRules: ["Al ejecutar se carga y valida el JSON Schema de /openapi.json", "Los flujos de escritura consultan el ID devuelto", "Los campos persistidos deben coincidir con el payload"],
    noResponse: "Todavía no hay una respuesta",
    noResponseHint: "Ejecuta el endpoint para compararlo con el contrato.",
    cleanup: "Limpieza: deja la base como estaba",
    setup: "Preparación o mutación",
    verify: "Consulta y verificación del estado persistido",
    main: "Operación principal",
    chained: "Flujo de verificación encadenado",
    steps: (n: number, ms: number) => `${n} pasos · ${ms} ms`,
    logged: "Solicitud registrada",
  },
  en: {
    tabs: { request: "Sent data", expected: "Expected response", actual: "Received response" },
    empty: "No content",
    finalUrl: "Final URL",
    parameters: "Parameters",
    optional: "Optional",
    allCases: "Every case of the endpoint",
    schemaRules: ["On run, the JSON Schema from /openapi.json is loaded and validated", "Write flows read back the returned ID", "Persisted fields must match the payload"],
    noResponse: "No response yet",
    noResponseHint: "Run the endpoint to compare it with the contract.",
    cleanup: "Cleanup: leaves the database as it was",
    setup: "Setup or mutation",
    verify: "Read and verification of the persisted state",
    main: "Main operation",
    chained: "Chained verification flow",
    steps: (n: number, ms: number) => `${n} steps · ${ms} ms`,
    logged: "Logged request",
  },
});
type Messages = typeof MESSAGES.es;

export function JsonBlock({ value, empty }: { value: unknown; empty?: string }) {
  const t = useMessages(MESSAGES);
  if (value === undefined || value === null || value === "") return <div className="theme-fixed grid min-h-44 place-items-center rounded-xl border border-dashed border-slate-700 bg-slate-950 text-sm text-slate-500">{empty ?? t.empty}</div>;
  return <pre className="theme-fixed max-h-[360px] min-h-44 overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-300"><code>{JSON.stringify(value, null, 2)}</code></pre>;
}

/** The final URL, the parameters, the credentials and the body: what a run will send. */
function RequestForm({ bench, env }: { bench: Workbench; env: Environment }) {
  const t = useMessages(MESSAGES);
  const { selected, parameterValues } = bench;
  return <div className="space-y-5">
    <div><p className="mb-2 block text-xs font-semibold text-slate-600">{t.finalUrl}</p><div className="flex overflow-hidden rounded-lg border border-slate-200 bg-slate-50"><span className="grid w-16 place-items-center"><MethodBadge method={selected.method}/></span><code className="overflow-x-auto px-3 py-2.5 text-xs">{env.baseUrl}{resolvePath(selected, parameterValues)}</code></div></div>
    {!!selected.parameters?.length && <div><p className="mb-3 text-xs font-semibold text-slate-600">{t.parameters}</p><div className="grid gap-3 sm:grid-cols-2">{selected.parameters.map((name) => { const inPath = selected.path.includes(`{${name}}`); return <label key={name} htmlFor={`parameter-${name}`} className="text-[11px] text-slate-500">{name}{inPath && <span className="text-rose-500"> *</span>}<TextField.Root size="2" id={`parameter-${name}`} value={parameterValues[name] ?? ""} onChange={(event) => bench.setParameterValues((values) => ({ ...values, [name]: event.target.value }))} placeholder={inPath ? "1" : t.optional} className="mt-1.5 w-full font-mono"/></label>; })}</div></div>}
    <CredentialsCard env={env}/>
    {selected.body && <div><label htmlFor="request-body" className="mb-2 block text-xs font-semibold text-slate-600">Body JSON</label><textarea id="request-body" value={bench.bodyText || JSON.stringify(selected.body, null, 2)} onChange={(event) => bench.setBodyText(event.target.value)} spellCheck={false} className="theme-fixed min-h-52 w-full resize-y rounded-xl bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-300 outline-none focus:ring-2 focus:ring-accent-8"/></div>}
  </div>;
}

/** What the contract expects of the case on screen, or of all the endpoint's cases. */
function expectedOf(bench: Workbench, t: Messages, current?: RunResult) {
  if (current?.expected) return current.expected;
  const { selected, selectedScenario: scenario, scenarios } = bench;
  if (!scenario) return { scope: t.allCases, total: scenarios.length, cases: scenarios.map((item) => ({ name: item.name, expectedStatus: item.expectedStatus, parameters: item.parameters ?? {}, flow: item.flow })) };
  const error = scenario.expectedStatus >= 400;
  return { scenario: scenario.name, status: scenario.expectedStatus, contentType: error ? "application/problem+json" : selected.method === "DELETE" ? null : "application/json", responseShape: error ? "ProblemDetails" : selected.responseShape, parameters: scenario.parameters ?? {}, flow: scenario.flow, declaredResponses: selected.statuses, schemaRules: t.schemaRules };
}

function NoResponse() {
  const t = useMessages(MESSAGES);
  return <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-center"><div><FlaskConical className="mx-auto size-8 text-slate-300"/><p className="mt-3 text-sm font-medium text-slate-600">{t.noResponse}</p><p className="mt-1 text-xs text-slate-400">{t.noResponseHint}</p></div></div>;
}

/** The three tabs: sent, expected, received. */
export function RequestTabs({ bench, env, current }: { bench: Workbench; env: Environment; current?: RunResult }) {
  const t = useMessages(MESSAGES);
  return <Card className="mb-5 overflow-hidden shadow-none"><Tabs.Root value={bench.activeTab} onValueChange={(value) => bench.setActiveTab(value as RequestTab)}>
    <Tabs.List size="1" className="bg-slate-50/60 px-2">{TABS.map((tab) => <Tabs.Trigger key={tab} value={tab}>{t.tabs[tab]}{tab === "actual" && current && <span className={cn("ml-2 inline-block size-1.5 rounded-full", current.ok ? "bg-emerald-500" : "bg-rose-500")}/>}</Tabs.Trigger>)}</Tabs.List>
    <div className="p-5">
      <Tabs.Content value="request"><RequestForm bench={bench} env={env}/></Tabs.Content>
      <Tabs.Content value="expected"><JsonBlock value={expectedOf(bench, t, current)}/></Tabs.Content>
      <Tabs.Content value="actual">{current ? <JsonBlock value={current.actual ?? { error: current.error }}/> : <NoResponse/>}</Tabs.Content>
    </div>
  </Tabs.Root></Card>;
}

const stepRole = (t: Messages, step: RunResult, index: number, total: number) => step.step ? step.step : step.request.method === "DELETE" && index === total - 1 && index > 1 ? t.cleanup : index === 0 ? t.setup : index === total - 1 ? t.verify : t.main;

/** The steps of a chained flow — create and read back, mutate, delete — with their status. */
export function ChainedFlow({ result }: { result: ScenarioResult }) {
  const t = useMessages(MESSAGES);
  const tone = (ok: boolean) => ok ? "jade" : "ruby";
  return <Card className="mb-5 overflow-hidden shadow-none">
    <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3"><p className="text-xs font-semibold">{t.chained}</p><Badge size="1" variant="soft" color={tone(result.ok)}>{t.steps(result.steps.length, result.durationMs)}</Badge></div>
    <div className="divide-y divide-slate-100">{result.steps.map((step, index) => <div key={`${step.request.url}-${index}`} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 px-5 py-3">
      <span className={cn("grid size-6 place-items-center rounded-full text-[10px] font-bold", step.ok ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>{index + 1}</span>
      <div className="min-w-0"><p className="truncate font-mono text-xs font-medium">{step.request.method} {step.request.url}</p><p className="mt-0.5 text-[11px] text-slate-400">{stepRole(t, step, index, result.steps.length)}</p></div>
      <Badge size="1" variant="soft" color={tone(step.ok)}>{step.actual?.status ?? "ERR"}</Badge>
    </div>)}</div>
  </Card>;
}

export function RequestLog({ current }: { current: RunResult }) {
  const t = useMessages(MESSAGES);
  return <Card className="overflow-hidden shadow-none"><div className="flex items-center justify-between border-b border-slate-200 px-5 py-3"><p className="text-xs font-semibold">{t.logged}</p><Badge size="1" variant="soft" color="gray"><Clock3 className="size-3"/>{current.durationMs} ms</Badge></div><div className="p-5"><JsonBlock value={current.request}/></div></Card>;
}
