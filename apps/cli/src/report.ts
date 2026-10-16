/**
 * A finished run as a person reads it in a terminal, as JSON for a script, and as JUnit XML for
 * CI systems that show test results (GitHub, GitLab, Jenkins, Azure DevOps all read it).
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

const xml = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A load test: one `<testcase>` per criterion of its verdict. */
function loadJunit(run: Run, project: string, environment: string): string {
  const checks = (run.report as { verdict?: { checks: { label: string; pass: boolean; detail: string }[] } } | null)?.verdict?.checks ?? [];
  const failures = checks.filter((check) => !check.pass).length;
  const cases = checks.map((check) => {
    const head = `    <testcase classname="${xml(`${project}.load`)}" name="${xml(check.label)}"`;
    return check.pass ? `${head}/>` : `${head}>\n      <failure message="${xml(check.detail)}">${xml(check.detail)}</failure>\n    </testcase>`;
  });
  if (run.error) cases.push(`    <testcase classname="${xml(`${project}.load`)}" name="run">\n      <error message="${xml(run.error)}"/>\n    </testcase>`);
  const time = ((run.durationMs ?? 0) / 1000).toFixed(3);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${xml(`${project} · ${environment} · ${run.scope}`)}" tests="${cases.length}" failures="${failures}" time="${time}">\n  <testsuite name="${xml(run.scope)}" tests="${cases.length}" failures="${failures}" time="${time}">\n${cases.join("\n")}\n  </testsuite>\n</testsuites>\n`;
}

/** One `<testsuite>` per operation, one `<testcase>` per case. Blocked cases are `<skipped>`. */
export function junitReport(run: Run, project: string, environment: string): string {
  if (run.kind === "load") return loadJunit(run, project, environment);
  const byOperation = new Map<string, RunCase[]>();
  for (const item of run.cases ?? []) byOperation.set(item.operationId, [...(byOperation.get(item.operationId) ?? []), item]);
  const suites = [...byOperation.entries()].map(([operation, cases]) => {
    const failures = cases.filter((item) => item.status === "failed").length;
    const skipped = cases.filter((item) => item.status !== "passed" && item.status !== "failed").length;
    const time = cases.reduce((sum, item) => sum + (item.durationMs ?? 0), 0) / 1000;
    const body = cases.map((item) => {
      const head = `    <testcase classname="${xml(`${project}.${operation}`)}" name="${xml(`${item.name} [${item.scenarioId}]`)}" time="${((item.durationMs ?? 0) / 1000).toFixed(3)}"`;
      if (item.status === "passed") return `${head}/>`;
      if (item.status === "failed") return `${head}>\n      <failure message="${xml(failedAssertions(item)[0] ?? "failed")}">${xml(failedAssertions(item).join("\n"))}</failure>\n    </testcase>`;
      return `${head}>\n      <skipped message="${xml(item.status === "blocked" ? "writes are not allowed in this environment" : item.status)}"/>\n    </testcase>`;
    }).join("\n");
    return `  <testsuite name="${xml(operation)}" tests="${cases.length}" failures="${failures}" skipped="${skipped}" time="${time.toFixed(3)}">\n${body}\n  </testsuite>`;
  });
  const { totals } = run;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${xml(`${project} · ${environment} · ${run.scope}`)}" tests="${totals.total}" failures="${totals.failed}" skipped="${totals.blocked}" time="${((run.durationMs ?? 0) / 1000).toFixed(3)}">\n${suites.join("\n")}\n</testsuites>\n`;
}
