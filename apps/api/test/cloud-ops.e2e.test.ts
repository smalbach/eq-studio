/**
 * Operating a team deployment: password resets, the audit log, Prometheus metrics and single
 * sign-on against a mocked OpenID Connect provider.
 */
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import type { DataSource } from "typeorm";
import { readConfig } from "../src/config.ts";
import { AuditEventEntity, PasswordResetEntity } from "../src/database/entities.ts";
import type { Mail } from "../src/shared/mailer.ts";
import { Mailer } from "../src/shared/mailer.ts";
import { DATA_SOURCE } from "../src/shared/tokens.ts";
import { databases, start, waitFor, type Harness } from "./helpers.ts";

const example = JSON.parse(readFileSync(new URL("../../../examples/mock-store/mock-store.eq.json", import.meta.url), "utf8"));
const PASSWORD = "correct horse battery staple";
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

/** Captures what the API emails instead of sending it. */
function captureMail(h: Harness) {
  const sent: Mail[] = [];
  Object.assign(h.app.get(Mailer), { send: async (mail: Mail) => { sent.push(mail); return true; } });
  return sent;
}
const tokenIn = (mail: Mail) => /restablecer=([^\s&]+)/.exec(mail.text)?.[1] ?? "";

async function register(h: Harness, email: string) {
  const registered = await h.request("POST", "/v1/auth/register", { email, password: PASSWORD, name: email.split("@")[0], workspace: "Team" });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  return registered.body as { accessToken: string; refreshToken: string; workspaces: { id: string }[]; user: { id: string } };
}

async function invite(h: Harness, ownerToken: string, email: string, role: string) {
  const invited = await h.request("POST", "/v1/workspace/invitations", { email, role }, bearer(ownerToken));
  const accepted = await h.request("POST", "/v1/auth/accept-invitation", { token: invited.body.token, password: PASSWORD, name: role });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
  return accepted.body as { accessToken: string; refreshToken: string; user: { id: string } };
}

for (const database of databases()) {
  describe(`password reset, audit log and metrics over ${database.name}`, () => {
    let h: Harness;
    let sent: Mail[];
    let owner: Awaited<ReturnType<typeof register>>;
    const METRICS_TOKEN = "metrics-secret-for-tests";

    before(async () => {
      h = await start(database.config(), { cloud: { allowPrivateTargets: true }, configure: (config) => ({ ...config, publicUrl: "https://eq.example.com", mail: { url: "smtp://mail.test:25", from: "EQ <eq@example.com>" }, metrics: { enabled: true, token: METRICS_TOKEN } }) });
      sent = captureMail(h);
      owner = await register(h, "owner@example.com");
    });
    after(async () => { await h?.close(); });

    test("asking for a reset answers the same whether the email has an account or not", async () => {
      const known = await h.request("POST", "/v1/auth/password/forgot", { email: "Owner@Example.com" });
      const unknown = await h.request("POST", "/v1/auth/password/forgot", { email: "nobody@example.com" });
      assert.equal(known.status, 202);
      assert.deepEqual([unknown.status, unknown.body], [known.status, known.body]);
      await tick();
      assert.equal(sent.length, 1, "only the real account gets an email");
      assert.equal(sent[0].to, "owner@example.com");
      assert.match(sent[0].text, /https:\/\/eq\.example\.com\/\?restablecer=eqp_/, "the link is built on EQ_PUBLIC_URL, never the Host header");
    });

    test("a reset link works once, sets the password and closes every session", async () => {
      const token = tokenIn(sent[0]);
      const weak = await h.request("POST", "/v1/auth/password/reset", { token, password: "short" });
      assert.equal(weak.status, 422, "a weak password does not spend the link");
      const next = "a brand new long password";
      assert.equal((await h.request("POST", "/v1/auth/password/reset", { token, password: next })).status, 204);
      assert.equal((await h.request("POST", "/v1/auth/password/reset", { token, password: "yet another long password" })).status, 404, "single use");
      assert.equal((await h.request("POST", "/v1/auth/refresh", { refreshToken: owner.refreshToken })).status, 401, "the sessions opened before are closed");
      assert.equal((await h.request("POST", "/v1/auth/login", { email: "owner@example.com", password: PASSWORD })).status, 401);
      const login = await h.request("POST", "/v1/auth/login", { email: "owner@example.com", password: next });
      assert.equal(login.status, 200);
      owner = { ...owner, accessToken: login.body.accessToken, refreshToken: login.body.refreshToken };
    });

    test("using one link spends the others, and an expired link is refused", async () => {
      sent.length = 0;
      await h.request("POST", "/v1/auth/password/forgot", { email: "owner@example.com" });
      await h.request("POST", "/v1/auth/password/forgot", { email: "owner@example.com" });
      await tick();
      const [first, second] = sent.map(tokenIn);
      assert.ok(first && second && first !== second);
      // Expire the first by hand: the reset table is not append-only.
      const db = h.app.get<DataSource>(DATA_SOURCE);
      await db.getRepository(PasswordResetEntity).update({ tokenHash: createHash("sha256").update(first).digest("hex") }, { expiresAt: "2000-01-01T00:00:00.000Z" });
      assert.equal((await h.request("POST", "/v1/auth/password/reset", { token: first, password: "expired link password" })).status, 404);
      assert.equal((await h.request("POST", "/v1/auth/password/reset", { token: second, password: "a brand new long password" })).status, 204);
      const login = await h.request("POST", "/v1/auth/login", { email: "owner@example.com", password: "a brand new long password" });
      owner = { ...owner, accessToken: login.body.accessToken, refreshToken: login.body.refreshToken };
    });

    test("asking too often is limited per email, known or not", async () => {
      for (const email of ["limit@example.com", "owner@example.com"]) {
        const statuses = [];
        for (let index = 0; index < 4; index += 1) statuses.push((await h.request("POST", "/v1/auth/password/forgot", { email })).status);
        // The owner already asked twice in this window, so the limit comes sooner — the same limit as for anyone.
        assert.equal(statuses.at(-1), 429, `${email}: ${statuses.join(",")}`);
      }
    });

    test("with SMTP an admin's reset link goes to the member's email and is not shown", async () => {
      const member = await invite(h, owner.accessToken, "member@example.com", "editor");
      sent.length = 0;
      const link = await h.request("POST", `/v1/workspace/members/${member.user.id}/password-reset`, undefined, bearer(owner.accessToken));
      assert.equal(link.status, 201, JSON.stringify(link.body));
      assert.equal(link.body.sent, true);
      assert.equal(link.body.token, null);
      assert.equal(sent[0]?.to, "member@example.com");
      assert.equal((await h.request("POST", `/v1/workspace/members/${owner.user.id}/password-reset`, undefined, bearer(member.accessToken))).status, 403, "an editor cannot");
    });

    test("security events land in the workspace's audit log, without secrets", async () => {
      assert.equal((await h.request("POST", "/v1/auth/login", { email: "owner@example.com", password: "wrong wrong wrong" })).status, 401);
      await h.request("POST", "/v1/projects/import", { file: example }, bearer(owner.accessToken));
      const environment = "local";
      const secret = "super-secret-credential-value";
      const path = `/v1/projects/mock-store/environments/${environment}/credentials/primary`;
      assert.equal((await h.request("PUT", path, { kind: "bearer", secret }, bearer(owner.accessToken))).status, 200);
      assert.equal((await h.request("PUT", path, { kind: "bearer", secret: `${secret}-2` }, bearer(owner.accessToken))).status, 200);
      assert.equal((await h.request("DELETE", path, undefined, bearer(owner.accessToken))).status, 204);
      const issued = await h.request("POST", "/v1/workspace/api-tokens", { name: "CI", role: "editor" }, bearer(owner.accessToken));
      assert.equal((await h.request("DELETE", `/v1/workspace/api-tokens/${issued.body.id}`, undefined, bearer(owner.accessToken))).status, 204);
      const viewer = await invite(h, owner.accessToken, "viewer@example.com", "viewer");
      assert.equal((await h.request("PATCH", `/v1/workspace/members/${viewer.user.id}`, { role: "editor" }, bearer(owner.accessToken))).status, 204);
      assert.equal((await h.request("DELETE", `/v1/workspace/members/${viewer.user.id}`, undefined, bearer(owner.accessToken))).status, 204);
      assert.equal((await h.request("DELETE", "/v1/projects/mock-store", undefined, bearer(owner.accessToken))).status, 204);

      const log = await h.request("GET", "/v1/audit?limit=200", undefined, bearer(owner.accessToken));
      assert.equal(log.status, 200, JSON.stringify(log.body));
      const types = new Set(log.body.items.map((item: { type: string }) => item.type));
      for (const type of ["auth.sign_in.succeeded", "auth.sign_in.failed", "auth.password.reset", "auth.password.reset_link_created", "member.invited", "member.joined", "member.role_changed", "member.removed", "api_token.created", "api_token.revoked", "credential.created", "credential.updated", "credential.deleted", "project.deleted"]) assert.ok(types.has(type), `${type} missing from ${[...types].join(", ")}`);
      const text = JSON.stringify(log.body);
      assert.ok(!text.includes(secret), "never a credential's value");
      assert.ok(!text.includes(issued.body.token), "never a token");
      const role = log.body.items.find((item: { type: string }) => item.type === "member.role_changed");
      assert.deepEqual([role.actorLabel, role.targetLabel, role.detail], ["owner@example.com", "viewer@example.com", { from: "viewer", to: "editor" }]);
      assert.equal(log.body.items.find((item: { type: string }) => item.type === "auth.sign_in.failed").detail.reason, "wrong_password");
      assert.ok(log.body.items.every((item: { ip: string | null }) => item.ip), "with the client's address");
    });

    test("the log filters by type and date, pages, and is for admins and owners only", async () => {
      const credentials = await h.request("GET", "/v1/audit?type=credential.", undefined, bearer(owner.accessToken));
      assert.deepEqual(credentials.body.items.map((item: { type: string }) => item.type), ["credential.deleted", "credential.updated", "credential.created"], "newest first");
      const exact = await h.request("GET", "/v1/audit?type=member.removed,project.deleted", undefined, bearer(owner.accessToken));
      assert.deepEqual(exact.body.items.map((item: { type: string }) => item.type).sort(), ["member.removed", "project.deleted"]);
      const today = new Date().toISOString().slice(0, 10);
      assert.ok((await h.request("GET", `/v1/audit?from=${today}&to=${today}`, undefined, bearer(owner.accessToken))).body.items.length > 0);
      assert.equal((await h.request("GET", "/v1/audit?to=2000-01-01", undefined, bearer(owner.accessToken))).body.items.length, 0);
      assert.equal((await h.request("GET", "/v1/audit?from=yesterday", undefined, bearer(owner.accessToken))).status, 422);

      const seen: string[] = [];
      let cursor = "";
      for (let page = 0; page < 50; page += 1) {
        const answer = await h.request("GET", `/v1/audit?limit=3${cursor ? `&cursor=${cursor}` : ""}`, undefined, bearer(owner.accessToken));
        seen.push(...answer.body.items.map((item: { id: string }) => item.id));
        if (!answer.body.nextCursor) break;
        cursor = answer.body.nextCursor;
      }
      const all = (await h.request("GET", "/v1/audit?limit=200", undefined, bearer(owner.accessToken))).body.items.map((item: { id: string }) => item.id);
      assert.deepEqual(seen, all, "the pages add up to the whole log, once each");

      const editor = await invite(h, owner.accessToken, "editor@example.com", "editor");
      assert.equal((await h.request("GET", "/v1/audit", undefined, bearer(editor.accessToken))).status, 403);
      const admin = await invite(h, owner.accessToken, "admin@example.com", "admin");
      assert.equal((await h.request("GET", "/v1/audit", undefined, bearer(admin.accessToken))).status, 200);
      const other = await h.request("POST", "/v1/auth/workspaces", { name: "Elsewhere" }, bearer(admin.accessToken));
      const elsewhere = await h.request("GET", "/v1/audit", undefined, { ...bearer(admin.accessToken), "x-workspace": other.body.id });
      assert.ok(elsewhere.body.items.every((item: { type: string }) => item.type !== "member.removed"), "another workspace's log is its own");
    });

    test("the database refuses to change or delete an audit row", async () => {
      const db = h.app.get<DataSource>(DATA_SOURCE);
      const events = db.getRepository(AuditEventEntity);
      const count = await events.count();
      assert.ok(count > 0);
      await assert.rejects(events.createQueryBuilder().update().set({ type: "x" }).execute(), /append-only/);
      await assert.rejects(events.createQueryBuilder().delete().execute(), /append-only/);
      assert.equal(await events.count(), count);
    });

    test("metrics need their token, and count requests and runs", async () => {
      assert.equal((await fetch(`${h.base}/metrics`)).status, 401);
      assert.equal((await fetch(`${h.base}/metrics`, { headers: bearer("wrong") })).status, 401);
      await h.request("POST", "/v1/projects/import", { file: example }, bearer(owner.accessToken));
      await h.request("PATCH", "/v1/projects/mock-store/environments/local", { baseUrl: h.mock }, bearer(owner.accessToken));
      const started = await h.request("POST", "/v1/projects/mock-store/runs", { environment: "local", readOnly: true }, bearer(owner.accessToken));
      assert.equal(started.status, 202, JSON.stringify(started.body));
      await waitFor({ request: (method, path, body) => h.request(method, path, body, bearer(owner.accessToken)) }, started.body.id);
      const response = await fetch(`${h.base}/metrics`, { headers: bearer(METRICS_TOKEN) });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /text\/plain/);
      const text = await response.text();
      assert.match(text, /^process_cpu_user_seconds_total \d/m);
      assert.match(text, /^eq_http_request_duration_seconds_count\{method="POST",route="\/v1\/auth\/login",status="200"\} \d+/m);
      assert.match(text, /^eq_http_request_duration_seconds_bucket\{le="0.1",method="GET",route="\/v1\/runs\/:run",status="200"\} \d+/m, "routes by pattern, not by id");
      assert.match(text, /^eq_runs_queued_total\{kind="functional"\} 1$/m);
      assert.match(text, /^eq_runs_started_total 1$/m);
      assert.match(text, /^eq_runs_finished_total\{status="(passed|failed)"\} 1$/m);
      assert.match(text, /^eq_run_queue_depth\{status="queued"\} 0$/m);
    });
  });

  describe(`password reset and metrics without SMTP over ${database.name}`, () => {
    let h: Harness;
    let owner: Awaited<ReturnType<typeof register>>;
    before(async () => {
      h = await start(database.config(), { cloud: { allowPrivateTargets: true } });
      owner = await register(h, "owner@example.com");
    });
    after(async () => { await h?.close(); });

    test("asking still answers 202, and nothing is sent", async () => {
      assert.equal((await h.request("POST", "/v1/auth/password/forgot", { email: "owner@example.com" })).status, 202);
    });

    test("an admin gets a member's link to pass on, only for someone below them and in no other workspace", async () => {
      const member = await invite(h, owner.accessToken, "member@example.com", "editor");
      const link = await h.request("POST", `/v1/workspace/members/${member.user.id}/password-reset`, undefined, bearer(owner.accessToken));
      assert.equal(link.status, 201, JSON.stringify(link.body));
      assert.equal(link.body.sent, false);
      assert.match(link.body.token, /^eqp_/);
      assert.equal((await h.request("POST", "/v1/auth/password/reset", { token: link.body.token, password: "member's new password" })).status, 204);
      assert.equal((await h.request("POST", "/v1/auth/login", { email: "member@example.com", password: "member's new password" })).status, 200);

      const admin = await invite(h, owner.accessToken, "admin@example.com", "admin");
      const peer = await invite(h, owner.accessToken, "peer@example.com", "admin");
      assert.equal((await h.request("POST", `/v1/workspace/members/${peer.user.id}/password-reset`, undefined, bearer(admin.accessToken))).status, 403, "an admin cannot take over another admin");
      assert.equal((await h.request("POST", `/v1/workspace/members/${owner.user.id}/password-reset`, undefined, bearer(admin.accessToken))).status, 403);
      await h.request("POST", "/v1/auth/workspaces", { name: "Member's own" }, bearer((await h.request("POST", "/v1/auth/login", { email: "member@example.com", password: "member's new password" })).body.accessToken));
      assert.equal((await h.request("POST", `/v1/workspace/members/${member.user.id}/password-reset`, undefined, bearer(owner.accessToken))).status, 409, "the link would open a workspace the owner does not run");
    });

    test("metrics are off by default", async () => {
      assert.equal((await fetch(`${h.base}/metrics`)).status, 404);
    });
  });
}

/** A minimal OpenID Connect provider: discovery, keys and a token endpoint that checks PKCE. */
async function mockProvider(clientId: string, clientSecret: string) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", use: "sig", alg: "RS256" };
  const codes = new Map<string, { challenge: string; nonce: string; redirectUri: string; claims: Record<string, unknown> }>();
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  let issuer = "";
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", issuer);
    const json = (status: number, body: unknown) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); };
    if (url.pathname === "/.well-known/openid-configuration") return json(200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["client_secret_post"] });
    if (url.pathname === "/jwks") return json(200, { keys: [jwk] });
    if (url.pathname === "/token" && request.method === "POST") {
      let raw = "";
      request.on("data", (chunk) => { raw += chunk; });
      request.on("end", () => {
        const form = new URLSearchParams(raw);
        const entry = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? "");
        if (!entry || form.get("client_id") !== clientId || form.get("client_secret") !== clientSecret || form.get("redirect_uri") !== entry.redirectUri) return json(400, { error: "invalid_grant" });
        if (createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") !== entry.challenge) return json(400, { error: "invalid_grant", error_description: "PKCE" });
        const now = Math.floor(Date.now() / 1000);
        const body = `${b64({ alg: "RS256", kid: "test-key", typ: "JWT" })}.${b64({ iss: issuer, aud: clientId, iat: now, exp: now + 300, nonce: entry.nonce, ...entry.claims })}`;
        json(200, { access_token: randomBytes(16).toString("hex"), token_type: "Bearer", expires_in: 300, id_token: `${body}.${sign("sha256", Buffer.from(body), privateKey).toString("base64url")}` });
      });
      return;
    }
    json(404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { issuer, codes, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const cookiesOf = (response: Response) => Object.fromEntries(response.headers.getSetCookie().map((cookie) => cookie.split(";")[0].split("=") as [string, string]));

for (const registration of ["invite", "open"] as const) {
  describe(`single sign-on with OpenID Connect (${registration} registration)`, () => {
    let h: Harness;
    let provider: Awaited<ReturnType<typeof mockProvider>>;
    const PUBLIC = "https://eq.example.com";

    before(async () => {
      provider = await mockProvider("eq-client", "eq-secret");
      h = await start(databases()[0].config(), { cloud: { allowPrivateTargets: true, registration }, configure: (config) => ({ ...config, publicUrl: PUBLIC, oidc: { issuer: provider.issuer, clientId: "eq-client", clientSecret: "eq-secret", allowedDomains: ["example.com"], name: "Example SSO", scopes: "openid email profile" } }) });
    });
    after(async () => { await h?.close(); await provider?.close(); });

    /** The browser's round trip: start, the provider's login (here: deciding the claims), the callback. */
    async function signIn(claims: Record<string, unknown>, tamper?: (params: URLSearchParams) => void) {
      const started = await fetch(`${h.base}/v1/auth/oidc/start`, { redirect: "manual" });
      assert.equal(started.status, 302);
      const authorize = new URL(started.headers.get("location")!);
      assert.equal(`${authorize.origin}${authorize.pathname}`, `${provider.issuer}/authorize`);
      assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
      assert.equal(authorize.searchParams.get("redirect_uri"), `${PUBLIC}/v1/auth/oidc/callback`);
      const flow = cookiesOf(started).eq_oidc;
      assert.ok(flow, "the flow travels in a cookie");
      const code = randomBytes(12).toString("hex");
      provider.codes.set(code, { challenge: authorize.searchParams.get("code_challenge")!, nonce: authorize.searchParams.get("nonce")!, redirectUri: authorize.searchParams.get("redirect_uri")!, claims });
      const params = new URLSearchParams({ code, state: authorize.searchParams.get("state")! });
      tamper?.(params);
      const callback = await fetch(`${h.base}/v1/auth/oidc/callback?${params}`, { redirect: "manual", headers: { cookie: `eq_oidc=${flow}` } });
      assert.equal(callback.status, 302);
      return { location: callback.headers.get("location")!, refresh: cookiesOf(callback).eq_refresh };
    }
    const session = async (refresh: string) => (await (await fetch(`${h.base}/v1/auth/refresh`, { method: "POST", headers: { "content-type": "application/json", cookie: `eq_refresh=${refresh}` }, body: "{}" })).json()) as { accessToken: string; user: { id: string; email: string }; workspaces: { id: string; role: string }[] };

    test("the sign-in page learns there is a provider", async () => {
      assert.deepEqual((await h.request("GET", "/health")).body.sso, { name: "Example SSO" });
    });

    test("the first account signs in and owns its workspace; an existing account is found by verified email", async () => {
      const first = await signIn({ sub: "u1", email: "Owner@Example.com", email_verified: true, name: "Owner" });
      assert.equal(first.location, `${PUBLIC}/`);
      const owner = await session(first.refresh);
      assert.equal(owner.user.email, "owner@example.com");
      assert.equal(owner.workspaces[0].role, "owner");
      const again = await session((await signIn({ sub: "u1", email: "owner@example.com", email_verified: true })).refresh);
      assert.equal(again.user.id, owner.user.id, "the same account, not a new one");
      const log = await h.request("GET", "/v1/audit?type=auth.sign_in.succeeded", undefined, bearer(again.accessToken));
      assert.ok(log.body.items.some((item: { detail: { method: string } }) => item.detail.method === "oidc"));
    });

    test("an unverified email, another domain or a tampered state is refused", async () => {
      assert.equal((await signIn({ sub: "u2", email: "x@example.com", email_verified: false })).location, `${PUBLIC}/?sso_error=unverified`);
      assert.equal((await signIn({ sub: "u3", email: "x@elsewhere.org", email_verified: true })).location, `${PUBLIC}/?sso_error=domain`);
      const tampered = await signIn({ sub: "u1", email: "owner@example.com", email_verified: true }, (params) => params.set("state", "forged"));
      assert.equal(tampered.location, `${PUBLIC}/?sso_error=failed`);
      assert.equal(tampered.refresh, undefined);
      const replay = await fetch(`${h.base}/v1/auth/oidc/callback?code=x&state=y`, { redirect: "manual" });
      assert.equal(replay.headers.get("location"), `${PUBLIC}/?sso_error=expired`, "no flow cookie, no sign-in");
    });

    test(registration === "invite" ? "a new email signs in only with an invitation, and joins that workspace" : "a new email gets an account and a workspace of its own", async () => {
      const outcome = await signIn({ sub: "u4", email: "newcomer@example.com", email_verified: true, name: "Newcomer" });
      if (registration === "open") {
        const newcomer = await session(outcome.refresh);
        assert.deepEqual(newcomer.workspaces.map((item: { role: string }) => item.role), ["owner"]);
        return;
      }
      assert.equal(outcome.location, `${PUBLIC}/?sso_error=not_invited`);
      const owner = await session((await signIn({ sub: "u1", email: "owner@example.com", email_verified: true })).refresh);
      await h.request("POST", "/v1/workspace/invitations", { email: "newcomer@example.com", role: "editor" }, bearer(owner.accessToken));
      const invited = await session((await signIn({ sub: "u4", email: "newcomer@example.com", email_verified: true, name: "Newcomer" })).refresh);
      assert.deepEqual(invited.workspaces.map((item: { id: string; role: string }) => [item.id, item.role]), [[owner.workspaces[0].id, "editor"]]);
      assert.equal((await h.request("GET", "/v1/workspace/invitations", undefined, bearer(owner.accessToken))).body.length, 0, "the invitation is used");
    });
  });
}

describe("the operations settings, read from the environment", () => {
  const cloud = { EQ_MODE: "cloud", EQ_CLOUD_SQLITE: "true", EQ_JWT_SECRET: "x".repeat(32), EQ_SECRETS_KEY: randomBytes(32).toString("base64") };

  test("metrics, email and SSO are off unless configured", () => {
    const config = readConfig(cloud);
    assert.deepEqual([config.metrics, config.mail?.url, config.oidc, config.devCloud], [{ enabled: false, token: null }, null, undefined, true]);
    assert.equal(readConfig({ ...cloud, EQ_CLOUD_SQLITE: undefined, EQ_DATABASE_URL: "postgres://db/eq" }).devCloud, false, "a real deployment never logs reset links");
  });

  test("emailed links and SSO need the public address, never a request's Host", () => {
    assert.throws(() => readConfig({ ...cloud, EQ_SMTP_URL: "smtp://mail:25" }), /EQ_PUBLIC_URL/);
    assert.throws(() => readConfig({ ...cloud, EQ_OIDC_ISSUER: "https://idp.example.com", EQ_OIDC_CLIENT_ID: "eq" }), /EQ_PUBLIC_URL/);
    const config = readConfig({ ...cloud, EQ_PUBLIC_URL: "https://eq.example.com/", EQ_METRICS: "true", EQ_METRICS_TOKEN: "t", EQ_OIDC_ISSUER: "https://idp.example.com", EQ_OIDC_CLIENT_ID: "eq", EQ_OIDC_ALLOWED_DOMAINS: " Example.com, example.org " });
    assert.equal(config.publicUrl, "https://eq.example.com");
    assert.deepEqual(config.metrics, { enabled: true, token: "t" });
    assert.deepEqual(config.oidc?.allowedDomains, ["example.com", "example.org"]);
  });
});
