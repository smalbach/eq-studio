import { useMemo, useState } from "react";
import { Link, SegmentedControl, Select, TextField } from "@radix-ui/themes";
import { Check, ChevronDown, ChevronRight, ExternalLink, Search, X } from "lucide-react";
import { isNegativeScenario } from "@eq/runner-core";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { MethodBadge } from "@/components/common/method-badge";
import type { Endpoint } from "@/lib/endpoints";
import { cn } from "@/lib/utils";
import { defineMessages, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    step: (n: number, total: number) => `Paso ${n} de ${total}`, noResponse: "sin respuesta",
    sentBody: "Body enviado", response: "Respuesta",
    bodiesOnlyFailed: "Los cuerpos solo se guardan para los casos fallidos.", noBodies: "Sin cuerpo en la solicitud ni en la respuesta.",
    title: "Casos de la ejecución", count: (visible: number, total: number) => `· ${visible} de ${total}`,
    all: (n: number) => `Todos ${n}`, failed: (n: number) => `Fallidos ${n}`, passed: (n: number) => `Correctos ${n}`,
    byTag: "Filtrar por tag", allTags: "Todos los tags",
    byKind: "Filtrar por tipo de caso", allKinds: "Todos los tipos", functional: "Funcionales", negative: "Negativos", negativeTag: "negativo", search: "Buscar caso", searchPlaceholder: "Buscar ruta o caso",
    expects: (status: number | string) => `espera ${status} · recibe `, steps: (n: number) => `${n} pasos · `,
    openInVerify: "Abrir en verificación para volver a ejecutarlo", noMatch: "Ningún caso coincide con el filtro.",
  },
  en: {
    step: (n: number, total: number) => `Step ${n} of ${total}`, noResponse: "no response",
    sentBody: "Sent body", response: "Response",
    bodiesOnlyFailed: "Bodies are only saved for failed cases.", noBodies: "No body in the request or the response.",
    title: "Run cases", count: (visible: number, total: number) => `· ${visible} of ${total}`,
    all: (n: number) => `All ${n}`, failed: (n: number) => `Failed ${n}`, passed: (n: number) => `Passed ${n}`,
    byTag: "Filter by tag", allTags: "All tags",
    byKind: "Filter by kind of case", allKinds: "All kinds", functional: "Functional", negative: "Negative", negativeTag: "negative", search: "Search case", searchPlaceholder: "Search path or case",
    expects: (status: number | string) => `expects ${status} · receives `, steps: (n: number) => `${n} steps · `,
    openInVerify: "Open in verification to run it again", noMatch: "No case matches the filter.",
  },
});

type Assertion = { label: string; pass: boolean; detail: string; informative?: boolean };
export type ExplorerStep = { ok: boolean; durationMs: number; step?: string; request: { method: string; url: string; body?: unknown }; actual: null | { status: number; body?: unknown }; assertions: Assertion[] };
export type ExplorerEntry = { endpoint: Endpoint; scenario: { id: string; name: string; expectedStatus: number; expectedStatuses?: number[]; description?: string }; result: { ok: boolean; durationMs: number; steps: ExplorerStep[] } };

/** Radix forbids an empty Select.Item value: "all tags" travels as this sentinel. */
const ALL_TAGS = "__all__";

export const caseKey = (entry: { endpoint: { id: string }; scenario: { id: string } }) => `${entry.endpoint.id}:${entry.scenario.id}`;

function Body({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null || value === "") return null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <div className="min-w-0"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p><pre className="theme-fixed max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[10px] leading-4 text-slate-200">{text}</pre></div>;
}

function StepDetail({ step, index, total, saved }: { step: ExplorerStep; index: number; total: number; saved: boolean }) {
  const t = useMessages(MESSAGES);
  const assertions = step.assertions;
  const hasBodies = step.request.body !== undefined || step.actual?.body !== undefined;
  return <div className={cn("rounded-xl border p-3", step.ok ? "border-slate-200" : "border-rose-200 bg-rose-50/30")}>
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <span className={cn("grid size-5 place-items-center rounded-full", step.ok ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600")}>{step.ok ? <Check className="size-3"/> : <X className="size-3"/>}</span>
      <span className="font-medium text-slate-700">{t.step(index + 1, total)}{step.step ? ` · ${step.step}` : ""}</span>
      <span className="ml-auto font-mono text-slate-500">{step.actual ? `HTTP ${step.actual.status}` : t.noResponse} · {step.durationMs} ms</span>
    </div>
    <p className="mt-1.5 break-all font-mono text-[11px] text-slate-600"><span className="font-semibold">{step.request.method}</span> {step.request.url}</p>
    {assertions.length > 0 && <ul className="mt-2 space-y-1">{assertions.map((assertion, position) => <li key={`${assertion.label}:${position}`} className="flex gap-2 text-[11px] leading-5">
      <span className={cn("mt-1 grid size-3.5 shrink-0 place-items-center rounded-full", assertion.informative ? "bg-slate-100 text-slate-400" : assertion.pass ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600")}>{assertion.pass ? <Check className="size-2.5"/> : <X className="size-2.5"/>}</span>
      <span className="min-w-0"><span className={cn("font-medium", assertion.pass || assertion.informative ? "text-slate-700" : "text-rose-700")}>{assertion.label}</span>{assertion.detail && <span className="break-words text-slate-500"> — {assertion.detail}</span>}</span>
    </li>)}</ul>}
    {hasBodies ? <div className="mt-3 grid gap-3 lg:grid-cols-2"><Body label={t.sentBody} value={step.request.body}/><Body label={t.response} value={step.actual?.body}/></div>
      : saved && <p className="mt-2 text-[10px] text-slate-400">{step.ok ? t.bodiesOnlyFailed : t.noBodies}</p>}
  </div>;
}

/**
 * Every case of a run, filterable, each opening to its steps: what was sent, what came back,
 * which assertions passed and which failed. It is what makes a saved run reviewable — the
 * verification view only knows the current session, so opening an old case there showed
 * nothing of that run.
 */
export function CaseExplorer({ entries, expanded, onToggle, saved, onOpenInVerify }: { entries: ExplorerEntry[]; expanded: string | null; onToggle: (key: string) => void; saved: boolean; onOpenInVerify?: (endpointId: string, scenarioId: string) => void }) {
  const t = useMessages(MESSAGES);
  const [status, setStatus] = useState<"all" | "failed" | "passed">("all");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [kind, setKind] = useState<"" | "functional" | "negative">("");
  const hasNegative = useMemo(() => entries.some((entry) => isNegativeScenario(entry.scenario)), [entries]);
  const tags = useMemo(() => [...new Set(entries.map((entry) => entry.endpoint.tag))].sort(), [entries]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // The case opened from elsewhere (a failure, the comparison) shows whatever the filters say.
    return entries.filter((entry) => caseKey(entry) === expanded || ((status === "all" || (status === "failed") !== entry.result.ok) && (!tag || entry.endpoint.tag === tag) && (!kind || (kind === "negative") === isNegativeScenario(entry.scenario)) && (!needle || `${entry.endpoint.method} ${entry.endpoint.path} ${entry.scenario.name} ${entry.endpoint.id}`.toLowerCase().includes(needle))))
      .sort((a, b) => Number(a.result.ok) - Number(b.result.ok));
  }, [entries, status, query, tag, kind, expanded]);
  const failed = entries.filter((entry) => !entry.result.ok).length;

  return <Card id="case-explorer" className="overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold">{t.title} <span className="font-normal text-slate-400">{t.count(visible.length, entries.length)}</span><InfoTip id="caseExplorer"/></p>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl.Root size="1" value={status} onValueChange={(value) => setStatus(value as typeof status)}>{([["all", t.all(entries.length)], ["failed", t.failed(failed)], ["passed", t.passed(entries.length - failed)]] as const).map(([value, label]) => <SegmentedControl.Item key={value} value={value}>{label}</SegmentedControl.Item>)}</SegmentedControl.Root>
        <Select.Root size="1" value={tag || ALL_TAGS} onValueChange={(value) => setTag(value === ALL_TAGS ? "" : value)}><Select.Trigger aria-label={t.byTag}/><Select.Content><Select.Item value={ALL_TAGS}>{t.allTags}</Select.Item>{tags.map((item) => <Select.Item key={item} value={item}>{item}</Select.Item>)}</Select.Content></Select.Root>
        {hasNegative && <Select.Root size="1" value={kind || ALL_TAGS} onValueChange={(value) => setKind(value === ALL_TAGS ? "" : value as typeof kind)}><Select.Trigger aria-label={t.byKind}/><Select.Content><Select.Item value={ALL_TAGS}>{t.allKinds}</Select.Item><Select.Item value="functional">{t.functional}</Select.Item><Select.Item value="negative">{t.negative}</Select.Item></Select.Content></Select.Root>}
        <label><span className="sr-only">{t.search}</span><TextField.Root size="1" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.searchPlaceholder} className="w-48"><TextField.Slot><Search className="size-3.5"/></TextField.Slot></TextField.Root></label>
      </div>
    </div>
    <div className="max-h-[720px] divide-y divide-slate-100 overflow-y-auto">
      {visible.map((entry) => { const key = caseKey(entry); const open = expanded === key; const decisive = entry.result.steps.find((step) => !step.ok) ?? entry.result.steps.at(-1); return <div key={key} id={`case-${key}`}>
        <button type="button" onClick={() => onToggle(key)} aria-expanded={open} className={cn("flex w-full items-center gap-2 px-5 py-2.5 text-left outline-none hover:bg-accent-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-8", open && "bg-accent-3")}>
          {open ? <ChevronDown className="size-3.5 shrink-0 text-slate-400"/> : <ChevronRight className="size-3.5 shrink-0 text-slate-400"/>}
          <span className={cn("grid size-4 shrink-0 place-items-center rounded-full", entry.result.ok ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600")}>{entry.result.ok ? <Check className="size-2.5"/> : <X className="size-2.5"/>}</span>
          <MethodBadge method={entry.endpoint.method} className="shrink-0"/>
          <span className="min-w-0 truncate font-mono text-[11px] font-semibold">{entry.endpoint.path}</span>
          <span className="min-w-0 truncate text-[11px] text-slate-500">· {entry.scenario.name}</span>
          {isNegativeScenario(entry.scenario) && <span className="shrink-0 rounded bg-amber-100 px-1.5 text-[10px] font-medium text-amber-700">{t.negativeTag}</span>}
          <span className="ml-auto shrink-0 font-mono text-[11px] text-slate-500">{t.expects(entry.scenario.expectedStatuses?.join("/") ?? (isNegativeScenario(entry.scenario) ? "4xx" : entry.scenario.expectedStatus))}<span className={entry.result.ok ? "" : "text-rose-600"}>{decisive?.actual?.status ?? "ERR"}</span> · {entry.result.steps.length > 1 ? t.steps(entry.result.steps.length) : ""}{entry.result.durationMs} ms</span>
        </button>
        {open && <div className="space-y-2 bg-slate-50/60 px-5 pb-4 pt-1">
          {entry.scenario.description && <p className="text-[11px] leading-5 text-slate-500">{entry.scenario.description}</p>}
          {entry.result.steps.map((step, index) => <StepDetail key={index} step={step} index={index} total={entry.result.steps.length} saved={saved}/>)}
          {onOpenInVerify && <Link asChild size="1" weight="medium"><button type="button" onClick={() => onOpenInVerify(entry.endpoint.id, entry.scenario.id)} className="flex items-center gap-1.5"><ExternalLink className="size-3.5"/>{t.openInVerify}</button></Link>}
        </div>}
      </div>; })}
      {!visible.length && <p className="px-5 py-6 text-xs text-slate-400">{t.noMatch}</p>}
    </div>
  </Card>;
}
