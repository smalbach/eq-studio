import assert from "node:assert/strict";
import test from "node:test";
import { budgetFor, buildEndpoints, buildQueue, clearSpecCache, createScenarioRunner, discoverIds, executeCase, negativeScenarios, operationKind, parseProjectFile, remapBodyIds, runnableScenarios, scenariosFor, type ProjectConfig, type StepResult } from "../src/index.ts";

/** A small, generic API: a collection with a detail, its writes, a bulk and a public health check. */
const config: ProjectConfig = {
  name: "Orders",
  operations: [
    { id: "health", method: "GET", path: "/health", summary: "Health", tag: "Health", statuses: [200], parameters: [] },
    { id: "listOrders", method: "GET", path: "/orders", summary: "List orders", tag: "Orders", statuses: [200, 401, 403], parameters: ["limit", "status", "cursor"] },
    { id: "getOrder", method: "GET", path: "/orders/{order_id}", summary: "Get an order", tag: "Orders", statuses: [200, 401, 403, 404], parameters: ["order_id"] },
    { id: "createOrder", method: "POST", path: "/orders", summary: "Create an order", tag: "Orders", statuses: [201, 401, 403, 409, 422], parameters: [] },
    { id: "replaceOrder", method: "PUT", path: "/orders/{order_id}", summary: "Replace an order", tag: "Orders", statuses: [200, 401, 403, 404, 422], parameters: ["order_id"] },
    { id: "deleteOrder", method: "DELETE", path: "/orders/{order_id}", summary: "Delete an order", tag: "Orders", statuses: [204, 401, 403, 404], parameters: ["order_id"] },
    { id: "bulkOrders", method: "POST", path: "/orders/bulk", summary: "Bulk upsert", tag: "Orders", statuses: [200, 401, 422], parameters: [] },
  ],
  bodies: { createOrder: { body: { reference: "A-1", total: 10 } }, replaceOrder: { body: { reference: "A-1", total: 10 }, replaceBody: { reference: "A-1", total: 12 } } },
  parameterSamples: { limit: [{ value: "10" }, { value: "0", expectedStatus: 422 }] },
  plugins: { pagination: { cursorParam: "cursor", invalidValue: "%%%" } },
  auth: { publicOperations: ["health"] },
  operationScenarios: { health: [{ id: "up", name: { es: "Arriba", en: "Up" }, description: "200", expectedStatus: 200, flow: "request" }] },
  budgets: [{ path: "/health", ms: 10 }, { methods: ["GET"], ms: 100, label: "GET < 100 ms", source: "SLO" }],
};
const endpoints = buildEndpoints(config);
const byId = (id: string) => endpoints.find((endpoint) => endpoint.id === id)!;

test("kinds are derived from method and path", () => {
  assert.deepEqual(endpoints.map((endpoint) => operationKind(endpoint, config)), ["list", "list", "detail", "create", "replace", "delete", "bulk"]);
  assert.equal(byId("listOrders").implemented, true);
  assert.equal(byId("getOrder").responseShape, "{ data: Resource }");
});

test("a list gets one case per sample, the declared status per value, and the pagination plugin", () => {
  const cases = scenariosFor(byId("listOrders"), config, "en");
  assert.deepEqual(cases.map((scenario) => [scenario.id, scenario.expectedStatus]), [["default", 200], ["limit-10", 200], ["limit-0", 422], ["status-test", 200], ["cursor-test", 200], ["cursor-invalid", 422], ["auth-none", 401], ["auth-insufficient", 403]]);
  assert.deepEqual(cases.find((scenario) => scenario.id === "cursor-invalid")?.parameters, { cursor: "%%%" });
});

test("writes get their edge cases and a PUT sends its replace body", () => {
  assert.deepEqual(scenariosFor(byId("createOrder"), config).map((scenario) => scenario.id), ["create-read", "invalid-body", "conflict", "negative-body-malformed", "auth-none", "auth-insufficient"]);
  const put = scenariosFor(byId("replaceOrder"), config);
  assert.deepEqual(put.find((scenario) => scenario.id === "replace-read")?.body, { reference: "A-1", total: 12 });
  assert.deepEqual(put.find((scenario) => scenario.id === "invalid-body")?.parameters, { order_id: "1" });
  assert.deepEqual(put.find((scenario) => scenario.id === "not-found")?.parameters, { order_id: "999999" });
});

test("public operations get no auth cases and replaced scenarios are localized", () => {
  assert.deepEqual(scenariosFor(byId("health"), config, "en").map((scenario) => [scenario.id, scenario.name]), [["up", "Up"]]);
  assert.equal(runnableScenarios(byId("getOrder"), config, false).some((scenario) => scenario.auth && scenario.auth !== "default"), false);
});

test("the safe order runs reads first and deletes last", () => {
  const queue = buildQueue(endpoints, config, { mode: "safe", customOrder: [], caseSelection: {}, authEnabled: false });
  const methods = [...new Set(queue.map((item) => item.endpoint.method))];
  assert.deepEqual(methods, ["GET", "POST", "PUT", "DELETE"]);
});

test("budgets: first matching rule wins, and no rule means no budget", () => {
  assert.equal(budgetFor(config.budgets!, "GET", "/health")?.ms, 10);
  assert.deepEqual(budgetFor(config.budgets!, "GET", "/orders/{order_id}"), { ms: 100, label: "GET < 100 ms", source: "SLO" });
  assert.equal(budgetFor(config.budgets!, "POST", "/orders"), null);
  assert.equal(budgetFor([{ path: "**/bulk", ms: 5000 }], "POST", "/orders/bulk")?.label, "POST < 5000 ms");
});

test("id discovery reads the configured envelope", async () => {
  const found = await discoverIds([{ name: "order_id", path: "/orders?limit=2", operationPath: "/orders" }], async () => ({ status: 200, body: { items: [{ id: 7 }, { id: 8 }] } }), { dataKey: "items", idFallbackKey: "id" });
  assert.deepEqual(found, { ids: { order_id: "7" }, lists: { order_id: ["7", "8"] }, empty: [], failed: [] });
  assert.deepEqual(remapBodyIds({ rows: [{ order_id: 2 }] }, { order_id: ["7", "8"] }, { fields: ["order_id"], nested: ["rows"] }), { rows: [{ order_id: 8 }] });
});

test("a create-read flow reads back what it created and deletes it, without an envelope", async () => {
  const bare: ProjectConfig = { ...config, envelope: { dataKey: "" } };
  const list = buildEndpoints(bare);
  const sent: string[] = [];
  const execute = async (item: (typeof list)[number], scenario: { expectedStatus: number; body?: Record<string, unknown> }, parameters: Record<string, string> = {}): Promise<StepResult> => {
    sent.push(`${item.method} ${item.path} ${JSON.stringify(parameters)}`);
    const body = item.method === "DELETE" ? null : { ...(scenario.body ?? {}), order_id: 42, reference: "A-1", total: 10 };
    return { ok: true, durationMs: 1, request: { method: item.method, url: item.path, body: scenario.body ?? null }, actual: { status: scenario.expectedStatus, body }, assertions: [] };
  };
  const runner = createScenarioRunner(list, bare, execute);
  const create = list.find((endpoint) => endpoint.id === "createOrder")!;
  const result = await runner.runScenario(create, scenariosFor(create, bare)[0]);
  assert.equal(result.ok, true);
  assert.deepEqual(sent, ["POST /orders {}", "GET /orders/{order_id} {\"order_id\":\"42\"}", "DELETE /orders/{order_id} {\"order_id\":\"42\"}"]);
});

/** The same API with the input schemas an OpenAPI import would have stored. */
const withSchemas: ProjectConfig = {
  ...config,
  requestSchemas: {
    createOrder: { body: { type: "object", required: ["reference", "total"], additionalProperties: false, properties: { order_id: { type: "integer", readOnly: true }, reference: { type: "string", minLength: 1, maxLength: 8 }, total: { type: "number", minimum: 0 }, status: { type: "string", enum: ["open", "shipped"] }, email: { type: ["string", "null"], format: "email" } } } },
    listOrders: { parameters: { limit: { type: "integer", minimum: 1, maximum: 100 }, status: { type: "string", enum: ["open", "shipped"] }, cursor: { type: "string" } } },
    getOrder: { parameters: { order_id: { type: "integer", minimum: 1 } } },
    replaceOrder: { body: { type: "object", required: ["reference"], properties: { reference: { type: "string" } } }, parameters: { order_id: { type: "integer", minimum: 1 } } },
  },
};
const schemaEndpoints = buildEndpoints(withSchemas);
const schemaEndpoint = (id: string) => schemaEndpoints.find((endpoint) => endpoint.id === id)!;

test("negative cases break one thing at a time, one kind of each before a second of any", () => {
  const cases = negativeScenarios(schemaEndpoint("createOrder"), withSchemas, "en");
  assert.deepEqual(cases.map((scenario) => scenario.id), [
    "negative-body-malformed", "negative-body-missing-reference", "negative-body-type-reference", "negative-body-null-reference", "negative-body-min-length-reference", "negative-body-max-length-reference", "negative-body-minimum-total", "negative-body-enum-status", "negative-body-format-email", "negative-body-extra",
  ]);
  const byCase = Object.fromEntries(cases.map((scenario) => [scenario.id, scenario]));
  assert.deepEqual(byCase["negative-body-missing-reference"].body, { total: 10 });
  assert.deepEqual(byCase["negative-body-type-reference"].body, { reference: 12345, total: 10 });
  assert.deepEqual(byCase["negative-body-minimum-total"].body, { reference: "A-1", total: -1 });
  assert.equal(byCase["negative-body-max-length-reference"].body?.reference, "xxxxxxxxx");
  assert.equal(byCase["negative-body-malformed"].rawBody, '{"reference":"A-1","total":10');
  assert.equal(byCase["negative-body-extra"].body?.eq_unexpected_field, "x");
  // 401, 403 and 409 are not a verdict on the input: only the 422 the operation declares counts.
  assert.ok(cases.every((scenario) => scenario.flow === "negative" && scenario.expectedStatus === 422 && scenario.expectedStatuses?.join() === "422"));
  assert.deepEqual(negativeScenarios(schemaEndpoint("createOrder"), withSchemas, "en"), cases, "deterministic");
});

test("negative parameters: a wrong type, a bound and an enum, in the query and in the path", () => {
  assert.deepEqual(negativeScenarios(schemaEndpoint("listOrders"), withSchemas, "en").map((scenario) => [scenario.id, scenario.parameters]), [
    ["negative-query-type-limit", { limit: "abc" }], ["negative-query-minimum-limit", { limit: "0" }], ["negative-query-maximum-limit", { limit: "101" }], ["negative-query-enum-status", { status: "not-in-enum" }],
  ]);
  const detail = negativeScenarios(schemaEndpoint("getOrder"), withSchemas, "en");
  assert.deepEqual(detail.map((scenario) => [scenario.id, scenario.parameters?.order_id, scenario.expectedStatuses]), [["negative-path-type-order_id", "abc", [404]], ["negative-path-minimum-order_id", "0", [404]]]);
  // Without a 4xx of its own that judges input, an operation falls back to 400 or 422.
  assert.deepEqual(negativeScenarios(schemaEndpoint("listOrders"), withSchemas, "en")[0].expectedStatuses, [400, 422]);
});

test("negative cases: a cap, an opt-out per operation, a switch for the project, statuses of its own", () => {
  const cap = (negativeCases: ProjectConfig["negativeCases"]) => negativeScenarios(schemaEndpoint("createOrder"), { ...withSchemas, negativeCases }, "en");
  assert.deepEqual(cap({ maxPerOperation: 3 }).map((scenario) => scenario.id), ["negative-body-malformed", "negative-body-missing-reference", "negative-body-type-reference"]);
  assert.deepEqual(cap({ exclude: ["createOrder"] }), []);
  assert.deepEqual(cap({ enabled: false }), []);
  assert.deepEqual(cap({ statuses: [400] })[0].expectedStatuses, [400]);
  assert.equal(scenariosFor(schemaEndpoint("createOrder"), { ...withSchemas, negativeCases: { enabled: false } }).some((scenario) => scenario.negative), false);
  assert.throws(() => parseProjectFile({ ...withSchemas, negativeCases: { maxPerOperation: -1, exclude: ["nope"] } }), /maxPerOperation[\s\S]*no such operation "nope"/);
});

test("a negative case accepts any of its statuses, and names a 2xx and a 5xx for what they are", async () => {
  clearSpecCache();
  const answer = (status: number) => (async (url: URL | RequestInfo) => String(url).endsWith("/openapi.json")
    ? new Response("{}", { status: 404 })
    : new Response(JSON.stringify({ type: "about:blank", title: "x", status, detail: "x" }), { status, headers: { "Content-Type": "application/problem+json" } })) as typeof fetch;
  const run = (status: number) => executeCase({ baseUrl: "http://api.test", method: "POST", path: "/orders", operationPath: "/orders", expectedStatus: 422, expectedStatuses: [404, 422], rawBody: "{", responseShape: "ProblemDetails", locale: "en" }, answer(status));
  const rejected = await run(404);
  assert.equal(rejected.ok, true);
  assert.equal(rejected.request.body, "{");
  assert.equal(rejected.assertions[0].label, "Status 404 | 422");
  assert.match((await run(500)).assertions[0].detail, /never a server error/);
  assert.match((await run(201)).assertions[0].detail, /accepted invalid input/);
});

test("a negative write that is wrongly accepted is undone: a POST deletes what it created, a PUT runs over its own row", async () => {
  const sent: string[] = [];
  const execute = async (item: (typeof schemaEndpoints)[number], scenario: { flow: string; expectedStatus: number; body?: Record<string, unknown> }, parameters: Record<string, string> = {}): Promise<StepResult> => {
    sent.push(`${item.method} ${item.path} ${JSON.stringify(parameters)}`);
    // An API that accepts everything.
    const status = item.method === "DELETE" ? 204 : item.method === "POST" ? 201 : 200;
    return { ok: scenario.flow !== "negative", durationMs: 1, request: { method: item.method, url: item.path, body: scenario.body ?? null }, actual: { status, body: item.method === "DELETE" ? null : { data: { order_id: 42 } } }, assertions: [] };
  };
  const runner = createScenarioRunner(schemaEndpoints, withSchemas, execute);
  const created = await runner.runScenario(schemaEndpoint("createOrder"), negativeScenarios(schemaEndpoint("createOrder"), withSchemas, "en")[1]);
  assert.equal(created.ok, false);
  assert.deepEqual(sent.splice(0), ["POST /orders {}", "DELETE /orders/{order_id} {\"order_id\":\"42\"}"]);
  const replaced = await runner.runScenario(schemaEndpoint("replaceOrder"), negativeScenarios(schemaEndpoint("replaceOrder"), withSchemas, "en").find((scenario) => scenario.id === "negative-body-missing-reference")!);
  assert.equal(replaced.ok, false);
  assert.deepEqual(sent.splice(0), ["POST /orders {}", "PUT /orders/{order_id} {\"order_id\":\"42\"}", "DELETE /orders/{order_id} {\"order_id\":\"42\"}"]);
  // A fault in the id itself has no row to protect: it goes out as it is.
  await runner.runScenario(schemaEndpoint("replaceOrder"), negativeScenarios(schemaEndpoint("replaceOrder"), withSchemas, "en").find((scenario) => scenario.id === "negative-path-type-order_id")!);
  assert.deepEqual(sent.splice(0), ["PUT /orders/{order_id} {}"]);
});
