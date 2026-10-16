/**
 * Automation: schedules that start runs on their own, and the targets a finished run is
 * announced to (webhook, Slack, email). Neither is synced: a schedule fires where it was made.
 */
import { Table, TableIndex, type MigrationInterface, type QueryRunner } from "typeorm";

const id = { name: "id", type: "varchar", length: "36", isPrimary: true };
const ref = (name: string, nullable = false) => ({ name, type: "varchar", length: "36", isNullable: nullable });
const stamp = (name: string, nullable = false) => ({ name, type: "varchar", length: "32", isNullable: nullable });
const varchar = (name: string, length: number, nullable = false) => ({ name, type: "varchar", length: String(length), isNullable: nullable });
const text = (name: string, nullable = false) => ({ name, type: "text", isNullable: nullable });
const integer = (name: string) => ({ name, type: "integer" });
const boolean = (name: string) => ({ name, type: "boolean" });

export class Automation1792400000000 implements MigrationInterface {
  name = "Automation1792400000000";

  async up(runner: QueryRunner) {
    await runner.createTable(new Table({
      name: "schedules",
      columns: [id, ref("workspace_id"), ref("project_id"), ref("environment_id"), varchar("name", 200), varchar("cron", 120), varchar("kind", 20), text("plan"), boolean("enabled"), stamp("next_run_at", true), stamp("last_run_at", true), ref("last_run_id", true), text("last_error", true), varchar("created_by", 120), integer("rev"), stamp("created_at"), stamp("updated_at")],
      // The scheduler's scan: what is enabled and due.
      indices: [new TableIndex({ name: "schedules_project", columnNames: ["project_id"] }), new TableIndex({ name: "schedules_due", columnNames: ["enabled", "next_run_at"] })],
    }));
    await runner.createTable(new Table({
      name: "notification_targets",
      columns: [id, ref("workspace_id"), ref("project_id"), varchar("name", 200), varchar("kind", 20), varchar("notify_on", 20), boolean("enabled"), text("url", true), varchar("url_hint", 300, true), text("signing_secret", true), text("recipients", true), stamp("last_sent_at", true), varchar("last_status", 20, true), text("last_error", true), integer("rev"), stamp("created_at"), stamp("updated_at")],
      indices: [new TableIndex({ name: "notification_targets_project", columnNames: ["project_id"] })],
    }));
  }

  async down(runner: QueryRunner) {
    for (const table of ["notification_targets", "schedules"]) await runner.dropTable(table);
  }
}
