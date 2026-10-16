/**
 * The initial schema, written with TypeORM's driver-neutral `Table` API so the one migration
 * runs on SQLite and PostgreSQL alike. Never `synchronize`: every schema change is a migration
 * that is run, and tested, on both engines.
 */
import { Table, TableIndex, type MigrationInterface, type QueryRunner } from "typeorm";
import { LOCAL_WORKSPACE_ID } from "../../shared/workspace.ts";

const id = { name: "id", type: "varchar", length: "36", isPrimary: true };
const ref = (name: string, nullable = false) => ({ name, type: "varchar", length: "36", isNullable: nullable });
const stamp = (name: string, nullable = false) => ({ name, type: "varchar", length: "32", isNullable: nullable });
const text = (name: string, nullable = false) => ({ name, type: "text", isNullable: nullable });
const synced = [{ name: "rev", type: "integer" }, stamp("created_at"), stamp("updated_at"), stamp("deleted_at", true)];

/** A table name with the connection's schema, when it has one (PostgreSQL in a schema of its own). */
function tablePath(runner: QueryRunner, table: string) {
  const schema = (runner.connection.options as { schema?: string }).schema;
  return schema ? `"${schema.replace(/"/g, "")}"."${table}"` : table;
}

export class Initial1792000000000 implements MigrationInterface {
  name = "Initial1792000000000";

  async up(runner: QueryRunner) {
    await runner.createTable(new Table({ name: "workspaces", columns: [id, { name: "name", type: "varchar", length: "200" }, stamp("created_at")] }));
    await runner.createTable(new Table({
      name: "projects",
      columns: [id, ref("workspace_id"), { name: "slug", type: "varchar", length: "120" }, { name: "name", type: "varchar", length: "200" }, text("config"), text("load", true), ref("active_spec_version_id", true), ...synced],
      indices: [new TableIndex({ name: "projects_workspace_slug", columnNames: ["workspace_id", "slug"], isUnique: true })],
    }));
    await runner.createTable(new Table({
      name: "spec_versions",
      columns: [id, ref("workspace_id"), ref("project_id"), { name: "hash", type: "varchar", length: "64" }, { name: "source_kind", type: "varchar", length: "20" }, text("source_url", true), { name: "openapi_version", type: "varchar", length: "20", isNullable: true }, text("title", true), { name: "version", type: "varchar", length: "100", isNullable: true }, text("document", true), { name: "operation_count", type: "integer" }, stamp("created_at")],
      indices: [new TableIndex({ name: "spec_versions_project_hash", columnNames: ["project_id", "hash"], isUnique: true }), new TableIndex({ name: "spec_versions_project_created", columnNames: ["project_id", "created_at"] })],
    }));
    await runner.createTable(new Table({
      name: "operations",
      columns: [id, ref("spec_version_id"), { name: "operation_id", type: "varchar", length: "200" }, { name: "method", type: "varchar", length: "10" }, text("path"), { name: "tag", type: "varchar", length: "200" }, text("summary"), text("statuses"), text("parameters"), { name: "internal", type: "boolean" }, { name: "position", type: "integer" }],
      indices: [new TableIndex({ name: "operations_spec_operation", columnNames: ["spec_version_id", "operation_id"], isUnique: true })],
    }));
    await runner.createTable(new Table({
      name: "environments",
      columns: [id, ref("workspace_id"), ref("project_id"), { name: "key", type: "varchar", length: "120" }, { name: "name", type: "varchar", length: "200" }, text("base_url"), text("spec_url", true), { name: "seeded", type: "boolean", isNullable: true }, { name: "writes_allowed", type: "boolean", isNullable: true }, { name: "enforce_latency", type: "boolean", isNullable: true }, { name: "auth_enabled", type: "boolean", isNullable: true }, text("description", true), ...synced],
      indices: [new TableIndex({ name: "environments_project_key", columnNames: ["project_id", "key"], isUnique: true })],
    }));
    // The local workspace every row belongs to in local mode.
    const postgres = runner.connection.options.type === "postgres";
    await runner.query(`INSERT INTO ${tablePath(runner, "workspaces")} (id, name, created_at) VALUES (${postgres ? "$1, $2, $3" : "?, ?, ?"})`, [LOCAL_WORKSPACE_ID, "Local", new Date().toISOString()]);
  }

  async down(runner: QueryRunner) {
    for (const table of ["environments", "operations", "spec_versions", "projects", "workspaces"]) await runner.dropTable(table);
  }
}
