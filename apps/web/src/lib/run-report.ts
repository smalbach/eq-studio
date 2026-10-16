/** A run as Markdown, to paste into a ticket or a chat: the numbers, the failures and the change. */
import type { compareRuns } from "@/lib/run-snapshot.mjs";
import type { summarizeResults } from "@/lib/results-summary.mjs";
import { caseName } from "@/lib/run-entries";
import type { RunRecord } from "@/lib/run-types";
import { formatDate, percent, seconds } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { tr } from "@/lib/i18n-core.mjs";

type Failure = { method: string; path: string; scenario: string; expectedStatus: number; actualStatus: number | null; reasons: string[] };

export function runMarkdown(run: RunRecord, summary: ReturnType<typeof summarizeResults>, comparison?: ReturnType<typeof compareRuns>, locale: Locale = "es") {
  const t = <V,>(es: V, en: V) => tr(locale, es, en);
  const lines = [
    `## ${run.scope} — ${run.failed ? t("con fallos", "with failures") : t("sin fallos", "no failures")}`,
    "",
    t(`- **Fecha:** ${formatDate(run.at, locale)} · **Entorno:** ${run.environment} (\`${run.baseUrl}\`)${run.stopped ? " · detenida antes de terminar" : ""}`, `- **Date:** ${formatDate(run.at, locale)} · **Environment:** ${run.environment} (\`${run.baseUrl}\`)${run.stopped ? " · stopped before finishing" : ""}`),
    t(`- **Casos:** ${summary.passed}/${summary.total} correctos (${percent(summary.passRate)}), ${summary.failed} fallidos`, `- **Cases:** ${summary.passed}/${summary.total} passed (${percent(summary.passRate)}), ${summary.failed} failed`),
    t(`- **Solicitudes:** ${summary.requests.total} · p50 ${summary.requests.latency.p50} ms · p95 ${summary.requests.latency.p95} ms · máx ${summary.requests.latency.max} ms`, `- **Requests:** ${summary.requests.total} · p50 ${summary.requests.latency.p50} ms · p95 ${summary.requests.latency.p95} ms · max ${summary.requests.latency.max} ms`),
    t(`- **Aserciones:** ${summary.assertions.passed}/${summary.assertions.total} correctas · respuestas verificadas ${summary.coverageTotals.verified}/${summary.coverageTotals.declared}`, `- **Assertions:** ${summary.assertions.passed}/${summary.assertions.total} passed · responses verified ${summary.coverageTotals.verified}/${summary.coverageTotals.declared}`),
    t(`- **Duración:** ${seconds(summary.durationMs)}`, `- **Duration:** ${seconds(summary.durationMs)}`),
  ];
  if (comparison) {
    lines.push(t(`- **Frente a la anterior:** ${comparison.newFailures.length} nuevos fallos, ${comparison.fixed.length} arreglados, ${comparison.stillFailing.length} siguen fallando`, `- **Versus the previous run:** ${comparison.newFailures.length} new failures, ${comparison.fixed.length} fixed, ${comparison.stillFailing.length} still failing`));
    if (comparison.newFailures.length) lines.push("", t("### Nuevos fallos", "### New failures"), ...comparison.newFailures.map((key) => { const name = caseName(key, locale); return `- \`${name.label}\` · ${name.scenario}`; }));
  }
  const failures = summary.failures as Failure[];
  if (failures.length) {
    lines.push("", t("### Fallos", "### Failures"), "", t("| Endpoint | Caso | Esperado | Recibido | Motivo |", "| Endpoint | Case | Expected | Received | Reason |"), "|---|---|---|---|---|");
    for (const failure of failures.slice(0, 50)) lines.push(`| \`${failure.method} ${failure.path}\` | ${failure.scenario} | ${failure.expectedStatus} | ${failure.actualStatus ?? "—"} | ${(failure.reasons[0] ?? "").replace(/\|/g, "\\|").slice(0, 160)} |`);
    if (failures.length > 50) lines.push("", t(`…y ${failures.length - 50} más.`, `…and ${failures.length - 50} more.`));
  }
  return lines.join("\n");
}
