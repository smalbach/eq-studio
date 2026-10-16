import { Badge, Button, Checkbox, SegmentedControl, Spinner, TextField } from "@radix-ui/themes";
import { Check, Clock3, Filter, Search, X } from "lucide-react";
import { MethodBadge } from "@/components/common/method-badge";
import { ALL_TAGS, type Workbench } from "@/components/functional/workbench/use-workbench";
import type { Endpoint } from "@/lib/endpoints";
import type { OperationStatus, RunResult } from "@/lib/run-types";
import { scenariosFor } from "@/lib/scenarios";
import { cn } from "@/lib/utils";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: { running: "Ejecutando", queued: "En cola", failed: "Falló", passed: "Correcto", implemented: "Implementado", pending: "Pendiente", cases: (count: string | number) => `${count} casos`, include: (operation: string) => `Incluir ${operation} en la selección`, search: "Buscar endpoint", searchPlaceholder: "Buscar ruta u operación…", allTags: "Todos", selection: "Selección para ejecutar", tickVisible: (n: number) => `Marcar los ${n} visibles`, clear: "Limpiar" },
  en: { running: "Running", queued: "Queued", failed: "Failed", passed: "Passed", implemented: "Implemented", pending: "Pending", cases: (count: string | number) => `${count} cases`, include: (operation: string) => `Include ${operation} in the selection`, search: "Search endpoint", searchPlaceholder: "Search path or operation…", allTags: "All", selection: "Selection to run", tickVisible: (n: number) => `Tick the ${n} visible`, clear: "Clear" },
});

/** The aggregate state of an endpoint's cases: running wins, then queued, then failed. */
export function endpointStatus(operationStates: Record<string, OperationStatus>, endpointId: string): OperationStatus | undefined {
  const statuses = Object.entries(operationStates).filter(([key]) => key.startsWith(`${endpointId}:`)).map(([, status]) => status);
  return (["running", "queued", "failed", "passed"] as const).find((status) => statuses.includes(status));
}

function StatusIcon({ status, result, implemented }: { status?: OperationStatus; result?: RunResult; implemented: boolean }) {
  const t = useMessages(MESSAGES);
  if (status === "running") return <span title={t.running} className="grid size-6 place-items-center rounded-full bg-sky-100 text-sky-600"><Spinner size="1"/></span>;
  if (status === "queued") return <span title={t.queued} className="grid size-6 place-items-center rounded-full bg-slate-100 text-slate-400"><Clock3 className="size-3.5"/></span>;
  if (status === "failed") return <span title={t.failed} className="grid size-6 place-items-center rounded-full bg-rose-100 text-rose-600"><X className="size-3.5"/></span>;
  if (status === "passed" || result) { const ok = status === "passed" || result?.ok; return <span title={ok ? t.passed : t.failed} className={cn("grid size-6 place-items-center rounded-full", ok ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600")}>{ok ? <Check className="size-3.5"/> : <X className="size-3.5"/>}</span>; }
  return <span title={implemented ? t.implemented : t.pending} className={cn("size-2 rounded-full", implemented ? "bg-emerald-400" : "bg-slate-200")}/>;
}

function EndpointRow({ item, bench, busy, status, result }: { item: Endpoint; bench: Workbench; busy: boolean; status?: OperationStatus; result?: RunResult }) {
  const t = useMessages(MESSAGES);
  const total = scenariosFor(item, useLocale()).length;
  const picked = bench.caseSelection[item.id];
  return <div className={cn("flex items-center gap-3 border-b border-slate-100 px-4 transition-colors hover:bg-slate-50", bench.selected.id === item.id && "bg-accent-3 hover:bg-accent-4")}>
    <Checkbox size="1" aria-label={t.include(`${item.method} ${item.path}`)} checked={bench.selectedEndpointIds.includes(item.id)} disabled={busy} onCheckedChange={() => bench.toggleEndpoint(item.id)} className="shrink-0"/>
    <button onClick={() => bench.selectEndpoint(item, Boolean(result))} className="grid min-w-0 flex-1 grid-cols-[62px_1fr_auto] items-center gap-3 py-3 text-left">
      <MethodBadge method={item.method} className="justify-center"/>
      <span className="min-w-0"><span className="block truncate font-mono text-xs font-semibold">{item.path}</span><span className="mt-1 block truncate text-[11px] text-slate-500">{item.summary} · {t.cases(picked ? `${picked.length}/${total}` : total)}</span></span>
      <StatusIcon status={status} result={result} implemented={item.implemented}/>
    </button>
  </div>;
}

/** Search, tag filter, the run selection and every endpoint with its last state. */
export function EndpointList({ bench, busy, operationStates, results }: { bench: Workbench; busy: boolean; operationStates: Record<string, OperationStatus>; results: Record<string, RunResult> }) {
  const t = useMessages(MESSAGES);
  return <aside className="border-b border-slate-200 xl:border-b-0 xl:border-r">
    <div className="border-b border-slate-200 p-4">
      <TextField.Root size="2" aria-label={t.search} value={bench.search} onChange={(event) => bench.setSearch(event.target.value)} placeholder={t.searchPlaceholder}><TextField.Slot><Search className="size-4"/></TextField.Slot></TextField.Root>
      <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1"><Filter className="size-3.5 shrink-0 text-slate-400"/><SegmentedControl.Root size="1" value={bench.tag} onValueChange={(value) => { if (value) bench.setTag(value); }} className="shrink-0">{bench.tags.map((item) => <SegmentedControl.Item key={item} value={item}>{item === ALL_TAGS ? t.allTags : item}</SegmentedControl.Item>)}</SegmentedControl.Root></div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-slate-500">{t.selection}</span><Badge size="1" variant="soft" color="gray">{bench.selectedEndpointIds.length}</Badge>
        <Button size="1" variant="surface" color="gray" onClick={bench.selectVisible} disabled={busy}>{t.tickVisible(bench.filtered.length)}</Button>
        <Button size="1" variant="surface" color="gray" onClick={bench.clearSelection} disabled={busy || !bench.selectedEndpointIds.length}>{t.clear}</Button>
      </div>
    </div>
    <div className="max-h-[630px] overflow-y-auto">{bench.filtered.map((item) => <EndpointRow key={item.id} item={item} bench={bench} busy={busy} status={endpointStatus(operationStates, item.id)} result={results[item.id]}/>)}</div>
  </aside>;
}
