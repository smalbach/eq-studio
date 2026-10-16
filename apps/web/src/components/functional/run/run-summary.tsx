import { ArrowDownRight, ArrowUpRight, CircleAlert, Repeat } from "lucide-react";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { Stat } from "@/components/common/stats";
import { caseName } from "@/lib/run-entries";
import type { RunRecord } from "@/lib/run-types";
import { formatDate, seconds } from "@/lib/format";
import type { summarizeResults } from "@/lib/results-summary.mjs";
import type { compareRuns } from "@/lib/run-snapshot.mjs";
import { cn } from "@/lib/utils";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    casesRun: "Casos ejecutados", endpoints: (run: number, total: number) => `${run} de ${total} endpoints`,
    passed: "Correctos", rate: (value: string) => `${value} % de éxito`,
    failed: "Fallidos", review: "Requieren revisión", none: "Ninguno",
    verified: "Respuestas verificadas", exercised: (n: number) => `${n} ejercitadas`,
    requests: "Solicitudes HTTP", perCase: (perCase: number, chained: number) => `${perCase} por caso · ${chained} flujos encadenados`,
    totalTime: "Tiempo total", meanCase: (ms: number) => `caso medio ${ms} ms`,
    newFailures: "Nuevos fallos", fixed: "Arreglados", stillFailing: "Siguen fallando",
    compared: "Comparada con la ejecución anterior", noneDot: "Ninguno.",
    notCompared: (current: number, previous: number) => `${current} casos solo en esta ejecución y ${previous} solo en la anterior: no se comparan.`,
  },
  en: {
    casesRun: "Cases run", endpoints: (run: number, total: number) => `${run} of ${total} endpoints`,
    passed: "Passed", rate: (value: string) => `${value} % pass rate`,
    failed: "Failed", review: "Need review", none: "None",
    verified: "Verified responses", exercised: (n: number) => `${n} exercised`,
    requests: "HTTP requests", perCase: (perCase: number, chained: number) => `${perCase} per case · ${chained} chained flows`,
    totalTime: "Total time", meanCase: (ms: number) => `mean case ${ms} ms`,
    newFailures: "New failures", fixed: "Fixed", stillFailing: "Still failing",
    compared: "Compared with the previous run", noneDot: "None.",
    notCompared: (current: number, previous: number) => `${current} cases only in this run and ${previous} only in the previous one: not compared.`,
  },
});

export type Summary = ReturnType<typeof summarizeResults>;
export type Inspect = (endpointId: string, scenarioId: string) => void;

/** The six headline numbers of a run. */
export function RunStats({ summary }: { summary: Summary }) {
  const t = useMessages(MESSAGES);
  return <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
    <Stat info="casesRun" label={t.casesRun} value={String(summary.total)} hint={t.endpoints(summary.endpointsRun, summary.endpointsTotal)}/>
    <Stat info="casesPassed" label={t.passed} value={String(summary.passed)} tone="good" hint={t.rate((summary.passRate * 100).toFixed(1))}/>
    <Stat info="casesFailed" label={t.failed} value={String(summary.failed)} tone={summary.failed ? "bad" : "neutral"} hint={summary.failed ? t.review : t.none}/>
    <Stat info="verifiedResponses" label={t.verified} value={`${summary.coverageTotals.verified} / ${summary.coverageTotals.declared}`} hint={t.exercised(summary.coverageTotals.exercised)}/>
    <Stat info="httpRequests" label={t.requests} value={String(summary.requests.total)} hint={t.perCase(summary.requests.perCase, summary.requests.chainedCases)}/>
    <Stat info="totalTime" label={t.totalTime} value={seconds(summary.durationMs)} hint={t.meanCase(summary.cases.mean)}/>
  </section>;
}

/** New failures, fixes and cases still failing against the previous run in the same environment. */
export function RunComparison({ comparison, previous, onInspect }: { comparison: ReturnType<typeof compareRuns>; previous: RunRecord; onInspect: Inspect }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const groups = [[t.newFailures, comparison.newFailures, "text-rose-600", ArrowDownRight], [t.fixed, comparison.fixed, "text-emerald-700", ArrowUpRight], [t.stillFailing, comparison.stillFailing, "text-slate-600", CircleAlert]] as const;
  return <Card className="p-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-2 text-sm font-semibold"><Repeat className="size-4 text-slate-400"/>{t.compared}<InfoTip id="comparison"/></p><span className="text-[11px] text-slate-500">{previous.scope} · {formatDate(previous.at, locale)} · {previous.passed}/{previous.total}</span></div>
    <div className="grid gap-4 lg:grid-cols-3">{groups.map(([label, keys, tone, Icon]) => <div key={label}>
      <p className={cn("mb-1.5 flex items-center gap-1.5 text-xs font-semibold", tone)}><Icon className="size-3.5"/>{label} <span className="font-mono">{keys.length}</span></p>
      {keys.length ? <ul className="max-h-40 space-y-0.5 overflow-y-auto">{keys.map((key: string) => { const name = caseName(key, locale); return <li key={key}><button onClick={() => onInspect(name.endpointId, name.scenarioId)} className="w-full truncate rounded px-1 py-0.5 text-left text-[11px] hover:bg-slate-50" title={`${name.label} · ${name.scenario}`}><span className="font-mono text-slate-700">{name.label}</span> <span className="text-slate-400">· {name.scenario}</span></button></li>; })}</ul> : <p className="text-[11px] text-slate-400">{t.noneDot}</p>}
    </div>)}</div>
    {(comparison.onlyCurrent > 0 || comparison.onlyPrevious > 0) && <p className="mt-3 text-[10px] text-slate-400">{t.notCompared(comparison.onlyCurrent, comparison.onlyPrevious)}</p>}
  </Card>;
}
