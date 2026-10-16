/**
 * JUnit XML, for CI systems that show test results (GitHub, GitLab, Jenkins, Azure DevOps all
 * read it).
 */
import { maskSecrets } from "./mask.ts";
import { failedAssertions, loadSummary, pathOf, type ReportCase, type ReportContext, type ReportRun } from "./model.ts";

export const xml = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const failures = (item: ReportCase) => (item.steps ?? []).flatMap((step) => failedAssertions(step).map((assertion) => `${step.method} ${pathOf(step.url)} · ${assertion.label}: ${assertion.detail}`));

/** A load test: one `<testcase>` per criterion of its verdict. */
function loadJunit(run: ReportRun, project: string, environment: string): string {
  const checks = loadSummary(run).verdict?.checks ?? [];
  const failed = checks.filter((check) => !check.pass).length;
  const cases = checks.map((check) => {
    const head = `    <testcase classname="${xml(`${project}.load`)}" name="${xml(check.label)}"`;
    return check.pass ? `${head}/>` : `${head}>\n      <failure message="${xml(check.detail)}">${xml(check.detail)}</failure>\n    </testcase>`;
  });
  if (run.error) cases.push(`    <testcase classname="${xml(`${project}.load`)}" name="run">\n      <error message="${xml(run.error)}"/>\n    </testcase>`);
  const time = ((run.durationMs ?? 0) / 1000).toFixed(3);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${xml(`${project} · ${environment} · ${run.scope}`)}" tests="${cases.length}" failures="${failed}" time="${time}">\n  <testsuite name="${xml(run.scope)}" tests="${cases.length}" failures="${failed}" time="${time}">\n${cases.join("\n")}\n  </testsuite>\n</testsuites>\n`;
}

/** One `<testsuite>` per operation, one `<testcase>` per case. Blocked cases are `<skipped>`. */
export function junitReport(input: ReportRun, context: ReportContext): string {
  const run = maskSecrets(input, context.secrets);
  const { project, environment } = context;
  if (run.kind === "load") return loadJunit(run, project, environment);
  const byOperation = new Map<string, ReportCase[]>();
  for (const item of run.cases ?? []) byOperation.set(item.operationId, [...(byOperation.get(item.operationId) ?? []), item]);
  const suites = [...byOperation.entries()].map(([operation, cases]) => {
    const failed = cases.filter((item) => item.status === "failed").length;
    const skipped = cases.filter((item) => item.status !== "passed" && item.status !== "failed").length;
    const time = cases.reduce((sum, item) => sum + (item.durationMs ?? 0), 0) / 1000;
    const body = cases.map((item) => {
      const head = `    <testcase classname="${xml(`${project}.${operation}`)}" name="${xml(`${item.name} [${item.scenarioId}]`)}" time="${((item.durationMs ?? 0) / 1000).toFixed(3)}"`;
      if (item.status === "passed") return `${head}/>`;
      if (item.status === "failed") return `${head}>\n      <failure message="${xml(failures(item)[0] ?? "failed")}">${xml(failures(item).join("\n"))}</failure>\n    </testcase>`;
      return `${head}>\n      <skipped message="${xml(item.status === "blocked" ? "writes are not allowed in this environment" : item.status)}"/>\n    </testcase>`;
    }).join("\n");
    return `  <testsuite name="${xml(operation)}" tests="${cases.length}" failures="${failed}" skipped="${skipped}" time="${time.toFixed(3)}">\n${body}\n  </testsuite>`;
  });
  const { totals } = run;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${xml(`${project} · ${environment} · ${run.scope}`)}" tests="${totals.total}" failures="${totals.failed}" skipped="${totals.blocked}" time="${((run.durationMs ?? 0) / 1000).toFixed(3)}">\n${suites.join("\n")}\n</testsuites>\n`;
}
