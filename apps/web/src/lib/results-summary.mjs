/**
 * What a run of the matrix says, aggregated.
 *
 * The verification panel answers one case at a time: pick an endpoint, pick a case, read its
 * assertions. After a 600-case run that is the wrong granularity — the questions are "which
 * tag is red", "is it the status, the schema or the latency that fails", "which declared
 * responses did this run actually exercise". This module answers them from the per-case results
 * the panel already keeps, and takes no React so the counts can be asserted in a test.
 *
 * **Coverage is of declared responses, and only of the contract.** A response counts as covered
 * when a case expecting that status ran; as verified when one of those passed. Internal
 * operations (routed but not declared) are reported, but never added to the contract's numbers.
 */
import { percentile } from "./budgets.mjs";

/**
 * @typedef {{ label: string, pass: boolean, detail: string, informative?: boolean }} Assertion
 * @typedef {{ ok: boolean, durationMs: number, actual: null | { status: number }, assertions: Assertion[], latency?: { p95: number, budgetMs: number | null, samples: number[] }, request: { method: string, url: string } }} Step
 * @typedef {{ ok: boolean, durationMs: number, steps: Step[] }} ScenarioResult
 * @typedef {{ id: string, method: string, path: string, tag: string, statuses: number[], internal?: boolean }} EndpointLike
 * @typedef {{ id: string, name: string, expectedStatus: number, flow: string, auth?: string }} ScenarioLike
 * @typedef {{ endpoint: EndpointLike, scenario: ScenarioLike, result: ScenarioResult }} Entry
 */

/**
 * Labels with no category of their own, English → the Spanish key they are filed under. Runs are
 * saved in the language they ran in, so the same assertion can arrive in either; the key is
 * always the Spanish one and only the display is translated (`categoryLabel`).
 */
const EN_LABELS = { "Record persisted": "Registro persistido", "Bulk of 5,000 records < 5 s": "Bulk de 5.000 registros < 5 s" };

/** The assertion label a failure is filed under. Latency labels carry the budget, so they fold.
 * Spanish and English labels land on the same (Spanish) key. */
export function failureCategory(label) {
  if (/^Status/.test(label)) return "Status HTTP";
  if (/Schema/.test(label)) return "Schema OpenAPI";
  if (/Content-Type/.test(label)) return "Content-Type";
  if (/ms|p95|latencia|latency/i.test(label)) return "Presupuesto de latencia";
  if (/Persistencia|persistence|ID/.test(label)) return "Persistencia / ID";
  if (/Conexión|[Cc]onnection/.test(label)) return "Conexión";
  if (/Dependencia|Dependency/.test(label)) return "Dependencias";
  const base = label.replace(/ \(informative\)$/, "");
  if (base in EN_LABELS) return `${EN_LABELS[/** @type {keyof typeof EN_LABELS} */ (base)]}${base === label ? "" : " (informativo)"}`;
  return label;
}

/** Display names of the category keys `failureCategory` and the summary return. */
const CATEGORY_EN = {
  "Status HTTP": "HTTP status",
  "Schema OpenAPI": "OpenAPI schema",
  "Presupuesto de latencia": "Latency budget",
  "Persistencia / ID": "Persistence / ID",
  "Conexión": "Connection",
  "Dependencias": "Dependencies",
  "Registro persistido": "Record persisted",
  "Bulk de 5.000 registros < 5 s": "Bulk of 5,000 records < 5 s",
  "Sin aserción registrada": "No assertion recorded",
  "Sin respuesta": "No response",
};

/** A category key (or the summary's "Sin respuesta" bucket) in the active language. Unknown keys
 * are labels already in the language they were recorded in, and are shown as they are.
 * @param {string} key @param {"es" | "en"} [locale] */
export function categoryLabel(key, locale = "es") {
  if (locale !== "en") return key;
  return CATEGORY_EN[/** @type {keyof typeof CATEGORY_EN} */ (key)] ?? key;
}

/** The step a case is judged by: the one whose failure made it red, or its last one. */
export function decisiveStep(result) {
  return result.steps.find((step) => !step.ok) ?? result.steps.at(-1);
}

function statusClass(status) {
  if (status >= 200 && status < 300) return "2xx";
  if (status === 401 || status === 403) return "401/403";
  return String(status);
}

function tally(map, key, ok) {
  const row = map.get(key) ?? { key, total: 0, passed: 0, failed: 0 };
  row.total += 1;
  if (ok) row.passed += 1; else row.failed += 1;
  map.set(key, row);
}

/**
 * @param {Entry[]} entries
 * @param {EndpointLike[]} allEndpoints every endpoint, run or not — the coverage denominator
 */
export function summarizeResults(entries, allEndpoints) {
  const byTag = new Map();
  const byMethod = new Map();
  const byExpected = new Map();
  const causes = new Map();
  const failures = [];
  const latencies = [];
  const perEndpoint = new Map();
  let durationMs = 0;

  for (const { endpoint, scenario, result } of entries) {
    tally(byTag, endpoint.tag, result.ok);
    tally(byMethod, endpoint.method, result.ok);
    tally(byExpected, statusClass(scenario.expectedStatus), result.ok);
    durationMs += result.durationMs;
    const first = result.steps[0];
    // Only single-request GET cases feed the latency view: a chained flow's duration is the sum
    // of a create, a mutation, a read and a cleanup, and comparing that with a GET budget is
    // comparing two different things.
    // An `existing` case that had to create its row first is a chained flow too.
    const single = scenario.flow === "request" || (scenario.flow === "existing" && result.steps.length === 1);
    if (single && endpoint.method === "GET" && first?.actual) {
      const p95 = first.latency?.p95 ?? first.durationMs;
      latencies.push(p95);
      const row = perEndpoint.get(endpoint.id) ?? { id: endpoint.id, method: endpoint.method, path: endpoint.path, tag: endpoint.tag, samples: [], budgetMs: first.latency?.budgetMs ?? null, over: 0 };
      row.samples.push(p95);
      if (row.budgetMs != null && p95 >= row.budgetMs) row.over += 1;
      perEndpoint.set(endpoint.id, row);
    }
    if (!result.ok) {
      const step = decisiveStep(result);
      // An informative assertion (a latency budget measured across a gateway) never failed the
      // case, so it is not one of its causes either.
      const failed = step?.assertions.filter((assertion) => !assertion.pass && !assertion.informative) ?? [];
      for (const assertion of failed) tally(causes, failureCategory(assertion.label), false);
      if (!failed.length) tally(causes, "Sin aserción registrada", false);
      failures.push({
        endpointId: endpoint.id,
        scenarioId: scenario.id,
        method: endpoint.method,
        path: endpoint.path,
        tag: endpoint.tag,
        scenario: scenario.name,
        expectedStatus: scenario.expectedStatus,
        actualStatus: step?.actual?.status ?? null,
        stepIndex: step ? result.steps.indexOf(step) : -1,
        steps: result.steps.length,
        reasons: failed.map((assertion) => `${assertion.label}: ${assertion.detail}`),
        url: step?.request.url ?? "",
      });
    }
  }

  // Declared responses of the contract, and which of them this run exercised.
  const ranKeys = new Map();
  for (const { endpoint, scenario, result } of entries) {
    const key = `${endpoint.id}:${scenario.expectedStatus}`;
    ranKeys.set(key, (ranKeys.get(key) ?? false) || result.ok);
  }
  const coverageRows = new Map();
  for (const endpoint of allEndpoints.filter((item) => !item.internal)) {
    for (const status of endpoint.statuses) {
      const row = coverageRows.get(status) ?? { status, declared: 0, exercised: 0, verified: 0 };
      row.declared += 1;
      const key = `${endpoint.id}:${status}`;
      if (ranKeys.has(key)) { row.exercised += 1; if (ranKeys.get(key)) row.verified += 1; }
      coverageRows.set(status, row);
    }
  }
  const coverage = [...coverageRows.values()].sort((a, b) => a.status - b.status);
  const declared = coverage.reduce((sum, row) => sum + row.declared, 0);
  const verified = coverage.reduce((sum, row) => sum + row.verified, 0);
  const exercised = coverage.reduce((sum, row) => sum + row.exercised, 0);

  // Every request the run sent — setup, case, verification and cleanup steps alike.
  const steps = entries.flatMap((entry) => entry.result.steps.map((step) => ({ step, endpoint: entry.endpoint })));
  const requestLatencies = steps.map(({ step }) => step.durationMs).filter((value) => typeof value === "number");
  const caseDurations = entries.map((entry) => entry.result.durationMs);
  const receivedCodes = new Map();
  const receivedClasses = new Map([["2xx", 0], ["3xx", 0], ["4xx", 0], ["5xx", 0], ["Sin respuesta", 0]]);
  const methods = new Map();
  let assertionsPassed = 0;
  let assertionsFailed = 0;
  let schemaPassed = 0;
  let schemaFailed = 0;
  for (const { step } of steps) {
    const status = step.actual?.status;
    const code = status ? String(status) : "Sin respuesta";
    receivedCodes.set(code, (receivedCodes.get(code) ?? 0) + 1);
    const klass = status ? `${String(status)[0]}xx` : "Sin respuesta";
    receivedClasses.set(klass, (receivedClasses.get(klass) ?? 0) + 1);
    const method = step.request?.method || "?";
    methods.set(method, (methods.get(method) ?? 0) + 1);
    for (const assertion of step.assertions ?? []) {
      if (assertion.informative) continue;
      if (assertion.pass) assertionsPassed += 1; else assertionsFailed += 1;
      if (/Schema/.test(assertion.label)) { if (assertion.pass) schemaPassed += 1; else schemaFailed += 1; }
    }
  }
  const mean = (values) => values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : 0;
  const endpointRows = new Map();
  for (const { endpoint, result } of entries) {
    const row = endpointRows.get(endpoint.id) ?? { id: endpoint.id, method: endpoint.method, path: endpoint.path, tag: endpoint.tag, cases: 0, passed: 0, failed: 0, requests: 0, durations: [] };
    row.cases += 1;
    if (result.ok) row.passed += 1; else row.failed += 1;
    row.requests += result.steps.length;
    row.durations.push(result.durationMs);
    endpointRows.set(endpoint.id, row);
  }
  const perEndpointRows = [...endpointRows.values()].map(({ durations, ...row }) => ({ ...row, meanMs: mean(durations), maxMs: durations.length ? Math.max(...durations) : 0 })).sort((a, b) => b.failed - a.failed || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  const slowestCases = entries.map(({ endpoint, scenario, result }) => ({ endpointId: endpoint.id, scenarioId: scenario.id, method: endpoint.method, path: endpoint.path, scenario: scenario.name, durationMs: result.durationMs, steps: result.steps.length, ok: result.ok })).sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);
  const chained = entries.filter((entry) => entry.result.steps.length > 1).length;

  const passed = entries.filter((entry) => entry.result.ok).length;
  const sortRows = (map) => [...map.values()].sort((a, b) => b.failed - a.failed || b.total - a.total || String(a.key).localeCompare(String(b.key)));
  const endpointsRun = new Set(entries.map((entry) => entry.endpoint.id));
  return {
    total: entries.length,
    passed,
    failed: entries.length - passed,
    passRate: entries.length ? passed / entries.length : 0,
    durationMs,
    endpointsRun: endpointsRun.size,
    endpointsTotal: allEndpoints.length,
    latency: { count: latencies.length, p50: percentile(latencies, 50), p95: percentile(latencies, 95), max: latencies.length ? Math.max(...latencies) : 0 },
    byTag: sortRows(byTag),
    byMethod: ["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => byMethod.get(method)).filter(Boolean),
    byExpected: sortRows(byExpected),
    causes: [...causes.values()].sort((a, b) => b.total - a.total),
    failures,
    coverage,
    coverageTotals: { declared, exercised, verified },
    requests: {
      total: steps.length,
      perCase: entries.length ? Math.round((steps.length / entries.length) * 10) / 10 : 0,
      chainedCases: chained,
      byMethod: ["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => ({ key: method, count: methods.get(method) ?? 0 })).filter((row) => row.count > 0),
      byClass: [...receivedClasses.entries()].map(([key, count]) => ({ key, count })).filter((row) => row.count > 0),
      byCode: [...receivedCodes.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
      latency: { mean: mean(requestLatencies), p50: percentile(requestLatencies, 50), p90: percentile(requestLatencies, 90), p95: percentile(requestLatencies, 95), p99: percentile(requestLatencies, 99), max: requestLatencies.length ? Math.max(...requestLatencies) : 0 },
    },
    cases: { mean: mean(caseDurations), p50: percentile(caseDurations, 50), p95: percentile(caseDurations, 95), max: caseDurations.length ? Math.max(...caseDurations) : 0 },
    assertions: { total: assertionsPassed + assertionsFailed, passed: assertionsPassed, failed: assertionsFailed, schemaPassed, schemaFailed },
    perEndpoint: perEndpointRows,
    slowestCases,
    slowest: [...perEndpoint.values()].map((row) => ({ ...row, p95: percentile(row.samples, 95) })).sort((a, b) => b.p95 - a.p95).slice(0, 10),
  };
}

/** One row per case, for the CSV export. Quotes are doubled, the RFC 4180 way. */
export function resultsToCsv(entries) {
  const header = ["endpoint", "method", "path", "tag", "case", "expected_status", "actual_status", "ok", "duration_ms", "failed_assertions"];
  const escape = (value) => { const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  const rows = entries.map(({ endpoint, scenario, result }) => {
    const step = decisiveStep(result);
    return [endpoint.id, endpoint.method, endpoint.path, endpoint.tag, scenario.name, scenario.expectedStatus, step?.actual?.status ?? "", result.ok, result.durationMs, (step?.assertions ?? []).filter((item) => !item.pass && !item.informative).map((item) => item.label).join(" | ")];
  });
  return [header, ...rows].map((row) => row.map(escape).join(",")).join("\n");
}
