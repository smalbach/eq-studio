import assert from "node:assert/strict";
import test from "node:test";
import { compareRuns, flakyCases, resultFromSnapshot, snapshotRun } from "../src/lib/run-snapshot.mjs";
import { summarizeResults } from "../src/lib/results-summary.mjs";

const endpoint = { id: "getProduct", method: "GET", path: "/v1/products/{product_id}", tag: "Products", statuses: [200, 404] };
const step = (ok, status, extra = {}) => ({ ok, durationMs: 120, request: { method: "GET", url: "https://staging.example/teams/store/v1/products/11", body: undefined }, actual: { status, body: { big: "x".repeat(500) } }, assertions: [{ label: `Status ${status}`, pass: ok, detail: ok ? "" : "esperado 200" }, { label: "Schema OpenAPI", pass: true, detail: "ok" }, { label: "p95 < 70 ms (informativo)", pass: false, detail: "", informative: true }], ...extra });
const entries = [
  { endpoint, scenario: { id: "found", name: "Recurso existente", expectedStatus: 200, flow: "request" }, result: { ok: true, durationMs: 120, steps: [step(true, 200, { latency: { p95: 120, budgetMs: 70, samples: [120] } })] } },
  { endpoint, scenario: { id: "not-found", name: "Recurso inexistente", expectedStatus: 404, flow: "request" }, result: { ok: false, durationMs: 240, steps: [step(true, 201), step(false, 500)] } },
];

test("a snapshot round-trips into the same summary, without bodies or origins", () => {
  const snapshot = snapshotRun(entries, { id: "1", at: 1, environment: "Staging", baseUrl: "https://staging.example/teams/store", scope: "Matriz GET", durationMs: 360 });
  assert.equal(snapshot.passed, 1);
  assert.equal(snapshot.cases[0].steps[0].rb, undefined, "a passing case keeps no body");
  assert.ok(snapshot.cases[1].steps[1].rb.includes("xxxxx"), "a failed case keeps its response body");
  assert.equal(snapshot.cases[1].steps[1].u, "/teams/store/v1/products/11");
  const restored = snapshot.cases.map((item, index) => ({ endpoint, scenario: entries[index].scenario, result: resultFromSnapshot(item, "https://staging.example") }));
  const a = summarizeResults(entries, [endpoint]);
  const b = summarizeResults(restored, [endpoint]);
  for (const key of ["total", "passed", "failed"]) assert.equal(b[key], a[key], key);
  assert.deepEqual(b.causes, a.causes);
  assert.deepEqual(b.assertions, a.assertions);
  assert.deepEqual(b.requests.byCode, a.requests.byCode);
});

test("the summary counts every request, assertion and code a run produced", () => {
  const summary = summarizeResults(entries, [endpoint]);
  assert.equal(summary.requests.total, 3);
  assert.equal(summary.requests.chainedCases, 1);
  assert.deepEqual(summary.requests.byClass.map((row) => row.key), ["2xx", "5xx"]);
  assert.equal(summary.assertions.failed, 1, "informative assertions are not counted");
  assert.equal(summary.assertions.schemaPassed, 3);
  assert.equal(summary.perEndpoint[0].cases, 2);
  assert.equal(summary.slowestCases[0].scenarioId, "not-found");
});

test("two runs compare case by case, and alternating cases are flagged", () => {
  const run = (results) => ({ cases: Object.entries(results).map(([key, ok]) => ({ e: key.split(":")[0], s: key.split(":")[1], ok })) });
  const older = run({ "a:1": true, "a:2": false, "a:3": false, "a:4": true });
  const newer = run({ "a:1": false, "a:2": true, "a:3": false, "b:1": true });
  assert.deepEqual(compareRuns(newer, older), { newFailures: ["a:1"], fixed: ["a:2"], stillFailing: ["a:3"], onlyCurrent: 1, onlyPrevious: 1 });
  assert.deepEqual(flakyCases([newer, older]).map((row) => row.key).sort(), ["a:1", "a:2"]);
});

test("a failed case's bodies come back, clipped", () => {
  const snapshot = snapshotRun([entries[1]], { id: "1", at: 1, environment: "Staging", baseUrl: "https://staging.example", scope: "x", durationMs: 1 });
  const restored = resultFromSnapshot(snapshot.cases[0], "https://staging.example");
  assert.equal(restored.steps[1].actual.status, 500);
  assert.equal(restored.steps[1].actual.body.big.length, 500);
});
