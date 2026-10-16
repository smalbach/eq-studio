import assert from "node:assert/strict";
import test from "node:test";
import { categoryLabel, failureCategory, resultsToCsv, summarizeResults } from "../src/lib/results-summary.mjs";

const step = (ok, status, assertions = [], extra = {}) => ({ ok, durationMs: 12, actual: { status }, assertions, request: { method: "GET", url: "http://api/x" }, ...extra });
const products = { id: "listProducts", method: "GET", path: "/v1/products", tag: "Products", statuses: [200, 401, 403] };
const store = { id: "deleteStore", method: "DELETE", path: "/v1/stores/{store_id}", tag: "Stores", statuses: [204, 401, 403, 404] };
const ping = { id: "internalPing", method: "GET", path: "/internal/ping", tag: "Internal", statuses: [200], internal: true };

const entries = [
  { endpoint: products, scenario: { id: "default", name: "Listado", expectedStatus: 200, flow: "request" }, result: { ok: true, durationMs: 12, steps: [step(true, 200, [], { latency: { p95: 30, budgetMs: 70, samples: [30] } })] } },
  { endpoint: products, scenario: { id: "limit-0", name: "limit = 0", expectedStatus: 422, flow: "request" }, result: { ok: false, durationMs: 12, steps: [step(false, 200, [{ label: "Status 422", pass: false, detail: "Recibido 200" }, { label: "Schema OpenAPI", pass: false, detail: "x" }])] } },
  { endpoint: store, scenario: { id: "deleted-read", name: "Consultar eliminado", expectedStatus: 404, flow: "deleted-read" }, result: { ok: false, durationMs: 40, steps: [step(true, 201), step(true, 204), step(false, 200, [{ label: "Status 404", pass: false, detail: "Recibido 200" }])] } },
  { endpoint: ping, scenario: { id: "pong", name: "Piso", expectedStatus: 200, flow: "request" }, result: { ok: true, durationMs: 3, steps: [step(true, 200)] } },
];

test("counts by tag, method and expected status", () => {
  const summary = summarizeResults(entries, [products, store, ping]);
  assert.equal(summary.total, 4);
  assert.equal(summary.passed, 2);
  assert.deepEqual(summary.byTag.find((row) => row.key === "Products"), { key: "Products", total: 2, passed: 1, failed: 1 });
  assert.equal(summary.byMethod.find((row) => row.key === "DELETE").failed, 1);
});

test("a chained flow is filed under the step that failed, not the first one", () => {
  const failure = summarizeResults(entries, [products, store, ping]).failures.find((item) => item.endpointId === "deleteStore");
  assert.equal(failure.stepIndex, 2);
  assert.equal(failure.actualStatus, 200);
});

test("failure causes fold the assertion labels", () => {
  const causes = summarizeResults(entries, [products, store, ping]).causes;
  assert.equal(causes.find((row) => row.key === "Status HTTP").total, 2);
  assert.equal(failureCategory("GET p95 < 70 ms"), "Presupuesto de latencia");
});

test("coverage counts the contract's declared responses and never the internal probes", () => {
  const summary = summarizeResults(entries, [products, store, ping]);
  assert.equal(summary.coverageTotals.declared, 7);
  const ok200 = summary.coverage.find((row) => row.status === 200);
  assert.deepEqual(ok200, { status: 200, declared: 1, exercised: 1, verified: 1 });
  assert.equal(summary.coverage.find((row) => row.status === 404).verified, 0);
});

test("the CSV doubles quotes and keeps one row per case", () => {
  const csv = resultsToCsv([{ ...entries[1], scenario: { ...entries[1].scenario, name: 'limit "0"' } }]);
  assert.equal(csv.split("\n").length, 2);
  assert.match(csv, /"limit ""0"""/);
});

test("an informative latency miss is never filed as a cause of failure", () => {
  const informative = { label: "GET p95 < 70 ms (informativo)", pass: false, informative: true, detail: "300 ms" };
  const entry = { endpoint: products, scenario: { id: "x", name: "x", expectedStatus: 200, flow: "request" }, result: { ok: false, durationMs: 1, steps: [step(false, 404, [{ label: "Status 200", pass: false, detail: "Recibido 404" }, informative])] } };
  const summary = summarizeResults([entry], [products]);
  assert.deepEqual(summary.causes.map((row) => row.key), ["Status HTTP"]);
});

test("English assertion labels fold into the same (Spanish) category keys", () => {
  const pairs = [
    ["Status 200", "Status HTTP"],
    ["Schema OpenAPI", "Schema OpenAPI"],
    ["Content-Type", "Content-Type"],
    ["GET p95 < 200 ms", "Presupuesto de latencia"],
    ["GET p95 < 70 ms (informative)", "Presupuesto de latencia"],
    ["Field persistence", "Persistencia / ID"],
    ["Returned ID", "Persistencia / ID"],
    ["Setup ID", "Persistencia / ID"],
    ["API connection", "Conexión"],
    ["Dependency postgres", "Dependencias"],
    ["Record persisted", "Registro persistido"],
    ["Bulk of 5,000 records < 5 s", "Bulk de 5.000 registros < 5 s"],
  ];
  for (const [label, key] of pairs) assert.equal(failureCategory(label), key, label);
  // The Spanish labels keep landing where they always did.
  assert.equal(failureCategory("Persistencia de campos"), "Persistencia / ID");
  assert.equal(failureCategory("Conexión con la API"), "Conexión");
  assert.equal(failureCategory("Dependencia redis"), "Dependencias");
  assert.equal(failureCategory("Registro persistido"), "Registro persistido");
});

test("category keys are translated only for display", () => {
  assert.equal(categoryLabel("Presupuesto de latencia", "en"), "Latency budget");
  assert.equal(categoryLabel("Sin respuesta", "en"), "No response");
  assert.equal(categoryLabel("Presupuesto de latencia", "es"), "Presupuesto de latencia");
  assert.equal(categoryLabel("Some unknown label", "en"), "Some unknown label");
});
