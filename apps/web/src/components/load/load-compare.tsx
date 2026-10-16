import { mixLabelIn } from "@/lib/load.mjs";
import { AlertTriangle, GitCompareArrows } from "lucide-react";
import { Callout, Table } from "@radix-ui/themes";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { LineChart } from "@/components/charts/line-chart";
import { Delta, VerdictPill } from "@/components/common/stats";
import { testTypeLabel } from "@/components/load/use-load-runner";
import { CHART } from "@/lib/chart-colors";
import type { LoadRun, LoadWindow } from "@/lib/load-types";
import { formatDate } from "@/lib/format";
import { defineMessages, useIntlLocale, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    meanThroughput: "Rendimiento medio", max: "Máx", errorRate: "Tasa de error", completed: "Completadas", duration: "Duración",
    pass: "Pasa", fail: "No pasa", older: "A · anterior", newer: "B · posterior",
    different: "Distinto tipo de prueba o entorno: compara la forma de las curvas, no el veredicto.",
    metrics: "Métricas", metric: "Métrica", change: "Cambio",
    p95PerSecond: "p95 por segundo", throughputPerSecond: "Rendimiento por segundo",
  },
  en: {
    meanThroughput: "Mean throughput", max: "Max", errorRate: "Error rate", completed: "Completed", duration: "Duration",
    pass: "Pass", fail: "Fail", older: "A · earlier", newer: "B · later",
    different: "Different test type or environment: compare the shape of the curves, not the verdict.",
    metrics: "Metrics", metric: "Metric", change: "Change",
    p95PerSecond: "p95 per second", throughputPerSecond: "Throughput per second",
  },
});

/** Two windows series on one time axis (seconds from the start), a gap where one has no second. */
function aligned(a: LoadWindow[], b: LoadWindow[], pick: (window: LoadWindow) => number | null) {
  const x = [...new Set([...a, ...b].map((window) => window.t))].sort((left, right) => left - right);
  const index = (windows: LoadWindow[]) => new Map(windows.map((window) => [window.t, window]));
  const ia = index(a);
  const ib = index(b);
  const value = (map: Map<number, LoadWindow>, t: number) => { const window = map.get(t); return window && window.completed ? pick(window) : null; };
  return { x, a: x.map((t) => value(ia, t)), b: x.map((t) => value(ib, t)) };
}

type Row = { label: string; a: number | null | undefined; b: number | null | undefined; format: (value: number) => string; lowerIsBetter?: boolean };

/**
 * Two saved load tests side by side: their numbers with the change, and their latency and
 * throughput second by second on the same axis. A is the older; B is drawn solid.
 */
export function LoadCompare({ a, b }: { a: LoadRun; b: LoadRun }) {
  const locale = useLocale();
  const intl = useIntlLocale();
  const t = useMessages(MESSAGES);
  const windowsA = a.report?.windows ?? [];
  const windowsB = b.report?.windows ?? [];
  const latency = aligned(windowsA, windowsB, (window) => window.p95);
  const throughput = aligned(windowsA, windowsB, (window) => Math.round(window.rps * 10) / 10);
  const ms = (value: number) => `${value} ms`;
  const rows: Row[] = [
    { label: t.meanThroughput, a: a.rps, b: b.rps, format: (value) => `${value} req/s`, lowerIsBetter: false },
    { label: "p50", a: a.p50, b: b.p50, format: ms },
    { label: "p95", a: a.p95, b: b.p95, format: ms },
    { label: "p99", a: a.p99, b: b.p99, format: ms },
    { label: t.max, a: a.report?.overall.max, b: b.report?.overall.max, format: ms },
    { label: t.errorRate, a: a.errorRate, b: b.errorRate, format: (value) => `${(value * 100).toFixed(2)} %` },
    { label: "Apdex", a: a.apdex, b: b.apdex, format: (value) => value.toFixed(2), lowerIsBetter: false },
    { label: t.completed, a: a.report?.overall.completed, b: b.report?.overall.completed, format: (value) => value.toLocaleString(intl), lowerIsBetter: false },
    { label: t.duration, a: a.elapsedS, b: b.elapsedS, format: (value) => `${value} s`, lowerIsBetter: false },
  ];
  const head = (run: LoadRun, name: string) => <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-start justify-between gap-2"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{name}</p><VerdictPill pass={run.pass} label={run.pass ? t.pass : t.fail}/></div><p className="truncate text-sm font-semibold">{testTypeLabel(run.type, locale)} · {mixLabelIn(run.mix, locale)}</p><p className="truncate text-[11px] text-slate-500">{formatDate(run.at, locale)} · {run.environment}</p></div>;
  const series = (values: { a: (number | null)[]; b: (number | null)[] }) => [{ key: "a", label: "A", color: CHART.muted, dashed: true, values: values.a }, { key: "b", label: "B", color: CHART.violet, values: values.b }];

  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2">{head(a, t.older)}{head(b, t.newer)}</div>
    {(a.type !== b.type || a.environment !== b.environment) && <Callout.Root size="1" color="amber"><Callout.Icon><AlertTriangle className="size-4"/></Callout.Icon><Callout.Text className="text-[11px]">{t.different}</Callout.Text></Callout.Root>}
    <Card className="overflow-x-auto"><p className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5 text-sm font-semibold"><GitCompareArrows className="size-4 text-slate-400"/>{t.metrics}<InfoTip id="loadCompare"/></p>
      <Table.Root size="1" variant="ghost" className="w-full text-[11px]"><Table.Header><Table.Row className="text-left text-slate-400"><Table.ColumnHeaderCell className="px-4 font-medium">{t.metric}</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="text-right font-medium">A</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="text-right font-medium">B</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="px-4 text-right font-medium">{t.change}</Table.ColumnHeaderCell></Table.Row></Table.Header>
        <Table.Body>{rows.map((row) => <Table.Row key={row.label}><Table.Cell className="px-4 text-slate-700">{row.label}</Table.Cell><Table.Cell className="text-right font-mono text-slate-500">{row.a != null ? row.format(row.a) : "—"}</Table.Cell><Table.Cell className="text-right font-mono font-semibold">{row.b != null ? row.format(row.b) : "—"}</Table.Cell><Table.Cell className="px-4 text-right">{row.a != null && row.b != null && <Delta value={row.b} previous={row.a} unit="" lowerIsBetter={row.lowerIsBetter ?? true}/>}</Table.Cell></Table.Row>)}</Table.Body></Table.Root>
    </Card>
    {windowsA.length > 0 && windowsB.length > 0 && <Card className="p-5"><div className="grid gap-6 xl:grid-cols-2">
      <LineChart info="chartLatency" title={t.p95PerSecond} unit="ms" x={latency.x} series={series(latency)}/>
      <LineChart info="chartThroughput" title={t.throughputPerSecond} unit="req/s" x={throughput.x} series={series(throughput)}/>
    </div></Card>}
  </div>;
}
