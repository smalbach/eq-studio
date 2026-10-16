import type { INestApplication } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { DataSource } from "typeorm";
import { createApp } from "../src/app.ts";
import { DEFAULT_EXAMPLES_DIR, type AppConfig, type DatabaseConfig } from "../src/config.ts";
// The fictional API the examples run against: its own OpenAPI document, no network needed.
import { createMockServer } from "../../mock-target/server.mjs";

/** The engines every suite runs on: SQLite always; PostgreSQL when a URL is given, in a schema
 * of its own that is dropped afterwards, so the suite never touches anything else there. */
export function databases(): { name: string; config: () => DatabaseConfig }[] {
  const url = process.env.EQ_TEST_POSTGRES_URL;
  return [
    { name: "sqlite", config: () => ({ type: "sqlite", file: null }) },
    ...(url ? [{ name: "postgres", config: (): DatabaseConfig => ({ type: "postgres", url, schema: `eq_test_${process.pid}_${Date.now()}` }) }] : []),
  ];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are read loosely by the tests
type Body = any;
export type Harness = { app: INestApplication; base: string; mock: string; request: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: Body; type: string }>; close: () => Promise<void> };

/** A test configuration: a random secrets key, the in-memory queue unless told otherwise. */
export function testConfig(database: DatabaseConfig, queue: AppConfig["queue"] = { driver: "memory", concurrency: 2 }, cloud?: { allowPrivateTargets: boolean; registration?: "open" | "invite" }): AppConfig {
  const base: AppConfig = { mode: "local", host: "127.0.0.1", port: 0, database, secrets: { type: "key", key: randomBytes(32).toString("base64") }, queue, examplesDir: DEFAULT_EXAMPLES_DIR };
  if (!cloud) return base;
  return { ...base, mode: "cloud", auth: { required: true, jwtSecret: randomBytes(48).toString("base64"), registration: cloud.registration ?? "invite", accessTtlSeconds: 900, refreshTtlDays: 30 }, network: { allowPrivateTargets: cloud.allowPrivateTargets, corsOrigins: [] } };
}

export async function start(database: DatabaseConfig, options: { auth?: boolean; queue?: AppConfig["queue"]; cloud?: { allowPrivateTargets: boolean; registration?: "open" | "invite" } } = {}): Promise<Harness> {
  const mockServer = createMockServer({ auth: options.auth ?? false });
  const { url: mock } = await mockServer.listen(0);
  const config = testConfig(database, options.queue, options.cloud);
  const app = await createApp(config);
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const request = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, type: response.headers.get("content-type") ?? "", body: text ? JSON.parse(text) : null };
  };
  return {
    app, base, mock, request,
    close: async () => {
      // The app first: its shutdown still reads the runs table.
      await app.close();
      await mockServer.close();
      if (database.type === "postgres" && database.schema) {
        const admin = new DataSource({ type: "postgres", url: database.url });
        await admin.initialize();
        await admin.query(`DROP SCHEMA "${database.schema}" CASCADE`);
        await admin.destroy();
      }
    },
  };
}

const FINISHED = ["passed", "failed", "cancelled", "interrupted", "error"];

/** Polls a run until `until` holds — by default, until it finished. */
export async function waitFor(h: Pick<Harness, "request">, runId: string, until: (run: Body) => boolean = (run) => FINISHED.includes(String(run.status)), timeoutMs = 30_000): Promise<Body> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { body } = await h.request("GET", `/v1/runs/${runId}`);
    if (until(body)) return body;
    if (Date.now() > deadline) throw new Error(`Run ${runId} still ${body?.status}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
