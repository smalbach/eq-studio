/**
 * A finished run as the reports read it: what `GET /v1/runs/:id?steps=true` answers and what
 * `eq run --json` writes. Kept structural (no import from the API) so the CLI, the API and a
 * stored JSON file all fit it.
 */
import type { Locale } from "../types.ts";

export type ReportAssertion = { label: string; pass: boolean; detail: string; informative?: boolean };
export type ReportStep = { step?: string; method: string; url: string; status: number | null; ok: boolean; durationMs: number; latency?: { p95: number; budgetMs: number | null }; assertions: ReportAssertion[]; requestBody?: unknown; responseBody?: unknown; error?: string };
export type ReportCase = { operationId: string; scenarioId: string; name: string; method: string; path: string; expectedStatus: number; status: string; durationMs: number | null; steps?: ReportStep[] | null };
export type ReportTotals = { total: number; passed: number; failed: number; blocked: number; completed: number };
export type ReportRun = {
  id: string;
  kind: "functional" | "load";
  status: string;
  scope: string;
  totals: ReportTotals;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  report?: Record<string, unknown> | null;
  cases?: ReportCase[];
};

/** What the run alone does not say: where it ran and against which contract. */
export type ReportContext = {
  /** The project's slug (or name): the JUnit class names and the SARIF automation id. */
  project: string;
  environment: string;
  baseUrl?: string;
  contractVersion?: string | null;
  /** The contract file in the repository, relative to its root, and its text when known: SARIF
   * then points each result at the line that declares the operation's path. */
  contract?: { uri: string; text?: string };
  /** Values that must never appear in a report (the tokens a run was given). */
  secrets?: string[];
  locale?: Locale;
  /** The tool's version, for SARIF. */
  toolVersion?: string;
  /** When the report was made; defaults to now. Fixed in tests. */
  generatedAt?: string;
};

export type LoadSummary = { overall?: { rps: number; p50: number; p95: number; p99: number; errorRate: number; completed: number }; verdict?: { pass?: boolean; checks: ReportAssertion[] } };

export const loadSummary = (run: ReportRun) => (run.report ?? {}) as LoadSummary;

/** The assertions that decided a case's failure. */
export const failedAssertions = (step: ReportStep) => step.assertions.filter((assertion) => !assertion.pass && !assertion.informative);

const CORE_LABELS = /^(Status \d+|Schema OpenAPI|Content-Type)$/;

/** Whether a failed case failed only on its latency budget: a warning, not a broken contract. */
export function onlyLatency(item: ReportCase) {
  const steps = item.steps ?? [];
  const failing = steps.flatMap((step) => failedAssertions(step).map((assertion) => ({ step, assertion })));
  return failing.length > 0 && steps.every((step) => !step.error) && failing.every(({ step, assertion }) => step.latency?.budgetMs != null && !CORE_LABELS.test(assertion.label) && /\bms\b/.test(assertion.label));
}

const FIXED_KINDS = new Set(["default", "cursor-invalid", "found", "not-found", "create-read", "invalid-body", "replace-read", "patch-read", "delete-read", "deleted-read", "conflict", "auth-none", "auth-insufficient", "auth-api-key"]);

/** The kind of a scenario, from its id: the generated ones keep their id, the geographic ones
 * are `geo`, a query-parameter sample (`status-active`) or a project's own scenario is `custom`. */
export function scenarioKind(scenarioId: string) {
  if (FIXED_KINDS.has(scenarioId)) return scenarioId;
  if (scenarioId.startsWith("geo-")) return "geo";
  if (scenarioId.startsWith("auth-")) return scenarioId;
  return "custom";
}

export const pathOf = (url: string) => { try { return new URL(url, "http://x").pathname; } catch { return url; } };
