/**
 * Accounts: users, their memberships in workspaces, invitations, refresh tokens and API tokens.
 * Every secret here is stored as a hash — a password with scrypt, a token with SHA-256 — so a
 * copy of the database grants nothing.
 */
import { Table, TableIndex, type MigrationInterface, type QueryRunner } from "typeorm";

const id = { name: "id", type: "varchar", length: "36", isPrimary: true };
const ref = (name: string, nullable = false) => ({ name, type: "varchar", length: "36", isNullable: nullable });
const stamp = (name: string, nullable = false) => ({ name, type: "varchar", length: "32", isNullable: nullable });
const varchar = (name: string, length: number, nullable = false) => ({ name, type: "varchar", length: String(length), isNullable: nullable });

export class Accounts1792200000000 implements MigrationInterface {
  name = "Accounts1792200000000";

  async up(runner: QueryRunner) {
    await runner.createTable(new Table({
      name: "users",
      columns: [id, varchar("email", 320), varchar("name", 200), varchar("password_hash", 300), varchar("status", 20), stamp("created_at"), stamp("updated_at")],
      indices: [new TableIndex({ name: "users_email", columnNames: ["email"], isUnique: true })],
    }));
    await runner.createTable(new Table({
      name: "memberships",
      columns: [id, ref("workspace_id"), ref("user_id"), varchar("role", 20), stamp("created_at")],
      indices: [new TableIndex({ name: "memberships_workspace_user", columnNames: ["workspace_id", "user_id"], isUnique: true }), new TableIndex({ name: "memberships_user", columnNames: ["user_id"] })],
    }));
    await runner.createTable(new Table({
      name: "invitations",
      columns: [id, ref("workspace_id"), varchar("email", 320), varchar("role", 20), varchar("token_hash", 64), stamp("expires_at"), stamp("accepted_at", true), ref("created_by"), stamp("created_at")],
      indices: [new TableIndex({ name: "invitations_token", columnNames: ["token_hash"], isUnique: true }), new TableIndex({ name: "invitations_workspace", columnNames: ["workspace_id"] })],
    }));
    await runner.createTable(new Table({
      name: "refresh_tokens",
      columns: [id, ref("user_id"), ref("family_id"), varchar("token_hash", 64), stamp("expires_at"), stamp("revoked_at", true), ref("replaced_by", true), stamp("created_at")],
      indices: [new TableIndex({ name: "refresh_tokens_hash", columnNames: ["token_hash"], isUnique: true }), new TableIndex({ name: "refresh_tokens_family", columnNames: ["family_id"] })],
    }));
    await runner.createTable(new Table({
      name: "api_tokens",
      columns: [id, ref("workspace_id"), varchar("name", 200), varchar("token_hash", 64), varchar("prefix", 16), varchar("role", 20), ref("created_by"), stamp("last_used_at", true), stamp("expires_at", true), stamp("revoked_at", true), stamp("created_at")],
      indices: [new TableIndex({ name: "api_tokens_hash", columnNames: ["token_hash"], isUnique: true }), new TableIndex({ name: "api_tokens_workspace", columnNames: ["workspace_id"] })],
    }));
  }

  async down(runner: QueryRunner) {
    for (const table of ["api_tokens", "refresh_tokens", "invitations", "memberships", "users"]) await runner.dropTable(table);
  }
}
