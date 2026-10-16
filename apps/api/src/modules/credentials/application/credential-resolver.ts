import { Inject, Injectable } from "@nestjs/common";
import type { ScenarioAuth } from "@eq/runner-core";
import type { CredentialRole, CredentialRow } from "../../../database/entities.ts";
import { Unreachable } from "../../../shared/errors.ts";
import { SecretBox } from "../../../shared/secret-box.ts";
import { HTTP_FETCH, SECRET_BOX } from "../../../shared/tokens.ts";
import { CredentialRepository } from "../infrastructure/credential.repository.ts";

/** Which stored credential each kind of case presents. `none` presents nothing: that is the 401. */
const ROLE_FOR: Record<ScenarioAuth, CredentialRole | null> = { default: "primary", none: null, insufficient: "insufficient", "api-key": "alternate" };

export type Credentials = { headersFor(auth: ScenarioAuth | undefined): Record<string, string>; specHeaders: Record<string, string> };

/**
 * Turns an environment's stored credentials into request headers, decrypting them only for the
 * run that uses them. An OAuth2 client-credentials credential is exchanged for a token here,
 * once per run — the token endpoint is the user's, and minting a token per case would hammer it.
 */
@Injectable()
export class CredentialResolver {
  constructor(@Inject(CredentialRepository) private readonly credentials: CredentialRepository, @Inject(SECRET_BOX) private readonly box: SecretBox, @Inject(HTTP_FETCH) private readonly fetchImpl: typeof fetch) {}

  async forEnvironment(environmentId: string, apiKeyHeader = "X-API-Key"): Promise<Credentials> {
    const rows = await this.credentials.list(environmentId);
    const headers = new Map<CredentialRole, Record<string, string>>();
    for (const row of rows) headers.set(row.role, await this.headersOf(row, apiKeyHeader));
    const headersFor = (auth: ScenarioAuth | undefined) => {
      const role = ROLE_FOR[auth ?? "default"];
      return role ? { ...(headers.get(role) ?? {}) } : {};
    };
    return { headersFor, specHeaders: headersFor("default") };
  }

  private secretOf(row: CredentialRow) {
    return row.secret ? this.box.decrypt(row.secret, row.id) : "";
  }

  private async headersOf(row: CredentialRow, apiKeyHeader: string): Promise<Record<string, string>> {
    const secret = this.secretOf(row);
    if (row.kind === "bearer") return secret ? { Authorization: `Bearer ${secret}` } : {};
    if (row.kind === "api_key") return secret ? { [row.headerName ?? apiKeyHeader]: secret } : {};
    if (row.kind === "basic") return row.username ? { Authorization: `Basic ${Buffer.from(`${row.username}:${secret}`, "utf8").toString("base64")}` } : {};
    return { Authorization: `Bearer ${await this.clientCredentialsToken(row, secret)}` };
  }

  private async clientCredentialsToken(row: CredentialRow, secret: string) {
    if (!row.tokenUrl || !row.clientId) throw new Unreachable("The OAuth2 credential needs a token URL and a client id");
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: row.clientId, client_secret: secret, ...(row.scope ? { scope: row.scope } : {}) });
    let response: Response;
    try {
      response = await this.fetchImpl(row.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body, signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      throw new Unreachable(`The token endpoint did not answer: ${error instanceof Error ? error.message : String(error)}`);
    }
    const payload = await response.json().catch(() => ({})) as { access_token?: string; error?: string };
    if (!response.ok || !payload.access_token) throw new Unreachable(`The token endpoint answered ${response.status}${payload.error ? ` (${payload.error})` : ""}`);
    return payload.access_token;
  }
}
