import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, Callout, Link, Switch } from "@radix-ui/themes";
import { ArrowLeft, ArrowRight, BookOpen, Check, CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { api, API, ApiError, type ApiRun, type ProbeResult } from "@/lib/api";
import { cn } from "@/lib/utils";
import { defineMessages, useLocale, useMessages, useTr } from "@/lib/i18n";
import type { GuideEntry } from "@/components/guide/guides";
import type { TestScenario } from "@eq/runner-core";

/**
 * The parts every guide is built from: the stepper around the form, the example beside it, the
 * notices, and the few API reads the guides share. Each guide owns its own state and decides
 * when a step is valid; the frame only draws it and moves between steps.
 */

const MESSAGES = defineMessages({
  es: { back: "Atrás", next: "Siguiente", example: "Ejemplo", learnMore: "Leer más en la documentación", step: (n: number, total: number) => `Paso ${n} de ${total}`, steps: "Pasos de la guía" },
  en: { back: "Back", next: "Next", example: "Example", learnMore: "Read more in the documentation", step: (n: number, total: number) => `Step ${n} of ${total}`, steps: "Guide steps" },
});

/** A structural selectable surface (a list item or chip that is picked), in the accent colour when chosen. */
export const choice = (active: boolean) => cn("rounded-xl border px-3 py-2.5 text-left text-[11px] transition-colors disabled:opacity-50", active ? "border-accent-8 bg-accent-2 ring-2 ring-accent-4" : "border-slate-200 bg-panel hover:bg-slate-50");

/** The text of whatever was thrown, with every field error the API listed. */
export const errorText = (error: unknown) => error instanceof ApiError ? error.full : error instanceof Error ? error.message : String(error);

/** A labelled control with the sentence that explains it. */
export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return <label className={cn("block text-[11px] font-medium text-slate-600", className)}>{label}{children}{hint && <span className="mt-1 block text-[11px] font-normal leading-4 text-slate-500">{hint}</span>}</label>;
}

/** A switch with its reason next to it: every switch in the guides says why it exists. */
export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint: ReactNode; disabled?: boolean }) {
  const id = useId();
  return <div className={cn("flex items-start gap-3 rounded-xl border p-3", checked ? "border-accent-7 bg-accent-2" : "border-slate-200 bg-panel", disabled && "opacity-60")}>
    <Switch id={id} size="1" checked={checked} disabled={disabled} onCheckedChange={onChange} className="mt-0.5"/>
    <label htmlFor={id} className={cn("flex-1", disabled ? "cursor-not-allowed" : "cursor-pointer")}><span className="block text-xs font-semibold text-slate-900">{label}</span><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{hint}</span></label>
  </div>;
}

const TONES = {
  info: { color: "blue", icon: Info },
  warn: { color: "amber", icon: TriangleAlert },
  error: { color: "red", icon: CircleAlert },
  ok: { color: "green", icon: CircleCheck },
} as const;

export function Notice({ tone = "info", children, className }: { tone?: keyof typeof TONES; children: ReactNode; className?: string }) {
  const { color, icon: Icon } = TONES[tone];
  return <Callout.Root size="1" color={color} role={tone === "error" ? "alert" : undefined} className={className}><Callout.Icon><Icon className="size-3.5"/></Callout.Icon><Callout.Text className="min-w-0 whitespace-pre-line text-[11px] leading-4">{children}</Callout.Text></Callout.Root>;
}

/** A filled-in example, beside the form: what a sensible answer to this step looks like. */
export function Example({ title, children, code }: { title?: string; children?: ReactNode; code?: string }) {
  const t = useMessages(MESSAGES);
  return <Card className="p-4">
    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{title ?? t.example}</p>
    {children && <div className="space-y-2 text-[11px] leading-4 text-slate-600">{children}</div>}
    {code && <pre className="theme-fixed mt-2 max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[10.5px] leading-4 text-slate-200">{code}</pre>}
  </Card>;
}

/** A link to a documentation page. A real link, so it opens in a new tab with a modifier key. */
export function DocLink({ doc, children }: { doc: string; children?: ReactNode }) {
  const t = useMessages(MESSAGES);
  return <Link href={`?vista=aprende&doc=${doc}`} size="1" weight="medium" underline="always" className="inline-flex items-center gap-1"><BookOpen className="size-3"/>{children ?? t.learnMore}</Link>;
}

/**
 * The frame of a guide: its steps across the top, the form of the current step with the
 * example beside it, and Back/Next underneath. `next` runs when Next is pressed — it may save
 * something — and the guide only moves on when it succeeds; `canNext` is the step's validation.
 */
export function GuideFrame({ guide, step, onStep, canNext, next, nextLabel, hideNext, title, intro, example, doc, children, maxStep }: {
  guide: GuideEntry; step: number; onStep: (step: number) => void; canNext: boolean; next?: () => Promise<boolean | void> | boolean | void; nextLabel?: string; hideNext?: boolean;
  title: string; intro?: ReactNode; example?: ReactNode; doc?: string; children: ReactNode; maxStep?: number;
}) {
  const t = useMessages(MESSAGES);
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  // An error belongs to the step that raised it: moving to another step leaves it behind.
  const [failure, setFailure] = useState({ step, text: "" });
  const error = failure.step === step ? failure.text : "";
  const total = guide.steps.length;
  // Steps already reached can be revisited; the ones ahead are reached through Next only.
  const reachable = Math.max(step, maxStep ?? step);

  async function advance() {
    setBusy(true);
    setFailure({ step, text: "" });
    try {
      const result = await next?.();
      if (result !== false) onStep(step + 1);
    } catch (thrown) {
      setFailure({ step, text: errorText(thrown) });
    } finally {
      setBusy(false);
    }
  }

  return <div>
    <ol aria-label={t.steps} className="mb-4 flex flex-wrap items-center gap-1.5 print:hidden">
      {guide.steps.map((name, index) => {
        const done = index < step;
        const current = index === step;
        return <li key={index} className="flex items-center gap-1.5">
          {index > 0 && <span className="h-px w-4 bg-slate-200"/>}
          <button type="button" disabled={index > reachable || busy} onClick={() => onStep(index)} aria-current={current ? "step" : undefined} className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-8", current ? "border-accent-8 bg-accent-3 text-accent-12" : done ? "border-emerald-200 bg-panel text-emerald-800 hover:bg-emerald-50" : "border-slate-200 bg-panel text-slate-500 disabled:opacity-60")}>
            <span className={cn("grid size-4 place-items-center rounded-full text-[9px] font-bold", current ? "bg-accent-9 text-accent-contrast" : done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>{done ? <Check className="size-2.5"/> : index + 1}</span>
            {name[locale]}
          </button>
        </li>;
      })}
    </ol>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="p-5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t.step(step + 1, total)}</p>
        <h2 className="mt-0.5 text-base font-semibold tracking-tight text-slate-950">{title}</h2>
        {intro && <div className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">{intro}</div>}
        <div className="mt-4 space-y-4">{children}</div>
        {error && <Notice tone="error" className="mt-4">{error}</Notice>}
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <Button type="button" size="2" variant="surface" color="gray" disabled={step === 0 || busy} onClick={() => onStep(step - 1)}><ArrowLeft className="size-3.5"/>{t.back}</Button>
          {!hideNext && <Button type="button" size="2" disabled={!canNext || busy} loading={busy} onClick={() => { void advance(); }}>{nextLabel ?? t.next}<ArrowRight className="size-3.5"/></Button>}
        </div>
      </Card>
      <div className="space-y-3">
        {example}
        {doc && <div className="px-1"><DocLink doc={doc}/></div>}
      </div>
    </div>
  </div>;
}

const draftKey = (guide: string) => `endpoint-quality:guide:${guide}`;

/** Forgets a guide's answers, so it starts over the next time it opens (a new project). */
export function clearGuideDraft(guide: string) {
  try { localStorage.removeItem(draftKey(guide)); } catch { /* nothing kept */ }
}

/** A guide's answers so far, kept in this browser so it can be left and resumed. */
export function useGuideDraft<T extends object>(guide: string, initial: T) {
  const key = draftKey(guide);
  const [draft, setDraft] = useState<T>(() => {
    try { const saved = localStorage.getItem(key); return saved ? { ...initial, ...JSON.parse(saved) as Partial<T> } : initial; } catch { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(draft)); } catch { /* a private window simply forgets it */ }
  }, [key, draft]);
  const update = (patch: Partial<T>) => setDraft((current) => ({ ...current, ...patch }));
  const reset = () => { clearGuideDraft(guide); setDraft(initial); };
  return [draft, update, reset] as const;
}

export type MatrixOperation = { operationId: string; method: string; path: string; implemented: boolean; scenarios: TestScenario[] };
export type Matrix = { total: number; operations: MatrixOperation[] };

/** The matrix the engine generates for a project, as the API computes it. */
export function fetchMatrix(projectId: string, auth: boolean, locale: "es" | "en") {
  return API.scenarios<Matrix>(projectId, auth, locale);
}

const ACTIVE: ApiRun["status"][] = ["queued", "running", "cancelling"];
export const isActive = (run: ApiRun | null) => Boolean(run && ACTIVE.includes(run.status));

/**
 * Follows a run by polling it until it finishes. Polling rather than the event stream: a guide
 * only needs the totals, and a poll survives the tab sleeping without any reconnection logic.
 */
export function useRunPoll(runId: string | null, intervalMs = 1200) {
  const [run, setRun] = useState<ApiRun | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    const tick = async () => {
      try {
        // Without `?steps=true`: the guide shows totals, not every request.
        const current = await api<ApiRun>("GET", `/v1/runs/${runId}`);
        if (stopped) return;
        setRun(current);
        setError("");
        if (ACTIVE.includes(current.status)) timer.current = setTimeout(tick, intervalMs);
      } catch (failure) {
        if (stopped) return;
        setError(errorText(failure));
        timer.current = setTimeout(tick, intervalMs * 3);
      }
    };
    void tick();
    return () => { stopped = true; if (timer.current) clearTimeout(timer.current); };
  }, [runId, intervalMs]);
  return { run: runId ? run : null, error };
}

/** Progress of a functional run: a bar and its totals. */
export function RunProgress({ run }: { run: ApiRun }) {
  const label = useTr();
  const { total, completed, passed, failed, blocked } = run.totals;
  const share = (value: number) => `${total ? (value / total) * 100 : 0}%`;
  return <div>
    <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}>
      <span className="bg-emerald-500" style={{ width: share(passed) }}/>
      <span className="bg-rose-500" style={{ width: share(failed) }}/>
      <span className="bg-amber-400" style={{ width: share(blocked) }}/>
    </div>
    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
      <span>{completed}/{total} {label("casos", "cases")}</span>
      <span className="text-emerald-700">{passed} {label("pasaron", "passed")}</span>
      <span className="text-rose-700">{failed} {label("fallaron", "failed")}</span>
      <span className="text-amber-700">{blocked} {label("bloqueados", "blocked")}</span>
    </p>
  </div>;
}

/** Shown by a guide that needs a project when there is none open. */
export function NeedsProject({ onFirstProject }: { onFirstProject: () => void }) {
  const t = useTr();
  return <Card className="p-6 text-center">
    <p className="text-sm font-semibold text-slate-900">{t("Esta guía trabaja sobre un proyecto", "This guide works on a project")}</p>
    <p className="mt-1 text-xs text-slate-500">{t("Crea uno primero: con el ejemplo incluido es un minuto.", "Create one first: it takes a minute with the bundled example.")}</p>
    <Button type="button" size="2" onClick={onFirstProject} className="mt-4">{t("Guía de nuevo proyecto", "New project guide")}<ArrowRight className="size-3.5"/></Button>
  </Card>;
}

/** The first environment's probe target: a GET whose first case needs no id and no credential. */
export function readTarget(matrix: Matrix) {
  const candidates = matrix.operations.filter((operation) => operation.method === "GET" && !operation.path.includes("{"));
  // A health check first: it answers without data and is usually public.
  const ordered = [...candidates.filter((operation) => /health|ping|status/i.test(operation.path)), ...candidates];
  for (const operation of ordered) {
    const scenario = operation.scenarios.find((item) => item.flow === "request" && (!item.auth || item.auth === "default") && !item.parameters);
    if (scenario) return { operation, scenario };
  }
  return null;
}

/**
 * What a probe answered: each request it sent, its status and the assertions that did not hold.
 * A network error has no status — that is a problem of the path to the API, not of the API.
 */
export function ProbeOutcome({ result }: { result: ProbeResult }) {
  const t = useTr();
  return <div className={cn("rounded-xl border p-3", result.ok ? "border-emerald-200 bg-emerald-50/60" : "border-rose-200 bg-rose-50/60")}>
    <p className={cn("flex items-center gap-1.5 text-xs font-semibold", result.ok ? "text-emerald-900" : "text-rose-800")}>{result.ok ? <CircleCheck className="size-3.5"/> : <CircleAlert className="size-3.5"/>}{result.ok ? t("El caso pasó", "The case passed") : t("El caso no pasó", "The case did not pass")} · {result.durationMs} ms</p>
    <ul className="mt-2 space-y-1.5">{result.steps.map((step, index) => <li key={index} className="text-[11px] leading-4 text-slate-700">
      <span className="font-mono">{step.request.method} {step.request.url}</span> → {step.actual ? <strong>{step.actual.status} {step.actual.statusText}</strong> : <strong className="text-rose-700">{step.error ?? t("sin respuesta", "no response")}</strong>}
      {step.assertions.filter((assertion) => !assertion.pass && !assertion.informative).map((assertion) => <span key={assertion.label} className="block pl-3 text-rose-700">✗ {assertion.label}: {assertion.detail}</span>)}
    </li>)}</ul>
  </div>;
}
