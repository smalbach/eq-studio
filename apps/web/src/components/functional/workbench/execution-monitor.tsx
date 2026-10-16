import { Button, Checkbox, Spinner } from "@radix-ui/themes";
import { Activity, Gauge, Square, TimerReset } from "lucide-react";
import { InfoTip } from "@/components/info-tip";
import type { Environment } from "@/components/environment/use-environment";
import type { FunctionalRunner } from "@/components/functional/use-functional-runner";
import { scenariosFor } from "@/lib/scenarios";
import { cn } from "@/lib/utils";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    stoppingTitle: "Deteniendo: termina el caso en curso",
    waiting: "Esperando antes del siguiente caso",
    analyzing: "Analizando escenarios en tiempo real",
    finished: "Último análisis finalizado",
    monitor: "Monitor de ejecución",
    startsIn: (s: string) => ` · inicia en ${s} s`,
    idle: "Configura el intervalo y ejecuta la suite para seguir cada caso.",
    stopTitle: "Termina el caso en curso (incluida su limpieza) y no inicia ninguno más",
    stopping: "Deteniendo…",
    stop: "Detener",
    queued: (n: number) => `${n} en cola`,
    running: (n: number) => `${n} ejecutando`,
    passed: (n: number) => `${n} correctos`,
    failed: (n: number) => `${n} fallidos`,
    delay: "Delay entre operaciones",
    noDelay: "Sin delay",
    samples: "Muestras de latencia",
    oneSampleTitle: "Una medición, no un p95",
    samplesTitle: (n: number) => `p95 sobre ${n} muestras`,
    oneSample: "1 (sin p95)",
    getOnly: "El p95 solo se mide en GET: repetir una escritura crearía N recursos.",
    remoteWarning: (n: number) => `Entorno remoto: cada muestra cruza el gateway, así que la Matriz GET envía ~${n}× más solicitudes. Sin delay, un gateway puede descartarlas con 429 o 503.`,
    enforce: "Exigir presupuestos de latencia del proyecto",
    enforced: "Una operación sobre su presupuesto falla el caso.",
    informative: "Informativos: a través de red y gateway se mide la ruta, no el servicio.",
  },
  en: {
    stoppingTitle: "Stopping: finishing the case in flight",
    waiting: "Waiting before the next case",
    analyzing: "Analyzing scenarios in real time",
    finished: "Last analysis finished",
    monitor: "Execution monitor",
    startsIn: (s: string) => ` · starts in ${s} s`,
    idle: "Set the interval and run the suite to follow each case.",
    stopTitle: "Finishes the case in flight (cleanup included) and starts no more",
    stopping: "Stopping…",
    stop: "Stop",
    queued: (n: number) => `${n} queued`,
    running: (n: number) => `${n} running`,
    passed: (n: number) => `${n} passed`,
    failed: (n: number) => `${n} failed`,
    delay: "Delay between operations",
    noDelay: "No delay",
    samples: "Latency samples",
    oneSampleTitle: "One measurement, not a p95",
    samplesTitle: (n: number) => `p95 over ${n} samples`,
    oneSample: "1 (no p95)",
    getOnly: "The p95 is only measured on GET: repeating a write would create N resources.",
    remoteWarning: (n: number) => `Remote environment: every sample crosses the gateway, so the GET matrix sends ~${n}× more requests. With no delay, a gateway may drop them with 429 or 503.`,
    enforce: "Enforce the project's latency budgets",
    enforced: "An operation over its budget fails the case.",
    informative: "Informative: across network and gateway it measures the route, not the service.",
  },
});

const pill = (active: boolean) => cn("text-[10px] transition-colors disabled:opacity-50", active ? "bg-accent-9 text-accent-contrast" : "bg-white/5 text-slate-400 hover:bg-white/10");

/** Progress of the run in flight: which case, how far, how many passed and failed. */
function MonitorStatus({ runner }: { runner: FunctionalRunner }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const { busy, stopping, delayRemaining, progress, active, operationStates } = runner;
  const counts = Object.values(operationStates).reduce((result, status) => ({ ...result, [status]: result[status] + 1 }), { queued: 0, running: 0, passed: 0, failed: 0 });
  const percent = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
  const scenario = active ? scenariosFor(active.endpoint, locale).find((item) => item.id === active.scenarioId) : undefined;
  const title = busy ? stopping ? t.stoppingTitle : delayRemaining > 0 ? t.waiting : t.analyzing : progress.completed > 0 ? t.finished : t.monitor;
  return <div className="min-w-0">
    <div className="flex flex-wrap items-center gap-3">
      <span className={cn("grid size-9 place-items-center rounded-lg", busy ? "bg-emerald-500/20 text-emerald-400" : "bg-white/10 text-slate-400")}>{busy ? <Spinner size="3"/> : <Activity className="size-5"/>}</span>
      <div><p className="text-sm font-semibold">{title}</p><p className="mt-0.5 text-xs text-slate-400">{active ? <><span className="font-mono text-slate-200">{active.endpoint.method} {active.endpoint.path}</span>{scenario && <span> · {scenario.name}</span>}{delayRemaining > 0 && t.startsIn((delayRemaining / 1000).toFixed(1))}</> : t.idle}</p></div>
    </div>
    <div className="mt-4 flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-emerald-400 transition-all duration-300" style={{ width: `${percent}%` }}/></div>
      <span className="w-20 text-right font-mono text-xs text-slate-300">{progress.completed}/{progress.total || 0} · {percent}%</span>
      {busy && <Button type="button" size="1" variant="soft" color="red" highContrast onClick={runner.requestStop} disabled={stopping} title={t.stopTitle} className="border border-rose-400/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 disabled:opacity-60">{stopping ? <Spinner size="1"/> : <Square className="size-3 fill-current"/>}{stopping ? t.stopping : t.stop}</Button>}
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]"><InfoTip id="monitorCounts" className="text-slate-500"/><span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-300">{t.queued(counts.queued)}</span><span className="rounded-full bg-sky-400/10 px-2.5 py-1 text-sky-300">{t.running(counts.running)}</span><span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-emerald-300">{t.passed(counts.passed)}</span><span className="rounded-full bg-rose-400/10 px-2.5 py-1 text-rose-300">{t.failed(counts.failed)}</span></div>
  </div>;
}

/** Delay, latency samples and whether the project's budgets decide a case. */
function MonitorSettings({ runner, env }: { runner: FunctionalRunner; env: Environment }) {
  const t = useMessages(MESSAGES);
  const disabled = Boolean(runner.busy);
  const { delayMs, samples } = runner;
  return <div className="rounded-xl border border-white/10 bg-white/5 p-4">
    <label htmlFor="operation-delay" className="flex items-center gap-2 text-xs font-medium text-slate-300"><TimerReset className="size-4"/>{t.delay}</label><InfoTip id="delay" size="xs" className="ml-1 text-slate-500"/>
    <div className="mt-2 flex items-center gap-2"><input id="operation-delay" type="number" min={0} max={30000} step={100} value={delayMs} disabled={disabled} onChange={(event) => runner.setDelayMs(Math.min(30000, Math.max(0, Number(event.target.value) || 0)))} className="h-9 w-28 rounded-lg border border-white/10 bg-slate-900 px-3 font-mono text-sm text-white outline-none focus:border-accent-8 disabled:opacity-50"/><span className="text-xs text-slate-400">ms</span></div>
    <div className="mt-2 flex gap-1">{[0, 500, 1000, 2000].map((value) => <Button key={value} size="1" variant="soft" color="gray" highContrast disabled={disabled} onClick={() => runner.setDelayMs(value)} className={pill(delayMs === value)}>{value === 0 ? t.noDelay : `${value / 1000}s`}</Button>)}</div>
    <label htmlFor="latency-samples" className="mt-4 flex items-center gap-2 text-xs font-medium text-slate-300"><Gauge className="size-4"/>{t.samples}</label><InfoTip id="samples" size="xs" className="ml-1 text-slate-500"/>
    <div className="mt-2 flex gap-1">{[1, 10, 30].map((value) => <Button key={value} size="1" variant="soft" color="gray" highContrast disabled={disabled} onClick={() => runner.setSamples(value)} className={pill(samples === value)} title={value === 1 ? t.oneSampleTitle : t.samplesTitle(value)}>{value === 1 ? t.oneSample : `${value}`}</Button>)}</div>
    <p className="mt-2 text-[10px] leading-4 text-slate-500">{t.getOnly}</p>
    {samples > 1 && !env.enforceLatency && <p className="mt-2 max-w-56 text-[10px] leading-4 text-amber-300">{t.remoteWarning(samples)}</p>}
    <label className="mt-3 flex max-w-56 cursor-pointer items-start gap-2 text-[11px] text-slate-300"><Checkbox size="1" checked={env.enforceLatency} disabled={disabled} onCheckedChange={(value) => { void env.saveEnvironment({ enforceLatency: value === true }); }} className="mt-0.5"/><span>{t.enforce} <InfoTip id="enforceLatency" size="xs" className="text-slate-500"/><span className="block text-[10px] leading-4 text-slate-500">{env.enforceLatency ? t.enforced : t.informative}</span></span></label>
  </div>;
}

export function ExecutionMonitor({ runner, env }: { runner: FunctionalRunner; env: Environment }) {
  return <div className="theme-fixed mb-5 overflow-hidden rounded-[var(--radius-4)] border border-slate-900 bg-slate-950 text-white shadow-lg" aria-live="polite">
    <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <MonitorStatus runner={runner}/>
      <MonitorSettings runner={runner} env={env}/>
    </div>
  </div>;
}
