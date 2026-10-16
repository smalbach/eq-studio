/**
 * Derived views over saved runs that the charts draw: distributions, the stability matrix, daily
 * activity and the saturation knee of a load test. Pure, no React, so they can be tested.
 */
import { failureCategory } from "@/lib/results-summary.mjs";
import type { LoadRun, LoadWindow } from "@/lib/load-types";
import type { RunEntry, RunRecord } from "@/lib/run-types";
import type { Locale } from "@/lib/i18n";
import { intlLocale } from "@/lib/i18n-core.mjs";

/** Bucket upper bounds in ms; the last bucket is open. */
export const LATENCY_BUCKETS = [5, 10, 25, 50, 100, 200, 300, 500, 750, 1000, 2000, 5000];

/** How many values fall in each bucket, with readable labels ("100–200"); empty edges trimmed. */
export function latencyHistogram(values: number[], bounds = LATENCY_BUCKETS) {
  const counts = new Array(bounds.length + 1).fill(0);
  for (const value of values) {
    const index = bounds.findIndex((bound) => value < bound);
    counts[index === -1 ? bounds.length : index] += 1;
  }
  const rows = counts.map((count, index) => ({ label: index === 0 ? `<${bounds[0]}` : index === bounds.length ? `≥${bounds.at(-1)}` : `${bounds[index - 1]}–${bounds[index]}`, count }));
  const first = rows.findIndex((row) => row.count > 0);
  if (first === -1) return [];
  const last = rows.length - 1 - [...rows].reverse().findIndex((row) => row.count > 0);
  return rows.slice(first, last + 1);
}

/** Every request of a run, setup and cleanup steps included. */
export const requestDurations = (entries: RunEntry[]) => entries.flatMap((entry) => entry.result.steps.map((step) => step.durationMs)).filter((value) => typeof value === "number");

/** Assertions checked by the run, grouped by what they check (status, schema, latency…). */
export function assertionsByCategory(entries: RunEntry[]) {
  const rows = new Map<string, { key: string; passed: number; failed: number }>();
  for (const entry of entries) for (const step of entry.result.steps) for (const assertion of step.assertions ?? []) {
    if (assertion.informative) continue;
    const key = failureCategory(assertion.label);
    const row = rows.get(key) ?? { key, passed: 0, failed: 0 };
    if (assertion.pass) row.passed += 1; else row.failed += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.failed - a.failed || (b.passed + b.failed) - (a.passed + a.failed));
}

/** Pass rate per tag of a run, for side-by-side comparisons. */
export function passRateByTag(entries: RunEntry[]) {
  const rows = new Map<string, { passed: number; total: number }>();
  for (const { endpoint, result } of entries) {
    const row = rows.get(endpoint.tag) ?? { passed: 0, total: 0 };
    row.total += 1;
    if (result.ok) row.passed += 1;
    rows.set(endpoint.tag, row);
  }
  return rows;
}

/**
 * The last runs with case detail (oldest to newest) and, per case, its result in each: true,
 * false, or null when that run did not include it. `unstableOnly` keeps the cases that failed at
 * least once in the window — the rows worth looking at.
 */
export function stabilityMatrix(runs: RunRecord[], { window = 12, unstableOnly = true } = {}) {
  const columns = runs.filter((run) => run.cases?.length).slice(0, window).reverse();
  const results = new Map<string, (boolean | null)[]>();
  columns.forEach((run, column) => {
    for (const item of run.cases ?? []) {
      const key = `${item.e}:${item.s}`;
      const row = results.get(key) ?? new Array(columns.length).fill(null);
      row[column] = item.ok;
      results.set(key, row);
    }
  });
  const rows = [...results.entries()].map(([key, cells]) => ({ key, cells, failures: cells.filter((cell) => cell === false).length, runs: cells.filter((cell) => cell != null).length }))
    .filter((row) => !unstableOnly || row.failures > 0)
    .sort((a, b) => b.failures / b.runs - a.failures / a.runs || b.failures - a.failures || a.key.localeCompare(b.key));
  return { columns, rows, totalCases: results.size };
}

const DAY = 86_400_000;
const dayStart = (at: number) => { const date = new Date(at); date.setHours(0, 0, 0, 0); return date.getTime(); };

/** Runs per local day for the last `days` days: functional clean, functional with failures, load. */
export function activityByDay(runs: RunRecord[], loadRuns: LoadRun[], now: number, days = 14, locale: Locale = "es") {
  const today = dayStart(now);
  const starts = Array.from({ length: days }, (_, index) => today - (days - 1 - index) * DAY);
  const slot = (at: number) => { const index = starts.findIndex((start) => at >= start && at < start + DAY); return index; };
  const clean = new Array(days).fill(0);
  const failed = new Array(days).fill(0);
  const load = new Array(days).fill(0);
  for (const run of runs) { const index = slot(run.at); if (index >= 0) (run.failed ? failed : clean)[index] += 1; }
  for (const run of loadRuns) { const index = slot(run.at); if (index >= 0) load[index] += 1; }
  const labels = starts.map((start) => new Date(start).toLocaleDateString(intlLocale(locale), { day: "2-digit", month: "short" }));
  return { labels, values: { clean, failed, load }, total: clean.reduce((a, b) => a + b, 0) + failed.reduce((a, b) => a + b, 0) + load.reduce((a, b) => a + b, 0) };
}

/**
 * Where latency starts to climb with throughput: the lowest delivered rate at which the p95 of a
 * second goes over the budget — or, with no budget, over twice the median p95 of the quietest
 * third of the test. Null when it never does: the test did not find the limit.
 */
export function saturationKnee(windows: LoadWindow[], budget: number | null) {
  const measured = windows.filter((window) => window.completed > 0 && !window.drain);
  if (measured.length < 5) return null;
  const byRate = [...measured].sort((a, b) => a.rps - b.rps);
  const quiet = byRate.slice(0, Math.max(1, Math.floor(byRate.length / 3))).map((window) => window.p95).sort((a, b) => a - b);
  const limit = budget ?? quiet[Math.floor(quiet.length / 2)] * 2;
  // Two windows in a row over the limit, so one slow second is not a knee.
  for (let index = 0; index < byRate.length - 1; index += 1) {
    if (byRate[index].p95 > limit && byRate[index + 1].p95 > limit) return { rps: Math.round(byRate[index].rps), limit: Math.round(limit), byBudget: budget != null };
  }
  return null;
}
