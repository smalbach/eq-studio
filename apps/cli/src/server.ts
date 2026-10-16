/**
 * The API in this process: what `eq serve` keeps running, and what `eq run --file` starts for
 * the length of one run (an in-memory database, a random port, nothing left behind).
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { createApp } from "@eq/api/app";
import { mailConfig, readConfig, type AppConfig } from "@eq/api/config";
import { DATA_DIR, resources } from "./runtime.ts";

export type Server = { url: string; close(): Promise<void> };

/** `autoSync`: a long-running local server syncs on its own once linked (`eq serve`); one started
 * for a single command does not. */
export async function startServer(options: { port: number; host: string; persistent: boolean; quiet?: boolean; autoSync?: boolean }): Promise<Server> {
  const found = resources();
  // A hosted deployment (the Docker image) is configured entirely by its environment.
  const config: AppConfig = options.persistent && process.env.EQ_MODE === "cloud" ? { ...readConfig(process.env), port: options.port, host: options.host, examplesDir: found.examplesDir, webDir: found.webDir } : {
    mode: "local",
    host: options.host,
    port: options.port,
    database: { type: "sqlite", file: options.persistent ? join(DATA_DIR, "data.sqlite") : null, wasm: found.wasm },
    // A throwaway run needs a throwaway key: its secrets die with the process.
    secrets: options.persistent ? { type: "file", path: join(DATA_DIR, "secret.key") } : { type: "key", key: randomBytes(32).toString("base64") },
    queue: { driver: "memory", concurrency: 2 },
    sync: { intervalSeconds: options.autoSync ? Math.max(0, Number(process.env.EQ_SYNC_INTERVAL_SECONDS ?? 300) || 0) : 0 },
    // Schedules fire from the long-running server only, never from one started for a single command.
    scheduler: { tickSeconds: options.autoSync ? Math.max(0, Number(process.env.EQ_SCHEDULER_TICK_SECONDS ?? 30) || 0) : 0 },
    mail: mailConfig(process.env),
    publicUrl: process.env.EQ_PUBLIC_URL ?? `http://localhost:${options.port}`,
    examplesDir: found.examplesDir,
    webDir: found.webDir,
  };
  if (options.quiet) process.env.EQ_LOG ??= "silent";
  const app = await createApp(config);
  await app.listen(options.port, options.host);
  const address = app.getHttpServer().address() as { port: number };
  const host = options.host === "0.0.0.0" ? "127.0.0.1" : options.host;
  return { url: `http://${host}:${address.port}`, close: () => app.close() };
}
