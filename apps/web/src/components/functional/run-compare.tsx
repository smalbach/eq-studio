import { useMemo } from "react";
import { GitCompareArrows } from "lucide-react";
import { Table } from "@radix-ui/themes";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { Delta } from "@/components/common/stats";
import { RunComparison } from "@/components/functional/run/run-summary";
import { useEndpoints } from "@/lib/endpoints";
import { summarizeResults } from "@/lib/results-summary.mjs";
import { compareRuns } from "@/lib/run-snapshot.mjs";
import { entriesOfRun } from "@/lib/run-entries";
import { passRateByTag } from "@/lib/run-analytics";
import type { RunRecord } from "@/lib/run-types";
import { formatDate, percent, seconds } from "@/lib/format";
import { cn } from "@/lib/utils";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    success: "Éxito", cases: "Casos", failed: "Fallidos", requests: "Solicitudes HTTP", p50: "Latencia p50", p95: "Latencia p95", max: "Latencia máx", failedAssertions: "Aserciones fallidas", verified: "Respuestas verificadas", duration: "Duración",
    older: "A · anterior", newer: "B · posterior",
    different: (environment: boolean, scope: boolean) => `Distinto ${environment ? "entorno" : ""}${environment && scope ? " y " : ""}${scope ? "alcance" : ""}: los totales no son directamente comparables; el cambio caso por caso sí, sobre los casos que ambas corrieron.`,
    metrics: "Métricas", metric: "Métrica", change: "Cambio", byTag: "Éxito por tag", deltaPoints: "Δ puntos",
  },
  en: {
    success: "Pass rate", cases: "Cases", failed: "Failed", requests: "HTTP requests", p50: "Latency p50", p95: "Latency p95", max: "Latency max", failedAssertions: "Failed assertions", verified: "Verified responses", duration: "Duration",
    older: "A · older", newer: "B · newer",
    different: (environment: boolean, scope: boolean) => `Different ${environment ? "environment" : ""}${environment && scope ? " and " : ""}${scope ? "scope" : ""}: the totals are not directly comparable; the case-by-case change is, over the cases both ran.`,
    metrics: "Metrics", metric: "Metric", change: "Change", byTag: "Pass rate by tag", deltaPoints: "Δ points",
  },
});

type Row = { label: string; a: number; b: number; format: (value: number) => string; lowerIsBetter?: boolean; points?: boolean };

/** A change in a rate, in percentage points: 97 % → 100 % is +3 pts, not "+3 %". */
function PointsDelta({ a, b }: { a: number; b: number }) {
  const points = Math.round((b - a) * 1000) / 10;
  if (points === 0) return <span className="text-[10px] text-slate-400">=</span>;
  return <span className={cn("text-[10px] font-mono", points > 0 ? "text-emerald-600" : "text-rose-600")}>{points > 0 ? "+" : ""}{points} pts</span>;
}

/**
 * Two saved runs side by side, whatever their environment or scope: the headline numbers with
 * their change, the cases that changed result, and the pass rate of each tag. A is the older.
 */
export function RunCompare({ a, b, onInspect }: { a: RunRecord; b: RunRecord; onInspect: (runId: string, endpointId: string, scenarioId: string) => void }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const ea = useMemo(() => entriesOfRun(a, locale), [a, locale]);
  const eb = useMemo(() => entriesOfRun(b, locale), [b, locale]);
  const endpoints = useEndpoints();
  const sa = useMemo(() => summarizeResults(ea, endpoints), [ea, endpoints]);
  const sb = useMemo(() => summarizeResults(eb, endpoints), [eb, endpoints]);
  const comparison = useMemo(() => compareRuns(b, a), [a, b]);
  const tags = useMemo(() => {
    const ta = passRateByTag(ea);
    const tb = passRateByTag(eb);
    return [...new Set([...ta.keys(), ...tb.keys()])].sort().map((tag) => ({ tag, a: ta.get(tag), b: tb.get(tag) }));
  }, [ea, eb]);
  const ms = (value: number) => `${value} ms`;
  const rows: Row[] = [
    { label: t.success, a: a.total ? a.passed / a.total : 0, b: b.total ? b.passed / b.total : 0, format: (value) => percent(value), lowerIsBetter: false, points: true },
    { label: t.cases, a: a.total, b: b.total, format: String, lowerIsBetter: false },
    { label: t.failed, a: a.failed, b: b.failed, format: String },
    { label: t.requests, a: sa.requests.total, b: sb.requests.total, format: String },
    { label: t.p50, a: sa.requests.latency.p50, b: sb.requests.latency.p50, format: ms },
    { label: t.p95, a: sa.requests.latency.p95, b: sb.requests.latency.p95, format: ms },
    { label: t.max, a: sa.requests.latency.max, b: sb.requests.latency.max, format: ms },
    { label: t.failedAssertions, a: sa.assertions.failed, b: sb.assertions.failed, format: String },
    { label: t.verified, a: sa.coverageTotals.verified, b: sb.coverageTotals.verified, format: String, lowerIsBetter: false },
    { label: t.duration, a: a.durationMs, b: b.durationMs, format: seconds },
  ];
  const column = (run: RunRecord, name: string) => <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{name}</p><p className="truncate text-sm font-semibold" title={run.scope}>{run.scope}</p><p className="truncate text-[11px] text-slate-500">{formatDate(run.at, locale)} · {run.environment}</p></div>;

  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2">{column(a, t.older)}{column(b, t.newer)}</div>
    {(a.environment !== b.environment || a.scope !== b.scope) && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">{t.different(a.environment !== b.environment, a.scope !== b.scope)}</p>}
    <Card className="overflow-x-auto"><p className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5 text-sm font-semibold"><GitCompareArrows className="size-4 text-slate-400"/>{t.metrics}<InfoTip id="runCompare"/></p>
      <Table.Root size="1" variant="ghost" className="w-full text-[11px]"><Table.Header><Table.Row className="text-left text-slate-400"><Table.ColumnHeaderCell className="px-4 py-2 font-medium">{t.metric}</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="py-2 text-right font-medium">A</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="py-2 text-right font-medium">B</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="px-4 py-2 text-right font-medium">{t.change}</Table.ColumnHeaderCell></Table.Row></Table.Header>
        <Table.Body>{rows.map((row) => <Table.Row key={row.label}><Table.Cell className="px-4 py-2 text-slate-700">{row.label}</Table.Cell><Table.Cell className="py-2 text-right font-mono text-slate-500">{row.format(row.a)}</Table.Cell><Table.Cell className="py-2 text-right font-mono font-semibold">{row.format(row.b)}</Table.Cell><Table.Cell className="px-4 py-2 text-right">{row.points ? <PointsDelta a={row.a} b={row.b}/> : <Delta value={row.b} previous={row.a} unit="" lowerIsBetter={row.lowerIsBetter ?? true}/>}</Table.Cell></Table.Row>)}</Table.Body></Table.Root>
    </Card>
    <RunComparison comparison={comparison} previous={a} onInspect={(endpointId, scenarioId) => onInspect(b.id, endpointId, scenarioId)}/>
    {tags.length > 0 && <Card className="overflow-x-auto"><p className="border-b border-slate-200 px-4 py-2.5 text-sm font-semibold">{t.byTag}</p>
      <Table.Root size="1" variant="ghost" className="w-full text-[11px]"><Table.Header><Table.Row className="text-left text-slate-400"><Table.ColumnHeaderCell className="px-4 py-2 font-medium">Tag</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="py-2 text-right font-medium">A</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="py-2 text-right font-medium">B</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="px-4 py-2 text-right font-medium">{t.deltaPoints}</Table.ColumnHeaderCell></Table.Row></Table.Header>
        <Table.Body>{tags.map(({ tag, a: ra, b: rb }) => { const pa = ra ? ra.passed / ra.total : null; const pb = rb ? rb.passed / rb.total : null; const delta = pa != null && pb != null ? Math.round((pb - pa) * 1000) / 10 : null; return <Table.Row key={tag}><Table.Cell className="px-4 py-2 text-slate-700">{tag}</Table.Cell><Table.Cell className="py-2 text-right font-mono text-slate-500">{pa != null ? `${percent(pa, 0)} (${ra!.passed}/${ra!.total})` : "—"}</Table.Cell><Table.Cell className="py-2 text-right font-mono">{pb != null ? `${percent(pb, 0)} (${rb!.passed}/${rb!.total})` : "—"}</Table.Cell><Table.Cell className={cn("px-4 py-2 text-right font-mono", delta != null && delta < 0 && "text-rose-600", delta != null && delta > 0 && "text-emerald-700")}>{delta == null ? "—" : delta === 0 ? "=" : `${delta > 0 ? "+" : ""}${delta}`}</Table.Cell></Table.Row>; })}</Table.Body></Table.Root>
    </Card>}
  </div>;
}
