import { Check, Download, X, Zap } from "lucide-react";
import { CHART } from "@/lib/chart-colors";
import { Badge, Button, Table } from "@radix-ui/themes";
import { Card } from "@/components/ui/card";
import { LineChart } from "@/components/charts/line-chart";
import { InfoTip } from "@/components/info-tip";
import type { GlossaryKey } from "@/lib/glossary";
import { errorKinds, localizeReport } from "@/lib/load.mjs";
import { useMemo } from "react";
import { defineMessages, useIntlLocale, useLocale, useMessages } from "@/lib/i18n";
import type { LoadReport, LoadWindow, PreflightResult, TestType } from "@/lib/load-types";
import { Th } from "@/components/common/stats";
import { LoadAnalysis } from "@/components/load/load-analysis";
import { LoadDegradation } from "@/components/load/load-degradation";
import { cn } from "@/lib/utils";

const MESSAGES = defineMessages({
  es: {
    throughput: "Rendimiento", requested: "Pedido", delivered: "Entregado",
    latencyPerSecond: "Latencia por segundo", limit: (ms: number) => `Límite ${ms} ms`,
    errorRatePerSecond: "Tasa de error por segundo", maxError: "Máx. 0,1 %", errors: "Errores",
    inFlightTitle: "Solicitudes en vuelo", inFlight: "En vuelo",
    pass: "Pasa", fail: "No pasa",
    latencyMode: "Latencia evaluada con: ", customLimit: (ms: number | undefined) => `límite p95 propio de ${ms} ms`, informative: "solo informativa", projectBudgets: "presupuestos del proyecto",
    exportJson: "Exportar reporte JSON",
    sent: "Enviadas", plan: (n: string) => `plan ~${n}`,
    completed: "Completadas", ofPlan: (pct: string) => `${pct} % del plan`,
    success: "Éxito", errorCount: (n: string) => `${n} errores`,
    dropped: "Descartadas", concurrencyLimit: "límite de concurrencia",
    duration: "Duración", stopped: "detenida", complete: "completa",
    noLatencyLimit: "sin límite de latencia",
    meanThroughput: "Rendimiento medio", peakMin: (peak: string, min: string | undefined) => `pico ${peak} · mín ${min}`,
    transferred: "Transferido",
    peakInFlight: "En vuelo (pico)", realConcurrency: "concurrencia real alcanzada",
    firstError: "Primer error", none: "ninguno",
    meanLatency: "Latencia media",
    minMax: "Mín · Máx", maxHint: (value: string) => `máx ${value}`, maxShort: "máx",
    histogram: "Distribución de latencia", noData: "Sin datos.",
    statusCodes: "Códigos de respuesta", errorKinds: "Errores por causa", noErrors: "Sin errores.",
    byTarget: "Por objetivo", target: "Objetivo", requests: "Solicitudes", error: "Error", mean: "Media", max: "Máx", limitCol: "Límite", codes: "Códigos",
    byStage: "Por etapa", stage: "Etapa", ramp: " · rampa",
    preflight: "Verificación previa", ready: (ok: number, total: number) => `${ok} / ${total} listos`,
  },
  en: {
    throughput: "Throughput", requested: "Requested", delivered: "Delivered",
    latencyPerSecond: "Latency per second", limit: (ms: number) => `Limit ${ms} ms`,
    errorRatePerSecond: "Error rate per second", maxError: "Max. 0.1 %", errors: "Errors",
    inFlightTitle: "Requests in flight", inFlight: "In flight",
    pass: "Pass", fail: "Fail",
    latencyMode: "Latency judged with: ", customLimit: (ms: number | undefined) => `custom p95 limit of ${ms} ms`, informative: "informative only", projectBudgets: "project budgets",
    exportJson: "Export JSON report",
    sent: "Sent", plan: (n: string) => `plan ~${n}`,
    completed: "Completed", ofPlan: (pct: string) => `${pct} % of the plan`,
    success: "Success", errorCount: (n: string) => `${n} errors`,
    dropped: "Dropped", concurrencyLimit: "concurrency limit",
    duration: "Duration", stopped: "stopped", complete: "complete",
    noLatencyLimit: "no latency limit",
    meanThroughput: "Mean throughput", peakMin: (peak: string, min: string | undefined) => `peak ${peak} · min ${min}`,
    transferred: "Transferred",
    peakInFlight: "In flight (peak)", realConcurrency: "actual concurrency reached",
    firstError: "First error", none: "none",
    meanLatency: "Mean latency",
    minMax: "Min · Max", maxHint: (value: string) => `max ${value}`, maxShort: "max",
    histogram: "Latency distribution", noData: "No data.",
    statusCodes: "Response codes", errorKinds: "Errors by cause", noErrors: "No errors.",
    byTarget: "By target", target: "Target", requests: "Requests", error: "Error", mean: "Mean", max: "Max", limitCol: "Limit", codes: "Codes",
    byStage: "By stage", stage: "Stage", ramp: " · ramp",
    preflight: "Preflight", ready: (ok: number, total: number) => `${ok} / ${total} ready`,
  },
});

export const LOAD_COLORS = { requested: CHART.muted, delivered: CHART.blue, errors: CHART.rose, p50: CHART.blue, p95: CHART.violet, p99: CHART.amber, inFlight: CHART.blue };

const ms = (value: number | undefined | null) => value == null ? "—" : `${Number.isInteger(value) ? value : value.toFixed(1)} ms`;
const pct = (value: number | undefined | null, digits = 2) => value == null ? "—" : `${(value * 100).toFixed(digits)} %`;
const num = (value: number | undefined | null, intl = "es-CO") => value == null ? "—" : value.toLocaleString(intl);
function bytes(value: number | undefined) {
  if (!value) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function Metric({ label, value, hint, tone, info }: { label: string; value: string; hint?: string; tone?: "good" | "bad"; info?: GlossaryKey }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
    <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}{info && <InfoTip id={info} size="xs"/>}</p>
    <p className={cn("mt-0.5 font-mono text-base font-semibold text-slate-800", tone === "good" && "text-emerald-700", tone === "bad" && "text-rose-600")}>{value}</p>
    {hint && <p className="mt-0.5 text-[10px] leading-4 text-slate-400">{hint}</p>}
  </div>;
}

/** Plain HTML bars with the count beside each: the histogram and the error kinds. */
function Bars({ rows, color }: { rows: { label: string; count: number; title?: string }[]; color: string }) {
  const intl = useIntlLocale();
  const top = Math.max(1, ...rows.map((row) => row.count));
  const total = rows.reduce((sum, row) => sum + row.count, 0) || 1;
  return <div className="space-y-1">{rows.map((row) => <div key={row.label} title={row.title ?? `${row.label}: ${row.count}`} className="grid grid-cols-[88px_minmax(0,1fr)_96px] items-center gap-2 text-[11px]">
    <span className="truncate font-mono text-slate-500">{row.label}</span>
    <span className="h-2.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${(row.count / top) * 100}%`, background: color }}/></span>
    <span className="text-right font-mono text-slate-600">{num(row.count, intl)} <span className="text-slate-400">· {((row.count / total) * 100).toFixed(1)} %</span></span>
  </div>)}</div>;
}

/** The histogram without its empty buckets at either end. */
function trimEmpty(rows: { label: string; count: number }[]) {
  const first = rows.findIndex((row) => row.count > 0);
  const last = rows.findLastIndex((row) => row.count > 0);
  return first === -1 ? [] : rows.slice(first, last + 1);
}


function apdexTone(value: number | null | undefined) {
  if (value == null) return undefined;
  return value >= 0.85 ? "good" as const : value < 0.7 ? "bad" as const : undefined;
}

/** The charts of a run: throughput, latency, error rate and concurrency, one measure each. */
export function LoadCharts({ windows, budget }: { windows: LoadWindow[]; budget: number | null }) {
  const t = useMessages(MESSAGES);
  const x = windows.map((window) => window.t);
  return <div className="grid gap-6 xl:grid-cols-2">
    <LineChart info="chartThroughput" title={t.throughput} unit="req/s" x={x} series={[{ key: "requested", label: t.requested, color: LOAD_COLORS.requested, dashed: true, values: windows.map((window) => window.targetRps) }, { key: "delivered", label: t.delivered, color: LOAD_COLORS.delivered, values: windows.map((window) => window.rps) }]}/>
    <LineChart info="chartLatency" title={t.latencyPerSecond} unit="ms" x={x} reference={budget != null ? { label: t.limit(budget), value: budget } : null} series={[{ key: "p50", label: "p50", color: LOAD_COLORS.p50, values: windows.map((window) => window.completed ? window.p50 : null) }, { key: "p95", label: "p95", color: LOAD_COLORS.p95, values: windows.map((window) => window.completed ? window.p95 : null) }, { key: "p99", label: "p99", color: LOAD_COLORS.p99, dashed: true, values: windows.map((window) => window.completed ? window.p99 : null) }]}/>
    <LineChart info="chartErrorRate" title={t.errorRatePerSecond} unit="%" x={x} reference={{ label: t.maxError, value: 0.1 }} series={[{ key: "errors", label: t.errors, color: LOAD_COLORS.errors, values: windows.map((window) => window.completed ? Math.round(window.errorRate * 1000) / 10 : null) }]}/>
    <LineChart info="chartInFlight" title={t.inFlightTitle} unit="" x={x} series={[{ key: "inFlight", label: t.inFlight, color: LOAD_COLORS.inFlight, values: windows.map((window) => window.inFlight) }]}/>
  </div>;
}

/**
 * Everything a finished load test says: the verdict, the metrics of the whole run, the latency
 * histogram, why requests failed, and the per-target and per-stage tables. The same view shows
 * the run that just finished and any run of the history.
 */
export function LoadReportView({ report: saved, type, title, subtitle, onExport, budget }: { report: LoadReport; type: TestType; title: string; subtitle?: string; onExport?: () => void; budget: number | null }) {
  const t = useMessages(MESSAGES);
  const intl = useIntlLocale();
  const locale = useLocale();
  const kindNames = errorKinds(locale);
  // A run saved in the other language: stage names and verdict shown in this one.
  const report = useMemo(() => localizeReport(type, saved, locale) as LoadReport, [type, saved, locale]);
  const n = (value: number | undefined | null) => num(value, intl);
  const overall = report.overall;
  const kinds = Object.entries(overall.kinds ?? {}).filter(([, count]) => count > 0).map(([kind, count]) => ({ label: kind === "rateLimited" ? "429" : kind === "client" ? "4xx" : kind === "server" ? "5xx" : kind, count, title: kindNames[kind] ?? kind }));
  const statuses = Object.entries(overall.statuses).sort(([, a], [, b]) => b - a).map(([status, count]) => ({ label: status, count }));
  const deliveredRatio = overall.requested ? overall.completed / overall.requested : null;
  return <div className="space-y-5">
    <div className="grid gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
      <Card className={cn("p-5", report.verdict.pass ? "border-emerald-200" : "border-rose-200")}>
        <div className="mb-3 flex items-center justify-between gap-2"><div><p className="flex items-center gap-2 text-sm font-semibold"><Zap className="size-4 text-slate-400"/>{title}<InfoTip id="verdict"/></p>{subtitle && <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>}</div><Badge size="1" variant="soft" color={report.verdict.pass ? "jade" : "ruby"}>{report.verdict.pass ? t.pass : t.fail}</Badge></div>
        <div className="space-y-3">{report.verdict.checks.map((check) => <div key={check.label} className="flex gap-3"><span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full", check.pass ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600")}>{check.pass ? <Check className="size-3"/> : <X className="size-3"/>}</span><div className="min-w-0"><p className="text-xs font-medium">{check.label}</p><p className="mt-0.5 break-words text-[11px] leading-5 text-slate-500">{check.detail}</p></div></div>)}</div>
        <p className="mt-3 text-[10px] text-slate-400">{t.latencyMode}{report.latencyMode?.mode === "custom" ? t.customLimit(report.latencyMode.p95Ms) : report.latencyMode?.mode === "off" ? t.informative : t.projectBudgets}</p>
        {onExport && <Button size="1" variant="surface" color="gray" onClick={onExport} className="mt-4 print:hidden"><Download className="size-3.5"/>{t.exportJson}</Button>}
      </Card>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-6">
          <Metric info="sent" label={t.sent} value={n(overall.sent)} hint={overall.requested ? t.plan(n(overall.requested)) : undefined}/>
          <Metric info="completed" label={t.completed} value={n(overall.completed)} hint={deliveredRatio != null ? t.ofPlan((deliveredRatio * 100).toFixed(1)) : undefined}/>
          <Metric info="successRate" label={t.success} value={pct(overall.successRate ?? 1 - overall.errorRate)} tone={overall.errorRate <= 0.001 ? "good" : "bad"} hint={t.errorCount(n(overall.errors))}/>
          <Metric info="dropped" label={t.dropped} value={n(overall.dropped)} tone={overall.dropped ? "bad" : undefined} hint={t.concurrencyLimit}/>
          <Metric info="elapsed" label={t.duration} value={`${report.elapsedS} s`} hint={report.aborted ? t.stopped : t.complete} tone={report.aborted ? "bad" : undefined}/>
          <Metric info="apdex" label="Apdex" value={overall.apdex != null ? overall.apdex.toFixed(2) : "—"} tone={apdexTone(overall.apdex)} hint={overall.apdexThresholdMs ? `T = ${overall.apdexThresholdMs} ms` : t.noLatencyLimit}/>
          <Metric info="rpsMean" label={t.meanThroughput} value={`${overall.rps.toFixed(1)} req/s`} hint={overall.peakRps != null ? t.peakMin(overall.peakRps.toFixed(0), overall.minRps?.toFixed(0)) : undefined}/>
          <Metric info="transferred" label={t.transferred} value={bytes(overall.bytes)} hint={overall.kbps != null ? `${overall.kbps} KB/s` : undefined}/>
          <Metric info="peakInFlight" label={t.peakInFlight} value={n(overall.peakInFlight)} hint={t.realConcurrency}/>
          <Metric info="firstError" label={t.firstError} value={overall.firstErrorS != null ? `${overall.firstErrorS} s` : t.none} tone={overall.firstErrorS != null ? "bad" : "good"}/>
          <Metric info="mean" label={t.meanLatency} value={ms(overall.mean)} hint={overall.stddev != null ? `σ ${ms(overall.stddev)}` : undefined}/>
          <Metric info="minMax" label={t.minMax} value={`${ms(overall.min)}`} hint={t.maxHint(ms(overall.max))}/>
        </div>
        <Card className="overflow-x-auto p-0"><Table.Root size="1" variant="ghost" className="w-full text-[11px]"><Table.Header><Table.Row className="text-left text-slate-400">{([["p50", "p50"], ["p75", "p75"], ["p90", "p90"], ["p95", "p95"], ["p99", "p99"], ["p99.9", "p999"], [t.maxShort, "max"]] as const).map(([label, key]) => <Table.ColumnHeaderCell key={key} className="px-3 py-2 text-right font-medium first:pl-4"><span className="inline-flex items-center gap-1">{label}<InfoTip id={key} size="xs"/></span></Table.ColumnHeaderCell>)}</Table.Row></Table.Header>
          <Table.Body><Table.Row>{[overall.p50, overall.p75, overall.p90, overall.p95, overall.p99, overall.p999, overall.max].map((value, index) => <Table.Cell key={index} className={cn("px-3 py-2 text-right font-mono first:pl-4", index === 3 && budget != null && (value ?? 0) >= budget && "text-rose-600")}>{ms(value)}</Table.Cell>)}</Table.Row></Table.Body></Table.Root></Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4"><p className="mb-2 flex items-center gap-1 text-xs font-semibold text-slate-700">{t.histogram}<InfoTip id="histogram" size="xs"/></p>{report.histogram?.length ? <Bars rows={trimEmpty(report.histogram)} color={LOAD_COLORS.p95}/> : <p className="text-[11px] text-slate-400">{t.noData}</p>}</Card>
          <Card className="p-4"><p className="mb-2 flex items-center gap-1 text-xs font-semibold text-slate-700">{t.statusCodes}<InfoTip id="statusCodes" size="xs"/></p><Bars rows={statuses} color={LOAD_COLORS.delivered}/>
            <p className="mb-2 mt-4 flex items-center gap-1 text-xs font-semibold text-slate-700">{t.errorKinds}<InfoTip id="errorKinds" size="xs"/></p>{kinds.length ? <Bars rows={kinds} color={LOAD_COLORS.errors}/> : <p className="flex items-center gap-1.5 text-[11px] text-emerald-700"><Check className="size-3.5"/>{t.noErrors}</p>}
            {kinds.length > 0 && <ul className="mt-2 space-y-0.5 text-[10px] leading-4 text-slate-400">{Object.entries(overall.kinds ?? {}).filter(([, count]) => count > 0).map(([kind]) => <li key={kind}>{kindNames[kind] ?? kind}</li>)}</ul>}</Card>
        </div>
      </div>
    </div>
    <Card className="p-5"><LoadCharts windows={report.windows} budget={budget}/></Card>
    <LoadDegradation report={report} type={type} budget={budget}/>
    <LoadAnalysis report={report} budget={budget}/>
    <Card className="overflow-x-auto"><p className="flex items-center gap-1 border-b border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-700">{t.byTarget}<InfoTip id="tableTargets" size="xs"/></p><Table.Root size="1" variant="ghost" className="w-full text-[11px]"><Table.Header><Table.Row className="text-left text-slate-400"><Table.ColumnHeaderCell className="px-4 font-medium"><span className="inline-flex items-center gap-1">{t.target}<InfoTip id="targetPath" size="xs"/></span></Table.ColumnHeaderCell><Th label={t.requests} info="colRequests"/><Th label="req/s" info="colRps"/><Th label={t.error} info="colError"/><Th label={t.mean} info="mean"/><Th label="p50" info="p50"/><Th label="p90" info="p90"/><Th label="p95" info="p95"/><Th label="p99" info="p99"/><Th label={t.max} info="max"/><Th label="Apdex" info="apdex"/><Th label="KB" info="colKb"/><Th label={t.limitCol} info="colLimit"/><Th label={t.codes} info="colCodes" className="px-4"/></Table.Row></Table.Header>
      <Table.Body>{report.targets.map((target, index) => { const over = target.budgetMs != null && target.p95 >= target.budgetMs; return <Table.Row key={`${target.path}:${index}`}><Table.Cell className="max-w-72 px-4"><p className="truncate font-medium text-slate-700" title={target.label}>{target.label}</p><p className="truncate font-mono text-[10px] text-slate-400" title={target.path}>{target.path}</p></Table.Cell><Table.Cell className="text-right font-mono">{n(target.completed)}</Table.Cell><Table.Cell className="text-right font-mono">{target.rps.toFixed(1)}</Table.Cell><Table.Cell className={cn("text-right font-mono", target.errors && "text-rose-600")}>{pct(target.errorRate)}</Table.Cell><Table.Cell className="text-right font-mono">{ms(target.mean)}</Table.Cell><Table.Cell className="text-right font-mono">{ms(target.p50)}</Table.Cell><Table.Cell className="text-right font-mono">{ms(target.p90)}</Table.Cell><Table.Cell className={cn("text-right font-mono", over && "text-rose-600")}>{ms(target.p95)}</Table.Cell><Table.Cell className="text-right font-mono">{ms(target.p99)}</Table.Cell><Table.Cell className="text-right font-mono">{ms(target.max)}</Table.Cell><Table.Cell className="text-right font-mono">{target.apdex != null ? target.apdex.toFixed(2) : "—"}</Table.Cell><Table.Cell className="text-right font-mono">{target.bytes != null ? (target.bytes / 1024).toFixed(0) : "—"}</Table.Cell><Table.Cell className="text-right font-mono text-slate-500">{target.budgetMs != null ? `< ${target.budgetMs} ms` : "—"}</Table.Cell><Table.Cell className="px-4 text-right font-mono text-slate-500">{Object.entries(target.statuses).map(([status, count]) => `${status}×${count}`).join(" ")}</Table.Cell></Table.Row>; })}</Table.Body></Table.Root></Card>
    <Card className="overflow-x-auto"><p className="flex items-center gap-1 border-b border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-700">{t.byStage}<InfoTip id="tableStages" size="xs"/></p><Table.Root size="1" variant="ghost" className="w-full text-[11px]"><Table.Header><Table.Row className="text-left text-slate-400"><Table.ColumnHeaderCell className="px-4 font-medium"><span className="inline-flex items-center gap-1">{t.stage}<InfoTip id="colStage" size="xs"/></span></Table.ColumnHeaderCell><Th label={t.requested} info="colRequested"/><Th label={t.delivered} info="colDelivered"/><Th label={t.dropped} info="dropped"/><Th label={t.error} info="colError"/><Th label="p50" info="p50"/><Th label="p95" info="p95"/><Th label="p99" info="p99"/><Th label={t.codes} info="colCodes" className="px-4"/></Table.Row></Table.Header>
      <Table.Body>{report.stages.map((stage) => <Table.Row key={stage.label}><Table.Cell className="px-4">{stage.label}{!stage.measured && <span className="text-slate-400">{t.ramp}</span>}</Table.Cell><Table.Cell className="text-right font-mono text-slate-500">{(stage.fromRps + stage.toRps) / 2} req/s</Table.Cell><Table.Cell className="text-right font-mono">{stage.rps.toFixed(1)} req/s</Table.Cell><Table.Cell className={cn("text-right font-mono", stage.dropped && "text-rose-600")}>{stage.dropped}</Table.Cell><Table.Cell className={cn("text-right font-mono", stage.errors && "text-rose-600")}>{pct(stage.errorRate)}</Table.Cell><Table.Cell className="text-right font-mono">{ms(stage.p50)}</Table.Cell><Table.Cell className="text-right font-mono">{ms(stage.p95)}</Table.Cell><Table.Cell className="text-right font-mono">{ms(stage.p99)}</Table.Cell><Table.Cell className="px-4 text-right font-mono text-slate-500">{Object.entries(stage.statuses).map(([status, count]) => `${status}×${count}`).join(" ")}</Table.Cell></Table.Row>)}</Table.Body></Table.Root></Card>
  </div>;
}

export function PreflightTable({ results }: { results: PreflightResult[] }) {
  const t = useMessages(MESSAGES);
  const failed = results.filter((result) => !result.ok).length;
  return <div className="rounded-xl border border-slate-200">
    <p className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-700"><span className="flex items-center gap-1">{t.preflight}<InfoTip id="preflight" size="xs"/></span><span className={cn("font-mono font-normal", failed ? "text-rose-600" : "text-emerald-700")}>{t.ready(results.length - failed, results.length)}</span></p>
    <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto">{results.map((result, index) => <li key={`${result.path}:${index}`} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
      <span className={cn("grid size-4 shrink-0 place-items-center rounded-full", result.ok ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600")}>{result.ok ? <Check className="size-2.5"/> : <X className="size-2.5"/>}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-slate-600" title={result.path}>{result.path}</span>
      <span className={cn("shrink-0", result.ok ? "font-mono text-slate-400" : "text-rose-600")}>{result.ok ? `${result.status} · ${ms(result.latency)}` : result.problem}</span>
    </li>)}</ul>
  </div>;
}
