/** The shapes of a load test: its configuration, its live windows and its saved report. */

export type TestType = "load" | "stress" | "spike" | "soak";
export type LoadTarget = { label: string; method: string; path: string; weight: number };
export type LatencyChoice = "auto" | "project" | "custom" | "off";
export type PreflightPolicy = "skip" | "stop" | "ignore";

export type LoadWindow = { t: number; targetRps: number | null; drain?: boolean; stage: number; inFlight: number; sent?: number; completed: number; errors: number; dropped?: number; errorRate: number; rps: number; p50: number; p95: number; p99: number; max?: number };
export type LoadStats = { sent: number; completed: number; errors: number; dropped: number; errorRate: number; successRate?: number; rps: number; bytes?: number; kbps?: number; min?: number; mean?: number; stddev?: number; p50: number; p75?: number; p90?: number; p95: number; p99: number; p999?: number; max: number; statuses: Record<string, number>; kinds?: Record<string, number> };
export type LoadReport = {
  aborted: boolean;
  elapsedS: number;
  latencyMode?: { mode: string; p95Ms?: number };
  overall: LoadStats & { apdex?: number | null; apdexThresholdMs?: number | null; peakRps?: number; minRps?: number; peakInFlight?: number; firstErrorS?: number | null; requested?: number };
  histogram?: { label: string; count: number }[];
  targets: (LoadStats & { label: string; path: string; weight?: number; budgetMs: number | null; apdex?: number | null })[];
  stages: (LoadStats & { label: string; durationS: number; fromRps: number; toRps: number; measured: boolean })[];
  windows: LoadWindow[];
  verdict: { pass: boolean; checks: { label: string; pass: boolean; detail: string }[] };
};
export type PreflightResult = { label: string; path: string; ok: boolean; status: number | null; latency: number | null; problem: string };

/** A finished test as the history keeps it: the summary for the list and the report to reopen it. */
export type LoadRun = { id: string; at: number; project?: string; type: TestType; mix: string; environment: string; baseUrl?: string; pass: boolean; rps: number; p50?: number; p95: number; p99?: number; errorRate: number; apdex?: number | null; elapsedS: number; targets?: number; skipped?: number; report?: LoadReport };

export const LOAD_HISTORY_KEY = "endpoint-quality:load-runs";
export const LOAD_HISTORY_LIMIT = 25;

/** The highest per-target latency budget of a report, for the reference line of its chart. */
export const reportBudget = (report: LoadReport) => report.targets.map((target) => target.budgetMs).filter((value): value is number => value != null).reduce((top, value) => Math.max(top, value), 0) || null;

/** What `degradationReport` in `lib/load-degradation.mjs` returns. */
export type StageHealth = "healthy" | "degrading" | "saturated" | "broken";
export type DegradationStage = { label: string; measured: boolean; fromRps: number; toRps: number; requested: number; delivered: number; efficiency: number; p50: number; p95: number; p99: number; factor: number; tail: number; errorRate: number; dropped: number; completed: number; health: StageHealth; reasons: string[] };
export type DegradationSignal = { key: string; label: string; t: number; rps: number; delivered: number; stage: string; detail: string };
export type Degradation = {
  baseline: { p50: number; p95: number; rps: number; inFlight: number; seconds: number } | null;
  limit: number | null;
  stages: DegradationStage[];
  timeline: { t: number; factor: number | null; efficiency: number | null; inFlight: number }[];
  signals: DegradationSignal[];
  capacity: { rps: number; stage: string } | null;
  firstDegraded: DegradationStage | null;
  firstBroken: DegradationStage | null;
  headroom: number | null;
  recovery: { seconds: number | null; window: number; limit: number; peakP95: number | null; peakFactor: number | null } | null;
};
