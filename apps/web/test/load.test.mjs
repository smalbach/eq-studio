import assert from "node:assert/strict";
import test from "node:test";
import { budgetFor } from "../src/lib/budgets.mjs";
import { buildStages, evaluate, expectedRequests, rateAt, requestPicker, runLoad, targetBudget, totalDuration, validatePlan, zipfSampler } from "../src/lib/load.mjs";

/** A clock that only moves when the engine sleeps, so a 10 s test runs in milliseconds. */
function fakeRuntime({ latencyMs = 10, status = 200 } = {}) {
  let clock = 0;
  return {
    now: () => clock,
    sleep: async (ms) => { clock += ms; await Promise.resolve(); },
    advance: (ms) => { clock += ms; },
    random: (() => { let seed = 7; return () => (seed = (seed * 16807) % 2147483647) / 2147483647; })(),
    // The latency is charged while the body is read, which is where the engine stops the clock.
    fetchImpl: async () => ({ status: typeof status === "function" ? status() : status, arrayBuffer: async () => { clock += latencyMs; return new ArrayBuffer(0); } }),
  };
}

test("each test type walks the stages its question needs", () => {
  const load = buildStages("load", { baseRps: 20, peakRps: 20, durationS: 60 });
  assert.equal(totalDuration(load), 60);
  assert.equal(load[0].measured, false, "the ramp is never held to the targets");
  assert.equal(load.at(-1).toRps, 20);
  const stress = buildStages("stress", { baseRps: 10, peakRps: 100, durationS: 100 });
  assert.deepEqual(stress.map((stage) => stage.toRps), [10, 33, 55, 78, 100]);
  const spike = buildStages("spike", { baseRps: 10, peakRps: 100, durationS: 60 });
  assert.deepEqual(spike.map((stage) => stage.toRps), [10, 100, 10]);
  assert.equal(spike[1].fromRps, 100, "a spike has no ramp");
});

test("the rate is interpolated inside a ramp and the request count follows it", () => {
  const stages = [{ label: "r", durationS: 10, fromRps: 0, toRps: 20, measured: false }, { label: "h", durationS: 10, fromRps: 20, toRps: 20, measured: true }];
  assert.equal(rateAt(stages, 5).rps, 10);
  assert.equal(rateAt(stages, 15).stage, 1);
  assert.equal(expectedRequests(stages), 300);
});

test("Zipf concentrates the picks on the first items", () => {
  let seed = 1;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = zipfSampler(100, 1.2, random);
  const counts = new Array(100).fill(0);
  for (let i = 0; i < 20_000; i += 1) counts[pick()] += 1;
  const top20 = counts.slice(0, 20).reduce((a, b) => a + b, 0) / 20_000;
  assert.ok(top20 > 0.7, `the top 20 % took ${top20}`);
});

test("placeholders are filled from the data lists", () => {
  const pick = requestPicker([{ label: "a", method: "GET", path: "/v1/products/{product_id}/full?store_id={store_id}", weight: 1 }], { product_id: ["7"], store_id: ["9"] });
  assert.equal(pick().path, "/v1/products/7/full?store_id=9");
});

test("a plan with a write, a relative path or too much traffic is refused", () => {
  const stages = buildStages("load", { baseRps: 10, peakRps: 10, durationS: 10 });
  assert.deepEqual(validatePlan({ baseUrl: "http://127.0.0.1:4010", targets: [{ method: "GET", path: "/health", weight: 1 }], stages }), []);
  assert.match(validatePlan({ baseUrl: "http://x", targets: [{ method: "POST", path: "/v1/products", weight: 1 }], stages }).join(), /solo envían GET/);
  assert.match(validatePlan({ baseUrl: "ftp://x", targets: [{ method: "GET", path: "health", weight: 1 }], stages }).join(), /HTTP o HTTPS/);
  assert.match(validatePlan({ baseUrl: "http://x", targets: [{ method: "GET", path: "/health", weight: 1 }], stages: buildStages("load", { baseRps: 900, peakRps: 900, durationS: 10 }) }).join(), /req\/s/);
});

const RULES = [{ path: "/health", ms: 20 }, { path: "/internal/**", ms: null }, { methods: ["GET"], ms: 70, label: "GET p95 < 70 ms" }];

test("a target with no budget rule, or a rule without one, can never miss a budget", () => {
  assert.equal(budgetFor(RULES, "GET", "/internal/ping"), null);
  assert.equal(budgetFor(RULES, "GET", "/health").ms, 20);
  assert.equal(targetBudget({ path: "/internal/ping" }, { mode: "project", rules: RULES }), null);
  assert.equal(targetBudget({ path: "/v1/products?limit=20" }, { mode: "project", rules: RULES }).ms, 70);
  assert.equal(targetBudget({ path: "/v1/products" }, { mode: "project" }), null);
});

test("a fast API at nominal rate passes the load test", async () => {
  const report = await runLoad({ type: "load", baseUrl: "http://api", targets: [{ label: "GET /v1/products", method: "GET", path: "/v1/products?limit=20", weight: 1 }], stages: buildStages("load", { baseRps: 20, peakRps: 20, durationS: 10 }) }, fakeRuntime({ latencyMs: 5 }));
  assert.ok(report.overall.completed > 150, `${report.overall.completed} completed`);
  assert.equal(report.overall.errors, 0);
  assert.ok(report.windows.length >= 10);
  assert.equal(report.verdict.pass, true, JSON.stringify(report.verdict.checks));
});

test("errors above 0.1 % fail the load test even when latency is fine", async () => {
  let n = 0;
  const report = await runLoad({ type: "load", baseUrl: "http://api", targets: [{ label: "x", method: "GET", path: "/v1/stores", weight: 1 }], stages: buildStages("load", { baseRps: 20, peakRps: 20, durationS: 10 }) }, fakeRuntime({ latencyMs: 5, status: () => (++n % 10 === 0 ? 500 : 200) }));
  const errorCheck = report.verdict.checks.find((check) => check.label.startsWith("Tasa de error"));
  assert.equal(errorCheck.pass, false);
  assert.equal(report.verdict.pass, false);
});

test("stress names the last step held and the first one broken", () => {
  const stage = (rps, p95) => ({ label: `${rps}`, durationS: 10, fromRps: rps, toRps: rps, measured: true, completed: rps * 10, errors: 0, dropped: 0, errorRate: 0, rps, p50: p95, p95, p99: p95, max: p95, statuses: { 200: rps * 10 } });
  const report = { aborted: false, elapsedS: 50, overall: { completed: 1000, statuses: { 200: 1000 } }, targets: [{ budgetMs: 70 }], stages: [stage(10, 20), stage(30, 40), stage(50, 90), stage(70, 30)], windows: [] };
  const verdict = evaluate("stress", report);
  assert.match(verdict.checks.find((check) => check.label === "Capacidad sostenida").detail, /^30 req\/s/);
  assert.match(verdict.checks.find((check) => check.label === "Punto de quiebre").detail, /^50 req\/s — p95 90 ms/);
});

test("an aborted test never passes", () => {
  const verdict = evaluate("load", { aborted: true, elapsedS: 3, overall: { completed: 10, statuses: {} }, targets: [], stages: [{ measured: true, completed: 10, errors: 0, dropped: 0, rps: 20, toRps: 20, fromRps: 20 }], windows: [] });
  assert.equal(verdict.pass, false);
});

test("over a remote route a missed budget is reported but does not fail the case", async () => {
  const { latencyAssertion } = await import("../src/lib/budgets.mjs");
  const budget = budgetFor(RULES, "GET", "/v1/products");
  assert.equal(latencyAssertion(budget, [300]).pass, false);
  const remote = latencyAssertion(budget, [300], { enforce: false });
  assert.equal(remote.pass, false);
  assert.equal(remote.informative, true);
  assert.match(remote.label, /informativo/);
});

test("the catalog offers every GET of the project plus its variants, and the mixes use it", async () => {
  const { loadCatalog, loadMixes, dataKeysOf, defaultLoadData } = await import("../src/lib/load.mjs");
  const operations = [
    { id: "health", method: "GET", path: "/health", tag: "Health", parameters: [] },
    { id: "listOrders", method: "GET", path: "/v1/orders", tag: "Orders", parameters: ["limit", "q"] },
    { id: "getOrder", method: "GET", path: "/v1/orders/{order_id}", tag: "Orders", parameters: ["order_id"] },
    { id: "createOrder", method: "POST", path: "/v1/orders", tag: "Orders", parameters: [] },
  ];
  const config = { targets: [{ id: "search", label: "GET ?q=", path: "/v1/orders?q={term}" }], mixes: [{ id: "reads", label: { es: "Lecturas", en: "Reads" }, targets: [{ target: "getOrder", weight: 3 }, { target: "search", weight: 1 }, { target: "missing", weight: 1 }] }], data: { term: ["a", "b"] } };
  const catalog = loadCatalog(operations, config);
  assert.deepEqual(catalog.map((item) => item.path), ["/health", "/v1/orders?limit=20", "/v1/orders/{order_id}", "/v1/orders?q={term}"]);
  const mixes = loadMixes(catalog, config);
  assert.deepEqual(mixes.map((mix) => mix.id), ["reads", "all-gets", "lists", "health"]);
  assert.deepEqual(mixes[0].targets.map((target) => target.weight), [3, 1], "a mix drops a target the catalog does not have");
  assert.equal(mixes[0].en.label, "Reads");
  assert.deepEqual(dataKeysOf(catalog), ["order_id", "term"]);
  assert.deepEqual(defaultLoadData(dataKeysOf(catalog), config), { order_id: ["1"], term: ["a", "b"] });
});

test("a correlated path placeholder keeps its slashes", () => {
  const pick = requestPicker([{ label: "p", method: "GET", path: "/v1/products/{review_path}", weight: 1 }], { review_path: ["11/reviews/9"] });
  assert.equal(pick().path, "/v1/products/11/reviews/9");
});

test("the report carries the extended metrics and classifies errors by owner", async () => {
  let n = 0;
  const runtime = fakeRuntime({ latencyMs: 20, status: () => (n++ % 10 === 0 ? 429 : 200) });
  const stages = [{ label: "h", durationS: 4, fromRps: 10, toRps: 10, measured: true }];
  const report = await runLoad({ baseUrl: "http://x", type: "load", targets: [{ label: "a", method: "GET", path: "/v1/products", weight: 1 }], stages, latency: { mode: "custom", p95Ms: 100 } }, runtime);
  for (const key of ["min", "mean", "stddev", "p75", "p90", "p999", "apdex", "peakRps", "peakInFlight", "firstErrorS", "kbps"]) assert.ok(key in report.overall, key);
  assert.ok(report.overall.kinds.rateLimited > 0);
  assert.equal(report.targets[0].budgetMs, 100, "a custom limit replaces the project budget");
  assert.equal(report.histogram.reduce((sum, row) => sum + row.count, 0), report.overall.completed);
  assert.match(report.verdict.checks.find((check) => check.label.startsWith("Tasa de error")).detail, /429/);
});

test("latency off never fails the verdict on a slow path", async () => {
  const runtime = fakeRuntime({ latencyMs: 600 });
  const stages = [{ label: "h", durationS: 3, fromRps: 5, toRps: 5, measured: true }];
  const report = await runLoad({ baseUrl: "http://x", type: "load", targets: [{ label: "a", method: "GET", path: "/v1/products", weight: 1 }], stages, latency: { mode: "off" }, maxInFlight: 64 }, runtime);
  assert.ok(!report.verdict.checks.some((check) => / p95 < /.test(check.label)));
});

test("the preflight names a target without data and a 404 before any load", async () => {
  const { preflight } = await import("../src/lib/load.mjs");
  const results = await preflight({ baseUrl: "http://x", targets: [{ label: "a", path: "/v1/prices/{price_id}", weight: 1 }, { label: "b", path: "/v1/products/{product_id}", weight: 1 }, { label: "c", path: "/health", weight: 1 }], data: { price_id: [], product_id: ["5"] } }, { fetchImpl: async (url) => ({ status: url.endsWith("/5") ? 404 : 200, arrayBuffer: async () => new ArrayBuffer(0) }), now: () => 0 });
  assert.match(results[0].problem, /Sin datos/);
  assert.match(results[1].problem, /404/);
  assert.equal(results[2].ok, true);
});

test("the environment's data lists are read from its own listings", async () => {
  const { discoverLoadData } = await import("../src/lib/load.mjs");
  const bodies = {
    "/v1/products?limit=50": [{ product_id: 11 }, { product_id: 12 }],
    "/v1/stores?limit=50": [{ id: 7 }],
    "/v1/prices?limit=50": [],
  };
  const sources = [
    { name: "product_id", path: "/v1/products?limit=4", operationPath: "/v1/products" },
    { name: "store_id", path: "/v1/stores?limit=4", operationPath: "/v1/stores" },
    { name: "price_id", path: "/v1/prices?limit=4", operationPath: "/v1/prices" },
    { name: "review_id", path: "/v1/products/{product_id}/reviews?limit=4", operationPath: "/v1/products/{product_id}/reviews", needs: "product_id" },
  ];
  const { data, failed } = await discoverLoadData(async (path) => ({ status: 200, body: { data: bodies[path] ?? [] } }), sources);
  assert.equal(failed, false);
  assert.deepEqual(data, { product_id: ["11", "12"], store_id: ["7"], price_id: [], review_path: [] }, "a nested collection with no rows is reported empty, not left out");
});

test("a spike that the gateway sheds with 429 and recovers passes; one that falls over does not", async () => {
  const stages = buildStages("spike", { baseRps: 10, peakRps: 60, durationS: 20 });
  const plan = () => ({ baseUrl: "http://x", type: "spike", targets: [{ label: "a", method: "GET", path: "/v1/products", weight: 1 }], stages, latency: { mode: "custom", p95Ms: 1500 }, maxInFlight: 512 });
  // A clock-driven status: 429 for part of the peak window only.
  const shed = fakeRuntime();
  let n = 0;
  shed.fetchImpl = async () => { const t = shed.now() / 1000; const inPeak = t >= 6 && t < 10; return { status: inPeak && n++ % 3 === 0 ? 429 : 200, arrayBuffer: async () => { shed.advance(5); return new ArrayBuffer(0); } }; };
  const ok = await runLoad(plan(), shed);
  assert.ok(ok.overall.kinds.rateLimited > 0, "the peak was shed");
  assert.equal(ok.verdict.pass, true, JSON.stringify(ok.verdict.checks));
  const crash = fakeRuntime();
  crash.fetchImpl = async () => { const t = crash.now() / 1000; return { status: t >= 6 && t < 10 ? 500 : 200, arrayBuffer: async () => { crash.advance(5); return new ArrayBuffer(0); } }; };
  const bad = await runLoad(plan(), crash);
  assert.equal(bad.verdict.checks.find((check) => check.label === "Sobrevive al pico").pass, false);
});

test("a soak compares pooled p95s, not the drain window, and flags real drift", async () => {
  const stages = buildStages("soak", { baseRps: 20, peakRps: 20, durationS: 60 });
  // The fake clock charges every request's latency to one global clock, so latencies are kept
  // small enough that 20 req/s still fit in a second.
  const steady = fakeRuntime({ latencyMs: 5 });
  const flat = await runLoad({ baseUrl: "http://x", type: "soak", targets: [{ label: "a", method: "GET", path: "/v1/products", weight: 1 }], stages, latency: { mode: "custom", p95Ms: 1500 } }, steady);
  assert.equal(flat.verdict.checks.find((check) => check.label === "Sin degradación en el tiempo").pass, true, JSON.stringify(flat.verdict.checks));
  const leak = fakeRuntime();
  const start = leak.now();
  leak.fetchImpl = async () => { const latency = 5 + (leak.now() - start) / 1000; return { status: 200, arrayBuffer: async () => { leak.advance(latency); return new ArrayBuffer(0); } }; };
  const drift = await runLoad({ baseUrl: "http://x", type: "soak", targets: [{ label: "a", method: "GET", path: "/v1/products", weight: 1 }], stages, latency: { mode: "off" } }, leak);
  assert.equal(drift.verdict.checks.find((check) => check.label === "Sin degradación en el tiempo").pass, false, JSON.stringify(drift.phases));
});

test("in English the stages, the verdict and the plan problems are English; Spanish stays the default", async () => {
  assert.equal(buildStages("stress", { baseRps: 10, peakRps: 100, durationS: 100 }, "en")[2].label, "Step 3 · 55 req/s");
  assert.deepEqual(buildStages("spike", { baseRps: 10, peakRps: 100, durationS: 60 }, "en").map((stage) => stage.label.split(" · ")[0]), ["Base", "Spike", "Recovery"]);
  assert.equal(buildStages("load", { baseRps: 20, peakRps: 20, durationS: 60 })[1].label, "Sostenido · 20 req/s");
  const stage = (rps, p95) => ({ label: `${rps}`, durationS: 10, fromRps: rps, toRps: rps, measured: true, completed: rps * 10, errors: 0, dropped: 0, errorRate: 0, rps, p50: p95, p95, p99: p95, max: p95, statuses: { 200: rps * 10 } });
  const report = { aborted: false, elapsedS: 50, overall: { completed: 1000, statuses: { 200: 1000 } }, targets: [{ budgetMs: 70 }], stages: [stage(10, 20), stage(30, 40), stage(50, 90)], windows: [] };
  const verdict = evaluate("stress", report, "en");
  assert.match(verdict.checks.find((check) => check.label === "Sustained capacity").detail, /^30 req\/s with p95 40 ms/);
  assert.ok(verdict.checks.some((check) => check.label === "Breaking point"));
  assert.match(validatePlan({ baseUrl: "nope", targets: [], stages: [] }, "en").join(" "), /The base URL is not valid\. There is no target to run\./);
  const { preflight } = await import("../src/lib/load.mjs");
  const results = await preflight({ locale: "en", baseUrl: "http://x", targets: [{ label: "a", path: "/v1/prices/{price_id}", weight: 1 }], data: { price_id: [] } }, { fetchImpl: async () => ({ status: 200, arrayBuffer: async () => new ArrayBuffer(0) }), now: () => 0 });
  assert.equal(results[0].problem, "No data for {price_id}");
});

test("a report saved in one language is shown in the other: stages, verdict and profile", async () => {
  const { localizeReport, mixLabelIn, stageLabelIn } = await import("../src/lib/load.mjs");
  assert.equal(stageLabelIn("Escalón 3 · 60 req/s", "en"), "Step 3 · 60 req/s");
  assert.equal(stageLabelIn("Recovery · 20 req/s", "es"), "Recuperación · 20 req/s");
  assert.equal(stageLabelIn("Base · 20 req/s", "en"), "Base · 20 req/s");
  assert.equal(mixLabelIn("Todos los GET del proyecto", "en"), "Every GET in the project");
  assert.equal(mixLabelIn("Mi perfil", "en"), "Mi perfil");
  const stage = (label, rate) => ({ label, durationS: 5, fromRps: rate, toRps: rate, measured: true, sent: rate * 5, completed: rate * 5, errors: 0, dropped: 0, errorRate: 0, rps: rate, p50: 5, p95: 8, p99: 9, max: 12, statuses: { 200: rate * 5 }, kinds: {} });
  const report = { aborted: false, elapsedS: 25, overall: { completed: 750, errors: 0, statuses: { 200: 750 }, kinds: {} }, targets: [], windows: [], stages: [10, 20, 30, 40, 50].map((rate, index) => stage(`Escalón ${index + 1} · ${rate} req/s`, rate)) };
  report.verdict = evaluate("stress", report, "es");
  const english = localizeReport("stress", report, "en");
  assert.equal(english.stages[0].label, "Step 1 · 10 req/s");
  assert.equal(english.verdict.pass, report.verdict.pass);
  assert.notDeepEqual(english.verdict.checks.map((check) => check.label), report.verdict.checks.map((check) => check.label));
});

test("a nested read draws its ids together, so the child always exists under its parent", async () => {
  const { loadCatalog, dataKeysOf, defaultLoadData, discoverLoadData } = await import("../src/lib/load.mjs");
  const catalog = loadCatalog([{ id: "getItem", method: "GET", path: "/v1/orders/{order_id}/items/{item_id}", tag: "Orders", parameters: ["order_id", "item_id"] }]);
  assert.deepEqual(catalog.map((item) => [item.path, item.template]), [["/v1/orders/{item_path}", "{order_id}/items/{item_id}"]]);
  assert.deepEqual(dataKeysOf(catalog), ["item_path"]);
  assert.deepEqual(defaultLoadData(dataKeysOf(catalog), { data: { order_id: ["7"] } }, catalog), { item_path: ["7/items/1"] });
  const bodies = { "/v1/orders?limit=50": [{ order_id: 7 }, { order_id: 8 }], "/v1/orders/7/items?limit=10": [{ id: 3 }], "/v1/orders/8/items?limit=10": [] };
  const sources = [{ name: "order_id", path: "/v1/orders?limit=4", operationPath: "/v1/orders" }, { name: "item_id", path: "/v1/orders/{order_id}/items?limit=4", operationPath: "/v1/orders/{order_id}/items", needs: "order_id" }];
  const { data } = await discoverLoadData(async (path) => ({ status: 200, body: { data: bodies[path] ?? [] } }), sources);
  assert.deepEqual(data, { order_id: ["7", "8"], item_path: ["7/items/3"] });
});
