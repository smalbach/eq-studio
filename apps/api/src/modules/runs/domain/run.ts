/**
 * What a run is and how its results are kept, without any framework.
 */
import type { CaseResult } from "@eq/runner-core";
import type { CaseStatus, RunStatus, RunTotals, StepRecord } from "../../../database/entities.ts";

export const FINISHED: RunStatus[] = ["passed", "failed", "cancelled", "interrupted", "error"];
export const isFinished = (status: RunStatus) => FINISHED.includes(status);

export type FunctionalPlan = {
  mode: "contract" | "safe" | "custom";
  customOrder: string[];
  endpointIds?: string[];
  caseSelection: Record<string, string[]>;
  readOnly: boolean;
  /** Overrides the environment's setting; absent = the environment decides. */
  authEnabled?: boolean;
  samples: number;
  delayMs: number;
  locale: "es" | "en";
};

export type LoadPlan = {
  type: "load" | "stress" | "spike" | "soak";
  baseRps: number;
  peakRps: number;
  durationS: number;
  mixId?: string;
  targets?: { label: string; method: "GET"; path: string; weight: number }[];
  data?: Record<string, string[]>;
  maxInFlight: number;
  timeoutMs: number;
  latency: { mode: "project" | "custom" | "off"; p95Ms?: number };
  onPreflightFailure: "stop" | "skip" | "ignore";
  locale: "es" | "en";
};

export const emptyTotals = (total: number): RunTotals => ({ total, passed: 0, failed: 0, blocked: 0, completed: 0 });

/** The totals after one more case. */
export function countCase(totals: RunTotals, status: CaseStatus): RunTotals {
  return { ...totals, completed: totals.completed + 1, passed: totals.passed + (status === "passed" ? 1 : 0), failed: totals.failed + (status === "failed" ? 1 : 0), blocked: totals.blocked + (status === "blocked" ? 1 : 0) };
}

/** A functional run passes when no case failed. Blocked writes are not failures — the
 * environment did not allow them — but they are counted and shown, never silently passed. */
export const verdict = (totals: RunTotals): RunStatus => totals.failed > 0 ? "failed" : "passed";

export const BLOCKED_LABEL = "Escrituras deshabilitadas";

const BODY_LIMIT = 4_000;

/** A body trimmed to what a review needs; a matrix keeps every case in tens of kilobytes. */
function clip(value: unknown) {
  if (value === undefined || value === null) return value;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length <= BODY_LIMIT ? value : `${text.slice(0, BODY_LIMIT)}… (${text.length - BODY_LIMIT} more characters)`;
}

/** One request as it is stored. A failed case keeps what it sent and got back; a passing one
 * keeps status, timing and assertions only. */
export function stepRecord(result: CaseResult, keepBodies: boolean): StepRecord {
  return {
    ...(result.step ? { step: result.step } : {}),
    method: result.request.method, url: result.request.url, status: result.actual?.status ?? null, ok: result.ok, durationMs: result.durationMs,
    ...(result.latency ? { latency: { p95: result.latency.p95, budgetMs: result.latency.budgetMs } } : {}),
    assertions: result.assertions,
    ...(keepBodies ? { requestBody: clip(result.request.body), responseBody: clip(result.actual?.body) } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
}

export function caseStatus(ok: boolean, steps: CaseResult[]): CaseStatus {
  if (steps.some((step) => step.assertions.some((assertion) => assertion.label === BLOCKED_LABEL))) return "blocked";
  return ok ? "passed" : "failed";
}
