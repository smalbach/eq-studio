import { useMemo } from "react";
import { AlertTriangle, Check, TrendingUp, X } from "lucide-react";
import { Badge, Table } from "@radix-ui/themes";
import { Card } from "@/components/ui/card";
import { ColumnChart } from "@/components/charts/column-chart";
import { LineChart, type ChartMarker } from "@/components/charts/line-chart";
import { CardTitle, Mini, Th } from "@/components/common/stats";
import { InfoTip } from "@/components/info-tip";
import { CHART } from "@/lib/chart-colors";
import { DEGRADE_FACTOR, healthLabel, degradationReport as analyse } from "@/lib/load-degradation.mjs";
import type { Degradation, LoadReport, StageHealth, TestType } from "@/lib/load-types";
import { defineMessages, useLocale, useMessages, type Locale } from "@/lib/i18n";
import { tr } from "@/lib/i18n-core.mjs";

export const degradationReport = (type: TestType, report: LoadReport, budget: number | null, locale: Locale = "es") => analyse(type, report, budget, locale) as Degradation;
import { cn } from "@/lib/utils";

const MESSAGES = defineMessages({
  es: {
    firstSignalMarker: (t: number) => `1.ª señal · ${t} s`,
    recoveredMarker: (s: number) => `recuperado · +${s} s`,
    verdictFirst: (t: number, rps: number, label: string, detail: string) => `Primera señal a los ${t} s, con ${rps} req/s pedidas: ${label} (${detail}).`,
    verdictNone: "Ninguna señal de degradación: la latencia, la cola, la concurrencia y la entrega se mantuvieron en su nivel de base durante toda la prueba.",
    title: "Análisis de degradación",
    extra: (p95: number, rps: number, limit: number | null) => `base: p95 ${p95} ms a ${rps} req/s · degradado si p95 > ${limit} ms`,
    firstSignal: "Primera señal",
    none: "ninguna",
    startsDegrading: "Empieza a degradarse",
    notObserved: "no se observó",
    recoveryAfterSpike: "Recuperación tras el pico",
    notWithin: (s: number) => `no en ${s} s`,
    healthyCapacity: "Capacidad sana",
    peakLatency: "Latencia en el pico",
    saturatesOrBreaks: "Se satura o rompe",
    notReached: "no se alcanzó",
    headroom: (h: number, stage: string) => ` Margen sano: ×${h} sobre la tasa base (${stage}).`,
    headroomAtLeast: (h: number) => ` Margen sano de al menos ×${h} sobre la tasa base: el límite está por encima de la tasa pico; súbela para encontrarlo.`,
    indexTitle: "Índice de degradación (p95 ÷ p95 base, escala log)",
    degradedRef: (threshold: number, limit: number | null) => `Degradado > ×${threshold} (${limit} ms)`,
    overBase: "p95 ÷ base",
    efficiencyTitle: "Eficiencia de entrega (entregado ÷ pedido)",
    minRef: "Mín. 95 %",
    efficiency: "Eficiencia",
    stagesTitle: "p95 de cada etapa frente a la base (escala log)",
    degradedRefShort: (threshold: number) => `degradado > ×${threshold}`,
    healthy: "Sano",
    degrading: "Degradándose",
    bad: "Saturado o roto",
    singleStage: "Una sola etapa medida: el índice en el tiempo muestra si se degrada mientras dura.",
    signalsTitle: "Señales en orden de aparición",
    noSignals: "Sin señales: se mantuvo en su nivel de base.",
    stage: "Etapa", state: "Estado", requested: "Pedido", delivered: "Entregado", error: "Error", reason: "Motivo",
    ramp: " · rampa",
  },
  en: {
    firstSignalMarker: (t: number) => `1st signal · ${t} s`,
    recoveredMarker: (s: number) => `recovered · +${s} s`,
    verdictFirst: (t: number, rps: number, label: string, detail: string) => `First signal at ${t} s, with ${rps} req/s requested: ${label} (${detail}).`,
    verdictNone: "No sign of degradation: latency, the tail, concurrency and delivery stayed at their baseline level for the whole test.",
    title: "Degradation analysis",
    extra: (p95: number, rps: number, limit: number | null) => `baseline: p95 ${p95} ms at ${rps} req/s · degraded if p95 > ${limit} ms`,
    firstSignal: "First signal",
    none: "none",
    startsDegrading: "Starts to degrade",
    notObserved: "not observed",
    recoveryAfterSpike: "Recovery after the spike",
    notWithin: (s: number) => `not within ${s} s`,
    healthyCapacity: "Healthy capacity",
    peakLatency: "Latency at the spike",
    saturatesOrBreaks: "Saturates or breaks",
    notReached: "not reached",
    headroom: (h: number, stage: string) => ` Healthy headroom: ×${h} over the base rate (${stage}).`,
    headroomAtLeast: (h: number) => ` Healthy headroom of at least ×${h} over the base rate: the limit is above the peak rate; raise it to find it.`,
    indexTitle: "Degradation index (p95 ÷ baseline p95, log scale)",
    degradedRef: (threshold: number, limit: number | null) => `Degraded > ×${threshold} (${limit} ms)`,
    overBase: "p95 ÷ baseline",
    efficiencyTitle: "Delivery efficiency (delivered ÷ requested)",
    minRef: "Min. 95 %",
    efficiency: "Efficiency",
    stagesTitle: "p95 of each stage against the baseline (log scale)",
    degradedRefShort: (threshold: number) => `degraded > ×${threshold}`,
    healthy: "Healthy",
    degrading: "Degrading",
    bad: "Saturated or broken",
    singleStage: "A single measured stage: the index over time shows whether it degrades while it lasts.",
    signalsTitle: "Signals in order of appearance",
    noSignals: "No signals: it stayed at its baseline level.",
    stage: "Stage", state: "State", requested: "Requested", delivered: "Delivered", error: "Error", reason: "Reason",
    ramp: " · ramp",
  },
});

type Health = StageHealth;

const HEALTH_STYLE: Record<Health, { color: "jade" | "amber" | "ruby"; variant: "soft" | "solid"; icon: React.ReactNode }> = {
  healthy: { color: "jade", variant: "soft", icon: <Check className="size-3"/> },
  degrading: { color: "amber", variant: "soft", icon: <TrendingUp className="size-3"/> },
  saturated: { color: "ruby", variant: "soft", icon: <AlertTriangle className="size-3"/> },
  broken: { color: "ruby", variant: "solid", icon: <X className="size-3"/> },
};

/** The state of a stage as a word with its icon — never colour alone. */
export function HealthPill({ health }: { health: Health }) {
  const style = HEALTH_STYLE[health];
  return <Badge size="1" radius="full" variant={style.variant} color={style.color} className="text-[10px] font-semibold">{style.icon}{healthLabel(health, useLocale())}</Badge>;
}

/** The phase names of `buildStages`, in either language, shortened in the active one. */
const SHORT_PHASE: Record<string, { es: string; en: string }> = {
  Pico: { es: "Pico", en: "Spike" }, Spike: { es: "Pico", en: "Spike" },
  "Recuperación": { es: "Recup.", en: "Recov." }, Recovery: { es: "Recup.", en: "Recov." },
  Rampa: { es: "Rampa", en: "Ramp" }, Ramp: { es: "Rampa", en: "Ramp" },
  Sostenido: { es: "Sostenido", en: "Sustained" }, Sustained: { es: "Sostenido", en: "Sustained" },
};

/**
 * "Escalón 3 · 120 req/s" or "Step 3 · 120 req/s" → "E3" / "S3"; "Pico · 200 req/s" → "Pico" /
 * "Spike". Saved runs keep the language they were run in, so both are read.
 */
export const shortStage = (label: string, locale: Locale = "es") => {
  const head = label.split(" · ")[0];
  const step = /^(?:Escalón|Step) (\d+)$/.exec(head);
  if (step) return `${tr(locale, "E", "S")}${step[1]}`;
  return SHORT_PHASE[head]?.[locale] ?? head;
};

/**
 * When the service starts to bend under load, not only when it breaks: each stage against the
 * calm baseline, the first second each warning sign showed, the delivery efficiency and the
 * latency index over time, and — for a spike — how long it took to come back.
 */
export function LoadDegradation({ report, type, budget }: { report: LoadReport; type: TestType; budget: number | null }) {
  const locale = useLocale();
  const t = useMessages(MESSAGES);
  const short = (label: string) => shortStage(label, locale);
  const analysis = useMemo(() => degradationReport(type, report, budget, locale), [type, report, budget, locale]);
  const { baseline, stages, timeline, signals, capacity, firstDegraded, firstBroken, headroom, recovery, limit } = analysis;
  if (!baseline) return null;
  const measured = stages.filter((stage) => stage.measured);
  const byHealth = (healths: Health[]) => measured.map((stage) => healths.includes(stage.health) ? Math.round(stage.factor * 100) / 100 : 0);
  const first = signals[0];
  // The line the stages are judged on: ×1.5 of the base, or the base + 20 ms when that is higher.
  const threshold = baseline.p95 ? Math.round(((limit ?? 0) / baseline.p95) * 100) / 100 : DEGRADE_FACTOR;
  const x = timeline.map((row) => row.t);
  const markers: ChartMarker[] = [];
  if (first) markers.push({ x: first.t, label: t.firstSignalMarker(first.t) });
  if (recovery?.seconds != null) {
    const peakEnd = report.windows.filter((window) => !window.drain && window.stage === 1).at(-1)?.t;
    if (peakEnd != null) markers.push({ x: peakEnd + recovery.seconds, label: t.recoveredMarker(recovery.seconds) });
  }
  const verdict = first
    ? t.verdictFirst(first.t, first.rps, first.label.toLowerCase(), first.detail)
    : t.verdictNone;

  return <Card className="overflow-hidden">
    <CardTitle icon={<TrendingUp className="size-4 text-slate-400"/>} title={t.title} info="degradation" extra={t.extra(baseline.p95, baseline.rps, limit)}/>
    <div className="space-y-5 p-5">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Mini info="degradationFirst" label={t.firstSignal} value={first ? `${first.t} s · ${first.rps} req/s` : t.none} tone={first ? "warn" : "good"}/>
        <Mini info="degradationFirstStage" label={t.startsDegrading} value={firstDegraded ? short(firstDegraded.label) + ` · ${firstDegraded.requested} req/s` : t.notObserved} tone={firstDegraded ? "warn" : "good"}/>
        {type === "spike" && recovery
          ? <Mini info="recoveryTime" label={t.recoveryAfterSpike} value={recovery.seconds != null ? `${recovery.seconds} s` : t.notWithin(recovery.window)} tone={recovery.seconds == null ? "bad" : recovery.seconds > 10 ? "warn" : "good"}/>
          : <Mini info="healthyCapacity" label={t.healthyCapacity} value={capacity ? `${firstDegraded ? "" : "≥ "}${capacity.rps} req/s` : t.none} tone={capacity ? "neutral" : "bad"}/>}
        {type === "spike" && recovery
          ? <Mini info="peakFactor" label={t.peakLatency} value={recovery.peakFactor != null ? `×${recovery.peakFactor} (${recovery.peakP95} ms)` : "—"} tone={recovery.peakFactor != null && recovery.peakFactor > threshold ? "warn" : "neutral"}/>
          : <Mini info="breakingStage" label={t.saturatesOrBreaks} value={firstBroken ? `${short(firstBroken.label)} · ${firstBroken.requested} req/s` : t.notReached} tone={firstBroken ? "bad" : "good"}/>}
      </div>
      <p className="text-[11px] leading-5 text-slate-600">{verdict}{headroom != null && type === "stress" && capacity && (firstDegraded ? t.headroom(headroom, capacity.stage) : t.headroomAtLeast(headroom))}</p>

      <div className="grid gap-6 xl:grid-cols-2">
        <LineChart info="degradationIndex" title={t.indexTitle} unit="×" log x={x} markers={markers} reference={{ label: t.degradedRef(threshold, limit), value: threshold }} series={[{ key: "factor", label: t.overBase, color: CHART.violet, values: timeline.map((row) => row.factor) }]}/>
        <LineChart info="deliveryEfficiency" title={t.efficiencyTitle} unit="%" ceiling={100} x={x} markers={markers} reference={{ label: t.minRef, value: 95 }} series={[{ key: "efficiency", label: t.efficiency, color: CHART.blue, values: timeline.map((row) => row.efficiency) }]}/>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {measured.length > 1
          ? <ColumnChart info="degradationStages" title={t.stagesTitle} unit="×" log labels={measured.map((stage) => short(stage.label))} reference={{ label: t.degradedRefShort(threshold), value: threshold }}
              series={[{ key: "healthy", label: t.healthy, color: CHART.green }, { key: "degrading", label: t.degrading, color: CHART.amber }, { key: "bad", label: t.bad, color: CHART.rose }]}
              values={{ healthy: byHealth(["healthy"]), degrading: byHealth(["degrading"]), bad: byHealth(["saturated", "broken"]) }}/>
          : <p className="self-center text-[11px] text-slate-400">{t.singleStage}</p>}
        <div className="min-w-0">
          <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-slate-700">{t.signalsTitle}<InfoTip id="degradationSignals" size="xs"/></p>
          {signals.length ? <ol className="relative space-y-2 border-l border-slate-200 pl-4">{signals.map((signal) => <li key={signal.key} className="text-[11px]">
            <span className={cn("absolute -left-[5px] mt-1 size-2.5 rounded-full border-2 border-white", ["errors", "drops", "throughput", "budget"].includes(signal.key) ? "bg-rose-500" : "bg-amber-500")}/>
            <p className="font-medium text-slate-700">{signal.label} <span className="font-mono font-normal text-slate-500">· {signal.t} s · {signal.rps} req/s</span></p>
            <p className="text-[10px] leading-4 text-slate-500">{signal.detail}{signal.stage && ` · ${signal.stage}`}</p>
          </li>)}</ol> : <p className="flex items-center gap-1.5 text-[11px] text-emerald-700"><Check className="size-3.5"/>{t.noSignals}</p>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200"><Table.Root size="1" variant="ghost" className="w-full text-[11px]"><Table.Header><Table.Row className="whitespace-nowrap text-left text-slate-400">
        <Table.ColumnHeaderCell className="px-4 font-medium">{t.stage}</Table.ColumnHeaderCell><Table.ColumnHeaderCell className="font-medium"><span className="inline-flex items-center gap-1">{t.state}<InfoTip id="stageHealth" size="xs"/></span></Table.ColumnHeaderCell><Th label={t.requested} info="colRequested"/><Th label={t.delivered} info="colDelivered"/><Th label={t.efficiency} info="deliveryEfficiency"/><Th label="p95" info="p95"/><Th label="×base" info="degradationIndex"/><Th label="p99 ÷ p50" info="tailRatio"/><Th label={t.error} info="colError"/><Table.ColumnHeaderCell className="px-4 font-medium">{t.reason}</Table.ColumnHeaderCell>
      </Table.Row></Table.Header><Table.Body>{stages.map((stage) => <Table.Row key={stage.label} className={cn(!stage.measured && "text-slate-400")}>
        <Table.Cell className="whitespace-nowrap px-4">{stage.label}{!stage.measured && t.ramp}</Table.Cell>
        <Table.Cell><HealthPill health={stage.health}/></Table.Cell>
        <Table.Cell className="text-right font-mono text-slate-500">{stage.requested}</Table.Cell>
        <Table.Cell className="text-right font-mono">{stage.delivered.toFixed(1)}</Table.Cell>
        <Table.Cell className={cn("text-right font-mono", stage.efficiency < 0.95 && "text-rose-600")}>{Math.round(stage.efficiency * 100)} %</Table.Cell>
        <Table.Cell className="text-right font-mono">{stage.p95} ms</Table.Cell>
        <Table.Cell className={cn("text-right font-mono", stage.factor > threshold && "text-amber-700")}>×{stage.factor.toFixed(2)}</Table.Cell>
        <Table.Cell className="text-right font-mono">×{stage.tail.toFixed(1)}</Table.Cell>
        <Table.Cell className={cn("text-right font-mono", stage.errorRate > 0.001 && "text-rose-600")}>{(stage.errorRate * 100).toFixed(2)} %</Table.Cell>
        <Table.Cell className="px-4 text-slate-500">{stage.reasons.join(" · ") || "—"}</Table.Cell>
      </Table.Row>)}</Table.Body></Table.Root></div>
    </div>
  </Card>;
}
