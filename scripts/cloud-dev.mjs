#!/usr/bin/env node
/**
 * A cloud deployment on this machine, to try accounts, workspaces and sync without PostgreSQL or
 * Docker: the API in cloud mode on http://localhost:4500, on its own SQLite file, with anyone
 * allowed to register. Its secrets are generated once and kept next to the database, so sessions
 * and stored credentials survive a restart. Not for a real deployment: see docker/compose.yml.
 *
 *   pnpm run cloud          # builds the web app, then starts
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = join(homedir(), ".endpoint-quality", "cloud-dev");
mkdirSync(dir, { recursive: true, mode: 0o700 });

/** A random secret kept in `dir`, created on first use. */
function secret(name, bytes) {
  const file = join(dir, name);
  if (!existsSync(file)) writeFileSync(file, randomBytes(bytes).toString("base64"), { mode: 0o600 });
  return readFileSync(file, "utf8").trim();
}

// Always rebuilt: the API serves apps/web/dist, and a stale build hides recent changes.
const build = spawnSync("pnpm", ["run", "build"], { cwd: root, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const port = process.env.EQ_PORT ?? "4500";
const env = {
  ...process.env,
  EQ_MODE: "cloud",
  EQ_CLOUD_SQLITE: "true",
  EQ_DATABASE_FILE: join(dir, "data.sqlite"),
  EQ_SECRETS_KEY: secret("secret.key", 32),
  EQ_JWT_SECRET: secret("jwt.key", 48),
  EQ_PORT: port,
  EQ_HOST: "127.0.0.1",
  EQ_REGISTRATION: process.env.EQ_REGISTRATION ?? "open",
  EQ_ALLOW_PRIVATE_TARGETS: "true",
  // Links (password resets, SSO) point here. Without EQ_SMTP_URL the reset link is logged as a warning.
  EQ_PUBLIC_URL: process.env.EQ_PUBLIC_URL ?? `http://localhost:${port}`,
};
console.log(`Endpoint Quality cloud (development) on http://localhost:${port}. Data in ${dir}`);
const api = spawn("pnpm", ["--filter", "@eq/api", "start"], { cwd: root, env, stdio: "inherit" });
api.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => api.kill(signal));
