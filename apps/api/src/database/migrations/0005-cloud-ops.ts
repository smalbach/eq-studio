/**
 * Operating a team deployment: the audit log and password resets.
 *
 * - `audit_events`: who did what to whom, per workspace. Append-only: the database itself
 *   refuses to change or delete a row (a trigger on each engine), so a bug or a stolen admin
 *   session cannot rewrite history through the API.
 * - `password_resets`: single-use, short-lived reset links; only the SHA-256 of the token.
 */
import { Table, TableIndex, type MigrationInterface, type QueryRunner } from "typeorm";

const id = { name: "id", type: "varchar", length: "36", isPrimary: true };
const ref = (name: string, nullable = false) => ({ name, type: "varchar", length: "36", isNullable: nullable });
const stamp = (name: string, nullable = false) => ({ name, type: "varchar", length: "32", isNullable: nullable });
const varchar = (name: string, length: number, nullable = false) => ({ name, type: "varchar", length: String(length), isNullable: nullable });
const text = (name: string, nullable = false) => ({ name, type: "text", isNullable: nullable });

function tablePath(runner: QueryRunner, table: string) {
  const schema = (runner.connection.options as { schema?: string }).schema;
  return schema ? `"${schema.replace(/"/g, "")}"."${table}"` : table;
}

export class CloudOps1792450000000 implements MigrationInterface {
  name = "CloudOps1792450000000";

  async up(runner: QueryRunner) {
    await runner.createTable(new Table({
      name: "audit_events",
      columns: [id, ref("workspace_id"), varchar("type", 60), ref("actor_user_id", true), ref("actor_token_id", true), varchar("actor_label", 320, true), varchar("target_type", 40, true), varchar("target_id", 120, true), varchar("target_label", 320, true), text("detail", true), varchar("ip", 64, true), stamp("created_at")],
      indices: [new TableIndex({ name: "audit_events_workspace_time", columnNames: ["workspace_id", "created_at"] }), new TableIndex({ name: "audit_events_workspace_type", columnNames: ["workspace_id", "type"] })],
    }));
    const table = tablePath(runner, "audit_events");
    if (runner.connection.options.type === "postgres") {
      const schema = (runner.connection.options as { schema?: string }).schema;
      const fn = schema ? `"${schema.replace(/"/g, "")}".audit_events_append_only` : "audit_events_append_only";
      await runner.query(`CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'audit_events is append-only'; END; $$ LANGUAGE plpgsql`);
      await runner.query(`CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    } else {
      await runner.query(`CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END`);
      await runner.query(`CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END`);
    }
    await runner.createTable(new Table({
      name: "password_resets",
      columns: [id, ref("user_id"), varchar("token_hash", 64), ref("created_by", true), stamp("expires_at"), stamp("used_at", true), stamp("created_at")],
      indices: [new TableIndex({ name: "password_resets_hash", columnNames: ["token_hash"], isUnique: true }), new TableIndex({ name: "password_resets_user", columnNames: ["user_id"] })],
    }));
  }

  async down(runner: QueryRunner) {
    await runner.dropTable("password_resets");
    if (runner.connection.options.type === "postgres") await runner.query(`DROP TRIGGER IF EXISTS audit_events_append_only ON ${tablePath(runner, "audit_events")}`);
    await runner.dropTable("audit_events");
  }
}
