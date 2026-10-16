/**
 * What a finished run announces, and when — without any framework, so it is tested directly.
 */
import { createHmac } from "node:crypto";
import type { NotificationTrigger, RunStatus, RunTotals } from "../../../database/entities.ts";

export type Verdict = "passed" | "failed";

/** An error is a failure of the check; a cancelled or interrupted run says nothing about the API. */
export function verdictOf(status: RunStatus | string): Verdict | null {
  if (status === "passed") return "passed";
  if (status === "failed" || status === "error") return "failed";
  return null;
}

/**
 * `always`: every finished run. `change`: only a flip of the verdict. With no earlier verdict the
 * baseline is "passed": a first green run is not news, a first red one is.
 */
export function shouldNotify(trigger: NotificationTrigger, verdict: Verdict | null, previous: Verdict | null) {
  if (trigger === "always") return true;
  return verdict !== null && verdict !== (previous ?? "passed");
}

export type RunPayload = {
  event: "run.finished";
  test?: true;
  sentAt: string;
  project: { id: string; slug: string; name: string };
  environment: { id: string; key: string; name: string; baseUrl: string };
  run: { id: string; kind: "functional" | "load"; status: string; verdict: Verdict | null; previousVerdict: Verdict | null; changed: boolean; scope: string; totals: RunTotals; error: string | null; triggeredBy: string; scheduleId: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null; durationMs: number | null; url: string | null };
};

/** `X-EQ-Signature: sha256=<hex>` over `<timestamp>.<body>`: the timestamp is signed too, so a
 * captured delivery cannot be replayed later with a fresh one. */
export function signature(secret: string, timestamp: number, body: string) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

const tr = (locale: "es" | "en", es: string, en: string) => locale === "en" ? en : es;

/** One line a person reads: in Slack, in an email subject. */
export function headline(payload: RunPayload, locale: "es" | "en") {
  const { run, project, environment } = payload;
  const kind = run.kind === "load" ? tr(locale, "Prueba de carga", "Load test") : tr(locale, "Verificación funcional", "Functional run");
  const outcome = run.verdict === "passed" ? tr(locale, "pasó", "passed") : run.verdict === "failed" ? (run.status === "error" ? tr(locale, "terminó con error", "ended with an error") : tr(locale, "falló", "failed")) : run.status;
  const change = run.changed && run.previousVerdict ? tr(locale, ` (antes ${run.previousVerdict === "passed" ? "pasaba" : "fallaba"})`, ` (was ${run.previousVerdict})`) : "";
  return `${payload.test ? tr(locale, "[prueba] ", "[test] ") : ""}${project.name} · ${environment.name}: ${kind} ${outcome}${change}`;
}

export function details(payload: RunPayload, locale: "es" | "en") {
  const { run, environment } = payload;
  const totals = run.kind === "functional"
    ? tr(locale, `${run.totals.passed} de ${run.totals.total} casos pasaron, ${run.totals.failed} fallaron, ${run.totals.blocked} bloqueados`, `${run.totals.passed} of ${run.totals.total} cases passed, ${run.totals.failed} failed, ${run.totals.blocked} blocked`)
    : tr(locale, `${run.totals.completed} peticiones, ${run.totals.failed} errores`, `${run.totals.completed} requests, ${run.totals.failed} errors`);
  return [totals, `${tr(locale, "Alcance", "Scope")}: ${run.scope}`, `${tr(locale, "Entorno", "Environment")}: ${environment.baseUrl}`, ...(run.durationMs != null ? [`${tr(locale, "Duración", "Duration")}: ${Math.round(run.durationMs / 1000)} s`] : []), ...(run.error ? [`${tr(locale, "Error", "Error")}: ${run.error}`] : []), ...(run.scheduleId ? [tr(locale, "Iniciada por una programación", "Started by a schedule")] : [])];
}

/** An incoming-webhook message: Slack, and the chat tools that accept its format. */
export function slackMessage(payload: RunPayload, locale: "es" | "en") {
  const icon = payload.run.verdict === "passed" ? ":white_check_mark:" : payload.run.verdict === "failed" ? ":x:" : ":warning:";
  const link = payload.run.url ? `\n<${payload.run.url}|${tr(locale, "Abrir la corrida", "Open the run")}>` : "";
  const text = `${icon} *${headline(payload, locale)}*\n${details(payload, locale).join("\n")}${link}`;
  return { text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] };
}

export function emailMessage(payload: RunPayload, locale: "es" | "en") {
  const link = payload.run.url ? `\n\n${tr(locale, "Abrir la corrida", "Open the run")}: ${payload.run.url}` : "";
  return { subject: headline(payload, locale), text: `${headline(payload, locale)}\n\n${details(payload, locale).join("\n")}${link}\n` };
}

/** What a list may show of a URL that is a secret: its host and its last four characters. */
export function urlHint(url: string) {
  try { return `${new URL(url).host}/…${url.slice(-4)}`; } catch { return "…"; }
}
