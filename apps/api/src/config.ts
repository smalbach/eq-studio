/**
 * How the API runs, read once from the environment.
 *
 * `local` is the default: SQLite in the user's home directory, no login, listening on the
 * loopback only. `cloud` needs PostgreSQL, the secrets key and the JWT secret, signs everyone in,
 * guards outbound requests against internal addresses, and binds wherever it is told to.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import type { SecretKeySource } from "./shared/secret-box.ts";

/** `wasm` is where sql.js's WebAssembly lives when it is not next to the package (a bundled CLI). */
export type DatabaseConfig = { type: "sqlite"; file: string | null; wasm?: string } | { type: "postgres"; url: string; schema?: string };
export type QueueConfig = { driver: "memory"; concurrency: number } | { driver: "redis"; url: string; concurrency: number };
export type AuthConfig = {
  /** Every request but the public ones needs a user or API token. Always on in cloud mode. */
  required: boolean;
  jwtSecret: string;
  /** `open`: anyone may register a workspace. `invite`: only the first account, then invitations. */
  registration: "open" | "invite";
  accessTtlSeconds: number;
  refreshTtlDays: number;
};
export type NetworkConfig = {
  /** Whether runs may reach loopback, private and link-local addresses. Local mode: yes, that
   * is the point. Cloud mode: no, unless the deployment opts in (a self-hosted install inside a
   * private network). */
  allowPrivateTargets: boolean;
  corsOrigins: string[];
  /** Express's `trust proxy`, so client addresses (rate limits) and HTTPS are read from the
   * proxy in front: e.g. `1` for one load balancer. */
  trustProxy?: string;
};
export type AppConfig = { mode: "local" | "cloud"; host: string; port: number; database: DatabaseConfig; secrets: SecretKeySource; queue: QueueConfig; examplesDir?: string; webDir?: string; auth?: AuthConfig; network?: NetworkConfig;
  /** Local mode, once linked to a cloud workspace: seconds between automatic syncs (0: only on demand). */
  sync?: { intervalSeconds: number } };

/** The repository's `examples/` and the built web app, found relative to this file. */
export const DEFAULT_EXAMPLES_DIR = fileURLToPath(new URL("../../../examples/", import.meta.url));
export const DEFAULT_WEB_DIR = fileURLToPath(new URL("../../web/dist/", import.meta.url));

export const LOCAL_DATA_DIR = join(homedir(), ".endpoint-quality");

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mode = env.EQ_MODE === "cloud" ? "cloud" : "local";
  const port = Number(env.EQ_PORT ?? 4400);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`EQ_PORT is not a port: ${env.EQ_PORT}`);
  const database: DatabaseConfig = env.EQ_DATABASE_URL?.startsWith("postgres")
    ? { type: "postgres", url: env.EQ_DATABASE_URL, schema: env.EQ_DATABASE_SCHEMA }
    : { type: "sqlite", file: env.EQ_DATABASE_FILE === ":memory:" ? null : env.EQ_DATABASE_FILE ?? join(LOCAL_DATA_DIR, "data.sqlite") };
  // EQ_CLOUD_SQLITE=true is for trying cloud mode on one machine (`pnpm run cloud`), never for a real deployment.
  if (mode === "cloud" && database.type !== "postgres" && env.EQ_CLOUD_SQLITE !== "true") throw new Error("EQ_MODE=cloud needs EQ_DATABASE_URL=postgres://…");
  if (mode === "cloud" && (env.EQ_JWT_SECRET ?? "").length < 32) throw new Error("EQ_MODE=cloud needs EQ_JWT_SECRET of at least 32 characters (openssl rand -base64 48)");
  if (mode === "cloud" && !env.EQ_SECRETS_KEY) throw new Error("EQ_MODE=cloud needs EQ_SECRETS_KEY (openssl rand -base64 32)");
  const secrets: SecretKeySource = env.EQ_SECRETS_KEY ? { type: "key", key: env.EQ_SECRETS_KEY } : { type: "file", path: env.EQ_SECRETS_FILE ?? join(LOCAL_DATA_DIR, "secret.key") };
  const concurrency = Math.max(1, Number(env.EQ_RUN_CONCURRENCY ?? 2) || 2);
  const queue: QueueConfig = env.EQ_QUEUE_DRIVER === "redis" ? { driver: "redis", url: env.EQ_REDIS_URL ?? "redis://127.0.0.1:6379", concurrency } : { driver: "memory", concurrency };
  const auth: AuthConfig = {
    required: mode === "cloud" || env.EQ_AUTH === "required",
    jwtSecret: env.EQ_JWT_SECRET ?? randomBytes(48).toString("base64"),
    registration: env.EQ_REGISTRATION === "open" ? "open" : "invite",
    accessTtlSeconds: Number(env.EQ_ACCESS_TTL_SECONDS ?? 900),
    refreshTtlDays: Number(env.EQ_REFRESH_TTL_DAYS ?? 30),
  };
  const network: NetworkConfig = {
    allowPrivateTargets: mode === "local" || env.EQ_ALLOW_PRIVATE_TARGETS === "true",
    corsOrigins: (env.EQ_CORS_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean),
    trustProxy: env.EQ_TRUST_PROXY,
  };
  const sync = { intervalSeconds: mode === "local" ? Math.max(0, Number(env.EQ_SYNC_INTERVAL_SECONDS ?? 300) || 0) : 0 };
  return { sync, mode, port, host: env.EQ_HOST ?? (mode === "local" ? "127.0.0.1" : "0.0.0.0"), database, secrets, queue, examplesDir: env.EQ_EXAMPLES_DIR ?? DEFAULT_EXAMPLES_DIR, webDir: env.EQ_WEB_DIR ?? DEFAULT_WEB_DIR, auth, network };
}
