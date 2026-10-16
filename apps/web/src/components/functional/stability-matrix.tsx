import { useMemo, useState } from "react";
import { Grid3x3 } from "lucide-react";
import { Link, SegmentedControl, Table } from "@radix-ui/themes";
import { Card } from "@/components/ui/card";
import { CardTitle } from "@/components/common/stats";
import { caseName } from "@/lib/run-entries";
import { stabilityMatrix } from "@/lib/run-analytics";
import type { RunRecord } from "@/lib/run-types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    title: "Mapa de estabilidad",
    extra: (shown: number, total: number, runs: number) => `· ${shown} de ${total} casos · últimas ${runs} ejecuciones`,
    unstable: "Con algún fallo", all: "Todos",
    case: "Caso", failures: "Fallos",
    notIncluded: "No incluido en esa ejecución",
    passed: "Pasó", failed: "Falló",
    inRun: (result: string, n: number) => `${result} en la ejecución ${n}`,
    more: (n: number) => `Ver ${n} más`,
    legendPassed: "pasó", legendFailed: "falló", legendMissing: "no incluido",
    legendNote: "· Columnas de la más antigua (1) a la más reciente. Clic abre el caso en esa ejecución.",
    none: (n: number) => `Ningún caso falló en las últimas ${n} ejecuciones.`,
  },
  en: {
    title: "Stability map",
    extra: (shown: number, total: number, runs: number) => `· ${shown} of ${total} cases · last ${runs} runs`,
    unstable: "With any failure", all: "All",
    case: "Case", failures: "Failures",
    notIncluded: "Not included in that run",
    passed: "Passed", failed: "Failed",
    inRun: (result: string, n: number) => `${result} in run ${n}`,
    more: (n: number) => `Show ${n} more`,
    legendPassed: "passed", legendFailed: "failed", legendMissing: "not included",
    legendNote: "· Columns from oldest (1) to newest. Click opens the case in that run.",
    none: (n: number) => `No case failed in the last ${n} runs.`,
  },
});

const PAGE = 40;

/**
 * Case × run: each case's result in each of the last runs, oldest left. A column of red is an
 * environment that broke; a row that alternates is a flaky case; a row red from some run onward
 * is a regression that started there. ✕ marks a failure, so the grid never relies on colour.
 */
export function StabilityMatrix({ runs, onOpenCell }: { runs: RunRecord[]; onOpenCell: (runId: string, key: string) => void }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const [unstableOnly, setUnstableOnly] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const matrix = useMemo(() => stabilityMatrix(runs, { unstableOnly }), [runs, unstableOnly]);
  if (matrix.columns.length < 2) return null;
  const rows = matrix.rows.slice(0, limit);
  return <Card className="mb-5 overflow-hidden">
    <CardTitle icon={<Grid3x3 className="size-4 text-slate-400"/>} title={t.title} info="stabilityMatrix" extra={t.extra(matrix.rows.length, matrix.totalCases, matrix.columns.length)}>
      <SegmentedControl.Root size="1" value={unstableOnly ? "unstable" : "all"} onValueChange={(value) => { setUnstableOnly(value === "unstable"); setLimit(PAGE); }}>{([["unstable", t.unstable], ["all", t.all]] as const).map(([value, label]) => <SegmentedControl.Item key={value} value={value}>{label}</SegmentedControl.Item>)}</SegmentedControl.Root>
    </CardTitle>
    {rows.length ? <div className="overflow-x-auto px-5 py-3">
      <Table.Root size="1" variant="ghost" className="text-[11px] [&_.rt-TableCell]:h-auto [&_.rt-TableCell]:shadow-none">
        <Table.Header><Table.Row><Table.ColumnHeaderCell className="px-0 pb-1 pt-0 pr-3 text-left font-medium text-slate-400">{t.case}</Table.ColumnHeaderCell>{matrix.columns.map((run, index) => <Table.ColumnHeaderCell key={run.id} title={`${formatDate(run.at, locale)} · ${run.scope} · ${run.environment}`} className="w-5 p-0 pb-1 text-center font-mono text-[9px] font-normal text-slate-400">{index + 1}</Table.ColumnHeaderCell>)}<Table.ColumnHeaderCell className="px-0 pb-1 pt-0 pl-3 text-right font-medium text-slate-400">{t.failures}</Table.ColumnHeaderCell></Table.Row></Table.Header>
        <Table.Body>{rows.map((row) => { const name = caseName(row.key, locale); return <Table.Row key={row.key}>
          <Table.Cell className="max-w-[340px] truncate px-0 py-0.5 pr-3" title={`${name.label} · ${name.scenario}`}><span className="font-mono text-slate-700">{name.label}</span> <span className="text-slate-400">· {name.scenario}</span></Table.Cell>
          {row.cells.map((cell, index) => <Table.Cell key={index} className="p-[1px]">{cell == null
            ? <span title={t.notIncluded} className="block size-4 rounded-[3px] bg-slate-100"/>
            : <button type="button" onClick={() => onOpenCell(matrix.columns[index].id, row.key)} title={`${cell ? t.passed : t.failed} · ${formatDate(matrix.columns[index].at, locale)}`} aria-label={t.inRun(cell ? t.passed : t.failed, index + 1)} className={cn("grid size-4 place-items-center rounded-[3px] text-[9px] font-bold leading-none text-white", cell ? "bg-emerald-500 hover:bg-emerald-600" : "bg-rose-500 hover:bg-rose-600")}>{cell ? "" : "✕"}</button>}</Table.Cell>)}
          <Table.Cell className={cn("px-0 py-0.5 pl-3 text-right font-mono", row.failures ? "text-rose-600" : "text-slate-400")}>{row.failures}/{row.runs}</Table.Cell>
        </Table.Row>; })}</Table.Body>
      </Table.Root>
      {matrix.rows.length > limit && <Link asChild size="1" weight="medium" underline="hover"><button type="button" onClick={() => setLimit((value) => value + PAGE)} className="mt-2 block print:hidden">{t.more(Math.min(PAGE, matrix.rows.length - limit))}</button></Link>}
      <p className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-slate-400"><span className="flex items-center gap-1"><span className="size-3 rounded-[3px] bg-emerald-500"/>{t.legendPassed}</span><span className="flex items-center gap-1"><span className="grid size-3 place-items-center rounded-[3px] bg-rose-500 text-[8px] font-bold text-white">✕</span>{t.legendFailed}</span><span className="flex items-center gap-1"><span className="size-3 rounded-[3px] bg-slate-100"/>{t.legendMissing}</span>{t.legendNote}</p>
    </div> : <p className="px-5 py-6 text-xs text-slate-400">{t.none(matrix.columns.length)}</p>}
  </Card>;
}
