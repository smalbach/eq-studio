import { useMemo, useState } from "react";
import { Button, Checkbox, Flex, RadioCards, Spinner, Table, Text, TextField } from "@radix-ui/themes";
import { Play } from "lucide-react";
import { buildStages, expectedRequests, LOAD_LIMITS, loadCatalog, loadMixes, localized, targetBudget, TEST_TYPES, totalDuration } from "@eq/runner-core/load";
import type { Environment } from "@/components/environment/use-environment";
import { errorText, Example, Field, GuideFrame, isActive, Notice, useGuideDraft, useRunPoll } from "@/components/guide/guide-kit";
import type { GuideEntry } from "@/components/guide/guides";
import { API } from "@/lib/api";
import { useProject } from "@/lib/project-store";
import { formatNumber, seconds } from "@/lib/format";
import { cn } from "@/lib/utils";
import { defineMessages, useLocale, useMessages } from "@/lib/i18n";

const MESSAGES = defineMessages({
  es: {
    typeTitle: "¿Qué pregunta quieres responder?", typeIntro: "Cuatro tipos de prueba para cuatro preguntas distintas: una prueba de carga que pasa no dice nada del doble de tráfico ni de si el servicio se recupera.",
    when: { load: "Antes de cada versión, con la tasa que esperas en producción.", stress: "Para conocer la capacidad y si falla de forma controlada (429/503) o se cae.", spike: "Campañas, reintentos masivos, un cron que despierta a todos los clientes a la vez.", soak: "Para fugas de memoria, pools que se agotan o cachés que crecen: decenas de minutos." } as Record<string, string>,
    whenLabel: "Úsala:",
    mixTitle: "¿Qué operaciones?", mixIntro: "Una mezcla reparte el tráfico entre lecturas con pesos relativos. Solo GET: repetir una escritura cientos de veces llena de filas un entorno.", noMixes: "El proyecto no tiene operaciones GET: no hay nada que cargar.",
    targets: (n: number) => `${n} objetivos`,
    stagesTitle: "Etapas", stagesIntro: "La tasa a lo largo del tiempo, en solicitudes por segundo (modelo abierto: se envía a esa tasa aunque la API tarde).",
    baseRps: "Tasa base (req/s)", peakRps: "Tasa pico (req/s)", durationS: "Duración (s)", total: (duration: string, requests: string) => `${duration} · ~${requests} solicitudes`,
    invalidStages: `La tasa va de 1 a ${LOAD_LIMITS.maxRps} req/s (el pico no menor que la base) y la duración de 5 a ${LOAD_LIMITS.maxDurationS} s.`, measuredNote: "La rampa (en gris) no se mide contra los umbrales: trae conexiones y cachés frías.",
    thresholdsTitle: "Umbrales", thresholdsIntro: "Todo tipo exige errores bajo 0,1 % en las etapas medidas. La latencia se juzga con el p95 de cada objetivo contra:",
    modes: { project: ["Presupuestos del proyecto", "Las reglas de presupuesto. Solo tienen sentido medidas al lado del servicio."], custom: ["Un p95 propio", "Un límite para todos los objetivos: el adecuado a través de VPN o gateway."], off: ["Solo informativa", "La latencia se reporta y no decide el veredicto."] } as Record<string, [string, string]>,
    p95: "Límite p95 (ms)", remoteHint: "Este entorno no es local: los presupuestos del servicio saldrían en rojo por la red. Se sugiere un p95 propio.",
    budgets: "Presupuesto de cada objetivo", noBudget: "sin presupuesto: no se juzga",
    preflight: "Si un objetivo falla la verificación previa", policies: { skip: ["Omitirlo", "La prueba sigue con el resto (por defecto)."], stop: ["Detener", "No se envía nada."], ignore: ["Ignorar", "Sin verificación previa."] } as Record<string, [string, string]>,
    runTitle: "Revisar y ejecutar", runIntro: "La prueba corre en el servidor: puedes cerrar esta pestaña.",
    summary: { type: "Tipo", mix: "Mezcla", stages: "Etapas", latency: "Latencia", environment: "Entorno" },
    shared: (name: string) => `«${name}» no es un entorno con seed: la carga llegará a un servicio que otras personas usan. Coordínala con quien lo opere y empieza con tasas bajas.`,
    confirm: "Entiendo que esta prueba carga un entorno compartido.", start: "Iniciar la prueba", running: "Prueba en curso…", finished: (status: string) => `Prueba terminada: ${status}.`, open: "Ver en Carga y estrés",
    statuses: { passed: "pasó", failed: "no pasó", cancelled: "detenida", interrupted: "interrumpida", error: "error" } as Record<string, string>, noEnvironment: "El proyecto no tiene entornos: crea uno con la guía de entorno.",
  },
  en: {
    typeTitle: "Which question do you want answered?", typeIntro: "Four test types for four different questions: a load test that passes says nothing about twice the traffic, nor about whether the service recovers.",
    when: { load: "Before each release, at the rate you expect in production.", stress: "To learn the capacity and whether it fails in a controlled way (429/503) or falls over.", spike: "Campaigns, mass retries, a cron that wakes every client at once.", soak: "For memory leaks, exhausted pools or growing caches: tens of minutes." } as Record<string, string>,
    whenLabel: "Use it:",
    mixTitle: "Which operations?", mixIntro: "A mix splits the traffic between reads with relative weights. GET only: repeating a write hundreds of times fills an environment with rows.", noMixes: "The project has no GET operations: there is nothing to load.",
    targets: (n: number) => `${n} targets`,
    stagesTitle: "Stages", stagesIntro: "The rate over time, in requests per second (open model: requests go out at that rate even when the API slows down).",
    baseRps: "Base rate (req/s)", peakRps: "Peak rate (req/s)", durationS: "Duration (s)", total: (duration: string, requests: string) => `${duration} · ~${requests} requests`,
    invalidStages: `The rate goes from 1 to ${LOAD_LIMITS.maxRps} req/s (the peak no lower than the base) and the duration from 5 to ${LOAD_LIMITS.maxDurationS} s.`, measuredNote: "The ramp (in grey) is not measured against the thresholds: it carries cold connections and caches.",
    thresholdsTitle: "Thresholds", thresholdsIntro: "Every type requires errors under 0.1 % over the measured stages. Latency is judged on each target's p95 against:",
    modes: { project: ["Project budgets", "The budget rules. They only make sense measured next to the service."], custom: ["A p95 of your own", "One limit for every target: the right one across a VPN or gateway."], off: ["Informative only", "Latency is reported and does not decide the verdict."] } as Record<string, [string, string]>,
    p95: "p95 limit (ms)", remoteHint: "This environment is not local: the service's budgets would be red because of the network. A p95 of your own is suggested.",
    budgets: "Each target's budget", noBudget: "no budget: not judged",
    preflight: "If a target fails the preflight", policies: { skip: ["Skip it", "The test goes on with the rest (default)."], stop: ["Stop", "Nothing is sent."], ignore: ["Ignore", "No preflight."] } as Record<string, [string, string]>,
    runTitle: "Review and run", runIntro: "The test runs on the server: you can close this tab.",
    summary: { type: "Type", mix: "Mix", stages: "Stages", latency: "Latency", environment: "Environment" },
    shared: (name: string) => `"${name}" is not a seeded environment: the load will reach a service other people use. Coordinate with whoever runs it and start with low rates.`,
    confirm: "I understand this test loads a shared environment.", start: "Start the test", running: "Test running…", finished: (status: string) => `Test finished: ${status}.`, open: "See it in Load and stress",
    statuses: { passed: "passed", failed: "did not pass", cancelled: "stopped", interrupted: "interrupted", error: "error" } as Record<string, string>, noEnvironment: "The project has no environments: create one with the environment guide.",
  },
});

type TestType = "load" | "stress" | "spike" | "soak";
type LatencyMode = "project" | "custom" | "off";
type Policy = "skip" | "stop" | "ignore";
/** Starting rates per type: the same defaults as the load screen. A soak is long by nature. */
const DEFAULTS: Record<TestType, { baseRps: number; peakRps: number; durationS: number }> = {
  load: { baseRps: 20, peakRps: 20, durationS: 60 },
  stress: { baseRps: 10, peakRps: 100, durationS: 100 },
  spike: { baseRps: 10, peakRps: 100, durationS: 60 },
  soak: { baseRps: 20, peakRps: 20, durationS: 600 },
};
/** Across a VPN or a gateway a p95 under load near 1.5 s is healthy. */
const REMOTE_P95_MS = 1500;

type Stage = { label: string; durationS: number; fromRps: number; toRps: number; measured: boolean };

/** The rate profile the stages ask for, as a small area chart. */
function StageChart({ stages }: { stages: Stage[] }) {
  const width = 600;
  const height = 150;
  const pad = { left: 36, right: 8, top: 10, bottom: 20 };
  const total = Math.max(1, totalDuration(stages));
  const peak = Math.max(1, ...stages.map((stage) => Math.max(stage.fromRps, stage.toRps)));
  const x = (t: number) => pad.left + (t / total) * (width - pad.left - pad.right);
  const y = (rps: number) => height - pad.bottom - (rps / peak) * (height - pad.top - pad.bottom);
  const shapes = stages.map((stage, index) => {
    const from = totalDuration(stages.slice(0, index));
    const to = from + stage.durationS;
    return { stage, from, to, points: `${x(from)},${y(0)} ${x(from)},${y(stage.fromRps)} ${x(to)},${y(stage.toRps)} ${x(to)},${y(0)}` };
  });
  return <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={stages.map((stage) => `${stage.label} (${stage.durationS} s)`).join(", ")}>
    <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="var(--chart-grid)"/>
    <line x1={pad.left} x2={width - pad.right} y1={y(peak)} y2={y(peak)} stroke="var(--chart-grid)" strokeDasharray="3 3"/>
    <text x={pad.left - 4} y={y(peak) + 3} textAnchor="end" fontSize="9" fill="var(--chart-muted)">{peak}</text>
    <text x={pad.left - 4} y={y(0) + 3} textAnchor="end" fontSize="9" fill="var(--chart-muted)">0</text>
    {shapes.map(({ stage, from, to, points }, index) => <g key={index}>
      <polygon points={points} fill={stage.measured ? "var(--chart-green)" : "var(--chart-muted)"} fillOpacity={stage.measured ? 0.18 : 0.12}/>
      <polyline points={`${x(from)},${y(stage.fromRps)} ${x(to)},${y(stage.toRps)}`} fill="none" stroke={stage.measured ? "var(--chart-green)" : "var(--chart-muted)"} strokeWidth="2"/>
      {index > 0 && <line x1={x(from)} x2={x(from)} y1={pad.top} y2={y(0)} stroke="var(--chart-grid)" strokeDasharray="2 3"/>}
    </g>)}
    <text x={pad.left} y={height - 6} fontSize="9" fill="var(--chart-muted)">0 s</text>
    <text x={width - pad.right} y={height - 6} textAnchor="end" fontSize="9" fill="var(--chart-muted)">{total} s</text>
  </svg>;
}

/** A load, stress, spike or soak test, set up one decision at a time and started on the server. */
export function LoadGuide({ guide, env, step, onStep, onDone }: { guide: GuideEntry; env: Environment; step: number; onStep: (step: number) => void; onDone: (target: "functional" | "load" | "home") => void }) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const project = useProject();
  const remote = !env.seeded;
  const [draft, update, reset] = useGuideDraft(`load:${project.id}`, { type: "load" as TestType, mixId: "", ...DEFAULTS.load, latency: (remote ? "custom" : "project") as LatencyMode, p95Ms: REMOTE_P95_MS, policy: "skip" as Policy, runId: "" });
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const { run, error: runError } = useRunPoll(draft.runId || null, 2000);

  const catalog = useMemo(() => loadCatalog(project.file.project.operations, project.file.load ?? {}), [project]);
  const mixes = useMemo(() => loadMixes(catalog, project.file.load ?? {}), [catalog, project]);
  const mix = mixes.find((item) => item.id === draft.mixId) ?? mixes[0];
  const usesPeak = draft.type === "stress" || draft.type === "spike";
  const stages = buildStages(draft.type, { baseRps: draft.baseRps, peakRps: usesPeak ? draft.peakRps : draft.baseRps, durationS: draft.durationS }, locale) as Stage[];
  const stagesValid = draft.baseRps >= 1 && draft.baseRps <= LOAD_LIMITS.maxRps && (!usesPeak || (draft.peakRps >= draft.baseRps && draft.peakRps <= LOAD_LIMITS.maxRps)) && draft.durationS >= 5 && draft.durationS <= LOAD_LIMITS.maxDurationS;
  const latency = draft.latency === "custom" ? { mode: "custom", p95Ms: draft.p95Ms } : { mode: draft.latency };
  const typeInfo = (id: string) => localized(TEST_TYPES.find((item) => item.id === id) ?? TEST_TYPES[0], locale);
  const frame = { guide, step, onStep, maxStep: draft.runId ? 4 : step };
  const weightOf = (weight: number) => { const sum = mix?.targets.reduce((total, target) => total + target.weight, 0) || 1; return `${Math.round((weight / sum) * 100)} %`; };

  async function start() {
    setError("");
    try {
      const started = await API.startLoadRun(project.id, { environment: env.environmentId, type: draft.type, baseRps: draft.baseRps, peakRps: usesPeak ? draft.peakRps : draft.baseRps, durationS: draft.durationS, mixId: mix?.id, latency, onPreflightFailure: draft.policy, locale });
      update({ runId: started.id });
    } catch (failure) {
      setError(errorText(failure));
    }
  }

  if (step === 0) return <GuideFrame {...frame} title={t.typeTitle} intro={t.typeIntro} canNext doc="carga"
    example={<Example><p>{typeInfo(draft.type).hint}</p></Example>}>
    <RadioCards.Root size="1" value={draft.type} onValueChange={(type) => update({ type: type as TestType, ...DEFAULTS[type as TestType] })} columns={{ initial: "1", sm: "2" }} gap="2">{TEST_TYPES.map((item) => {
      const text = localized(item, locale);
      return <RadioCards.Item key={item.id} value={item.id} className="justify-start text-left text-[11px]"><span>
        <span className="block text-xs font-semibold text-slate-900">{text.label}</span>
        <span className="mt-0.5 block font-medium text-slate-700">{text.question}</span>
        <span className="mt-1 block text-slate-500"><strong className="font-medium">{t.whenLabel}</strong> {t.when[item.id]}</span>
      </span></RadioCards.Item>;
    })}</RadioCards.Root>
  </GuideFrame>;

  if (step === 1) return <GuideFrame {...frame} title={t.mixTitle} intro={t.mixIntro} canNext={Boolean(mix)} doc="carga"
    example={<Example code={`"mixes": [{\n  "id": "browse",\n  "label": { "es": "Navegación", "en": "Browsing" },\n  "targets": [\n    { "target": "listOrders", "weight": 30 },\n    { "target": "getOrder", "weight": 70 }\n  ]\n}]`}/>}>
    {!mixes.length && <Notice tone="warn">{t.noMixes}</Notice>}
    <RadioCards.Root size="1" value={mix?.id ?? ""} onValueChange={(mixId) => update({ mixId })} columns={{ initial: "1", sm: "2" }} gap="2">{mixes.map((item, index) => {
      const text = localized(item, locale);
      // Keyed by position: a project's own mix may share its id with a generic one ("health").
      return <RadioCards.Item key={`${index}:${item.id}`} value={item.id} className="justify-start text-left text-[11px]"><span>
        <span className="block text-xs font-semibold text-slate-900">{text.label}</span>
        <span className="mt-0.5 block text-slate-500">{text.hint}</span>
        <span className="mt-1 block text-[10px] text-slate-400">{t.targets(item.targets.length)}</span>
      </span></RadioCards.Item>;
    })}</RadioCards.Root>
    {mix && <div className="max-h-56 overflow-auto rounded-xl border border-slate-200"><Table.Root size="1" variant="ghost" className="text-[11px]"><Table.Body>{mix.targets.map((target) => <Table.Row key={target.path}><Table.Cell className="px-3 font-mono text-slate-700">{target.path}</Table.Cell><Table.Cell justify="end" className="px-3 tabular-nums text-slate-500">{weightOf(target.weight)}</Table.Cell></Table.Row>)}</Table.Body></Table.Root></div>}
  </GuideFrame>;

  if (step === 2) return <GuideFrame {...frame} title={t.stagesTitle} intro={t.stagesIntro} canNext={stagesValid} doc="carga"
    example={<Example><ul className="space-y-0.5">{stages.map((stage, index) => <li key={index} className="font-mono text-[10.5px]">{stage.label} · {stage.durationS} s</li>)}</ul></Example>}>
    <div className={cn("grid gap-3", usesPeak ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
      <Field label={t.baseRps}><TextField.Root size="2" type="number" min={1} max={LOAD_LIMITS.maxRps} value={draft.baseRps} onChange={(event) => update({ baseRps: Number(event.target.value) })} className="mt-1 font-mono"/></Field>
      {usesPeak && <Field label={t.peakRps}><TextField.Root size="2" type="number" min={1} max={LOAD_LIMITS.maxRps} value={draft.peakRps} onChange={(event) => update({ peakRps: Number(event.target.value) })} className="mt-1 font-mono"/></Field>}
      <Field label={t.durationS}><TextField.Root size="2" type="number" min={5} max={LOAD_LIMITS.maxDurationS} value={draft.durationS} onChange={(event) => update({ durationS: Number(event.target.value) })} className="mt-1 font-mono"/></Field>
    </div>
    {stagesValid ? <>
      <div className="rounded-xl border border-slate-200 p-3"><StageChart stages={stages}/></div>
      <p className="text-[11px] text-slate-600">{t.total(seconds(totalDuration(stages) * 1000), formatNumber(expectedRequests(stages), locale))}</p>
      {stages.some((stage) => !stage.measured) && <p className="text-[11px] text-slate-500">{t.measuredNote}</p>}
    </> : <Notice tone="warn">{t.invalidStages}</Notice>}
  </GuideFrame>;

  if (step === 3) {
    const rules = project.file.project.budgets ?? [];
    const judged = draft.latency === "project" ? { mode: "project", rules } : latency;
    return <GuideFrame {...frame} title={t.thresholdsTitle} intro={t.thresholdsIntro} canNext={draft.latency !== "custom" || draft.p95Ms > 0} doc="carga"
      example={<Example>{typeInfo(draft.type).hint}</Example>}>
      <RadioCards.Root size="1" value={draft.latency} onValueChange={(latency) => update({ latency: latency as LatencyMode })} columns={{ initial: "1", sm: "3" }} gap="2">{(["project", "custom", "off"] as LatencyMode[]).map((mode) => <RadioCards.Item key={mode} value={mode} className="justify-start text-left text-[11px]"><span><span className="block text-xs font-semibold text-slate-900">{t.modes[mode][0]}</span><span className="mt-0.5 block text-slate-500">{t.modes[mode][1]}</span></span></RadioCards.Item>)}</RadioCards.Root>
      {remote && draft.latency === "project" && <Notice tone="warn">{t.remoteHint}</Notice>}
      {draft.latency === "custom" && <Field label={t.p95} className="max-w-48"><TextField.Root size="2" type="number" min={1} value={draft.p95Ms} onChange={(event) => update({ p95Ms: Number(event.target.value) })} className="mt-1 font-mono"/></Field>}
      {draft.latency !== "off" && mix && <div>
        <p className="mb-1 text-[11px] font-medium text-slate-600">{t.budgets}</p>
        <div className="max-h-48 overflow-auto rounded-xl border border-slate-200"><Table.Root size="1" variant="ghost" className="text-[11px]"><Table.Body>{mix.targets.map((target) => {
          const budget = targetBudget(target, judged, locale);
          return <Table.Row key={target.path}><Table.Cell className="px-3 font-mono text-slate-700">{target.path}</Table.Cell><Table.Cell justify="end" className={cn("px-3", budget ? "font-semibold text-slate-900" : "text-slate-400")}>{budget ? `p95 < ${budget.ms} ms` : t.noBudget}</Table.Cell></Table.Row>;
        })}</Table.Body></Table.Root></div>
      </div>}
      <div>
        <p className="mb-1 text-[11px] font-medium text-slate-600">{t.preflight}</p>
        <RadioCards.Root size="1" value={draft.policy} onValueChange={(policy) => update({ policy: policy as Policy })} columns={{ initial: "1", sm: "3" }} gap="2">{(["skip", "stop", "ignore"] as Policy[]).map((policy) => <RadioCards.Item key={policy} value={policy} className="justify-start text-left text-[11px]"><span><span className="block text-xs font-semibold text-slate-900">{t.policies[policy][0]}</span><span className="mt-0.5 block text-slate-500">{t.policies[policy][1]}</span></span></RadioCards.Item>)}</RadioCards.Root>
      </div>
    </GuideFrame>;
  }

  const done = run && !isActive(run);
  const rows: [string, string][] = [
    [t.summary.environment, `${env.label} · ${env.baseUrl}`],
    [t.summary.type, typeInfo(draft.type).label],
    [t.summary.mix, mix ? localized(mix, locale).label : "—"],
    [t.summary.stages, stages.map((stage) => `${stage.label} (${stage.durationS} s)`).join(" → ")],
    [t.summary.latency, draft.latency === "custom" ? `p95 < ${draft.p95Ms} ms` : t.modes[draft.latency][0]],
  ];
  return <GuideFrame {...frame} title={t.runTitle} intro={t.runIntro} canNext={false} hideNext doc="carga"
    example={<Example code={JSON.stringify({ environment: env.environmentId, type: draft.type, baseRps: draft.baseRps, peakRps: usesPeak ? draft.peakRps : draft.baseRps, durationS: draft.durationS, mixId: mix?.id, latency, onPreflightFailure: draft.policy }, null, 2)}/>}>
    <Table.Root size="1" variant="ghost" className="text-[11px]"><Table.Body>{rows.map(([name, value]) => <Table.Row key={name}><Table.RowHeaderCell className="w-28 pr-4 align-top font-normal text-slate-500">{name}</Table.RowHeaderCell><Table.Cell className="text-slate-800">{value}</Table.Cell></Table.Row>)}</Table.Body></Table.Root>
    {!env.environmentId && <Notice tone="error">{t.noEnvironment}</Notice>}
    {!draft.runId && <>
      {env.shared && <>
        <Notice tone="warn">{t.shared(env.label)}</Notice>
        <Text as="label" size="1" className="text-[11px] text-slate-700"><Flex gap="2" align="center"><Checkbox size="1" color="amber" checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)}/>{t.confirm}</Flex></Text>
      </>}
      <Button type="button" size="2" disabled={!env.environmentId || !mix || !stagesValid || (env.shared && !confirmed)} onClick={() => { void start(); }}><Play className="size-3.5"/>{t.start}</Button>
    </>}
    {draft.runId && <div className="space-y-2">
      {!done && <p className="flex items-center gap-1.5 text-xs text-slate-500"><Spinner size="1"/>{t.running}</p>}
      {done && <Notice tone={run.status === "passed" ? "ok" : "warn"}>{t.finished(t.statuses[run.status] ?? run.status)}{run.error ? `\n${run.error}` : ""}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="2" onClick={() => { reset(); onDone("load"); }}>{t.open}</Button>
        {done && <Button type="button" size="2" variant="surface" color="gray" onClick={() => { update({ runId: "" }); setConfirmed(false); }}>{t.start}</Button>}
      </div>
    </div>}
    {(error || runError) && <Notice tone="error">{error || runError}</Notice>}
  </GuideFrame>;
}
