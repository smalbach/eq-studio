import assert from "node:assert/strict";
import test from "node:test";
import { budgetFor, buildEndpoints, buildQueue, createScenarioRunner, discoverIds, operationKind, remapBodyIds, runnableScenarios, scenariosFor, type ProjectConfig, type StepResult } from "../src/index.ts";

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
  assert.deepEqual(scenariosFor(byId("createOrder"), config).map((scenario) => scenario.id), ["create-read", "invalid-body", "conflict", "auth-none", "auth-insufficient"]);
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
