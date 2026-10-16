import { useEffect, useMemo, useState } from "react";
import { Check, ClipboardCopy, Download, FileJson, FileText, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@radix-ui/themes";
import { Card } from "@/components/ui/card";
import { CaseExplorer, caseKey } from "@/components/case-explorer";
import { RunComparison, RunStats } from "@/components/functional/run/run-summary";
import { CaseBreakdown, RequestBreakdown } from "@/components/functional/run/run-breakdowns";
import { RunCharts } from "@/components/functional/run/run-charts";
import { FailureList, PerEndpointTable, RunHighlights } from "@/components/functional/run/run-failures";
import { useEndpoints } from "@/lib/endpoints";
import { resultsToCsv, summarizeResults } from "@/lib/results-summary.mjs";
import { compareRuns } from "@/lib/run-snapshot.mjs";
import { entriesOfRun, previousRun } from "@/lib/run-entries";
import type { RunEntry, RunRecord } from "@/lib/run-types";
import { download, fileStamp, formatDate } from "@/lib/format";
import { runMarkdown } from "@/lib/run-report";
import { defineMessages, useLocale, useMessages, type Locale } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    legacy: (passed: number, total: number) => `Esta ejecución se guardó antes de que existiera el detalle por caso: solo quedan sus totales (${passed}/${total}).`,
    stopped: "· detenida antes de terminar",
    busy: "Hay una ejecución en curso", retryTitle: "Corre de nuevo solo los casos que fallaron, como una ejecución nueva", retry: (n: number) => `Reintentar fallidos (${n})`,
    copyTitle: "Resumen en Markdown para pegar en un ticket", copied: "Copiado", copy: "Copiar resumen",
    exportJson: "Exportar JSON", exportCsv: "Exportar CSV", remove: "Borrar",
  },
  en: {
    legacy: (passed: number, total: number) => `This run was saved before per-case detail existed: only its totals remain (${passed}/${total}).`,
    stopped: "· stopped before finishing",
    busy: "A run is in progress", retryTitle: "Runs only the cases that failed again, as a new run", retry: (n: number) => `Retry failed (${n})`,
    copyTitle: "Markdown summary to paste into a ticket", copied: "Copied", copy: "Copy summary",
    exportJson: "Export JSON", exportCsv: "Export CSV", remove: "Delete",
  },
});

function exportJson(run: RunRecord, entries: RunEntry[], summary: ReturnType<typeof summarizeResults>, locale: Locale) {
  const cases = entries.map(({ endpoint, scenario, result }) => ({ endpoint: endpoint.id, method: endpoint.method, path: endpoint.path, case: scenario.id, name: scenario.name, expectedStatus: scenario.expectedStatus, ok: result.ok, durationMs: result.durationMs, steps: result.steps.map((step) => ({ ok: step.ok, request: step.request, status: step.actual?.status ?? null, durationMs: step.durationMs, assertions: step.assertions })) }));
  download(`eq-results-${fileStamp(run.at)}.json`, JSON.stringify({ generatedAt: new Date().toISOString(), run: { id: run.id, at: formatDate(run.at, locale), scope: run.scope, environment: run.environment, baseUrl: run.baseUrl, stopped: Boolean(run.stopped) }, summary, cases }, null, 2), "application/json");
}

/**
 * Everything a saved run says: its numbers, the comparison with the previous run in the same
 * environment, the breakdowns, the failures, and every case with its steps and bodies.
 */
export function RunDetail({ run, runs, initialCase, busy, onRerun, onRerunFailed, onDelete }: { run: RunRecord; runs: RunRecord[]; initialCase?: string | null; busy?: boolean; onRerun: (endpointId: string, scenarioId: string) => void; onRerunFailed?: (keys: string[]) => void; onDelete: () => void }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(initialCase ?? null);
  const entries = useMemo(() => entriesOfRun(run, locale), [run, locale]);
  const endpoints = useEndpoints();
  const summary = useMemo(() => summarizeResults(entries, endpoints), [entries, endpoints]);
  const previous = previousRun(runs, run);
  const comparison = previous ? compareRuns(run, previous) : undefined;
  useEffect(() => {
    if (initialCase) requestAnimationFrame(() => document.getElementById(`case-${initialCase}`)?.scrollIntoView({ block: "center" }));
  }, [initialCase]);
  /** Opens a case of this run in the explorer below; one it does not contain opens to be run. */
  const inspect = (endpointId: string, scenarioId: string) => {
    const key = `${endpointId}:${scenarioId}`;
    if (!entries.some((entry) => caseKey(entry) === key)) { onRerun(endpointId, scenarioId); return; }
    setExpanded(key);
    requestAnimationFrame(() => document.getElementById(`case-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  const failedKeys = entries.filter((entry) => !entry.result.ok).map(caseKey);
  const markdown = () => runMarkdown(run, summary, comparison, locale);
  const copy = () => { void navigator.clipboard?.writeText(markdown()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };

  if (!entries.length) return <Card className="p-8 text-center text-xs text-slate-500">{t.legacy(run.passed, run.total)}</Card>;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-slate-500">{run.environment} · <span className="font-mono">{run.baseUrl}</span>{run.stopped && <span className="ml-2 text-amber-700">{t.stopped}</span>}</p>
      <div className="flex flex-wrap gap-2">
        {onRerunFailed && failedKeys.length > 0 && <Button size="1" variant="surface" color="red" onClick={() => onRerunFailed(failedKeys)} disabled={busy} title={busy ? t.busy : t.retryTitle}><RotateCcw className="size-3.5"/>{t.retry(failedKeys.length)}</Button>}
        <Button size="1" variant="surface" color="gray" onClick={copy} title={t.copyTitle}>{copied ? <Check className="size-3.5 text-emerald-600"/> : <ClipboardCopy className="size-3.5"/>}{copied ? t.copied : t.copy}</Button>
        <Button size="1" variant="surface" color="gray" onClick={() => download(`eq-results-${fileStamp(run.at)}.md`, markdown(), "text/markdown")}><FileText className="size-3.5"/>Markdown</Button>
        <Button size="1" variant="surface" color="gray" onClick={() => exportJson(run, entries, summary, locale)}><FileJson className="size-3.5"/>{t.exportJson}</Button>
        <Button size="1" variant="surface" color="gray" onClick={() => download(`eq-results-${fileStamp(run.at)}.csv`, resultsToCsv(entries), "text/csv")}><Download className="size-3.5"/>{t.exportCsv}</Button>
        <Button size="1" variant="soft" color="red" onClick={onDelete}><Trash2 className="size-3.5"/>{t.remove}</Button>
      </div>
    </div>
    <RunStats summary={summary}/>
    {comparison && previous && <RunComparison comparison={comparison} previous={previous} onInspect={inspect}/>}
    <RunCharts entries={entries} summary={summary}/>
    <RequestBreakdown summary={summary}/>
    <CaseBreakdown summary={summary} tagFilter={tagFilter} onTag={(tag) => setTagFilter((current) => current === tag ? null : tag)}/>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <FailureList summary={summary} tagFilter={tagFilter} onInspect={inspect}/>
      <RunHighlights summary={summary} onInspect={inspect}/>
    </div>
    <PerEndpointTable summary={summary}/>
    <CaseExplorer entries={entries} expanded={expanded} onToggle={(key) => setExpanded((current) => current === key ? null : key)} saved onOpenInVerify={onRerun}/>
  </div>;
}
