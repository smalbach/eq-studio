/**
 * Credential kinds beyond a header: OAuth2 refresh tokens, session cookies, HMAC signatures and
 * client certificates. Their settings (`options`), the secrets besides the main one, encrypted
 * together (`extra_secrets`), and what a read may show of those (`secret_hints`).
 */
import { TableColumn, type MigrationInterface, type QueryRunner } from "typeorm";

const COLUMNS = ["options", "extra_secrets", "secret_hints"];

export class CredentialKinds1792450000000 implements MigrationInterface {
  name = "CredentialKinds1792450000000";

  async up(runner: QueryRunner) {
    for (const name of COLUMNS) await runner.addColumn("credentials", new TableColumn({ name, type: "text", isNullable: true }));
  }

  async down(runner: QueryRunner) {
    for (const name of [...COLUMNS].reverse()) await runner.dropColumn("credentials", name);
  }
}
