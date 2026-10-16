/**
 * A finished run of the matrix, kept so it can be opened again.
 *
 * The history used to keep five counters per run — total, passed, failed, duration, scope — so a
 * run from this morning could say "211 of 216" and nothing about *which* five. The results view
 * only knew the current session, and a reload lost it. A snapshot keeps every case with its
 * steps and its failed assertions, compact enough for `localStorage` (≈ 60 KB for the full
 * matrix), and turns back into the same entries `summarizeResults` reads, so an old run gets the
 * same dashboard as the one that just finished.
 *
 * No React: the round trip and the comparison are asserted in `tests/run-snapshot.test.mjs`.
 */

import { tr } from "./i18n-core.mjs";

/** Bodies kept for the steps of a failed case: enough to see what went wrong, capped for storage. */
export const BODY_LIMIT = 4000;

/** A body as text, cut at `limit` characters with a visible mark.
 * @param {unknown} body @param {number} [limit] @param {"es" | "en"} [locale] */
export function clip(body, limit = BODY_LIMIT, locale = "es") {
  if (body === undefined || body === null || body === "") return undefined;
  const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  return text.length > limit ? `${text.slice(0, limit)}\n… ${tr(locale, `(${text.length - limit} caracteres más, recortado al guardar)`, `(${text.length - limit} more characters, trimmed on save)`)}` : text;
}

function restore(text) {
  if (text === undefined) return undefined;
  try { return JSON.parse(text); } catch { return text; }
}

/** The path and query of a URL, without the origin every step of a run shares. */
function pathOf(url) {
  try { const parsed = new URL(url); return `${parsed.pathname}${parsed.search}`; } catch { return String(url ?? ""); }
}

/**
 * @param {{ endpoint: { id: string }, scenario: { id: string }, result: { ok: boolean, durationMs: number, steps: any[] } }[]} entries
 * @param {{ id: string, at: number, project?: string, environment: string, baseUrl: string, scope: string, durationMs: number, stopped?: boolean }} meta
 * @param {"es" | "en"} [locale] the language of the trimming mark on clipped bodies
 */
export function snapshotRun(entries, meta, locale = "es") {
  const passed = entries.filter((entry) => entry.result.ok).length;
  return {
    ...meta,
    total: entries.length,
    passed,
    failed: entries.length - passed,
    cases: entries.map(({ endpoint, scenario, result }) => ({
      e: endpoint.id,
      s: scenario.id,
      ok: result.ok,
      ms: result.durationMs,
      // A failed case keeps what it sent and what it got back, so it can be reviewed after a
      // reload; a passing one keeps status, time and assertions only, which keeps a full matrix
      // in tens of kilobytes.
      steps: result.steps.map((step) => ({
        ...(!result.ok ? { qb: clip(step.request?.body, BODY_LIMIT, locale), rb: clip(step.actual?.body, BODY_LIMIT, locale) } : {}),
        m: step.request?.method ?? "",
        u: pathOf(step.request?.url),
        st: step.actual?.status ?? null,
        ok: step.ok,
        ms: step.durationMs,
        ...(step.step ? { n: step.step } : {}),
        ...(step.latency ? { p95: step.latency.p95, b: step.latency.budgetMs } : {}),
        // What failed with its detail; what passed by label only — the passing details are the
        // bulk of a step and say nothing a green tick does not. Informative ones are dropped.
        a: step.assertions.filter((assertion) => !assertion.pass && !assertion.informative).map((assertion) => [assertion.label, assertion.detail]),
        ap: step.assertions.filter((assertion) => assertion.pass && !assertion.informative).map((assertion) => assertion.label),
      })),
    })),
  };
}

/** A snapshot's case back into the shape the results view reads. */
export function resultFromSnapshot(snapshotCase, baseUrl = "") {
  return {
    ok: snapshotCase.ok,
    durationMs: snapshotCase.ms,
    steps: snapshotCase.steps.map((step) => ({
      ok: step.ok,
      durationMs: step.ms,
      step: step.n,
      request: { method: step.m, url: `${baseUrl.replace(/\/+$/, "")}${step.u}`, body: restore(step.qb) },
      actual: step.st == null ? null : { status: step.st, body: restore(step.rb) },
      latency: step.p95 != null ? { p95: step.p95, budgetMs: step.b ?? null, samples: [] } : undefined,
      assertions: [
        ...step.a.map(([label, detail]) => ({ label, pass: false, detail })),
        ...(Array.isArray(step.ap) ? step.ap : []).map((label) => ({ label, pass: true, detail: "" })),
      ],
    })),
  };
}

/**
 * What changed between two runs, case by case, over the cases both ran.
 *
 * @returns {{ newFailures: string[], fixed: string[], stillFailing: string[], onlyCurrent: number, onlyPrevious: number }}
 */
export function compareRuns(current, previous) {
  const before = new Map((previous?.cases ?? []).map((item) => [`${item.e}:${item.s}`, item.ok]));
  const now = new Map((current?.cases ?? []).map((item) => [`${item.e}:${item.s}`, item.ok]));
  const newFailures = [];
  const fixed = [];
  const stillFailing = [];
  for (const [key, ok] of now) {
    if (!before.has(key)) continue;
    const was = before.get(key);
    if (was && !ok) newFailures.push(key);
    else if (!was && ok) fixed.push(key);
    else if (!was && !ok) stillFailing.push(key);
  }
  return { newFailures, fixed, stillFailing, onlyCurrent: [...now.keys()].filter((key) => !before.has(key)).length, onlyPrevious: [...before.keys()].filter((key) => !now.has(key)).length };
}

/**
 * Cases whose result changed across the last runs that contain them — candidates for a flaky
 * test or an unstable environment, not necessarily for a bug.
 *
 * @param {{ cases?: { e: string, s: string, ok: boolean }[] }[]} runs newest first
 */
export function flakyCases(runs, window = 5) {
  const seen = new Map();
  for (const run of runs.filter((item) => item.cases?.length).slice(0, window)) {
    for (const item of run.cases) {
      const key = `${item.e}:${item.s}`;
      seen.set(key, [...(seen.get(key) ?? []), item.ok]);
    }
  }
  return [...seen.entries()]
    .filter(([, results]) => results.length >= 2 && results.some(Boolean) && results.some((ok) => !ok))
    .map(([key, results]) => ({ key, passed: results.filter(Boolean).length, runs: results.length }))
    .sort((a, b) => a.passed / a.runs - b.passed / b.runs);
}
