import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { contractFormatOf, dereference, postmanEnvironmentVariables, projectFromOpenApi, responseSchema, toOpenApi3, validateJson } from "../src/index.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- converted documents are read loosely by the tests
type Json = Record<string, any>;

test("each accepted format is recognized by the field it must carry", () => {
  assert.equal(contractFormatOf(fixture("store.openapi31.json")), "openapi");
  assert.equal(contractFormatOf(fixture("petstore.swagger2.json")), "swagger");
  assert.equal(contractFormatOf(fixture("store.postman_collection.json")), "postman");
  assert.equal(contractFormatOf(fixture("store.postman_environment.json")), null);
  assert.throws(() => toOpenApi3({ swagger: "1.2" }), /only Swagger 2.0/);
  assert.throws(() => toOpenApi3({ hello: "world" }), /Not an OpenAPI 3, Swagger 2.0 or Postman collection/);
});

test("Swagger 2.0 converts to OpenAPI 3.0: servers, components, bodies, forms, responses and security", () => {
  const { document, format, warnings } = toOpenApi3(fixture("petstore.swagger2.json"));
  const doc = document as Json;
  assert.equal(format, "swagger");
  assert.match(warnings[0], /Swagger 2.0/);
  assert.equal(doc.openapi, "3.0.3");
  assert.deepEqual(doc.servers, [{ url: "https://petstore.example.com/v2" }]);
  assert.equal(doc.swagger, undefined);
  assert.equal(doc.components.schemas.NewPet.properties.tag.nullable, true);
  assert.equal(doc.components.schemas.Pet.allOf[0].$ref, "#/components/schemas/NewPet");
  assert.deepEqual(doc.components.parameters.petId.schema, { type: "integer", format: "int64", minimum: 1 });
  assert.equal(doc.components.parameters.petBody, undefined, "a body parameter is not a parameter in 3.0");
  assert.deepEqual(doc.components.securitySchemes.api_key, { type: "apiKey", name: "X-API-Key", in: "header" });
  assert.deepEqual(Object.keys(doc.components.securitySchemes.oauth.flows), ["authorizationCode"]);

  const list = doc.paths["/pets"].get;
  assert.deepEqual(list.parameters[1], { name: "tags", in: "query", schema: { type: "array", items: { type: "string" } }, style: "form", explode: false });
  assert.equal(list.responses["200"].content["application/json"].schema.properties.data.items.$ref, "#/components/schemas/Pet");
  assert.deepEqual(list.responses["200"].headers["X-Total"], { schema: { type: "integer" } });
  assert.deepEqual(list.security, []);
  assert.deepEqual(doc.paths["/pets"].post.requestBody, { content: { "application/json": { schema: { $ref: "#/components/schemas/NewPet" } } }, required: true });
  assert.deepEqual(doc.paths["/pets/{petId}"].parameters, [{ $ref: "#/components/parameters/petId" }]);
  assert.deepEqual(doc.paths["/pets/{petId}"].get.responses["200"].content["application/json"].example, { id: 1, name: "Rex", tag: null });
  assert.equal(doc.paths["/pets/{petId}"].get.responses["404"].$ref, "#/components/responses/NotFound");
  const upload = doc.paths["/pets/{petId}/photo"].post;
  assert.deepEqual(upload.parameters, [{ $ref: "#/components/parameters/petId" }]);
  assert.deepEqual(upload.requestBody.content["multipart/form-data"].schema, { type: "object", properties: { file: { type: "string", format: "binary" }, caption: { type: "string" } }, required: ["file"] });

  // The converted document drives the run's schema validation like any OpenAPI 3 one.
  const schema = responseSchema(doc, "/pets/{petId}", "GET", 200);
  assert.deepEqual(validateJson({ id: 1, name: "Rex", tag: null }, schema), []);
  assert.equal(validateJson({ id: 1 }, schema, "$", [], "en")[0], "$.name: required field");
  assert.ok(responseSchema(doc, "/pets/{petId}", "GET", 404));
});

test("Swagger 2.0 imports as a project, and the same file always gives the same document", () => {
  const imported = projectFromOpenApi(fixture("petstore.swagger2.json"));
  assert.equal(imported.config.name, "Petstore");
  assert.equal(imported.config.contractVersion, "1.2.0");
  assert.deepEqual(imported.config.operations.map((operation) => `${operation.method} ${operation.path}`), ["GET /pets", "POST /pets", "GET /pets/{petId}", "DELETE /pets/{petId}", "POST /pets/{petId}/photo"]);
  assert.deepEqual(imported.config.auth?.publicOperations, ["listPets"]);
  assert.deepEqual(imported.config.bodies?.createPet, { body: { name: "Rex" } });
  assert.deepEqual(imported.config.operations.find((operation) => operation.id === "getPet")?.parameters, ["petId"]);
  assert.match(imported.warnings[0], /Swagger 2.0/);
  assert.equal(JSON.stringify(toOpenApi3(fixture("petstore.swagger2.json")).document), JSON.stringify(toOpenApi3(fixture("petstore.swagger2.json")).document));
});

test("Swagger 2.0 with no host keeps the base path as a relative server, and a local host is http", () => {
  assert.deepEqual((toOpenApi3({ swagger: "2.0", info: { title: "x", version: "1" }, basePath: "/api", paths: {} }).document as Json).servers, [{ url: "/api" }]);
  assert.deepEqual((toOpenApi3({ swagger: "2.0", info: { title: "x", version: "1" }, host: "localhost:8080", paths: {} }).document as Json).servers, [{ url: "http://localhost:8080" }]);
});

test("OpenAPI 3.1 imports: type arrays, examples, const and $ref siblings", () => {
  const spec = fixture("store.openapi31.json");
  const imported = projectFromOpenApi(spec);
  assert.deepEqual(imported.warnings, []);
  assert.deepEqual(imported.config.operations.map((operation) => operation.id), ["listOrders", "createOrder", "getOrder"]);
  // `type: [integer, "null"]` is an integer parameter, and `examples` gives its value.
  assert.deepEqual(imported.config.parameterSamples?.limit, [{ value: "10" }, { value: "0", expectedStatus: 422, description: { es: "Comprueba un valor fuera de rango.", en: "Checks an out-of-range value." } }, { value: "51", expectedStatus: 422, description: { es: "Comprueba un valor fuera de rango.", en: "Checks an out-of-range value." } }]);
  assert.deepEqual(imported.config.bodies?.createOrder, { body: { kind: "order", total: 12.5 } });
  assert.equal(imported.config.envelope?.dataKey, "data");
  const created = responseSchema(spec, "/v1/orders", "POST", 201) as Json;
  assert.equal(created.description, "The order as stored");
  assert.equal(created.additionalProperties, false);
});

test("OpenAPI 3.1 schemas validate with JSON Schema 2020-12 keywords", () => {
  const spec = fixture("store.openapi31.json");
  const schema = responseSchema(spec, "/v1/orders/{order_id}", "GET", 200);
  const valid = { id: "00000000-0000-4000-8000-000000000001", kind: "order", total: 3, note: null, lines: [{ sku: "ABC-1", qty: 1 }], meta: { "x-source": "web" } };
  assert.deepEqual(validateJson(valid, schema), []);
  const errors = (value: Json) => validateJson({ ...valid, ...value }, schema, "$", [], "en");
  assert.deepEqual(errors({ kind: "refund" }), ["$.kind: must be \"order\""]);
  assert.deepEqual(errors({ total: 0 }), ["$.total: must be greater than 0"]);
  assert.deepEqual(errors({ note: 5 }), ["$.note: expected type string | null"]);
  assert.deepEqual(errors({ lines: [] }), ["$.lines: fewer than 1 items"]);
  assert.deepEqual(errors({ lines: [{ sku: "nope" }] }), ["$.lines[0].sku: does not match the pattern"]);
  assert.deepEqual(errors({ lines: [{ sku: "ABC-1" }, { sku: "ABC-2", qty: 0 }] }), ["$.lines[1].qty: less than 1"]);
  assert.deepEqual(errors({ meta: { "x-a": 1, other: "b" } }), ["$.meta.x-a: expected type string", "$.meta.other: additional field not allowed"]);
  assert.deepEqual(errors({ extra: true }), ["$.extra: additional field not allowed"]);
});

test("the validator covers the remaining keywords both OpenAPI versions use", () => {
  const en = (value: unknown, schema: unknown) => validateJson(value, schema, "$", [], "en");
  assert.deepEqual(en(null, { type: "string", nullable: true }), []);
  assert.deepEqual(en(null, { type: "string" }), ["$: expected type string"]);
  assert.deepEqual(en(5, { type: "integer", minimum: 5, exclusiveMinimum: true }), ["$: must be greater than 5"]);
  assert.deepEqual(en(10, { type: "integer", exclusiveMaximum: 10 }), ["$: must be less than 10"]);
  assert.deepEqual(en(0.3, { multipleOf: 0.1 }), []);
  assert.deepEqual(en(7, { multipleOf: 2 }), ["$: not a multiple of 2"]);
  assert.deepEqual(en([1, 1], { uniqueItems: true }), ["$: repeated items"]);
  assert.deepEqual(en("a", false), ["$: no value is allowed"]);
  assert.deepEqual(en("a", true), []);
  assert.deepEqual(en("a", { not: { type: "string" } }), ["$: matches a forbidden schema (not)"]);
  assert.deepEqual(en({ a: 1 }, { additionalProperties: { type: "string" } }), ["$.a: expected type string"]);
  assert.deepEqual(en({ card: 1 }, { dependentRequired: { card: ["cvc"] } }), ["$.cvc: required when card is present"]);
  assert.deepEqual(en({ kind: "a" }, { if: { properties: { kind: { const: "a" } } }, then: { required: ["a"] }, else: { required: ["b"] } }), ["$.a: required field"]);
  assert.deepEqual(en([1, "x"], { contains: { type: "string" } }), []);
  assert.deepEqual(dereference({ $ref: "#/paths/~1v1~1x/get" }, { paths: { "/v1/x": { get: { ok: true } } } }), { ok: true });
});

test("a Postman collection becomes an OpenAPI 3 document: paths, parameters, bodies, folders and auth", () => {
  const { document, format, warnings, baseUrl } = toOpenApi3(fixture("store.postman_collection.json"));
  const doc = document as Json;
  assert.equal(format, "postman");
  assert.match(warnings[0], /inferred/);
  assert.equal(baseUrl, "http://127.0.0.1:4010");
  assert.deepEqual(doc.servers, [{ url: "http://127.0.0.1:4010" }]);
  assert.equal(doc.info.title, "Store collection");
  assert.deepEqual(Object.keys(doc.paths), ["/health", "/v1/orders", "/v1/orders/{orderId}", "/v1/orders/{order_id}/items/{item_id}"]);
  assert.deepEqual(doc.components.securitySchemes, { bearerAuth: { type: "http", scheme: "bearer" } });
  assert.deepEqual(doc.security, [{ bearerAuth: [] }]);
  assert.deepEqual(doc.paths["/health"].get.security, []);
  assert.equal(doc.paths["/health"].get.tags, undefined);

  const list = doc.paths["/v1/orders"].get;
  assert.equal(list.operationId, "listOrders");
  assert.deepEqual(list.tags, ["Orders"]);
  assert.deepEqual(list.parameters, [
    { name: "limit", in: "query", required: false, schema: { type: "integer" }, example: 10 },
    { name: "status", in: "query", required: false, schema: { type: "string" }, example: "open" },
    { name: "X-Request-Id", in: "header", required: false, schema: { type: "string" }, example: "abc" },
  ]);
  assert.deepEqual(list.responses["200"].content["application/json"].schema.properties.data.items.properties, { id: { type: "string" }, total: { type: "number" }, created_at: { type: "string", format: "date-time" }, note: { nullable: true } });

  const get = doc.paths["/v1/orders/{orderId}"].get;
  assert.deepEqual(get.parameters, [{ name: "orderId", in: "path", required: true, schema: { type: "integer" }, example: 42 }]);
  assert.deepEqual(Object.keys(get.responses), ["200", "404"]);

  const create = doc.paths["/v1/orders"].post;
  assert.deepEqual(create.requestBody.content["application/json"].example, { reference: "A-1", total: "{{total}}", owner: "{{owner}}" });
  assert.deepEqual(create.responses, { "201": { description: "Not stated in the collection: no saved response." } });

  const remove = doc.paths["/v1/orders/{order_id}/items/{item_id}"].delete;
  assert.deepEqual(remove.tags, ["Order items"]);
  assert.deepEqual(remove.parameters.map((parameter: Json) => [parameter.name, parameter.example]), [["order_id", 42], ["item_id", 7]]);

  // A saved response is a schema the run validates against.
  assert.deepEqual(validateJson({ data: [{ id: "1", total: 3, created_at: "2030-01-01T00:00:00Z", note: "x" }] }, responseSchema(doc, "/v1/orders", "GET", 200)), []);
  assert.equal(validateJson({ data: [{ id: 1 }] }, responseSchema(doc, "/v1/orders", "GET", 200), "$", [], "en")[0], "$.data[0].id: expected type string");
});

test("a Postman collection imports as a project; an environment's variables decide the base URL", () => {
  const collection = fixture("store.postman_collection.json");
  const imported = projectFromOpenApi(collection);
  assert.equal(imported.config.name, "Store collection");
  assert.deepEqual(imported.config.operations.map((operation) => `${operation.id} ${operation.method} ${operation.path} ${operation.statuses.join(",")}`), [
    "health GET /health 200",
    "listOrders GET /v1/orders 200",
    "createOrder POST /v1/orders 201",
    "getOrder GET /v1/orders/{orderId} 200,404",
    "deleteItem DELETE /v1/orders/{order_id}/items/{item_id} 204",
  ]);
  assert.deepEqual(imported.config.auth?.publicOperations, ["health"]);
  assert.deepEqual(imported.config.bodies?.createOrder, { body: { reference: "A-1", total: "{{total}}", owner: "{{owner}}" } });
  const staging = postmanEnvironmentVariables(fixture("store.postman_environment.json"));
  assert.deepEqual(staging, { baseUrl: "https://staging.example.com" });
  assert.equal(toOpenApi3(collection, { variables: staging }).baseUrl, "https://staging.example.com");
  const unresolved = toOpenApi3({ ...collection, variable: [] });
  assert.equal(unresolved.baseUrl, undefined);
  assert.ok(unresolved.warnings.some((warning) => warning.includes("{{baseUrl}} has no value")));
});

test("Postman v2.0 string URLs, literal hosts and duplicate requests", () => {
  const { document, warnings } = toOpenApi3({ info: { name: "Old", schema: "https://schema.getpostman.com/json/collection/v2.0.0/collection.json" }, item: [
    { name: "Users", request: { method: "GET", url: "https://api.example.com/users/:id?expand=true" } },
    { name: "Users again", request: { method: "GET", url: "https://api.example.com/users/:id" } },
    { name: "Bad body", request: { method: "POST", url: "https://api.example.com/users", body: { mode: "raw", raw: "{ not json" } } },
  ] });
  const doc = document as Json;
  assert.deepEqual(doc.servers, [{ url: "https://api.example.com" }]);
  assert.deepEqual(doc.paths["/users/{id}"].get.parameters.map((parameter: Json) => [parameter.name, parameter.in, parameter.example]), [["id", "path", undefined], ["expand", "query", true]]);
  assert.ok(warnings.some((warning) => warning.includes("already declared")));
  assert.ok(warnings.some((warning) => warning.includes("not valid JSON")));
});
