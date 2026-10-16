import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { isBlockedAddress } from "../src/shared/guarded-fetch.ts";
import { databases, start, waitFor, type Harness } from "./helpers.ts";

const example = JSON.parse(readFileSync(new URL("../../../examples/mock-store/mock-store.eq.json", import.meta.url), "utf8"));
const PASSWORD = "correct horse battery staple";
const bearer = (token: string, workspace?: string) => ({ authorization: `Bearer ${token}`, ...(workspace ? { "x-workspace": workspace } : {}) });

for (const database of databases()) {
  describe(`accounts and roles over ${database.name}`, () => {
    let h: Harness;
    let owner: { accessToken: string; refreshToken: string; workspaces: { id: string }[] };
    let workspace = "";
    const as: Record<string, string> = {};

    before(async () => { h = await start(database.config(), { cloud: { allowPrivateTargets: true } }); });
    after(async () => { await h?.close(); });

    test("only health is public; everything else needs a token", async () => {
      assert.equal((await h.request("GET", "/health")).body.auth, "required");
      const denied = await h.request("GET", "/v1/projects");
      assert.equal(denied.status, 401);
      assert.match(denied.type, /problem\+json/);
      assert.equal((await h.request("GET", "/v1/projects", undefined, bearer("not-a-token"))).status, 401);
    });

    test("the first account registers; after it, registration is by invitation", async () => {
      const registered = await h.request("POST", "/v1/auth/register", { email: "Owner@Example.com", password: PASSWORD, name: "Owner", workspace: "Store team" });
      assert.equal(registered.status, 201, JSON.stringify(registered.body));
      owner = registered.body;
      workspace = owner.workspaces[0].id;
      as.owner = owner.accessToken;
      assert.deepEqual(registered.body.workspaces.map((item: { name: string; role: string }) => [item.name, item.role]), [["Store team", "owner"]]);
      assert.equal((await h.request("POST", "/v1/auth/register", { email: "someone@example.com", password: PASSWORD, name: "Someone" })).status, 403);
      assert.equal((await h.request("POST", "/v1/auth/register", { email: "x@example.com", password: "short", name: "X" })).status, 403, "invitation-only before any password rule");
    });

    test("sign in, and a wrong password says nothing about which part was wrong", async () => {
      const wrong = await h.request("POST", "/v1/auth/login", { email: "owner@example.com", password: "nope nope nope" });
      const unknown = await h.request("POST", "/v1/auth/login", { email: "nobody@example.com", password: PASSWORD });
      assert.equal(wrong.status, 401);
      assert.equal(wrong.body.detail, unknown.body.detail);
      const login = await h.request("POST", "/v1/auth/login", { email: "owner@example.com", password: PASSWORD });
      assert.equal(login.status, 200);
      const me = await h.request("GET", "/v1/auth/me", undefined, bearer(login.body.accessToken));
      assert.equal(me.body.email, "owner@example.com");
      assert.equal(me.body.workspaces[0].role, "owner");
    });

    test("refresh tokens rotate, and reusing a spent one closes the whole session", async () => {
      const first = await h.request("POST", "/v1/auth/refresh", { refreshToken: owner.refreshToken });
      assert.equal(first.status, 200);
      assert.notEqual(first.body.refreshToken, owner.refreshToken);
      const replay = await h.request("POST", "/v1/auth/refresh", { refreshToken: owner.refreshToken });
      assert.equal(replay.status, 401, "the spent token is refused");
      assert.equal((await h.request("POST", "/v1/auth/refresh", { refreshToken: first.body.refreshToken })).status, 401, "and the family it belonged to is revoked");
      assert.equal((await h.request("GET", "/v1/projects", undefined, bearer(as.owner))).status, 200, "access tokens already issued last until they expire");
    });

    test("invitations bring in people with a role, never above the inviter's", async () => {
      await h.request("POST", "/v1/projects/import", { file: example }, bearer(as.owner));
      await h.request("PATCH", "/v1/projects/mock-store/environments/local", { baseUrl: h.mock }, bearer(as.owner));
      for (const role of ["viewer", "editor", "admin"]) {
        const invited = await h.request("POST", "/v1/workspace/invitations", { email: `${role}@example.com`, role }, bearer(as.owner));
        assert.equal(invited.status, 201, JSON.stringify(invited.body));
        const accepted = await h.request("POST", "/v1/auth/accept-invitation", { token: invited.body.token, password: PASSWORD, name: role });
        assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
        as[role] = accepted.body.accessToken;
        assert.equal((await h.request("POST", "/v1/auth/accept-invitation", { token: invited.body.token, password: PASSWORD })).status, 404, "an invitation is used once");
      }
      assert.equal((await h.request("POST", "/v1/workspace/invitations", { email: "boss@example.com", role: "owner" }, bearer(as.admin))).status, 403);
      const members = await h.request("GET", "/v1/workspace/members", undefined, bearer(as.viewer));
      assert.deepEqual(members.body.map((item: { role: string }) => item.role).sort(), ["admin", "editor", "owner", "viewer"]);
    });

    test("every endpoint answers each role as the table says", async () => {
      const environment = (await h.request("GET", "/v1/projects/mock-store/environments", undefined, bearer(as.owner))).body.find((item: { id: string }) => item.id === "local").environmentId;
      const members = (await h.request("GET", "/v1/workspace/members", undefined, bearer(as.owner))).body as { userId: string; role: string }[];
      const viewerId = members.find((item) => item.role === "viewer")!.userId;
      // [method, path, body, the lowest role allowed]
      const table: [string, string, unknown, string][] = [
        ["GET", "/v1/projects", undefined, "viewer"],
        ["GET", "/v1/projects/mock-store", undefined, "viewer"],
        ["GET", "/v1/projects/mock-store/scenarios", undefined, "viewer"],
        ["GET", "/v1/projects/mock-store/environments", undefined, "viewer"],
        ["GET", "/v1/projects/mock-store/runs", undefined, "viewer"],
        ["GET", "/v1/workspace/members", undefined, "viewer"],
        ["PUT", "/v1/projects/mock-store/config/budgets", { value: [{ methods: ["GET"], ms: 500 }] }, "editor"],
        ["POST", "/v1/projects/mock-store/spec-versions", { source: { url: `${h.mock}/openapi.json` }, activate: false }, "editor"],
        ["POST", "/v1/projects/mock-store/runs", { environment: "local", readOnly: true }, "editor"],
        ["POST", "/v1/projects/mock-store/probe", { environment: "local", operationId: "listProducts", scenarioId: "default" }, "editor"],
        ["POST", "/v1/projects/mock-store/runs", { environment: "local" }, "admin"],
        ["POST", "/v1/projects/mock-store/probe", { environment: "local", operationId: "createProduct", scenarioId: "invalid-body" }, "admin"],
        ["POST", "/v1/projects/mock-store/load-runs", { environment: "local", baseRps: 1, durationS: 1, latency: { mode: "off" } }, "admin"],
        ["GET", `/v1/projects/mock-store/environments/${environment}/credentials`, undefined, "admin"],
        ["PUT", `/v1/projects/mock-store/environments/${environment}/credentials/primary`, { kind: "bearer", secret: "t0ken-for-tests" }, "admin"],
        ["PATCH", `/v1/projects/mock-store/environments/${environment}`, { enforceLatency: true }, "admin"],
        ["GET", "/v1/workspace/api-tokens", undefined, "admin"],
        ["GET", "/v1/workspace/invitations", undefined, "admin"],
        ["PATCH", `/v1/workspace/members/${viewerId}`, { role: "viewer" }, "owner"],
      ];
      const ranks = ["viewer", "editor", "admin", "owner"];
      const failures: string[] = [];
      for (const [method, path, body, lowest] of table) {
        for (const role of ranks) {
          const { status } = await h.request(method, path, body, bearer(as[role]));
          const allowed = ranks.indexOf(role) >= ranks.indexOf(lowest);
          if (allowed ? status === 403 || status === 401 : status !== 403) failures.push(`${method} ${path} as ${role}: ${status} (needs ${lowest})`);
        }
      }
      assert.deepEqual(failures, []);
    });

    test("a workspace is invisible from another one", async () => {
      // A second workspace with its own owner, who is a member of nothing else.
      const invited = await h.request("POST", "/v1/workspace/invitations", { email: "outsider@example.com", role: "viewer" }, bearer(as.owner));
      const outsider = await h.request("POST", "/v1/auth/accept-invitation", { token: invited.body.token, password: PASSWORD });
      const created = await h.request("POST", "/v1/auth/workspaces", { name: "Elsewhere" }, bearer(outsider.body.accessToken));
      await h.request("DELETE", `/v1/workspace/members/${outsider.body.user.id}`, undefined, bearer(as.owner));
      const projectId = (await h.request("GET", "/v1/projects/mock-store", undefined, bearer(as.owner))).body.id;
      const runs = (await h.request("GET", "/v1/projects/mock-store/runs", undefined, bearer(as.owner))).body;
      const other = bearer(outsider.body.accessToken, created.body.id);
      assert.equal((await h.request("GET", `/v1/projects/${projectId}`, undefined, other)).status, 404, "a project id from another workspace does not exist here");
      if (runs[0]) assert.equal((await h.request("GET", `/v1/runs/${runs[0].id}`, undefined, other)).status, 404);
      assert.deepEqual((await h.request("GET", "/v1/projects", undefined, other)).body, []);
      assert.equal((await h.request("GET", "/v1/projects", undefined, bearer(outsider.body.accessToken, workspace))).status, 403, "and asking for it by header is refused");
    });

    test("API tokens act in one workspace with their role, for CI; revoked, they stop", async () => {
      const issued = await h.request("POST", "/v1/workspace/api-tokens", { name: "CI", role: "editor" }, bearer(as.admin));
      assert.equal(issued.status, 201);
      assert.match(issued.body.token, /^eqt_/);
      const ci = bearer(issued.body.token);
      const started = await h.request("POST", "/v1/projects/mock-store/runs", { environment: "local", readOnly: true }, ci);
      assert.equal(started.status, 202, JSON.stringify(started.body));
      const run = await waitFor({ request: (method, path) => h.request(method, path, undefined, ci) }, started.body.id);
      assert.equal(run.status, "passed");
      assert.equal(run.triggeredBy, `token:${issued.body.id}`);
      assert.equal((await h.request("POST", "/v1/projects/mock-store/environments", { name: "x", baseUrl: "https://x.example.com" }, ci)).status, 403);
      assert.equal((await h.request("GET", "/v1/auth/me", undefined, ci)).status, 403, "a token is not a person");
      const listed = await h.request("GET", "/v1/workspace/api-tokens", undefined, bearer(as.admin));
      assert.equal(JSON.stringify(listed.body).includes(issued.body.token), false, "the token itself is never listed");
      assert.equal((await h.request("POST", "/v1/workspace/api-tokens", { name: "x", role: "owner" }, bearer(as.owner))).status, 422);
      assert.equal((await h.request("DELETE", `/v1/workspace/api-tokens/${issued.body.id}`, undefined, bearer(as.admin))).status, 204);
      assert.equal((await h.request("GET", "/v1/projects", undefined, ci)).status, 401);
    });

    test("roles change only by an owner, and the last owner stays", async () => {
      const members = (await h.request("GET", "/v1/workspace/members", undefined, bearer(as.owner))).body as { userId: string; role: string }[];
      const ownerId = members.find((item) => item.role === "owner")!.userId;
      assert.equal((await h.request("PATCH", `/v1/workspace/members/${ownerId}`, { role: "admin" }, bearer(as.owner))).status, 409);
      assert.equal((await h.request("DELETE", `/v1/workspace/members/${ownerId}`, undefined, bearer(as.admin))).status, 403);
    });

    test("the browser app keeps the refresh token in an httpOnly cookie", async () => {
      const response = await fetch(`${h.base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.com", password: PASSWORD }) });
      const cookie = response.headers.get("set-cookie") ?? "";
      assert.match(cookie, /eq_refresh=eqr_/);
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Strict/i);
      assert.match(cookie, /Path=\/v1\/auth/);
      const refreshed = await fetch(`${h.base}/v1/auth/refresh`, { method: "POST", headers: { cookie: cookie.split(";")[0] } });
      assert.equal(refreshed.status, 200);
    });

    test("a new password closes the other sessions; repeated failures are slowed down", async () => {
      const session = await h.request("POST", "/v1/auth/login", { email: "editor@example.com", password: PASSWORD });
      assert.equal((await h.request("POST", "/v1/auth/password", { current: PASSWORD, next: `${PASSWORD}!` }, bearer(session.body.accessToken))).status, 204);
      assert.equal((await h.request("POST", "/v1/auth/refresh", { refreshToken: session.body.refreshToken })).status, 401);
      let limited = 0;
      for (let attempt = 0; attempt < 12; attempt += 1) if ((await h.request("POST", "/v1/auth/login", { email: "viewer@example.com", password: "wrong wrong wrong" })).status === 429) limited += 1;
      assert.ok(limited > 0, "the eleventh attempt in a minute is refused");
    });

  });
}

describe("SSRF guard of a hosted deployment", () => {
  let h: Harness;
  let token = "";
  before(async () => {
    h = await start({ type: "sqlite", file: null }, { cloud: { allowPrivateTargets: false } });
    token = (await h.request("POST", "/v1/auth/register", { email: "owner@example.com", password: PASSWORD, name: "Owner" })).body.accessToken;
  });
  after(async () => { await h?.close(); });

  test("private, loopback, link-local and metadata addresses are blocked; public ones are not", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) assert.equal(isBlockedAddress(address), true, address);
    for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "93.184.216.34"]) assert.equal(isBlockedAddress(address), false, address);
  });

  test("a contract cannot be read from an internal address, by IP or by name", async () => {
    for (const url of ["http://169.254.169.254/latest/meta-data/", `${h.mock}/openapi.json`, `http://localhost:${new URL(h.mock).port}/openapi.json`]) {
      const response = await h.request("POST", "/v1/projects", { spec: { url } }, bearer(token));
      assert.equal(response.status, 502, url);
      assert.match(response.body.detail, /private, loopback or link-local/);
    }
  });

  test("a run against an internal address sends nothing there and says why", async () => {
    await h.request("POST", "/v1/projects/import", { file: example }, bearer(token));
    await h.request("PATCH", "/v1/projects/mock-store/environments/local", { baseUrl: h.mock }, bearer(token));
    const started = await h.request("POST", "/v1/projects/mock-store/runs", { environment: "local", readOnly: true, endpointIds: ["healthCheck"] }, bearer(token));
    const run = await waitFor({ request: (method, path) => h.request(method, path, undefined, bearer(token)) }, started.body.id);
    assert.equal(run.status, "failed");
    const full = await h.request("GET", `/v1/runs/${started.body.id}?steps=true`, undefined, bearer(token));
    assert.match(JSON.stringify(full.body.cases[0].steps), /private, loopback or link-local/);
  });

  test("security headers on every response", async () => {
    const response = await fetch(`${h.base}/health`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  });
});
