import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { DataSource } from "typeorm";
import { createApp } from "../src/app.ts";
import { DATA_SOURCE } from "../src/shared/tokens.ts";
import { createMockServer } from "../../mock-target/server.mjs";
import { start, testConfig, waitFor, type Harness } from "./helpers.ts";

const example = JSON.parse(readFileSync(new URL("../../../examples/mock-store/mock-store.eq.json", import.meta.url), "utf8"));

async function listen(app: Awaited<ReturnType<typeof createApp>>): Promise<Harness> {
  await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  const request = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, type: response.headers.get("content-type") ?? "", body: text ? JSON.parse(text) : null };
  };
  return { app, base, mock: "", request, close: () => app.close() };
}

test("after a restart, a run that was executing is interrupted and a queued one runs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "eq-recovery-"));
  const mock = createMockServer();
  const { url } = await mock.listen(0);
  const config = { ...testConfig({ type: "sqlite", file: join(directory, "data.sqlite") }) };
  const apps: Harness[] = [];
  try {
    const first = await listen(await createApp(config));
    apps.push(first);
    await first.request("POST", "/v1/projects/import", { file: example });
    await first.request("PATCH", "/v1/projects/mock-store/environments/local", { baseUrl: url });
    const done = await first.request("POST", "/v1/projects/mock-store/runs", { environment: "local", readOnly: true });
    await waitFor(first, done.body.id);
    // What a crash leaves behind: one run marked as executing, one still waiting. Written as the
    // copies of a finished run, so they have real cases.
    const db = first.app.get<DataSource>(DATA_SOURCE);
    for (const [id, status] of [["01900000-0000-7000-8000-00000000000a", "running"], ["01900000-0000-7000-8000-00000000000b", "queued"]]) {
      await db.query(`INSERT INTO runs (id, workspace_id, project_id, environment_id, spec_version_id, kind, status, scope, plan, totals, report, error, triggered_by, created_at, started_at, finished_at, duration_ms) SELECT ?, workspace_id, project_id, environment_id, spec_version_id, kind, ?, scope, plan, totals, NULL, NULL, triggered_by, created_at, NULL, NULL, NULL FROM runs WHERE id = ?`, [id, status, done.body.id]);
      await db.query(`INSERT INTO run_cases (id, run_id, position, operation_id, scenario_id, name, method, path, expected_status, status, duration_ms, steps) SELECT ? || substr(id, 2), ?, position, operation_id, scenario_id, name, method, path, expected_status, 'queued', NULL, NULL FROM run_cases WHERE run_id = ?`, [id.slice(-1), id, done.body.id]);
    }
    await db.query(`UPDATE runs SET totals = '{"total":${done.body.total},"passed":0,"failed":0,"blocked":0,"completed":0}' WHERE status IN ('running', 'queued')`);
    // Closing writes the file. The rows are copies with no worker behind them, so the graceful
    // shutdown has nothing to stop: on the next boot they look exactly like a crash left them.
    await first.app.close();

    apps.length = 0;
    const second = await listen(await createApp(config));
    apps.push(second);
    const interrupted = await waitFor(second, "01900000-0000-7000-8000-00000000000a");
    assert.equal(interrupted.status, "interrupted");
    assert.ok(interrupted.cases.every((item: { status: string }) => item.status === "skipped"));
    const resumed = await waitFor(second, "01900000-0000-7000-8000-00000000000b");
    assert.equal(resumed.status, "passed");
  } finally {
    for (const app of apps) await app.close().catch(() => {});
    await mock.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

const freePort = () => new Promise<number>((resolve) => { const server = createServer(); server.listen(0, "127.0.0.1", () => { const { port } = server.address() as { port: number }; server.close(() => resolve(port)); }); });

/** A throwaway Redis, when one is installed; the test is skipped otherwise. */
async function redis(): Promise<{ url: string; stop: () => void } | null> {
  if (process.env.EQ_TEST_REDIS_URL) return { url: process.env.EQ_TEST_REDIS_URL, stop: () => {} };
  const port = await freePort();
  let child: ChildProcess;
  try { child = spawn("redis-server", ["--port", String(port), "--save", "", "--appendonly", "no", "--bind", "127.0.0.1"], { stdio: "ignore" }); } catch { return null; }
  const ready = await new Promise<boolean>((resolve) => { child.once("error", () => resolve(false)); setTimeout(() => resolve(child.exitCode === null), 400); });
  return ready ? { url: `redis://127.0.0.1:${port}`, stop: () => child.kill() } : null;
}

test("runs go through BullMQ on Redis exactly as through the in-memory queue", async (context) => {
  const server = await redis();
  if (!server) { context.skip("redis-server is not installed"); return; }
  const h = await start({ type: "sqlite", file: null }, { queue: { driver: "redis", url: server.url, concurrency: 2 } });
  try {
    await h.request("POST", "/v1/projects/import", { file: example });
    await h.request("PATCH", "/v1/projects/mock-store/environments/local", { baseUrl: h.mock });
    const [a, b] = await Promise.all([h.request("POST", "/v1/projects/mock-store/runs", { environment: "local" }), h.request("POST", "/v1/projects/mock-store/runs", { environment: "local", readOnly: true })]);
    for (const started of [a, b]) {
      const run = await waitFor(h, started.body.id);
      assert.equal(run.status, "passed");
    }
  } finally {
    await h.close();
    server.stop();
  }
});
