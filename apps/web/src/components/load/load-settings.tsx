import { AlertTriangle, CircleAlert, Play, Square } from "lucide-react";
import { Button, Callout, Checkbox, Select, Spinner, TextField } from "@radix-ui/themes";
import { InfoTip } from "@/components/info-tip";
import { PreflightTable } from "@/components/load/load-report";
import { testTypeLabel, type LoadRunner } from "@/components/load/use-load-runner";
import type { GlossaryKey } from "@/lib/glossary";
import { LATENCY_MODES, LOAD_LIMITS, localized } from "@/lib/load.mjs";
import type { LatencyChoice, PreflightPolicy } from "@/lib/load-types";
import { defineMessages, useIntlLocale, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    baseRate: "Tasa base", targetRate: "Tasa objetivo", peakRate: "Tasa pico", duration: "Duración", maxConcurrency: "Concurrencia máx.", inFlight: "en vuelo", timeout: "Timeout",
    latencyCriterion: "Criterio de latencia", auto: (detail: string) => `Automático (${detail})`, projectBudgets: "presupuestos del proyecto", customP95: "Límite p95 propio",
    preflightPolicy: "Si un objetivo falla la verificación previa", skip: "Omitirlo y probar el resto", stop: "No enviar carga", ignore: "Sin verificación previa",
    rfpRemote: (env: string) => `Los presupuestos del proyecto se miden junto a la API. A través de ${env} cada solicitud puede costar cientos de ms de red: el veredicto será rojo por el camino, no por la API.`,
    plan: (duration: number, requests: string) => `Plan · ${duration} s · ~${requests} solicitudes`, notEvaluated: " · no se evalúa",
    sharedTitle: "Ambiente compartido.", shared: (requests: string, env: string) => ` Esta prueba envía ~${requests} solicitudes a ${env}. Coordínala con el equipo: una prueba de estrés puede degradar el entorno para todos.`,
    tokenShort: (left: number, minutes: number) => `El token expira en ${left} min y la prueba dura ${minutes} min: la segunda parte serán 401/400. Renueva el token antes.`,
    stopTest: "Detener", start: (type: string) => `Iniciar prueba de ${type.toLowerCase()}`,
  },
  en: {
    baseRate: "Base rate", targetRate: "Target rate", peakRate: "Peak rate", duration: "Duration", maxConcurrency: "Max. concurrency", inFlight: "in flight", timeout: "Timeout",
    latencyCriterion: "Latency criterion", auto: (detail: string) => `Automatic (${detail})`, projectBudgets: "project budgets", customP95: "Custom p95 limit",
    preflightPolicy: "If a target fails the preflight", skip: "Skip it and test the rest", stop: "Send no load", ignore: "No preflight",
    rfpRemote: (env: string) => `The project budgets are measured next to the API. Through ${env} every request can cost hundreds of ms of network: the verdict will be red because of the path, not the API.`,
    plan: (duration: number, requests: string) => `Plan · ${duration} s · ~${requests} requests`, notEvaluated: " · not evaluated",
    sharedTitle: "Shared environment.", shared: (requests: string, env: string) => ` This test sends ~${requests} requests to ${env}. Coordinate it with the team: a stress test can degrade the environment for everyone.`,
    tokenShort: (left: number, minutes: number) => `The token expires in ${left} min and the test lasts ${minutes} min: the second part will be 401/400. Renew the token first.`,
    stopTest: "Stop", start: (type: string) => `Start ${type.toLowerCase()} test`,
  },
});

function NumberField({ id, label, value, onChange, min, max, suffix, disabled, info }: { info?: GlossaryKey; id: string; label: string; value: number; onChange: (value: number) => void; min: number; max: number; suffix: string; disabled?: boolean }) {
  return <div className="text-[11px] text-slate-500"><span className="flex items-center gap-1"><label htmlFor={id}>{label}</label>{info && <InfoTip id={info} size="xs"/>}</span><span className="mt-1.5 flex items-center gap-2"><TextField.Root id={id} size="2" type="number" min={min} max={max} value={value} disabled={disabled} onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value) || min)))} className="w-full font-mono text-xs"/><span className="shrink-0 text-[10px] text-slate-400">{suffix}</span></span></div>;
}

/** Rates, duration, concurrency, timeout, the latency criterion and the preflight policy. */
function Parameters({ load }: { load: LoadRunner }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const { running, usesPeak, remote, latency } = load;
  return <>
    <div className="grid grid-cols-2 gap-3">
      <NumberField info="baseRps" id="load-base" label={usesPeak ? t.baseRate : t.targetRate} value={load.baseRps} onChange={load.setBaseRps} min={1} max={LOAD_LIMITS.maxRps} suffix="req/s" disabled={running}/>
      <NumberField info="peakRps" id="load-peak" label={t.peakRate} value={usesPeak ? load.peakRps : load.baseRps} onChange={load.setPeakRps} min={1} max={LOAD_LIMITS.maxRps} suffix="req/s" disabled={running || !usesPeak}/>
      <NumberField info="durationS" id="load-duration" label={t.duration} value={load.durationS} onChange={load.setDurationS} min={5} max={LOAD_LIMITS.maxDurationS} suffix="s" disabled={running}/>
      <NumberField info="maxInFlight" id="load-inflight" label={t.maxConcurrency} value={load.maxInFlight} onChange={load.setMaxInFlight} min={1} max={LOAD_LIMITS.maxInFlight} suffix={t.inFlight} disabled={running}/>
      <NumberField info="timeoutMs" id="load-timeout" label={t.timeout} value={load.timeoutMs} onChange={load.setTimeoutMs} min={500} max={LOAD_LIMITS.timeoutMs} suffix="ms" disabled={running}/>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <div className="text-[11px] text-slate-500"><span className="flex items-center gap-1"><label htmlFor="load-latency">{t.latencyCriterion}</label><InfoTip id="latencyCriterion" size="xs"/></span><Select.Root size="2" value={load.latencyChoice} disabled={running} onValueChange={(value) => load.setLatencyChoice(value as LatencyChoice)}><Select.Trigger id="load-latency" className="mt-1.5 w-full"/><Select.Content><Select.Item value="auto">{t.auto(remote ? `p95 < ${load.p95Ms} ms` : t.projectBudgets)}</Select.Item>{LATENCY_MODES.map((mode) => <Select.Item key={mode.id} value={mode.id}>{localized(mode, locale).label}</Select.Item>)}</Select.Content></Select.Root></div>
      <NumberField info="p95Limit" id="load-p95" label={t.customP95} value={load.p95Ms} onChange={load.setP95Ms} min={10} max={LOAD_LIMITS.timeoutMs} suffix="ms" disabled={running || latency.mode !== "custom"}/>
    </div>
    <div className="block text-[11px] text-slate-500"><span className="flex items-center gap-1"><label htmlFor="load-policy">{t.preflightPolicy}</label><InfoTip id="preflightPolicy" size="xs"/></span><Select.Root size="2" value={load.policy} disabled={running} onValueChange={(value) => load.setPolicy(value as PreflightPolicy)}><Select.Trigger id="load-policy" className="mt-1.5 w-full"/><Select.Content><Select.Item value="skip">{t.skip}</Select.Item><Select.Item value="stop">{t.stop}</Select.Item><Select.Item value="ignore">{t.ignore}</Select.Item></Select.Content></Select.Root></div>
    {remote && latency.mode === "project" && <Callout.Root size="1" color="amber"><Callout.Icon><AlertTriangle className="size-4"/></Callout.Icon><Callout.Text className="text-[10px] leading-4">{t.rfpRemote(load.environmentName)}</Callout.Text></Callout.Root>}
  </>;
}

/** The plan, the warnings that must be read before sending load, and the start button. */
export function LoadSettings({ load, shared, tokenMinutesLeft }: { load: LoadRunner; shared: boolean; tokenMinutesLeft: number | null }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const intl = useIntlLocale();
  const { running, duration, requests } = load;
  const tokenTooShort = tokenMinutesLeft != null && tokenMinutesLeft * 60 < duration;
  const blocked = shared && !load.confirmed;
  return <div className="space-y-3">
    <Parameters load={load}/>
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-700">{t.plan(duration, requests.toLocaleString(intl))}<InfoTip id="plan" size="xs"/></p>
      <ul className="mt-1.5 space-y-0.5">{load.stages.map((stage) => <li key={stage.label} className="flex justify-between gap-2 text-[11px] text-slate-600"><span>{stage.label}{!stage.measured && <span className="text-slate-400">{t.notEvaluated}</span>}</span><span className="font-mono text-slate-400">{stage.durationS} s</span></li>)}</ul>
    </div>
    {shared && <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-800"><Checkbox size="1" color="amber" checked={load.confirmed} disabled={running} onCheckedChange={(value) => load.setConfirmed(value === true)} className="mt-1"/><span><AlertTriangle className="mr-1 inline size-3.5"/><strong>{t.sharedTitle}</strong>{t.shared(requests.toLocaleString(intl), load.environmentName)}</span></label>}
    {tokenTooShort && <Callout.Root size="1" color="red"><Callout.Icon><AlertTriangle className="size-4"/></Callout.Icon><Callout.Text className="text-[11px] leading-5">{t.tokenShort(tokenMinutesLeft, Math.ceil(duration / 60))}</Callout.Text></Callout.Root>}
    <div className="flex gap-2">
      {running ? <Button size="3" onClick={load.stop} variant="surface" color="gray" className="flex-1"><Square className="size-4 fill-current"/>{t.stopTest}</Button> : <Button onClick={() => void load.start()} disabled={blocked || !load.targets.length} size="3" variant="solid" className="flex-1"><Play className="size-4 fill-current"/>{t.start(testTypeLabel(load.type, locale))}</Button>}
    </div>
    {load.phase && <p className="flex items-center gap-2 text-[11px] text-slate-500"><Spinner size="1"/>{load.phase}</p>}
    {!!load.error && <Callout.Root size="1" color="red" role="alert"><Callout.Icon><CircleAlert className="size-4"/></Callout.Icon><Callout.Text className="text-[11px] leading-5">{load.error}</Callout.Text></Callout.Root>}
    {load.preflight.length > 0 && <PreflightTable results={load.preflight}/>}
  </div>;
}
