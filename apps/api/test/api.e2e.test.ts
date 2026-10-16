import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { databases, start, type Harness } from "./helpers.ts";

const example = JSON.parse(readFileSync(new URL("../../../examples/mock-store/mock-store.eq.json", import.meta.url), "utf8"));

for (const database of databases()) {
  describe(`API over ${database.name}`, () => {
    let h: Harness;
    before(async () => { h = await start(database.config()); });
    after(async () => { await h?.close(); });

    test("health answers with the mode and the engine", async () => {
      const { status, body } = await h.request("GET", "/health");
      assert.equal(status, 200);
      assert.deepEqual(body, { status: "ok", mode: "local", database: database.config().type, auth: "none", registration: "invite" });
    });

    test("a project from its contract's URL: operations, generated config and an environment in one call", async () => {
      const created = await h.request("POST", "/v1/projects", { spec: { url: `${h.mock}/openapi.json` }, environments: [{ name: "Local", baseUrl: h.mock }] });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.slug, "mock-store-api");
      const project = await h.request("GET", "/v1/projects/mock-store-api");
      assert.equal(project.body.operationCount, example.project.operations.length);
      assert.deepEqual(project.body.file.project.operations.map((operation: { id: string }) => operation.id), example.project.operations.map((operation: { id: string }) => operation.id));
      assert.ok(Object.keys(project.body.file.project.bodies).length > 0, "sample bodies were generated");
      assert.equal(project.body.file.project.envelope.dataKey, "data");
      assert.equal(project.body.file.environments[0].baseUrl, h.mock);
      assert.equal(project.body.file.project.plugins.geo.radius, "radius_km", "the geographic search was detected");
    });

    test("the same contract imported again is the same version; activating an older one is a rollback", async () => {
      const again = await h.request("POST", "/v1/projects/mock-store-api/spec-versions", { source: { url: `${h.mock}/openapi.json` } });
      assert.equal(again.status, 201);
      assert.equal(again.body.created, false);
      const spec = await (await fetch(`${h.mock}/openapi.json`)).json() as { info: { version: string }; paths: Record<string, unknown> };
      spec.info.version = "1.1.0";
      delete spec.paths["/health"];
      const changed = await h.request("POST", "/v1/projects/mock-store-api/spec-versions", { source: { document: spec } });
      assert.equal(changed.body.created, true);
      assert.equal(changed.body.operationCount, example.project.operations.length - 1);
      assert.equal(again.body.diff, null, "an existing version brings no diff");
      assert.deepEqual(changed.body.diff.summary, { breaking: 1, nonBreaking: 0, operationsAdded: 0, operationsRemoved: 1, operationsChanged: 0 });
      const diff = await h.request("GET", "/v1/projects/mock-store-api/specs/diff");
      assert.equal(diff.status, 200, JSON.stringify(diff.body));
      assert.equal(diff.body.from.version, "1.0.0");
      assert.equal(diff.body.to.id, changed.body.id);
      assert.deepEqual(diff.body.changes.map((change: { kind: string; path: string; breaking: boolean }) => [change.kind, change.path, change.breaking]), [["operation-removed", "/health", true]]);
      const reverse = await h.request("GET", `/v1/projects/mock-store-api/spec-versions/diff?from=${changed.body.id}&to=${diff.body.from.id}`);
      assert.deepEqual(reverse.body.summary, { breaking: 0, nonBreaking: 1, operationsAdded: 1, operationsRemoved: 0, operationsChanged: 0 });
      assert.equal((await h.request("GET", "/v1/projects/mock-store-api/specs/diff?from=nope")).status, 404);
      const versions = await h.request("GET", "/v1/projects/mock-store-api/spec-versions");
      assert.deepEqual(versions.body.map((version: { version: string; active: boolean }) => [version.version, version.active]), [["1.1.0", true], ["1.0.0", false]]);
      assert.equal(versions.body[0].document, undefined, "the listing leaves the documents out");
      const rollback = await h.request("POST", `/v1/projects/mock-store-api/spec-versions/${versions.body[1].id}/activate`);
      assert.equal(rollback.status, 204);
      const operations = await h.request("GET", "/v1/projects/mock-store-api/operations");
      assert.equal(operations.body.length, example.project.operations.length);
      const oldest = await h.request("GET", "/v1/projects/mock-store-api/specs/diff");
      assert.equal(oldest.body.from, null, "the oldest version has nothing before it");
    });

    test("scenarios and the queue preview come from the engine, reads first and deletes last", async () => {
      const scenarios = await h.request("GET", "/v1/projects/mock-store-api/scenarios?locale=en");
      assert.ok(scenarios.body.total > 50);
      assert.equal(scenarios.body.operations.find((item: { operationId: string }) => item.operationId === "listProducts").scenarios[0].name, "Unfiltered list");
      const withAuth = await h.request("GET", "/v1/projects/mock-store-api/scenarios?auth=true");
      assert.ok(withAuth.body.total > scenarios.body.total, "auth cases appear only with auth on");
      const queue = await h.request("GET", "/v1/projects/mock-store-api/queue-preview?mode=safe");
      const methods = queue.body.items.map((item: { method: string }) => item.method);
      assert.equal(methods[0], "GET");
      assert.equal(methods.at(-1), "DELETE");
      const reads = await h.request("GET", "/v1/projects/mock-store-api/queue-preview?readOnly=true");
      assert.ok(reads.body.items.every((item: { method: string }) => item.method === "GET"));
    });

    test("a config section is validated against the contract and guarded by its revision", async () => {
      const { body: current } = await h.request("GET", "/v1/projects/mock-store-api/config");
      const wrong = await h.request("PUT", "/v1/projects/mock-store-api/config/bodies", { value: { noSuchOperation: { body: {} } } });
      assert.equal(wrong.status, 422);
      assert.match(wrong.type, /application\/problem\+json/);
      assert.deepEqual(wrong.body.errors, ["project.bodies.noSuchOperation: no such operation"]);
      const budgets = [{ methods: ["GET"], ms: 200, label: "GET p95 < 200 ms" }];
      const saved = await h.request("PUT", "/v1/projects/mock-store-api/config/budgets", { value: budgets, expectedRev: current.rev });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      assert.equal(saved.body.rev, current.rev + 1);
      const stale = await h.request("PUT", "/v1/projects/mock-store-api/config/budgets", { value: [], expectedRev: current.rev });
      assert.equal(stale.status, 409);
      const { body: after } = await h.request("GET", "/v1/projects/mock-store-api/config");
      assert.deepEqual(after.config.budgets, budgets);
      const unknown = await h.request("PUT", "/v1/projects/mock-store-api/config/secrets", { value: 1 });
      assert.equal(unknown.status, 422);
    });

    test("regenerating merges: hand-tuned values stay, missing ones are filled", async () => {
      await h.request("PUT", "/v1/projects/mock-store-api/config/bodies", { value: { createProduct: { body: { sku: "HAND-TUNED" } } } });
      const merged = await h.request("POST", "/v1/projects/mock-store-api/config/generate", { mode: "merge" });
      assert.equal(merged.status, 201, JSON.stringify(merged.body));
      const { body } = await h.request("GET", "/v1/projects/mock-store-api/config");
      assert.deepEqual(body.config.bodies.createProduct, { body: { sku: "HAND-TUNED" } });
      assert.ok(body.config.bodies.createStore, "the other bodies came back");
      assert.ok(body.config.budgets.length, "budgets are not generated, so the hand-written ones stay");
    });

    test("environments: create, update with a revision, delete, and the key is reusable", async () => {
      const created = await h.request("POST", "/v1/projects/mock-store-api/environments", { key: "staging", name: "Staging", baseUrl: "https://staging.example.com/api/", writesAllowed: false });
      assert.equal(created.status, 201);
      const duplicate = await h.request("POST", "/v1/projects/mock-store-api/environments", { key: "staging", name: "Again", baseUrl: "https://x.example.com" });
      assert.equal(duplicate.status, 409);
      const updated = await h.request("PATCH", "/v1/projects/mock-store-api/environments/staging", { enforceLatency: false, specUrl: null, expectedRev: 1 });
      assert.equal(updated.body.rev, 2);
      const list = await h.request("GET", "/v1/projects/mock-store-api/environments");
      const staging = list.body.find((item: { id: string }) => item.id === "staging");
      assert.equal(staging.baseUrl, "https://staging.example.com/api");
      assert.equal(staging.writesAllowed, false);
      assert.equal(staging.enforceLatency, false);
      assert.equal((await h.request("DELETE", "/v1/projects/mock-store-api/environments/staging")).status, 204);
      assert.equal((await h.request("POST", "/v1/projects/mock-store-api/environments", { key: "staging", name: "Staging", baseUrl: "https://staging.example.com" })).status, 201);
      const invalid = await h.request("POST", "/v1/projects/mock-store-api/environments", { name: "Bad", baseUrl: "ftp://x" });
      assert.equal(invalid.status, 422);
    });

    test("a project file round-trips: import, export, same configuration", async () => {
      const imported = await h.request("POST", "/v1/projects/import", { file: example });
      assert.equal(imported.status, 201, JSON.stringify(imported.body));
      assert.equal(imported.body.slug, "mock-store");
      const exported = await h.request("GET", "/v1/projects/mock-store/export");
      assert.deepEqual(exported.body, example);
      const second = await h.request("POST", "/v1/projects/import", { file: example });
      assert.equal(second.body.slug, "mock-store-2", "a taken slug gets a suffix");
      const broken = await h.request("POST", "/v1/projects/import", { file: { format: "endpoint-quality/project", version: 1, project: { name: "x", operations: [] }, environments: [] } });
      assert.equal(broken.status, 422);
      assert.ok(broken.body.errors.some((error: string) => error.includes("no operation")));
    });

    test("a project from a file cannot regenerate config: there is no document behind it", async () => {
      const response = await h.request("POST", "/v1/projects/mock-store/config/generate", {});
      assert.equal(response.status, 422);
    });

    test("rename, archive, and the slug is free again", async () => {
      const renamed = await h.request("PATCH", "/v1/projects/mock-store-2", { name: "Copy", slug: "copy" });
      assert.equal(renamed.status, 200);
      assert.equal((await h.request("GET", "/v1/projects/copy")).body.name, "Copy");
      assert.equal((await h.request("PATCH", "/v1/projects/copy", { slug: "mock-store" })).status, 409);
      assert.equal((await h.request("DELETE", "/v1/projects/copy")).status, 204);
      assert.equal((await h.request("GET", "/v1/projects/copy")).status, 404);
      const listed = await h.request("GET", "/v1/projects");
      assert.deepEqual(listed.body.map((project: { slug: string }) => project.slug).sort(), ["mock-store", "mock-store-api"]);
      assert.equal((await h.request("PATCH", "/v1/projects/mock-store", { slug: "copy" })).status, 200, "an archived project's slug is free");
    });

    test("errors are Problem Details: an unreachable contract, a missing project, a bad body", async () => {
      const unreachable = await h.request("POST", "/v1/projects", { spec: { url: "http://127.0.0.1:9/openapi.json" } });
      assert.equal(unreachable.status, 502);
      assert.match(unreachable.type, /problem\+json/);
      const missing = await h.request("GET", "/v1/projects/nope");
      assert.deepEqual(missing.body, { type: "about:blank", title: "Not Found", status: 404, detail: "Project nope not found" });
      const bad = await h.request("POST", "/v1/projects", {});
      assert.equal(bad.status, 422);
      const swagger = await h.request("POST", "/v1/projects", { spec: { document: { swagger: "2.0" } } });
      assert.equal(swagger.status, 422);
      assert.match(swagger.body.detail, /Swagger 2\.0/);
      const projects = await h.request("GET", "/v1/projects");
      assert.equal(projects.body.length, 2, "nothing was half-created by the failed calls");
    });
  });
}
