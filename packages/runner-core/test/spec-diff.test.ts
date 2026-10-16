import assert from "node:assert/strict";
import test from "node:test";
import { changesByOperation, describeChange, diffSpecs, type SpecChange } from "../src/index.ts";

/** A small orders API; each test edits a copy of it. */
function base() {
  return {
    openapi: "3.1.0",
    info: { title: "Orders", version: "1.0.0" },
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
      schemas: {
        Order: { type: "object", required: ["id", "status"], properties: { id: { type: "string" }, status: { $ref: "#/components/schemas/Status" }, total: { type: "integer" }, lines: { type: "array", items: { type: "object", properties: { sku: { type: "string" } } } } } },
        Status: { type: "string", enum: ["open", "paid"] },
        NewOrder: { type: "object", required: ["reference"], properties: { reference: { type: "string" }, note: { type: "string" }, status: { $ref: "#/components/schemas/Status" } } },
      },
      parameters: { Limit: { name: "limit", in: "query", schema: { type: "integer" } } },
    },
    paths: {
      "/health": { get: { operationId: "health", security: [], responses: { 200: { description: "ok" } } } },
      "/orders": {
        get: { operationId: "listOrders", parameters: [{ $ref: "#/components/parameters/Limit" }, { name: "status", in: "query", schema: { $ref: "#/components/schemas/Status" } }], responses: { 200: { description: "ok", content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Order" } } } } } } }, 401: { description: "no" } } },
        post: { operationId: "createOrder", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/NewOrder" } } } }, responses: { 201: { description: "created", content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } } } },
      },
      "/orders/{order_id}": { parameters: [{ name: "order_id", in: "path", required: true, schema: { type: "string" } }], get: { operationId: "getOrder", responses: { 200: { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } }, 404: { description: "missing" } } } },
    },
  };
}
type Spec = ReturnType<typeof base>;
const edit = (change: (spec: Spec) => void) => { const spec = structuredClone(base()); change(spec); return spec; };
const brief = (changes: SpecChange[]) => changes.map((change) => [change.kind, change.breaking, [change.method, change.path, change.location, change.pointer].filter(Boolean).join(" ")]);

test("the same document has no changes", () => {
  assert.deepEqual(diffSpecs(base(), base()), { changes: [], summary: { breaking: 0, nonBreaking: 0, operationsAdded: 0, operationsRemoved: 0, operationsChanged: 0 } });
});

test("operations removed break; added do not; renaming a path parameter is not a change", () => {
  const after = edit((spec) => {
    delete (spec.paths as Record<string, unknown>)["/health"];
    (spec.paths as Record<string, unknown>)["/orders/{id}"] = { ...spec.paths["/orders/{order_id}"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }] };
    delete (spec.paths as Record<string, unknown>)["/orders/{order_id}"];
    (spec.paths as Record<string, unknown>)["/refunds"] = { get: { responses: { 200: { description: "ok" } } } };
  });
  const diff = diffSpecs(base(), after);
  assert.deepEqual(brief(diff.changes), [
    ["parameter-added", true, "GET /orders/{id} path.id"],
    ["parameter-removed", false, "GET /orders/{id} path.order_id"],
    ["operation-added", false, "GET /refunds"],
    ["operation-removed", true, "GET /health"],
  ]);
  assert.deepEqual(diff.summary, { breaking: 2, nonBreaking: 2, operationsAdded: 1, operationsRemoved: 1, operationsChanged: 1 });
});

test("parameters: a new required one breaks, an optional one does not, a narrower type and a removed enum value break", () => {
  const after = edit((spec) => {
    const list = spec.paths["/orders"].get;
    list.parameters.push({ name: "X-Tenant", in: "header", required: true, schema: { type: "string" } } as never, { name: "q", in: "query", schema: { type: "string" } } as never);
    spec.components.parameters.Limit.schema = { type: "string" };
    spec.components.schemas.Status.enum = ["open", "paid", "refunded"];
  });
  const changes = diffSpecs(base(), after).changes.filter((change) => change.operationId === "listOrders");
  assert.deepEqual(brief(changes), [
    ["type-changed", true, "GET /orders query.limit $"],
    ["enum-value-added", false, "GET /orders query.status $"],
    ["parameter-added", true, "GET /orders header.x-tenant"],
    ["parameter-added", false, "GET /orders query.q"],
    ["enum-value-added", true, "GET /orders response 200 $.data[].status"],
  ]);
  const removed = diffSpecs(base(), edit((spec) => { spec.components.schemas.Status.enum = ["open"]; })).changes;
  assert.deepEqual(brief(removed.filter((change) => change.kind === "enum-value-removed")), [
    ["enum-value-removed", true, "GET /orders query.status $"],
    ["enum-value-removed", false, "GET /orders response 200 $.data[].status"],
    ["enum-value-removed", true, "POST /orders request $.status"],
    ["enum-value-removed", false, "POST /orders response 201 $.status"],
    ["enum-value-removed", false, "GET /orders/{order_id} response 200 $.status"],
  ]);
});

test("request bodies: a new required field breaks, a new optional or removed one does not, a wider type does not", () => {
  const after = edit((spec) => {
    const order = spec.components.schemas.NewOrder as { required: string[]; properties: Record<string, unknown> };
    order.required.push("currency");
    order.properties.currency = { type: "string" };
    order.properties.channel = { type: "string" };
    delete order.properties.note;
    order.properties.reference = { type: ["string", "null"] };
  });
  assert.deepEqual(brief(diffSpecs(base(), after).changes.filter((change) => change.location === "request")), [
    ["field-added", true, "POST /orders request $.currency"],
    ["field-added", false, "POST /orders request $.channel"],
    ["field-removed", false, "POST /orders request $.note"],
    ["type-changed", false, "POST /orders request $.reference"],
  ]);
  const required = diffSpecs(base(), edit((spec) => { spec.components.schemas.NewOrder.required.push("note"); })).changes;
  assert.deepEqual(brief(required), [["field-required", true, "POST /orders request $.note"]]);
});

test("responses: a removed status, a removed field, a changed type and a field no longer guaranteed break", () => {
  const after = edit((spec) => {
    delete (spec.paths["/orders/{order_id}"].get.responses as Record<string, unknown>)["404"];
    (spec.paths["/orders/{order_id}"].get.responses as Record<string, unknown>)["410"] = { description: "gone" };
    const order = spec.components.schemas.Order as { required: string[]; properties: Record<string, unknown> };
    delete order.properties.total;
    order.properties.lines = { type: "array", items: { type: "object", properties: { sku: { type: "integer" } } } };
    order.properties.createdAt = { type: "string" };
    order.required = ["id"];
  });
  assert.deepEqual(brief(diffSpecs(base(), after).changes.filter((change) => change.operationId === "getOrder")), [
    ["field-added", false, "GET /orders/{order_id} response 200 $.createdAt"],
    ["field-removed", true, "GET /orders/{order_id} response 200 $.total"],
    ["field-optional", true, "GET /orders/{order_id} response 200 $.status"],
    ["type-changed", true, "GET /orders/{order_id} response 200 $.lines[].sku"],
    ["response-removed", true, "GET /orders/{order_id} response 404"],
    ["response-added", false, "GET /orders/{order_id} response 410"],
  ]);
});

test("allOf is merged, so moving properties into a shared part is not a change", () => {
  const after = edit((spec) => {
    (spec.components.schemas as Record<string, unknown>).Base = { type: "object", required: ["id"], properties: { id: { type: "string" } } };
    spec.components.schemas.Order = { allOf: [{ $ref: "#/components/schemas/Base" }, { type: "object", required: ["status"], properties: { status: { $ref: "#/components/schemas/Status" }, total: { type: "integer" }, lines: spec.components.schemas.Order.properties.lines } }] } as never;
  });
  assert.deepEqual(diffSpecs(base(), after).changes, []);
});

test("security: requiring a credential or dropping a scheme breaks; going public or adding an alternative does not", () => {
  const after = edit((spec) => {
    (spec.paths["/health"].get as { security?: unknown }).security = undefined;
    (spec.paths["/orders"].post as Record<string, unknown>).security = [{ bearer: [] }, { apiKey: [] }];
    (spec.paths["/orders/{order_id}"].get as Record<string, unknown>).security = [{ oauth: ["orders:read"] }];
    (spec.paths["/orders"].get as Record<string, unknown>).security = [];
  });
  assert.deepEqual(diffSpecs(base(), after).changes.map((change) => [change.operationId, change.kind, change.breaking]), [
    ["health", "security-added", true],
    ["listOrders", "security-removed", false],
    ["createOrder", "security-changed", false],
    ["getOrder", "security-changed", true],
  ]);
});

test("a request body that becomes required breaks; one added as optional does not", () => {
  const optional = edit((spec) => { (spec.paths["/orders"].post.requestBody as { required: boolean }).required = false; });
  assert.deepEqual(brief(diffSpecs(optional, base()).changes), [["request-body-required", true, "POST /orders request"]]);
  const withBody = edit((spec) => { (spec.paths["/health"].get as Record<string, unknown>).requestBody = { content: { "application/json": { schema: { type: "object" } } } }; });
  assert.deepEqual(brief(diffSpecs(base(), withBody).changes), [["request-body-added", false, "GET /health request"]]);
  assert.deepEqual(brief(diffSpecs(withBody, base()).changes), [["request-body-removed", false, "GET /health request"]]);
});

test("changes group by operation, and every change has a sentence in both languages", () => {
  const after = edit((spec) => { delete (spec.paths as Record<string, unknown>)["/health"]; spec.components.parameters.Limit = { ...spec.components.parameters.Limit, required: true } as never; });
  const diff = diffSpecs(base(), after);
  const groups = changesByOperation(diff.changes);
  assert.deepEqual(groups.map((group) => [group.method, group.path, group.breaking, group.changes.length]), [["GET", "/orders", true, 1], ["GET", "/health", true, 1]]);
  assert.equal(describeChange(diff.changes[0]), "query.limit: parameter became required");
  assert.equal(describeChange(diff.changes[0], "es"), "query.limit: el parámetro pasa a ser obligatorio");
  assert.equal(describeChange(diff.changes[1]), "operation removed");
});

test("anything but OpenAPI 3 is refused", () => {
  assert.throws(() => diffSpecs({ swagger: "2.0" }, base()), /old document is not OpenAPI 3/);
  assert.throws(() => diffSpecs(base(), {}), /new document is not OpenAPI 3/);
});
