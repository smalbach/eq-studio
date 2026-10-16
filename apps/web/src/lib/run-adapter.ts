/**
 * Runs as the API stores them, in the shapes the views already read: a saved functional run as
 * a `RunRecord` with its snapshot cases, a case as a `ScenarioResult`, a load run as a `LoadRun`.
 * The views were written against those shapes when runs lived in the browser; keeping them
 * means the history, comparison and analysis screens work unchanged over the server's runs.
 */
import type { ApiRun, ApiRunCase, StepRecord } from "@/lib/api";
import type { LoadReport, LoadRun, TestType } from "@/lib/load-types";
import type { RunRecord, RunResult, ScenarioResult, SnapshotCase } from "@/lib/run-types";
import { clip } from "@/lib/run-snapshot.mjs";

const pathOf = (url: string) => { try { const parsed = new URL(url); return `${parsed.pathname}${parsed.search}`; } catch { return url; } };
const at = (run: ApiRun) => Date.parse(run.startedAt ?? run.createdAt);

export function stepToResult(step: StepRecord): RunResult {
  return {
    ok: step.ok,
    durationMs: step.durationMs,
    step: step.step,
    error: step.error,
    request: { method: step.method, url: step.url, body: step.requestBody ?? null },
    expected: {},
    actual: step.status === null ? null : { status: step.status, statusText: "", contentType: "", headers: {}, body: step.responseBody },
    assertions: step.assertions,
    ...(step.latency ? { latency: { samples: [], p50: step.latency.p95, p95: step.latency.p95, budgetMs: step.latency.budgetMs } } : {}),
  };
}

export function caseToResult(item: ApiRunCase): ScenarioResult {
  return { ok: item.status === "passed", durationMs: item.durationMs ?? 0, steps: (item.steps ?? []).map(stepToResult) };
}

function snapshotCase(item: ApiRunCase): SnapshotCase {
  return {
    e: item.operationId,
    s: item.scenarioId,
    ok: item.status === "passed",
    ms: item.durationMs ?? 0,
    steps: (item.steps ?? []).map((step) => ({
      ...(item.status !== "passed" ? { qb: clip(step.requestBody), rb: clip(step.responseBody) } : {}),
      m: step.method, u: pathOf(step.url), st: step.status, ok: step.ok, ms: step.durationMs,
      ...(step.step ? { n: step.step } : {}),
      ...(step.latency ? { p95: step.latency.p95, b: step.latency.budgetMs } : {}),
      a: step.assertions.filter((assertion) => !assertion.pass && !assertion.informative).map((assertion) => [assertion.label, assertion.detail] as [string, string]),
      ap: step.assertions.filter((assertion) => assertion.pass && !assertion.informative).map((assertion) => assertion.label),
    })),
  };
}

/** Blocked and skipped cases are not results: they are left out of the snapshot's counters. */
export function runToRecord(run: ApiRun, environment: { name: string; baseUrl: string } | undefined): RunRecord {
  const cases = (run.cases ?? []).filter((item) => item.status === "passed" || item.status === "failed");
  return {
    id: run.id, at: at(run), project: run.projectId,
    environment: environment?.name ?? "—", baseUrl: environment?.baseUrl ?? "",
    scope: run.scope, total: cases.length, passed: cases.filter((item) => item.status === "passed").length, failed: cases.filter((item) => item.status === "failed").length,
    durationMs: run.durationMs ?? 0, stopped: ["cancelled", "interrupted", "error"].includes(run.status),
    cases: cases.map(snapshotCase),
  };
}

export function loadRunToRecord(run: ApiRun, environment: { name: string; baseUrl: string } | undefined, mixLabel: (id: string | undefined) => string): LoadRun | null {
  const report = run.report as unknown as (LoadReport & { live?: boolean }) | null;
  if (!report?.overall) return null;
  const plan = (run.plan ?? {}) as { type?: TestType; mixId?: string; targets?: unknown[] };
  return {
    id: run.id, at: at(run), project: run.projectId, type: plan.type ?? "load", mix: plan.targets ? "Custom" : mixLabel(plan.mixId),
    environment: environment?.name ?? "—", baseUrl: environment?.baseUrl ?? "",
    pass: report.verdict?.pass ?? run.status === "passed", rps: Math.round(report.overall.rps * 10) / 10, p50: report.overall.p50, p95: report.overall.p95, p99: report.overall.p99,
    errorRate: report.overall.errorRate, apdex: report.overall.apdex ?? null, elapsedS: report.elapsedS, targets: report.targets.length,
    skipped: ((report as { preflight?: { ok: boolean }[] }).preflight ?? []).filter((check) => !check.ok).length, report,
  };
}
