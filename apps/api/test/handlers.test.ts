import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CommandBus, EventBus, QueryBus } from "@nestjs/cqrs";
import { createApp } from "../src/app.ts";
import type { AppConfig } from "../src/config.ts";
import { testConfig } from "./helpers.ts";
import { CreateProjectCommand } from "../src/modules/projects/application/commands/create-project.ts";
import { ListProjectsQuery } from "../src/modules/projects/application/queries/project-queries.ts";
import { UpdateConfigSectionCommand } from "../src/modules/config/application/commands/config-commands.ts";
import { LOCAL_WORKSPACE_ID } from "../src/shared/workspace.ts";
import { Unreachable } from "../src/shared/errors.ts";

const spec = { openapi: "3.1.0", info: { title: "Orders", version: "2.0.0" }, paths: { "/orders": { get: { operationId: "listOrders", responses: { 200: { description: "ok" } } }, post: { operationId: "createOrder", requestBody: { content: { "application/json": { schema: { type: "object", required: ["reference"], properties: { reference: { type: "string", example: "A-1" } } } } } }, responses: { 201: { description: "created" }, 422: { description: "invalid" } } } } } };
const config = (file: string | null): AppConfig => testConfig({ type: "sqlite", file });

test("commands publish their events after the commit, in order, and a failed read writes nothing", async () => {
  let reachable = true;
  const app = await createApp(config(null), { specFetcher: { fetch: async () => { if (!reachable) throw new Unreachable("down"); return JSON.stringify(spec); } } });
  await app.init();
  const events: string[] = [];
  app.get(EventBus).subscribe((event: object) => events.push(event.constructor.name));
  const commands = app.get(CommandBus);
  const created = await commands.execute(new CreateProjectCommand(LOCAL_WORKSPACE_ID, { spec: { url: "http://orders.example/openapi.json" }, environments: [{ name: "Dev", baseUrl: "http://127.0.0.1:9000" }] }));
  assert.equal(created.slug, "orders");
  assert.deepEqual(events, ["ProjectCreated", "SpecVersionImported", "SpecVersionActivated", "EnvironmentChanged"]);
  events.length = 0;
  await commands.execute(new UpdateConfigSectionCommand(LOCAL_WORKSPACE_ID, "orders", "budgets", [{ ms: 100 }]));
  assert.deepEqual(events, ["ProjectConfigChanged"]);
  events.length = 0;
  reachable = false;
  await assert.rejects(commands.execute(new CreateProjectCommand(LOCAL_WORKSPACE_ID, { spec: { url: "http://orders.example/openapi.json" } })), /down/);
  assert.deepEqual(events, []);
  assert.equal((await app.get(QueryBus).execute(new ListProjectsQuery(LOCAL_WORKSPACE_ID))).length, 1);
  await app.close();
});

test("the local database survives a restart: same file, same projects", async () => {
  const directory = mkdtempSync(join(tmpdir(), "eq-api-"));
  const file = join(directory, "nested", "data.sqlite");
  try {
    const first = await createApp(config(file), { specFetcher: { fetch: async () => JSON.stringify(spec) } });
    await first.init();
    await first.get(CommandBus).execute(new CreateProjectCommand(LOCAL_WORKSPACE_ID, { spec: { url: "http://orders.example/openapi.json" } }));
    await first.close();
    const second = await createApp(config(file));
    await second.init();
    const projects = await second.get(QueryBus).execute(new ListProjectsQuery(LOCAL_WORKSPACE_ID));
    assert.deepEqual(projects.map((project: { slug: string; operationCount: number }) => [project.slug, project.operationCount]), [["orders", 2]]);
    await second.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the API serves the built web app, and every non-API path falls back to it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "eq-web-"));
  writeFileSync(join(directory, "index.html"), "<!doctype html><title>Endpoint Quality</title>");
  writeFileSync(join(directory, "app.js"), "console.log(1)");
  const app = await createApp({ ...config(null), webDir: directory });
  await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  try {
    for (const path of ["/", "/?vista=funcional", "/anything/deep"]) {
      const response = await fetch(`${base}${path}`);
      assert.match(response.headers.get("content-type") ?? "", /text\/html/, path);
      assert.match(await response.text(), /Endpoint Quality/);
    }
    assert.equal(await (await fetch(`${base}/app.js`)).text(), "console.log(1)");
    assert.match((await fetch(`${base}/v1/projects`)).headers.get("content-type") ?? "", /json/);
    assert.equal((await fetch(`${base}/v1/nope`)).status, 404, "an unknown API path is a 404, not the app");
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
