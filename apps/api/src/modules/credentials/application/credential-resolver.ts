import { Inject, Injectable } from "@nestjs/common";
import { createAuthenticator, type ScenarioAuth, type TlsMaterial } from "@eq/runner-core";
import type { CredentialRole, CredentialRow } from "../../../database/entities.ts";
import { Unreachable } from "../../../shared/errors.ts";
import { isoNow } from "../../../shared/ids.ts";
import { SecretBox } from "../../../shared/secret-box.ts";
import { HTTP_FETCH, HTTP_TLS_AGENT, SECRET_BOX } from "../../../shared/tokens.ts";
import { openExtras, resolveCredential, sealExtras } from "../domain/credential.ts";
import { CredentialRepository } from "../infrastructure/credential.repository.ts";

/** Which stored credential each kind of case presents. `none` presents nothing: that is the 401. */
const ROLE_FOR: Record<ScenarioAuth, CredentialRole | null> = { default: "primary", none: null, insufficient: "insufficient", "api-key": "alternate" };

export type Credentials = {
  /** The headers of a role as of the start of the run: what a report shows, what a load sends. */
  headersFor(auth: ScenarioAuth | undefined): Record<string, string>;
  /** The connection of a role: signs, renews and presents its client certificate per request. */
  fetchFor(auth: ScenarioAuth | undefined): typeof fetch;
  specHeaders: Record<string, string>;
  specFetch: typeof fetch;
};

/**
 * Turns an environment's stored credentials into the engine's authenticators, decrypting them
 * only for the run that uses them. A token (OAuth2) or a session (a cookie login) is obtained
 * here, once per run and before the first case — a credential that does not work fails the run
 * up front, and the token endpoint is not hammered per case. It is renewed when it expires or
 * a case gets a 401.
 *
 * A client certificate that rides along another kind (a bearer token over mutual TLS) is the
 * connection's, not the case's: the primary one is presented by every case that has none of
 * its own — the case without credentials included, which tests the API's authentication, not
 * the TLS handshake. A `mtls` credential is the certificate alone: there it *is* the identity,
 * and a case without credentials presents none — though it still trusts the CA the credential
 * names, which is about the server, not the client.
 */
@Injectable()
export class CredentialResolver {
  constructor(
    @Inject(CredentialRepository) private readonly credentials: CredentialRepository,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(HTTP_FETCH) private readonly fetchImpl: typeof fetch,
    @Inject(HTTP_TLS_AGENT) private readonly tlsAgent: (tls: Partial<TlsMaterial>) => unknown,
  ) {}

  async forEnvironment(environmentId: string, apiKeyHeader = "X-API-Key", baseUrl = "http://localhost"): Promise<Credentials> {
    const rows = await this.credentials.list(environmentId);
    const decrypted = rows.map((row) => ({ row, resolved: resolveCredential(row, row.secret ? this.box.decrypt(row.secret, row.id) : "", openExtras(row, this.box), apiKeyHeader) }));
    const primary = decrypted.find(({ row }) => row.role === "primary")?.resolved;
    const primaryTls = primary?.kind === "mtls" ? (primary.tls?.ca ? { ca: primary.tls.ca } : undefined) : primary?.tls;
    const transport = primaryTls ? this.tlsAgent(primaryTls) : undefined;
    const plain: typeof fetch = transport ? (input, init) => this.fetchImpl(input, { ...init, dispatcher: transport } as RequestInit) : this.fetchImpl;
    const roles = new Map<CredentialRole, { headers: Record<string, string>; fetch: typeof fetch }>();
    for (const { row, resolved } of decrypted) {
      const authenticator = createAuthenticator(resolved, {
        baseUrl,
        fetchImpl: this.fetchImpl,
        dispatcher: resolved.tls ? (row.role === "primary" && primary?.kind !== "mtls" ? transport : this.tlsAgent(resolved.tls)) : transport,
        onRefreshToken: (token) => this.keepRefreshToken(row, token),
      });
      let headers: Record<string, string>;
      try {
        headers = await authenticator.headers();
      } catch (error) {
        throw new Unreachable(`The ${row.role} credential (${row.kind}) did not authenticate: ${error instanceof Error ? error.message : String(error)}`);
      }
      roles.set(row.role, { headers, fetch: authenticator.fetch });
    }
    const roleOf = (auth: ScenarioAuth | undefined) => {
      const role = ROLE_FOR[auth ?? "default"];
      return role ? roles.get(role) : undefined;
    };
    const headersFor = (auth: ScenarioAuth | undefined) => ({ ...(roleOf(auth)?.headers ?? {}) });
    const fetchFor = (auth: ScenarioAuth | undefined) => roleOf(auth)?.fetch ?? plain;
    return { headersFor, fetchFor, specHeaders: headersFor("default"), specFetch: fetchFor("default") };
  }

  /** A rotated refresh token replaces the stored one: the old one may already be revoked. */
  private async keepRefreshToken(row: CredentialRow, refreshToken: string) {
    const current = await this.credentials.find(row.environmentId, row.role);
    if (!current || current.id !== row.id) return;
    sealExtras(current, { ...openExtras(current, this.box), refreshToken }, this.box);
    current.rev += 1;
    current.updatedAt = isoNow();
    await this.credentials.save(current);
  }
}
