import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import type { DataSource } from "typeorm";
import { DATA_SOURCE } from "../src/shared/tokens.ts";
import { createMockServer } from "../../mock-target/server.mjs";
import { databases, start, waitFor, type Harness } from "./helpers.ts";

const example = JSON.parse(readFileSync(new URL("../../../examples/mock-store/mock-store.eq.json", import.meta.url), "utf8"));
/** What the mock holds, to prove a run left it as it found it. */
async function counts(url: string) {
  const read = async (path: string) => ((await (await fetch(`${url}${path}`, { headers: { Authorization: "Bearer admin-token" } })).json()) as { data: unknown[] }).data.length;
  return { products: await read("/v1/products?limit=100"), stores: await read("/v1/stores?limit=100") };
}

const failures = (run: { cases: { status: string; operationId: string; scenarioId: string }[] }) => run.cases.filter((item) => item.status !== "passed").map((item) => `${item.operationId}:${item.scenarioId}=${item.status}`);

for (const database of databases()) {
  describe(`runs over ${database.name}`, () => {
    let h: Harness;
    const authMock = createMockServer({ auth: true });
    let authUrl = "";
    before(async () => {
      h = await start(database.config());
      authUrl = (await authMock.listen(0)).url;
      assert.equal((await h.request("POST", "/v1/projects/import", { file: example })).status, 201);
      await h.request("PATCH", "/v1/projects/mock-store/environments/local", { baseUrl: h.mock });
      await h.request("PATCH", "/v1/projects/mock-store/environments/local-auth", { baseUrl: authUrl });
    });
    after(async () => { await h?.close(); await authMock.close(); });

    test("the full matrix runs on the server, every case green, and leaves the API as it found it", async () => {
      const before = await counts(h.mock);
      const started = await h.request("POST", "/v1/projects/mock-store/runs", { environment: "local" });
      assert.equal(started.status, 202, JSON.stringify(started.body));
      const run = await waitFor(h, started.body.id);
      assert.equal(run.status, "passed", failures(run).join(", "));
      assert.equal(run.cases.length, started.body.total);
      assert.deepEqual(run.totals, { total: started.body.total, completed: started.body.total, passed: started.body.total, failed: 0, blocked: 0 });
      assert.deepEqual(await counts(h.mock), before);
      const withSteps = await h.request("GET", `/v1/runs/${started.body.id}?steps=true`);
      const createRead = withSteps.body.cases.find((item: { operationId: string; scenarioId: string }) => item.operationId === "createProduct" && item.scenarioId === "create-read");
      assert.ok(createRead.steps.length >= 3, "the chained flow keeps its steps: create, read back, clean up");
      assert.equal(createRead.steps[0].requestBody, undefined, "a passing case keeps no bodies");
    });

    test("credentials are stored encrypted, never read back, and drive the 401/403 matrix", async () => {
      for (const [role, body] of [["primary", { kind: "bearer", secret: "admin-token" }], ["insufficient", { kind: "bearer", secret: "read-token" }], ["alternate", { kind: "api_key", secret: "demo-key", headerName: "X-API-Key" }]] as const) {
        const saved = await h.request("PUT", `/v1/projects/mock-store/environments/local-auth/credentials/${role}`, body);
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
      }
      const listed = await h.request("GET", "/v1/projects/mock-store/environments/local-auth/credentials");
      assert.equal(JSON.stringify(listed.body).includes("admin-token"), false);
      assert.deepEqual(listed.body.map((item: { role: string; lastFour: string }) => [item.role, item.lastFour]), [["alternate", "••••"], ["insufficient", "oken"], ["primary", "oken"]]);
      const stored = await h.app.get<DataSource>(DATA_SOURCE).getRepository("Credential").find() as { secret: string }[];
      assert.ok(stored.every((row: { secret: string }) => row.secret.startsWith("v1.") && !row.secret.includes("token")));
      const started = await h.request("POST", "/v1/projects/mock-store/runs", { environment: "local-auth" });
      const run = await waitFor(h, started.body.id);
      assert.equal(run.status, "passed", failures(run).join(", "));
      assert.ok(run.cases.some((item: { scenarioId: string }) => item.scenarioId === "auth-insufficient"), "the environment turns the auth cases on");
      const header = await h.request("PUT", "/v1/projects/mock-store/environments/local-auth/credentials/alternate", { kind: "api_key", headerName: "X-Other-Key" });
      assert.equal(header.status, 200, "a credential can change without sending its secret again");
      const missing = await h.request("PUT", "/v1/projects/mock-store/environments/local-auth/credentials/primary", { kind: "basic" });
      assert.equal(missing.status, 422);
    });

    test("the stream sends a snapshot, each case as it changes, and the final run", async () => {
      const started = await h.request("POST", "/v1/projects/mock-store/runs", { environment: "local", readOnly: true, delayMs: 20 });
      const response = await fetch(`${h.base}/v1/runs/${started.body.id}/stream`);
      assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
      const text = await response.text();
      const events = [...text.matchAll(/^event: (\w+)$/gm)].map((match) => match[1]);
      assert.equal(events[0], "snapshot");
      assert.equal(events.at(-1), "finished");
      assert.ok(events.filter((event) => event === "case").length >= started.body.total, `${events.length} events`);
    });

    test("a cancelled run stops after the case in flight, skips the rest and cleans up", async () => {
      const before = await counts(h.mock);
      const started = await h.request("POST", "/v1/projects/mock-store/runs", { environment: "local", delayMs: 400 });
      await waitFor(h, started.body.id, (run) => (run.totals as { completed: number }).completed >= 2);
      assert.equal((await h.request("POST", `/v1/runs/${started.body.id}/cancel`)).status, 202);
      const run = await waitFor(h, started.body.id);
      assert.equal(run.status, "cancelled");
      assert.ok(run.cases.some((item: { status: string }) => item.status === "skipped"));
      assert.ok(!run.cases.some((item: { status: string }) => ["queued", "running"].includes(item.status)));
      assert.deepEqual(await counts(h.mock), before);
      assert.equal((await h.request("POST", `/v1/runs/${started.body.id}/cancel`)).status, 409);
    });

    test("an environment without writes never sends one: blocked, not failed", async () => {
      const before = await counts(h.mock);
      await h.request("POST", "/v1/projects/mock-store/environments", { key: "shared", name: "Shared", baseUrl: h.mock, seeded: true, writesAllowed: false });
      const started = await h.request("POST", "/v1/projects/mock-store/runs", { environment: "shared" });
      const run = await waitFor(h, started.body.id);
      assert.equal(run.status, "passed", failures(run).filter((item) => !item.endsWith("blocked")).join(", "));
      assert.ok(run.totals.blocked > 0);
      assert.equal(run.totals.failed, 0);
      assert.deepEqual(await counts(h.mock), before);
    });

    test("a load test runs on the server and stores its report with a verdict", async () => {
      const started = await h.request("POST", "/v1/projects/mock-store/load-runs", { environment: "local", type: "load", baseRps: 8, durationS: 3, mixId: "all-gets", latency: { mode: "custom", p95Ms: 1000 } });
      assert.equal(started.status, 202, JSON.stringify(started.body));
      const run = await waitFor(h, started.body.id);
      assert.equal(run.status, "passed", JSON.stringify(run.report?.verdict ?? run.error));
      assert.ok(run.report.windows.length >= 3);
      assert.ok(run.totals.completed > 10);
      const listed = await h.request("GET", "/v1/projects/mock-store/runs?kind=load");
      assert.deepEqual(listed.body.map((item: { id: string }) => item.id), [started.body.id]);
    });

    test("replay starts the same plan again as a new run", async () => {
      const first = await h.request("POST", "/v1/projects/mock-store/runs", { environment: "local", readOnly: true, scope: "Smoke" });
      await waitFor(h, first.body.id);
      const again = await h.request("POST", `/v1/runs/${first.body.id}/replay`);
      assert.equal(again.status, 202);
      assert.notEqual(again.body.id, first.body.id);
      const run = await waitFor(h, again.body.id);
      assert.equal(run.scope, "Smoke");
      assert.equal(run.status, "passed");
      assert.equal((await h.request("DELETE", `/v1/runs/${first.body.id}`)).status, 204);
      assert.equal((await h.request("GET", `/v1/runs/${first.body.id}`)).status, 404);
    });

    test("a probe runs one case with typed values, its flow whole, and stores nothing", async () => {
      const before = (await h.request("GET", "/v1/projects/mock-store/runs")).body.length;
      const found = await h.request("POST", "/v1/projects/mock-store/probe", { environment: "local", operationId: "getProduct", scenarioId: "found", parameters: { product_id: "2" } });
      assert.equal(found.status, 200, JSON.stringify(found.body));
      assert.equal(found.body.ok, true);
      assert.match(found.body.steps[0].request.url, /\/v1\/products\/2$/);
      const edited = await h.request("POST", "/v1/projects/mock-store/probe", { environment: "local", operationId: "createProduct", scenarioId: "create-read", body: { sku: "PROBE-1", name: "Probe", price: 10, category: "lamps", stock: 1 } });
      assert.equal(edited.body.steps[0].request.body.sku, "PROBE-1", "the typed body is the one sent");
      assert.ok(edited.body.steps.length >= 2, "the flow runs whole: create, read back, clean up");
      assert.equal((await h.request("GET", "/v1/projects/mock-store/runs")).body.length, before);
      assert.equal((await h.request("POST", "/v1/projects/mock-store/probe", { environment: "local", operationId: "getProduct", scenarioId: "nope" })).status, 404);
    });

    test("bundled examples are listed and imported in one call", async () => {
      const list = await h.request("GET", "/v1/examples");
      assert.ok(list.body.some((example: { id: string }) => example.id === "mock-store"));
      const imported = await h.request("POST", "/v1/examples/mock-store/import");
      assert.equal(imported.status, 201);
      assert.equal((await h.request("POST", "/v1/examples/none/import")).status, 404);
    });

    test("bad requests are Problem Details", async () => {
      assert.equal((await h.request("POST", "/v1/projects/mock-store/runs", { environment: "nope" })).status, 404);
      assert.equal((await h.request("POST", "/v1/projects/mock-store/runs", { environment: "local", endpointIds: ["noSuchOperation"] })).status, 422);
      assert.equal((await h.request("GET", "/v1/runs/00000000-0000-7000-8000-000000000999")).status, 404);
      assert.equal((await h.request("POST", "/v1/projects/mock-store/load-runs", { environment: "local", baseRps: 9000 })).status, 422);
    });
  });
}
