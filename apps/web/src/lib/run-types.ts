/** The shapes a functional run moves around: one request, one case, one saved run. */
import type { Endpoint } from "@/lib/endpoints";
import type { TestScenario } from "@/lib/scenarios";

export type Assertion = { label: string; pass: boolean; detail: string; informative?: boolean };

/** One request as `/api/run` answers it. */
export type RunResult = {
  ok: boolean;
  durationMs: number;
  error?: string;
  latency?: { samples: number[]; p50: number; p95: number; budgetMs: number | null };
  request: { method: string; url: string; headers?: Record<string, string>; body: unknown };
  expected: Record<string, unknown>;
  actual: null | { status: number; statusText: string; contentType: string; headers: Record<string, string>; body: unknown };
  assertions: Assertion[];
  step?: string;
};

/** A case: one request, or the steps of a chained flow. */
export type ScenarioResult = { ok: boolean; durationMs: number; steps: RunResult[] };
export type OperationStatus = "queued" | "running" | "passed" | "failed";

/** The subset of a step every summary needs; a step rebuilt from a snapshot has only this. */
export type StepLike = { ok: boolean; durationMs: number; step?: string; actual: null | { status: number; body?: unknown }; assertions: Assertion[]; latency?: { p95: number; budgetMs: number | null; samples: number[] }; request: { method: string; url: string; body?: unknown } };
export type ScenarioResultLike = { ok: boolean; durationMs: number; steps: StepLike[] };
export type RunEntry = { endpoint: Endpoint; scenario: TestScenario; result: ScenarioResultLike };

type SnapshotStep = { m: string; u: string; st: number | null; ok: boolean; ms: number; n?: string; p95?: number; b?: number | null; a: [string, string][]; ap?: string[] };
export type SnapshotCase = { e: string; s: string; ok: boolean; ms: number; steps: SnapshotStep[] };

/** A finished run. Runs recorded before the snapshots existed have no `cases`: counters only. */
export type RunRecord = { id: string; at: number; project?: string; environment: string; baseUrl: string; scope: string; total: number; passed: number; failed: number; durationMs: number; stopped?: boolean; cases?: SnapshotCase[] };

/** Ids found in a remote environment, per collection, so the seed's `1` becomes a real row. */
export type SeedIds = { ids: Record<string, string>; lists?: Record<string, string[]>; empty: string[]; failed: string[]; at: number };

export const RUNS_KEY = "endpoint-quality:runs";
export const RUNS_LIMIT = 20;
