/**
 * Sync: a change cursor on every synced table, and the bookkeeping of both sides.
 *
 * - `sync_seq` on projects, environments, spec versions, runs and credentials: a number per
 *   workspace that grows with every write (`sync_counters`), taken inside the write's own
 *   transaction. The cloud answers "what changed since N" with it; a device tells what it
 *   changed since its last sync with it.
 * - The cloud: `sync_objects` (what it keeps without reading — end-to-end encrypted
 *   credentials), `sync_aliases` (two devices that imported the same contract), `device_codes`
 *   (signing a device in from the browser), and devices as API tokens of a user.
 * - A device: `sync_link` (where it syncs), `sync_state` (what it last agreed with the cloud,
 *   entity by entity: the base of every three-way merge).
 * - Both: `sync_conflicts`, the fields two sides changed differently, until someone chooses.
 */
import { Table, TableColumn, TableIndex, type MigrationInterface, type QueryRunner } from "typeorm";

const id = { name: "id", type: "varchar", length: "36", isPrimary: true };
const ref = (name: string, nullable = false) => ({ name, type: "varchar", length: "36", isNullable: nullable });
const stamp = (name: string, nullable = false) => ({ name, type: "varchar", length: "32", isNullable: nullable });
const varchar = (name: string, length: number, nullable = false) => ({ name, type: "varchar", length: String(length), isNullable: nullable });
const text = (name: string, nullable = false) => ({ name, type: "text", isNullable: nullable });
const integer = (name: string, nullable = false) => ({ name, type: "integer", isNullable: nullable });

export const SYNCED_TABLES = ["spec_versions", "projects", "environments", "credentials", "runs"];

function tablePath(runner: QueryRunner, table: string) {
  const schema = (runner.connection.options as { schema?: string }).schema;
  return schema ? `"${schema.replace(/"/g, "")}"."${table}"` : table;
}

export class Sync1792300000000 implements MigrationInterface {
  name = "Sync1792300000000";

  async up(runner: QueryRunner) {
    const postgres = runner.connection.options.type === "postgres";
    const p = (index: number) => postgres ? `$${index}` : "?";
    await runner.createTable(new Table({ name: "sync_counters", columns: [{ ...ref("workspace_id"), isPrimary: true }, integer("value")] }));

    // Every existing row gets its own number, in creation order, so a first pull pages cleanly.
    const counters = new Map<string, number>();
    for (const table of SYNCED_TABLES) {
      await runner.addColumn(table, new TableColumn({ name: "sync_seq", type: "integer", default: 0 }));
      await runner.createIndex(table, new TableIndex({ name: `${table}_workspace_seq`, columnNames: ["workspace_id", "sync_seq"] }));
      const rows: { id: string; workspace_id: string }[] = await runner.query(`SELECT id, workspace_id FROM ${tablePath(runner, table)} ORDER BY created_at, id`);
      for (const row of rows) {
        const next = (counters.get(row.workspace_id) ?? 0) + 1;
        counters.set(row.workspace_id, next);
        await runner.query(`UPDATE ${tablePath(runner, table)} SET sync_seq = ${p(1)} WHERE id = ${p(2)}`, [next, row.id]);
      }
    }
    for (const [workspace, value] of counters) await runner.query(`INSERT INTO ${tablePath(runner, "sync_counters")} (workspace_id, value) VALUES (${p(1)}, ${p(2)})`, [workspace, value]);

    await runner.createTable(new Table({
      name: "sync_objects",
      columns: [{ ...varchar("id", 120), isPrimary: true }, { ...ref("workspace_id"), isPrimary: true }, { ...varchar("type", 20), isPrimary: true }, text("data"), integer("rev"), integer("sync_seq"), stamp("updated_at")],
      indices: [new TableIndex({ name: "sync_objects_workspace_seq", columnNames: ["workspace_id", "sync_seq"] })],
    }));
    await runner.createTable(new Table({
      name: "sync_aliases",
      columns: [{ ...ref("workspace_id"), isPrimary: true }, { ...varchar("type", 20), isPrimary: true }, { ...ref("from_id"), isPrimary: true }, ref("to_id"), stamp("created_at")],
    }));
    await runner.createTable(new Table({
      name: "sync_conflicts",
      columns: [id, ref("workspace_id"), varchar("type", 20), varchar("entity_id", 120), varchar("label", 300), varchar("field", 200), text("mine", true), text("theirs", true), varchar("device", 200), stamp("created_at"), stamp("resolved_at", true), varchar("resolution", 20, true)],
      indices: [new TableIndex({ name: "sync_conflicts_workspace", columnNames: ["workspace_id", "resolved_at"] })],
    }));
    await runner.createTable(new Table({
      name: "sync_state",
      columns: [{ ...varchar("type", 20), isPrimary: true }, { ...varchar("entity_id", 120), isPrimary: true }, integer("local_seq"), integer("remote_rev"), text("shadow")],
    }));
    await runner.createTable(new Table({
      name: "sync_link",
      columns: [id, text("url"), ref("remote_workspace_id", true), varchar("remote_workspace_name", 200, true), ref("device_id"), varchar("device_name", 200), text("token", true), integer("cursor"), { name: "include_runs", type: "boolean" }, text("projects", true), text("secrets_key", true), text("pending", true), text("resolved", true), stamp("last_sync_at", true), text("last_error", true), text("last_result", true), stamp("created_at")],
    }));
    await runner.createTable(new Table({
      name: "device_codes",
      columns: [id, varchar("device_code_hash", 64), varchar("user_code", 16), varchar("name", 200), varchar("status", 20), ref("workspace_id", true), ref("user_id", true), stamp("expires_at"), stamp("created_at")],
      indices: [new TableIndex({ name: "device_codes_hash", columnNames: ["device_code_hash"], isUnique: true }), new TableIndex({ name: "device_codes_user_code", columnNames: ["user_code"], isUnique: true })],
    }));
    await runner.addColumn("api_tokens", new TableColumn({ name: "kind", type: "varchar", length: "20", default: "'api'" }));
    await runner.addColumn("api_tokens", new TableColumn({ name: "user_id", type: "varchar", length: "36", isNullable: true }));
  }

  async down(runner: QueryRunner) {
    await runner.dropColumn("api_tokens", "user_id");
    await runner.dropColumn("api_tokens", "kind");
    for (const table of ["device_codes", "sync_link", "sync_state", "sync_conflicts", "sync_aliases", "sync_objects", "sync_counters"]) await runner.dropTable(table);
    for (const table of SYNCED_TABLES) {
      await runner.dropIndex(table, `${table}_workspace_seq`);
      await runner.dropColumn(table, "sync_seq");
    }
  }
}
