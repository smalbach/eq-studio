import { BarChart3, Check, CircleAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@radix-ui/themes";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { CountBars, Mini, SplitBar } from "@/components/common/stats";
import type { Summary } from "@/components/functional/run/run-summary";
import { categoryLabel } from "@/lib/results-summary.mjs";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    requestLatency: "Latencia de las solicitudes", mean: "media", max: "máx", caseDuration: "Duración por caso",
    latencyNote: (p95: string) => `Todas las solicitudes del run, incluidas preparación, verificación y limpieza. GET p95 de casos simples: ${p95}.`,
    codes: "Códigos recibidos", byMethod: "Solicitudes por método",
    assertions: "Aserciones", passed: "correctas", failed: "fallidas", schema: "Validación de schema OpenAPI", causes: "Causas de fallo", noneFailed: "Ningún caso falló.",
    byTag: "Por tag", tagNote: "Clic en un tag filtra la lista de fallos.", caseByMethod: "Por método", byExpected: "Por código esperado",
  },
  en: {
    requestLatency: "Request latency", mean: "mean", max: "max", caseDuration: "Duration per case",
    latencyNote: (p95: string) => `Every request of the run, including setup, verification and cleanup. GET p95 of simple cases: ${p95}.`,
    codes: "Received codes", byMethod: "Requests by method",
    assertions: "Assertions", passed: "passed", failed: "failed", schema: "OpenAPI schema validation", causes: "Failure causes", noneFailed: "No case failed.",
    byTag: "By tag", tagNote: "Click a tag to filter the failure list.", caseByMethod: "By method", byExpected: "By expected code",
  },
});

const codeTone = (code: string) => code.startsWith("2") ? "jade" as const : code.startsWith("5") || code === "Sin respuesta" ? "red" as const : "amber" as const;

/** Latency of every request, the codes received and the assertions checked. */
export function RequestBreakdown({ summary }: { summary: Summary }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const { requests, cases, assertions } = summary;
  return <div className="grid gap-5 xl:grid-cols-3">
    <Card className="p-5"><p className="mb-3 flex items-center gap-1.5 text-sm font-semibold">{t.requestLatency}<InfoTip id="requestLatency"/></p>
      <div className="grid grid-cols-3 gap-2"><Mini info="mean" label={t.mean} value={`${requests.latency.mean} ms`}/><Mini info="p50" label="p50" value={`${requests.latency.p50} ms`}/><Mini info="p90" label="p90" value={`${requests.latency.p90} ms`}/><Mini info="p95" label="p95" value={`${requests.latency.p95} ms`}/><Mini info="p99" label="p99" value={`${requests.latency.p99} ms`}/><Mini info="max" label={t.max} value={`${requests.latency.max} ms`}/></div>
      <p className="mb-2 mt-4 flex items-center gap-1 text-xs font-semibold text-slate-700">{t.caseDuration}<InfoTip id="caseDuration" size="xs"/></p>
      <div className="grid grid-cols-4 gap-2"><Mini label={t.mean} value={`${cases.mean} ms`}/><Mini label="p50" value={`${cases.p50} ms`}/><Mini label="p95" value={`${cases.p95} ms`}/><Mini label={t.max} value={`${cases.max} ms`}/></div>
      <p className="mt-2 text-[10px] leading-4 text-slate-400">{t.latencyNote(summary.latency.count ? `${summary.latency.p95} ms` : "—")}</p>
    </Card>
    <Card className="p-5"><p className="mb-3 flex items-center gap-1.5 text-sm font-semibold">{t.codes}<InfoTip id="receivedCodes"/></p><CountBars rows={requests.byClass.map((row: { key: string; count: number }) => ({ key: categoryLabel(row.key, locale), count: row.count }))} color="bg-sky-500"/>
      <div className="mt-3 flex flex-wrap gap-1.5">{requests.byCode.map((row: { key: string; count: number }) => <Badge key={row.key} size="1" variant="soft" color={codeTone(row.key)} className="font-mono">{categoryLabel(row.key, locale)} × {row.count}</Badge>)}</div>
      <p className="mb-2 mt-4 flex items-center gap-1 text-xs font-semibold text-slate-700">{t.byMethod}<InfoTip id="requestsByMethod" size="xs"/></p><CountBars rows={requests.byMethod} color="bg-violet-500"/>
    </Card>
    <Card className="p-5"><p className="mb-3 flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-slate-400"/>{t.assertions}<InfoTip id="assertions"/></p>
      <div className="grid grid-cols-3 gap-2"><Mini label="total" value={String(assertions.total)}/><Mini label={t.passed} value={String(assertions.passed)}/><Mini label={t.failed} value={String(assertions.failed)} tone={assertions.failed ? "bad" : "neutral"}/></div>
      <p className="mb-2 mt-4 flex items-center gap-1 text-xs font-semibold text-slate-700">{t.schema}<InfoTip id="schemaValidation" size="xs"/></p>
      <SplitBar label="Schema" passed={assertions.schemaPassed} failed={assertions.schemaFailed}/>
      <p className="mb-2 mt-4 flex items-center gap-2 text-xs font-semibold text-slate-700"><CircleAlert className="size-3.5 text-slate-400"/>{t.causes}<InfoTip id="failureCauses" size="xs"/></p>
      {summary.causes.length ? <ul className="space-y-1.5">{summary.causes.map((cause: { key: string; total: number }) => <li key={cause.key} className="flex items-center justify-between gap-3 text-[11px]"><span className="text-slate-700">{categoryLabel(cause.key, locale)}</span><span className="font-mono text-rose-600">{cause.total}</span></li>)}</ul> : <p className="flex items-center gap-2 text-xs text-emerald-700"><Check className="size-4"/>{t.noneFailed}</p>}
    </Card>
  </div>;
}

type Split = { key: string; passed: number; failed: number };

/** Passed and failed by tag (a click filters the failures), by method and by expected status. */
export function CaseBreakdown({ summary, tagFilter, onTag }: { summary: Summary; tagFilter: string | null; onTag: (tag: string) => void }) {
  const t = useMessages(MESSAGES);
  return <div className="grid gap-5 xl:grid-cols-2">
    <Card className="p-5"><p className="mb-3 flex items-center gap-2 text-sm font-semibold"><BarChart3 className="size-4 text-slate-400"/>{t.byTag}<InfoTip id="byTag"/></p><div className="space-y-0.5">{summary.byTag.map((row: Split) => <SplitBar key={row.key} label={row.key} passed={row.passed} failed={row.failed} active={tagFilter === row.key} onClick={() => onTag(row.key)}/>)}</div><p className="mt-2 text-[10px] text-slate-400">{t.tagNote}</p></Card>
    <Card className="p-5"><p className="mb-3 flex items-center gap-1.5 text-sm font-semibold">{t.caseByMethod}<InfoTip id="byMethod"/></p><div className="space-y-0.5">{summary.byMethod.map((row: Split) => <SplitBar key={row.key} label={row.key} passed={row.passed} failed={row.failed}/>)}</div>
      <p className="mb-3 mt-5 flex items-center gap-1.5 text-sm font-semibold">{t.byExpected}<InfoTip id="byExpected"/></p><div className="space-y-0.5">{summary.byExpected.map((row: Split) => <SplitBar key={row.key} label={row.key} passed={row.passed} failed={row.failed}/>)}</div></Card>
  </div>;
}
