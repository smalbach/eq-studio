/**
 * A finished run as a person reads it in a terminal. JSON is the run itself; JUnit XML, HTML and
 * SARIF come from `@eq/runner-core/report`.
 */
import type { Run, RunCase } from "./client.ts";

const color = (code: number) => (text: string) => process.stdout.isTTY && !process.env.NO_COLOR ? `\u001b[${code}m${text}\u001b[0m` : text;
export const green = color(32);
export const red = color(31);
export const yellow = color(33);
export const dim = color(2);
export const bold = color(1);

function failedAssertions(item: RunCase) {
  return (item.steps ?? []).flatMap((step) => step.assertions.filter((assertion) => !assertion.pass && !assertion.informative).map((assertion) => `${step.method} ${new URL(step.url, "http://x").pathname} · ${assertion.label}: ${assertion.detail}`));
}

export function textReport(run: Run, environment: string): string {
  const lines: string[] = [];
  const { totals } = run;
  const verdict = run.status === "passed" ? green("PASSED") : run.status === "failed" ? red("FAILED") : yellow(run.status.toUpperCase());
  lines.push("", `${bold(run.scope)} · ${environment} · ${verdict}`);
  if (run.kind === "functional") {
    lines.push(`${totals.passed} passed · ${totals.failed} failed · ${totals.blocked} blocked · ${totals.total} cases · ${((run.durationMs ?? 0) / 1000).toFixed(1)} s`);
    for (const item of (run.cases ?? []).filter((candidate) => candidate.status === "failed" || candidate.status === "blocked")) {
      lines.push("", `${item.status === "failed" ? red("✗") : yellow("⊘")} ${item.method} ${item.path} · ${item.name} ${dim(`(${item.operationId}:${item.scenarioId})`)}`);
      for (const detail of failedAssertions(item).slice(0, 6)) lines.push(`    ${detail}`);
    }
  } else {
    const report = run.report as { overall?: { rps: number; p50: number; p95: number; p99: number; errorRate: number; completed: number }; verdict?: { checks: { label: string; pass: boolean; detail: string }[] } } | null;
    if (report?.overall) lines.push(`${report.overall.completed} requests · ${report.overall.rps.toFixed(1)} req/s · p50 ${report.overall.p50} ms · p95 ${report.overall.p95} ms · p99 ${report.overall.p99} ms · errors ${(report.overall.errorRate * 100).toFixed(2)} %`);
    for (const check of report?.verdict?.checks ?? []) lines.push(`${check.pass ? green("✓") : red("✗")} ${check.label} ${dim(check.detail)}`);
  }
  if (run.error) lines.push("", red(run.error));
  return lines.join("\n");
}

/** The shareable formats live in the core, where the API renders them too. */
export { htmlReport, junitReport, renderReport, sarifReport, REPORT_FORMATS, type ReportContext, type ReportFormat } from "@eq/runner-core/report";
