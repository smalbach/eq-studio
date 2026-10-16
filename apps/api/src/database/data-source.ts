import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DataSource, type DataSourceOptions } from "typeorm";
import type { DatabaseConfig } from "../config.ts";
import { ENTITIES } from "./entities.ts";
import { Initial1792000000000 } from "./migrations/0001-initial.ts";
import { Runs1792100000000 } from "./migrations/0002-runs.ts";
import { Accounts1792200000000 } from "./migrations/0003-accounts.ts";
import { Sync1792300000000 } from "./migrations/0004-sync.ts";
import { Automation1792400000000 } from "./migrations/0005-automation.ts";
import { CredentialKinds1792450000000 } from "./migrations/0006-credential-kinds.ts";
import { CloudOps1792500000000 } from "./migrations/0007-cloud-ops.ts";

export const MIGRATIONS = [Initial1792000000000, Runs1792100000000, Accounts1792200000000, Sync1792300000000, Automation1792400000000, CredentialKinds1792450000000, CloudOps1792500000000];

/**
 * SQLite runs through sql.js — SQLite compiled to WebAssembly — so the local mode has no native
 * module to build on macOS, Windows or Linux. It keeps the database in memory and writes the
 * file after every change.
 */
export function dataSourceOptions(database: DatabaseConfig): DataSourceOptions {
  const common = { entities: ENTITIES, migrations: MIGRATIONS, migrationsRun: false, synchronize: false, logging: false } as const;
  if (database.type === "postgres") return { ...common, type: "postgres", url: database.url, schema: database.schema };
  if (database.file) mkdirSync(dirname(database.file), { recursive: true });
  const wasm = database.wasm;
  return { ...common, type: "sqljs", location: database.file ?? undefined, autoSave: Boolean(database.file), useLocalForage: false, ...(wasm ? { sqlJsConfig: { locateFile: () => wasm } } : {}) };
}

/** Opens the database and brings its schema up to date. */
export async function openDatabase(database: DatabaseConfig) {
  if (database.type === "postgres" && database.schema) {
    const bootstrap = new DataSource({ type: "postgres", url: database.url });
    await bootstrap.initialize();
    await bootstrap.query(`CREATE SCHEMA IF NOT EXISTS "${database.schema.replace(/"/g, "")}"`);
    await bootstrap.destroy();
  }
  const source = new DataSource(dataSourceOptions(database));
  await source.initialize();
  await source.runMigrations({ transaction: "each" });
  return source;
}
