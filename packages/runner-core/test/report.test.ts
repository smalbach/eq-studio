import assert from "node:assert/strict";
import test from "node:test";
import { htmlReport, junitReport, MASK, maskSecrets, renderReport, sarifReport, scenarioKind, type ReportContext, type ReportRun } from "../src/report/index.ts";

const SECRET = "s3cr3t-admin-token";

/** A functional run with one failure, one latency-only failure, one blocked case and secrets
 * where a careless API puts them: echoed in a body, in a query string, in an error. */
const run: ReportRun = {
  id: "run-1", kind: "functional", status: "failed", scope: "Full matrix", createdAt: "2026-10-16T10:00:00.000Z", startedAt: "2026-10-16T10:00:00.100Z", finishedAt: "2026-10-16T10:00:02.000Z", durationMs: 1900, error: null,
  totals: { total: 4, passed: 1, failed: 2, blocked: 1, completed: 4 },
  cases: [
    { operationId: "listOrders", scenarioId: "default", name: "Unfiltered list", method: "GET", path: "/orders", expectedStatus: 200, status: "passed", durationMs: 12, steps: [{ method: "GET", url: "http://api.test/orders", status: 200, ok: true, durationMs: 12, assertions: [{ label: "Status 200", pass: true, detail: "Received 200" }] }] },
    { operationId: "getOrder", scenarioId: "not-found", name: "Missing <resource>", method: "GET", path: "/orders/{order_id}", expectedStatus: 404, status: "failed", durationMs: 30, steps: [{
      method: "GET", url: `http://api.test/orders/999?api_key=${SECRET}&page=1`, status: 500, ok: false, durationMs: 30,
      assertions: [{ label: "Status 404", pass: false, detail: "Received 500" }, { label: "Schema OpenAPI", pass: false, detail: "$.title: required field" }],
      requestBody: null, responseBody: { error: "boom", debug: { authorization: `Bearer ${SECRET}`, echoed: `token was ${SECRET}` }, password: "hunter2-hunter2" },
    }] },
    { operationId: "listOrders", scenarioId: "status-active", name: "status = active", method: "GET", path: "/orders", expectedStatus: 200, status: "failed", durationMs: 900, steps: [{ method: "GET", url: "http://api.test/orders?status=active", status: 200, ok: false, durationMs: 900, latency: { p95: 900, budgetMs: 300 }, assertions: [{ label: "Status 200", pass: true, detail: "Received 200" }, { label: "GET < 300 ms", pass: false, detail: "900 ms · target 300 ms (project)" }] }] },
    { operationId: "createOrder", scenarioId: "create-read", name: "Create and read", method: "POST", path: "/orders", expectedStatus: 201, status: "blocked", durationMs: 0, steps: [] },
  ],
};
const context: ReportContext = { project: "orders", environment: "Staging", baseUrl: "https://api.test", contractVersion: "2.3.0", contract: { uri: "openapi.yaml", text: "openapi: 3.1.0\npaths:\n  /orders:\n    get:\n      operationId: listOrders\n  /orders/{order_id}:\n    get:\n      operationId: getOrder\n" }, secrets: [SECRET], locale: "en", toolVersion: "0.1.0", generatedAt: "2026-10-16T10:05:00.000Z" };

const load: ReportRun = {
  id: "load-1", kind: "load", status: "failed", scope: "Load test", createdAt: "2026-10-16T11:00:00.000Z", durationMs: 30_000, error: null, totals: { total: 0, passed: 0, failed: 0, blocked: 0, completed: 250 },
  report: { overall: { rps: 9.8, p50: 40, p95: 120, p99: 310, errorRate: 0.004, completed: 250 }, verdict: { pass: false, checks: [{ label: "Error rate < 0.1 %", pass: false, detail: "1 of 250 (0.400 %)" }, { label: "p95 < 300 ms", pass: true, detail: "120 ms" }] } },
};

test("masking: names, query strings, schemes and given values, deep", () => {
  const masked = maskSecrets({ headers: { Authorization: "Bearer abc.def" }, url: "https://x.test/a?token=abc&q=1", note: `the key is ${SECRET}`, nested: [{ apiKey: 123 }] }, [SECRET]);
  assert.equal(masked.headers.Authorization, MASK);
  assert.equal(masked.url, `https://x.test/a?token=${MASK}&q=1`);
  assert.equal(masked.note, `the key is ${MASK}`);
  assert.equal(masked.nested[0].apiKey, MASK as unknown as number);
});

test("no format lets a secret through", () => {
  for (const format of ["html", "sarif", "junit"] as const) {
    const { body } = renderReport(format, run, context);
    assert.equal(body.includes(SECRET), false, `${format} leaks the token`);
    assert.equal(body.includes("hunter2"), false, `${format} leaks a password member`);
  }
});

test("HTML: one self-contained page, summary, failures first, the whole table", () => {
  const html = htmlReport(run, context);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none';/);
  assert.equal(/<(script|link|img|iframe)[^>]+(src|href)=/i.test(html), false, "no external resource");
  assert.equal(/https?:\/\/(?!api\.test)/.test(html.replace(/https:\/\/api\.test/g, "")), false, "no URL other than the run's own");
  assert.match(html, /prefers-color-scheme:dark/);
  assert.match(html, /@media print/);
  assert.match(html, /orders · Full matrix <span class="verdict v-failed">FAILED<\/span>/);
  assert.match(html, /<dt>Contract version<\/dt><dd>2\.3\.0<\/dd>/);
  assert.match(html, /<dt>Environment<\/dt><dd>Staging<\/dd>/);
  const failures = html.slice(html.indexOf('id="failures"'), html.indexOf('id="all"'));
  const order = [...failures.matchAll(/data-case="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(order, ["getOrder:not-found", "listOrders:status-active", "createOrder:create-read"], "failed before blocked");
  assert.match(failures, /Missing &lt;resource&gt;/, "escaped");
  assert.match(failures, /\$\.title: required field/);
  assert.match(failures, /latency only/);
  assert.equal((html.match(/<tr data-status=/g) ?? []).length, 4);
  assert.match(html, /<input id="q" type="search"/);
});

test("HTML in Spanish, and a load run with its percentiles and verdict", () => {
  assert.match(htmlReport(run, { ...context, locale: "es" }), /<html lang="es">[\s\S]*Fallos \(3\)/);
  const html = htmlReport(load, context);
  for (const text of ["p50", "40 ms", "p95", "120 ms", "p99", "310 ms", "0.40 %", "Error rate &lt; 0.1 %", "Verdict criteria"]) assert.ok(html.includes(text), text);
  assert.equal(html.includes('id="cases"'), false);
});

test("SARIF 2.1.0: required fields, a result per failed case, rules by scenario kind", () => {
  const log = JSON.parse(renderReport("sarif", run, context).body);
  assert.equal(log.version, "2.1.0");
  assert.match(log.$schema, /sarif-2\.1\.0/);
  assert.equal(log.runs.length, 1);
  const [sarif] = log.runs;
  assert.equal(sarif.tool.driver.name, "Endpoint Quality");
  assert.equal(sarif.results.length, 2, "blocked cases are not results");
  for (const result of sarif.results) {
    assert.equal(typeof result.message.text, "string");
    assert.ok(["error", "warning", "note"].includes(result.level));
    assert.equal(sarif.tool.driver.rules[result.ruleIndex].id, result.ruleId);
    assert.ok(result.locations[0].logicalLocations[0].fullyQualifiedName);
    assert.equal(result.locations[0].physicalLocation.artifactLocation.uri, "openapi.yaml");
    assert.ok(result.partialFingerprints["eqCase/v1"]);
  }
  const [notFound, latency] = sarif.results;
  assert.deepEqual([notFound.ruleId, notFound.level, latency.ruleId, latency.level], ["not-found", "error", "custom", "warning"]);
  assert.equal(notFound.locations[0].logicalLocations[0].fullyQualifiedName, "GET /orders/{order_id}");
  assert.equal(notFound.locations[0].physicalLocation.region.startLine, 8, "the line of its operationId");
  assert.equal(sarif.properties.contractVersion, "2.3.0");
  const loadLog = sarifReport(load, { ...context, contract: undefined });
  assert.deepEqual(loadLog.runs[0].results.map((result) => [result.ruleId, result.level]), [["load-criterion", "error"]]);
  assert.equal(loadLog.runs[0].results[0].locations[0].physicalLocation, undefined);
});

test("JUnit keeps its shape, and scenario kinds group parameter samples", () => {
  const xml = junitReport(run, context);
  assert.match(xml, /<testsuites name="orders · Staging · Full matrix" tests="4" failures="2" skipped="1"/);
  assert.equal((xml.match(/<testcase /g) ?? []).length, 4);
  assert.deepEqual(["not-found", "status-active", "geo-1km", "auth-none"].map(scenarioKind), ["not-found", "custom", "geo", "auth-none"]);
});
