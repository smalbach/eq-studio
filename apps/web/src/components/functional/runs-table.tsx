import { useMemo, useState } from "react";
import { ChevronRight, History, Search, Trash2 } from "lucide-react";
import { Badge, Checkbox, IconButton, Link, Select, SegmentedControl, Table, TextField } from "@radix-ui/themes";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { CardTitle, VerdictPill } from "@/components/common/stats";
import type { RunRecord } from "@/lib/run-types";
import { formatDate, percent, seconds } from "@/lib/format";
import { passRate } from "@/lib/run-entries";
import { RUNS_LIMIT } from "@/lib/run-types";
import { cn } from "@/lib/utils";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    title: "Ejecuciones", extra: (visible: number, total: number, limit: number) => `· ${visible} de ${total} (las ${limit} más recientes)`,
    status: { all: "Todas", failed: "Con fallos", clean: "Sin fallos" } as Record<StatusFilter, string>,
    byEnvironment: "Filtrar por entorno", allEnvironments: "Todos los entornos", byScope: "Buscar por alcance", scopePlaceholder: "Buscar alcance", clear: "Borrar historial",
    compare: "Comparar", date: "Fecha", environment: "Entorno", scope: "Alcance", cases: "Casos", passed: "Correctos", failed: "Fallidos", success: "Éxito", failDelta: "Δ fallos", duration: "Duración",
    select: "Seleccionar para comparar", selectTitle: "Marca dos ejecuciones para compararlas", stopped: "detenida", remove: "Borrar ejecución",
    noMatch: "Ninguna ejecución coincide con el filtro.", empty: "Todavía no hay ejecuciones. Cada corrida de matriz, selección o endpoint queda registrada aquí con todos sus casos.",
  },
  en: {
    title: "Runs", extra: (visible: number, total: number, limit: number) => `· ${visible} of ${total} (the latest ${limit})`,
    status: { all: "All", failed: "With failures", clean: "No failures" } as Record<StatusFilter, string>,
    byEnvironment: "Filter by environment", allEnvironments: "All environments", byScope: "Search by scope", scopePlaceholder: "Search scope", clear: "Clear history",
    compare: "Compare", date: "Date", environment: "Environment", scope: "Scope", cases: "Cases", passed: "Passed", failed: "Failed", success: "Pass rate", failDelta: "Δ failures", duration: "Duration",
    select: "Select to compare", selectTitle: "Tick two runs to compare them", stopped: "stopped", remove: "Delete run",
    noMatch: "No run matches the filter.", empty: "No runs yet. Every matrix, selection or endpoint run is recorded here with all its cases.",
  },
});

type StatusFilter = "all" | "failed" | "clean";

/** Radix Select forbids an empty value, so "every environment" travels as this sentinel. */
const ALL_ENVIRONMENTS = "__all__";

function Header({ label, info, right }: { label: string; info?: Parameters<typeof InfoTip>[0]["id"]; right?: boolean }) {
  return <Table.ColumnHeaderCell className={cn("font-medium text-slate-400", right && "text-right")}><span className="inline-flex items-center gap-1">{label}{info && <InfoTip id={info} size="xs"/>}</span></Table.ColumnHeaderCell>;
}

/**
 * Every saved functional run, newest first. A row opens the run in a panel over this list; the
 * filters live here and are still set when the panel closes.
 */
export function RunsTable({ runs, openId, selected = [], onToggleSelect, onOpen, onDelete, onClear }: { runs: RunRecord[]; openId?: string; selected?: string[]; onToggleSelect?: (id: string) => void; onOpen: (run: RunRecord) => void; onDelete: (id: string) => void; onClear: () => void }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const [environment, setEnvironment] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const environments = useMemo(() => [...new Set(runs.map((run) => run.environment))].sort(), [runs]);
  const visible = runs.filter((run) => (!environment || run.environment === environment) && (status === "all" || (status === "failed") === (run.failed > 0)) && (!query.trim() || run.scope.toLowerCase().includes(query.trim().toLowerCase())));

  return <Card className="overflow-hidden">
    <CardTitle icon={<History className="size-4 text-slate-400"/>} title={t.title} info="runsList" extra={t.extra(visible.length, runs.length, RUNS_LIMIT)}>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl.Root size="1" value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>{(["all", "failed", "clean"] as const).map((value) => <SegmentedControl.Item key={value} value={value}>{t.status[value]}</SegmentedControl.Item>)}</SegmentedControl.Root>
        <Select.Root size="1" value={environment || ALL_ENVIRONMENTS} onValueChange={(value) => setEnvironment(value === ALL_ENVIRONMENTS ? "" : value)}><Select.Trigger aria-label={t.byEnvironment}/><Select.Content><Select.Item value={ALL_ENVIRONMENTS}>{t.allEnvironments}</Select.Item>{environments.map((item) => <Select.Item key={item} value={item}>{item}</Select.Item>)}</Select.Content></Select.Root>
        <label><span className="sr-only">{t.byScope}</span><TextField.Root size="1" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.scopePlaceholder} className="w-40"><TextField.Slot><Search className="size-3.5"/></TextField.Slot></TextField.Root></label>
        {runs.length > 0 && <Link asChild size="1" color="gray" underline="hover"><button type="button" onClick={onClear}>{t.clear}</button></Link>}
      </div>
    </CardTitle>
    <div className="overflow-x-auto"><Table.Root size="1" variant="ghost" className="w-full text-[11px]">
      <Table.Header><Table.Row className="text-left">{onToggleSelect && <Table.ColumnHeaderCell className="w-8 pl-5 font-medium print:hidden"><span className="sr-only">{t.compare}</span></Table.ColumnHeaderCell>}<Table.ColumnHeaderCell className="px-5 font-medium text-slate-400">{t.date}</Table.ColumnHeaderCell><Header label={t.environment}/><Header label={t.scope} info="colScope"/><Header label={t.cases} right/><Header label={t.passed} right/><Header label={t.failed} right/><Header label={t.success} info="colSuccess" right/><Header label={t.failDelta} info="colFailDelta" right/><Header label={t.duration} right/><Table.ColumnHeaderCell className="px-5"/></Table.Row></Table.Header>
      <Table.Body>
        {visible.map((run) => {
          const before = runs.slice(runs.indexOf(run) + 1).find((other) => other.environment === run.environment && other.total > 0);
          const delta = before ? run.failed - before.failed : null;
          return <Table.Row key={run.id} align="center" onClick={() => onOpen(run)} className={cn("cursor-pointer hover:bg-slate-50", openId === run.id && "bg-accent-3")}>
            {onToggleSelect && <Table.Cell className="pl-5 print:hidden" onClick={(event) => event.stopPropagation()}><Checkbox size="1" aria-label={t.select} title={t.selectTitle} checked={selected.includes(run.id)} disabled={!run.cases?.length} onCheckedChange={() => onToggleSelect(run.id)}/></Table.Cell>}
            <Table.Cell className="px-5 font-mono text-slate-600">{formatDate(run.at, locale)}</Table.Cell>
            <Table.Cell title={run.baseUrl}>{run.environment}</Table.Cell>
            <Table.Cell className="max-w-72"><span className="flex items-center gap-2"><span className="truncate text-slate-700" title={run.scope}>{run.scope}</span>{run.stopped && <Badge size="1" variant="soft" color="amber" className="shrink-0">{t.stopped}</Badge>}</span></Table.Cell>
            <Table.Cell className="text-right font-mono">{run.total}</Table.Cell>
            <Table.Cell className="text-right font-mono text-emerald-700">{run.passed}</Table.Cell>
            <Table.Cell className={cn("text-right font-mono", run.failed && "text-rose-600")}>{run.failed}</Table.Cell>
            <Table.Cell className="text-right"><VerdictPill pass={run.failed === 0} label={percent(passRate(run))}/></Table.Cell>
            <Table.Cell className={cn("text-right font-mono", delta != null && delta > 0 && "text-rose-600", delta != null && delta < 0 && "text-emerald-700")}>{delta == null ? "—" : delta === 0 ? "=" : delta > 0 ? `+${delta}` : delta}</Table.Cell>
            <Table.Cell className="text-right font-mono text-slate-600">{seconds(run.durationMs)}</Table.Cell>
            <Table.Cell className="px-5"><span className="flex items-center justify-end gap-1">
              <IconButton size="1" variant="ghost" color="gray" aria-label={t.remove} title={t.remove} onClick={(event) => { event.stopPropagation(); onDelete(run.id); }} className="hover:text-rose-600"><Trash2 className="size-3.5"/></IconButton>
              <ChevronRight className="size-4 text-slate-300"/>
            </span></Table.Cell>
          </Table.Row>;
        })}
        {!visible.length && <Table.Row><Table.Cell colSpan={11} className="px-5 py-6 text-xs text-slate-400">{runs.length ? t.noMatch : t.empty}</Table.Cell></Table.Row>}
      </Table.Body>
    </Table.Root></div>
  </Card>;
}
