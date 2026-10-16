/** Runs, their cases, and the encrypted credentials of each environment. */
import { Table, TableIndex, type MigrationInterface, type QueryRunner } from "typeorm";

const id = { name: "id", type: "varchar", length: "36", isPrimary: true };
const ref = (name: string, nullable = false) => ({ name, type: "varchar", length: "36", isNullable: nullable });
const stamp = (name: string, nullable = false) => ({ name, type: "varchar", length: "32", isNullable: nullable });
const text = (name: string, nullable = false) => ({ name, type: "text", isNullable: nullable });
const varchar = (name: string, length: number, nullable = false) => ({ name, type: "varchar", length: String(length), isNullable: nullable });
const integer = (name: string, nullable = false) => ({ name, type: "integer", isNullable: nullable });

export class Runs1792100000000 implements MigrationInterface {
  name = "Runs1792100000000";

  async up(runner: QueryRunner) {
    await runner.createTable(new Table({
      name: "runs",
      columns: [id, ref("workspace_id"), ref("project_id"), ref("environment_id"), ref("spec_version_id", true), varchar("kind", 20), varchar("status", 20), varchar("scope", 300), text("plan"), text("totals"), text("report", true), text("error", true), varchar("triggered_by", 120), stamp("created_at"), stamp("started_at", true), stamp("finished_at", true), integer("duration_ms", true)],
      // The listing of a project's runs, newest first, and the restart scan for unfinished ones.
      indices: [new TableIndex({ name: "runs_project_created", columnNames: ["project_id", "created_at"] }), new TableIndex({ name: "runs_status", columnNames: ["status"] })],
    }));
    await runner.createTable(new Table({
      name: "run_cases",
      columns: [id, ref("run_id"), integer("position"), varchar("operation_id", 200), varchar("scenario_id", 200), text("name"), varchar("method", 10), text("path"), integer("expected_status"), varchar("status", 20), integer("duration_ms", true), text("steps", true)],
      indices: [new TableIndex({ name: "run_cases_run_position", columnNames: ["run_id", "position"], isUnique: true }), new TableIndex({ name: "run_cases_run_status", columnNames: ["run_id", "status"] })],
    }));
    await runner.createTable(new Table({
      name: "credentials",
      columns: [id, ref("workspace_id"), ref("environment_id"), varchar("role", 20), varchar("kind", 40), varchar("header_name", 200, true), text("username", true), text("token_url", true), text("client_id", true), text("scope", true), text("secret", true), varchar("last_four", 8, true), integer("rev"), stamp("created_at"), stamp("updated_at")],
      indices: [new TableIndex({ name: "credentials_environment_role", columnNames: ["environment_id", "role"], isUnique: true })],
    }));
  }

  async down(runner: QueryRunner) {
    for (const table of ["credentials", "run_cases", "runs"]) await runner.dropTable(table);
  }
}
