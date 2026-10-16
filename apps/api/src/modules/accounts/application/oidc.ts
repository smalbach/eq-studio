/**
 * Single sign-on with an OpenID Connect provider: authorization code with PKCE (S256), `state`
 * and `nonce`, through openid-client — discovery, the code exchange and every ID token check
 * (issuer, audience, expiry, nonce) are the library's, not ours.
 *
 * The account is found by the provider's **verified** email: an existing account is signed in
 * (its password, if any, keeps working); a new email gets an account only as registration would
 * allow it — anyone with `EQ_REGISTRATION=open`, otherwise only someone with a pending
 * invitation (or the very first account). Pending invitations for the email are accepted on the
 * way in: the provider has just proven the address is theirs.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import * as client from "openid-client";
import type { AppConfig, OidcConfig } from "../../../config.ts";
import type { UserRow } from "../../../database/entities.ts";
import { DomainError, Forbidden } from "../../../shared/errors.ts";
import { isoNow, uuidv7 } from "../../../shared/ids.ts";
import { APP_CONFIG } from "../../../shared/tokens.ts";
import { AuditLog } from "../../audit/audit-log.ts";
import { AccountsRepository } from "../infrastructure/accounts.repository.ts";
import { issueSession, type Session } from "./accounts-commands.ts";

/** Why a sign-in was refused, as the web app shows it (`/?sso_error=<code>`). */
export type SsoFailure = "unverified" | "domain" | "not_invited" | "disabled" | "failed";
export class SsoRefused extends DomainError {
  constructor(readonly code: SsoFailure, message: string) { super(message, 403, "Forbidden"); }
}

const FLOW_TTL_MS = 10 * 60_000;
/** An account that signs in only through the provider: no password hash can match it. */
export const NO_PASSWORD = "sso$none";

export type OidcFlow = { state: string; nonce: string; verifier: string; exp: number };

/** The provider's configuration, discovered once and kept; and the short-lived flow cookie. */
@Injectable()
export class OidcClient {
  private discovered: Promise<client.Configuration> | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get settings(): OidcConfig | null { return this.config.oidc ?? null; }
  get redirectUri() { return `${this.config.publicUrl}/v1/auth/oidc/callback`; }

  private configuration() {
    const oidc = this.settings!;
    const issuer = new URL(oidc.issuer);
    // Plain HTTP only for a provider on this machine (a test, a local Keycloak): never across a network.
    const local = issuer.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(issuer.hostname);
    this.discovered ??= client.discovery(issuer, oidc.clientId, oidc.clientSecret ?? undefined, oidc.clientSecret ? client.ClientSecretPost(oidc.clientSecret) : client.None(), local ? { execute: [client.allowInsecureRequests] } : undefined)
      .catch((error) => { this.discovered = null; throw error; });
    return this.discovered;
  }

  /** Where to send the browser, and the flow to keep in its cookie until it comes back. */
  async start() {
    const configuration = await this.configuration();
    const flow: OidcFlow = { state: client.randomState(), nonce: client.randomNonce(), verifier: client.randomPKCECodeVerifier(), exp: Date.now() + FLOW_TTL_MS };
    const url = client.buildAuthorizationUrl(configuration, {
      redirect_uri: this.redirectUri, scope: this.settings!.scopes, state: flow.state, nonce: flow.nonce,
      code_challenge: await client.calculatePKCECodeChallenge(flow.verifier), code_challenge_method: "S256",
    });
    return { url: url.href, cookie: this.seal(flow) };
  }

  /** The provider's answer, checked against the flow: the verified claims we sign in with. */
  async finish(callbackUrl: URL, flow: OidcFlow) {
    const configuration = await this.configuration();
    const tokens = await client.authorizationCodeGrant(configuration, callbackUrl, { pkceCodeVerifier: flow.verifier, expectedState: flow.state, expectedNonce: flow.nonce, idTokenExpected: true });
    const claims = tokens.claims();
    if (!claims) throw new SsoRefused("failed", "The provider returned no ID token");
    return { email: typeof claims.email === "string" ? claims.email : null, verified: claims.email_verified === true, name: typeof claims.name === "string" ? claims.name : null, subject: claims.sub };
  }

  /** The flow as an HMAC-signed cookie value: nothing to store between the two requests. */
  seal(flow: OidcFlow) {
    const body = Buffer.from(JSON.stringify(flow)).toString("base64url");
    return `${body}.${this.sign(body)}`;
  }

  open(value: string | undefined): OidcFlow | null {
    const [body, signature] = (value ?? "").split(".");
    if (!body || !signature) return null;
    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const flow = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OidcFlow;
      return typeof flow.exp === "number" && flow.exp > Date.now() ? flow : null;
    } catch { return null; }
  }

  private sign(body: string) { return createHmac("sha256", this.config.auth!.jwtSecret).update(`oidc-flow:${body}`).digest("base64url"); }
}

export class SsoSignInCommand { constructor(readonly email: string | null, readonly verified: boolean, readonly name: string | null) {} }

@CommandHandler(SsoSignInCommand)
export class SsoSignInHandler implements ICommandHandler<SsoSignInCommand, Session> {
  constructor(@Inject(AccountsRepository) private readonly accounts: AccountsRepository, @Inject(APP_CONFIG) private readonly config: AppConfig, @Inject(AuditLog) private readonly audit: AuditLog) {}

  async execute({ email: given, verified, name }: SsoSignInCommand) {
    if (!given || !verified) throw new SsoRefused("unverified", "The provider did not confirm a verified email for this account");
    const email = given.toLowerCase();
    const domains = this.config.oidc?.allowedDomains ?? [];
    if (domains.length && !domains.includes(email.split("@").pop() ?? "")) throw new SsoRefused("domain", `Only accounts of ${domains.join(", ")} sign in here`);

    const now = isoNow();
    const invitations = (await this.accounts.pendingInvitationsFor(email)).filter((item) => item.expiresAt > now);
    let user = await this.accounts.userByEmail(email);
    if (user && user.status !== "active") {
      await this.audit.record({ workspaceId: (await this.accounts.membershipsOf(user.id)).map((item) => item.workspaceId), type: "auth.sign_in.failed", actor: { userId: user.id }, detail: { method: "oidc", reason: "disabled" } });
      throw new SsoRefused("disabled", "This account is disabled");
    }
    let ownWorkspace: string | undefined;
    if (!user) {
      const first = (await this.accounts.userCount()) === 0;
      if (this.config.auth!.registration !== "open" && !first && !invitations.length) throw new SsoRefused("not_invited", "Registration is by invitation: ask an administrator of your workspace to invite this email");
      const account: UserRow = { id: uuidv7(), email, name: (name ?? email.split("@")[0]).slice(0, 200), passwordHash: NO_PASSWORD, status: "active", createdAt: now, updatedAt: now };
      // An invited person joins the workspaces they were invited to; anyone else gets their own.
      if (!invitations.length) ownWorkspace = uuidv7();
      await this.accounts.transaction(async (tx) => {
        await this.accounts.saveUser(account, tx);
        if (ownWorkspace) {
          await this.accounts.saveWorkspace({ id: ownWorkspace, name: `${account.name}'s workspace`, createdAt: now }, tx);
          await this.accounts.saveMembership({ id: uuidv7(), workspaceId: ownWorkspace, userId: account.id, role: "owner", createdAt: now }, tx);
        }
      });
      user = account;
    }
    const account = user;
    for (const invitation of invitations) {
      const joined = await this.accounts.transaction(async (tx) => {
        if (await this.accounts.membership(invitation.workspaceId, account.id, tx)) { await this.accounts.saveInvitation({ ...invitation, acceptedAt: now }, tx); return false; }
        await this.accounts.saveMembership({ id: uuidv7(), workspaceId: invitation.workspaceId, userId: account.id, role: invitation.role, createdAt: now }, tx);
        await this.accounts.saveInvitation({ ...invitation, acceptedAt: now }, tx);
        return true;
      });
      if (joined) await this.audit.record({ workspaceId: invitation.workspaceId, type: "member.joined", actor: { userId: account.id }, target: { type: "user", id: account.id, label: account.email }, detail: { role: invitation.role, method: "oidc" } });
    }
    const session = await issueSession(this.accounts, this.config, account, undefined, ownWorkspace ?? invitations[0]?.workspaceId);
    if (!session.workspaces.length) throw new Forbidden("This account belongs to no workspace yet: ask for an invitation");
    await this.audit.record({ workspaceId: session.workspaces.map((item) => item.id), type: "auth.sign_in.succeeded", actor: { userId: account.id }, detail: { method: "oidc" } });
    return session;
  }
}
