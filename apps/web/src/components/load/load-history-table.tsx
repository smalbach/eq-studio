import { mixLabelIn } from "@/lib/load.mjs";
import { useState } from "react";
import { ChevronRight, History, Trash2 } from "lucide-react";
import { Button, Checkbox, IconButton, SegmentedControl, Select, Table } from "@radix-ui/themes";
import { Card } from "@/components/ui/card";
import { CardTitle, Delta, Th, VerdictPill } from "@/components/common/stats";
import { testTypeLabel } from "@/components/load/use-load-runner";
import { localized, TEST_TYPES } from "@/lib/load.mjs";
import { LOAD_HISTORY_LIMIT, type LoadRun } from "@/lib/load-types";
import { formatDate } from "@/lib/format";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const VERDICT_FILTERS = ["all", "pass", "fail"] as const;
const ALL_TYPES = "__all__";

const MESSAGES = defineMessages({
  es: {
    title: "Pruebas realizadas", extra: (visible: number, total: number, max: number) => `· ${visible} de ${total} (las ${max} más recientes)`,
    filters: { all: "Todas", pass: "Pasan", fail: "No pasan" } as Record<(typeof VERDICT_FILTERS)[number], string>,
    byType: "Filtrar por tipo", allTypes: "Todos los tipos", clear: "Borrar historial",
    compare: "Comparar", date: "Fecha", type: "Tipo", profile: "Perfil", environment: "Entorno", targets: "Objetivos", duration: "Duración", errors: "Errores", verdict: "Veredicto",
    select: "Seleccionar para comparar", selectHint: "Marca dos pruebas para compararlas", skipped: "Omitidos en la verificación previa",
    pass: "Pasa", fail: "No pasa", remove: "Borrar del historial", noReport: "sin reporte",
    noMatch: "Ninguna prueba coincide con el filtro.",
    empty: "Todavía no hay pruebas. Cada prueba terminada queda aquí con su reporte completo para reabrirla y compararla con la anterior del mismo tipo y entorno.",
  },
  en: {
    title: "Tests run", extra: (visible: number, total: number, max: number) => `· ${visible} of ${total} (the latest ${max})`,
    filters: { all: "All", pass: "Pass", fail: "Fail" } as Record<(typeof VERDICT_FILTERS)[number], string>,
    byType: "Filter by type", allTypes: "All types", clear: "Clear history",
    compare: "Compare", date: "Date", type: "Type", profile: "Profile", environment: "Environment", targets: "Targets", duration: "Duration", errors: "Errors", verdict: "Verdict",
    select: "Select to compare", selectHint: "Tick two tests to compare them", skipped: "Skipped in the preflight",
    pass: "Pass", fail: "Fail", remove: "Delete from history", noReport: "no report",
    noMatch: "No test matches the filter.",
    empty: "No tests yet. Every finished test stays here with its full report, to reopen it and compare it with the previous one of the same type and environment.",
  },
});

/** The previous test of the same type in the same environment, the one a run is compared to. */
export const previousLoadRun = (history: LoadRun[], run: LoadRun) => history.slice(history.indexOf(run) + 1).find((other) => other.type === run.type && other.environment === run.environment);

/** Every finished load test, newest first; a row opens its report in a panel over the list. */
export function LoadHistoryTable({ history, openId, selected = [], onToggleSelect, onOpen, onDelete, onClear }: { history: LoadRun[]; openId?: string; selected?: string[]; onToggleSelect?: (id: string) => void; onOpen: (run: LoadRun) => void; onDelete: (id: string) => void; onClear: () => void }) {
  const locale = useLocale();
  const t = useMessages(MESSAGES);
  const [type, setType] = useState("");
  const [verdict, setVerdict] = useState<"all" | "pass" | "fail">("all");
  const visible = history.filter((run) => (!type || run.type === type) && (verdict === "all" || run.pass === (verdict === "pass")));
  return <Card className="overflow-hidden">
    <CardTitle icon={<History className="size-4 text-slate-400"/>} title={t.title} info="loadHistory" extra={t.extra(visible.length, history.length, LOAD_HISTORY_LIMIT)}>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl.Root size="1" value={verdict} onValueChange={(value) => setVerdict(value as typeof verdict)}>{VERDICT_FILTERS.map((value) => <SegmentedControl.Item key={value} value={value}>{t.filters[value]}</SegmentedControl.Item>)}</SegmentedControl.Root>
        <Select.Root size="1" value={type || ALL_TYPES} onValueChange={(value) => setType(value === ALL_TYPES ? "" : value)}><Select.Trigger aria-label={t.byType}/><Select.Content><Select.Item value={ALL_TYPES}>{t.allTypes}</Select.Item>{TEST_TYPES.map((item) => <Select.Item key={item.id} value={item.id}>{localized(item, locale).label}</Select.Item>)}</Select.Content></Select.Root>
        {history.length > 0 && <Button size="1" variant="ghost" color="gray" onClick={onClear}>{t.clear}</Button>}
      </div>
    </CardTitle>
    <div className="overflow-x-auto"><Table.Root size="1" variant="ghost" className="w-full text-[11px]">
      <Table.Header><Table.Row className="text-left text-slate-400">{onToggleSelect && <Table.ColumnHeaderCell className="w-8 pl-5 print:hidden"><span className="sr-only">{t.compare}</span></Table.ColumnHeaderCell>}<Table.ColumnHeaderCell className="px-5 font-medium">{t.date}</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="font-medium">{t.type}</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="font-medium">{t.profile}</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="font-medium">{t.environment}</Table.ColumnHeaderCell><Th label={t.targets} info="colTargets"/><Th label={t.duration} info="elapsed"/><Th label="req/s" info="colDelta"/><Th label="p50" info="p50"/><Th label="p95" info="colDelta"/><Th label="p99" info="p99"/><Th label={t.errors} info="colError"/><Th label="Apdex" info="apdex"/><Th label={t.verdict} info="verdict"/><Table.ColumnHeaderCell className="px-5"/></Table.Row></Table.Header>
      <Table.Body>
        {visible.map((run) => { const previous = previousLoadRun(history, run); return <Table.Row key={run.id} onClick={() => run.report && onOpen(run)} className={cn(run.report && "cursor-pointer hover:bg-slate-50", openId === run.id && "bg-accent-3 hover:bg-accent-3")}>
          {onToggleSelect && <Table.Cell className="pl-5 print:hidden" onClick={(event) => event.stopPropagation()}><Checkbox size="1" aria-label={t.select} title={t.selectHint} checked={selected.includes(run.id)} disabled={!run.report} onCheckedChange={() => onToggleSelect(run.id)}/></Table.Cell>}
          <Table.Cell className="px-5 font-mono text-slate-600">{formatDate(run.at, locale)}</Table.Cell><Table.Cell className="font-medium">{testTypeLabel(run.type, locale)}</Table.Cell><Table.Cell className="max-w-40 truncate text-slate-600" title={run.mix}>{mixLabelIn(run.mix, locale)}</Table.Cell><Table.Cell className="text-slate-600" title={run.baseUrl}>{run.environment}</Table.Cell>
          <Table.Cell className="text-right font-mono">{run.targets ?? "—"}{run.skipped ? <span className="text-amber-600" title={t.skipped}> −{run.skipped}</span> : null}</Table.Cell><Table.Cell className="text-right font-mono">{run.elapsedS} s</Table.Cell>
          <Table.Cell className="text-right font-mono">{run.rps}<Delta value={run.rps} previous={previous?.rps} unit=" req/s" lowerIsBetter={false}/></Table.Cell><Table.Cell className="text-right font-mono">{run.p50 != null ? `${run.p50} ms` : "—"}</Table.Cell><Table.Cell className="text-right font-mono">{run.p95} ms<Delta value={run.p95} previous={previous?.p95} unit=" ms"/></Table.Cell><Table.Cell className="text-right font-mono">{run.p99 != null ? `${run.p99} ms` : "—"}</Table.Cell>
          <Table.Cell className={cn("text-right font-mono", run.errorRate > 0.001 && "text-rose-600")}>{(run.errorRate * 100).toFixed(2)} %</Table.Cell><Table.Cell className="text-right font-mono">{run.apdex != null ? run.apdex.toFixed(2) : "—"}</Table.Cell>
          <Table.Cell className="text-right"><VerdictPill pass={run.pass} label={run.pass ? t.pass : t.fail}/></Table.Cell>
          <Table.Cell className="px-5"><span className="flex items-center justify-end gap-1"><IconButton size="1" variant="ghost" color="gray" aria-label={t.remove} title={t.remove} onClick={(event) => { event.stopPropagation(); onDelete(run.id); }}><Trash2 className="size-3.5"/></IconButton>{run.report ? <ChevronRight className="size-4 text-slate-300"/> : <span className="text-[10px] text-slate-400">{t.noReport}</span>}</span></Table.Cell>
        </Table.Row>; })}
        {!visible.length && <Table.Row><Table.Cell colSpan={15} className="px-5 py-6 text-xs text-slate-400">{history.length ? t.noMatch : t.empty}</Table.Cell></Table.Row>}
      </Table.Body>
    </Table.Root></div>
  </Card>;
}
