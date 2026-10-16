import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createMockServer } from "../../../apps/mock-target/server.mjs";
import { cookieHeaderOf, createAuthenticator, fillLoginBody, hmacHeaders } from "../src/auth.ts";

async function mock() {
  const server = createMockServer({ auth: true });
  const { url } = await server.listen(0);
  return { server, url };
}

test("an HMAC credential signs every request the way the mock store verifies it", async () => {
  const { server, url } = await mock();
  try {
    const auth = createAuthenticator({ kind: "hmac", key: "hmac-secret", options: { keyId: "demo-hmac" } }, { baseUrl: url });
    assert.deepEqual(await auth.headers(), {});
    assert.equal((await auth.fetch(`${url}/v1/products?limit=2`)).status, 200);
    const created = await auth.fetch(`${url}/v1/products`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sku: "HM-1", name: "Signed", price: 1, category: "lamps" }) });
    assert.notEqual(created.status, 401);
    const wrong = createAuthenticator({ kind: "hmac", key: "not-the-key", options: { keyId: "demo-hmac" } }, { baseUrl: url });
    assert.equal((await wrong.fetch(`${url}/v1/products`)).status, 401);
  } finally {
    await server.close();
  }
});

test("the string to sign follows the template, the algorithm and the encoding", () => {
  const url = new URL("https://api.example/v1/orders?page=2");
  const headers = hmacHeaders("k", { algorithm: "sha512", header: "X-Sig", keyId: "kid", keyIdHeader: "X-Kid", timestampHeader: "X-Ts", template: "{keyId}|{method}|{path}|{timestamp}", encoding: "base64" }, { method: "post", url, body: "{}" }, 1_700_000_000_000);
  assert.equal(headers["X-Ts"], "1700000000");
  assert.equal(headers["X-Kid"], "kid");
  assert.match(headers["X-Sig"], /^[A-Za-z0-9+/]+=*$/);
  const again = hmacHeaders("k", { algorithm: "sha512", header: "X-Sig", keyId: "kid", template: "{keyId}|{method}|{path}|{timestamp}", encoding: "base64" }, { method: "POST", url, body: "{\"other\":1}" }, 1_700_000_000_000);
  // The body is not in that template: a different body signs the same.
  assert.equal(again["X-Sig"], headers["X-Sig"]);
});

test("a pasted session cookie is sent as is", async () => {
  const { server, url } = await mock();
  try {
    const auth = createAuthenticator({ kind: "cookie", name: "eq_session", value: "admin-session" }, { baseUrl: url });
    assert.deepEqual(await auth.headers(), { Cookie: "eq_session=admin-session" });
    assert.equal((await auth.fetch(`${url}/v1/products`)).status, 200);
  } finally {
    await server.close();
  }
});

test("a cookie login is captured, reused, and done again once on a 401", async () => {
  const { server, url } = await mock();
  let logins = 0;
  const counting: typeof fetch = (input, init) => {
    if (String(input).endsWith("/auth/login")) logins += 1;
    return fetch(input, init);
  };
  try {
    const auth = createAuthenticator({ kind: "cookie", login: { path: "/auth/login", body: "{\"username\":\"{{username}}\",\"password\":\"{{password}}\"}" }, username: "admin", password: "admin-password" }, { baseUrl: url, fetchImpl: counting });
    assert.match((await auth.headers()).Cookie, /^eq_session=[0-9a-f]+$/);
    assert.equal((await auth.fetch(`${url}/v1/products`)).status, 200);
    assert.equal(logins, 1);
    server.expireSessions();
    assert.equal((await auth.fetch(`${url}/v1/products`)).status, 200);
    assert.equal(logins, 2);
    const wrong = createAuthenticator({ kind: "cookie", login: { path: "/auth/login", body: "username={{username}}&password={{password}}", contentType: "application/x-www-form-urlencoded" }, username: "admin", password: "nope" }, { baseUrl: url });
    await assert.rejects(wrong.headers(), /401 without a Set-Cookie/);
  } finally {
    await server.close();
  }
});

test("a login body is escaped for its content type", () => {
  assert.equal(fillLoginBody("{\"p\":\"{{password}}\"}", { password: "a\"b" }, "application/json"), "{\"p\":\"a\\\"b\"}");
  assert.equal(fillLoginBody("u={{username}}&p={{ password }}", { username: "a b", password: "&" }, "application/x-www-form-urlencoded"), "u=a%20b&p=%26");
  const response = new Response(null, { headers: [["Set-Cookie", "a=1; Path=/"], ["Set-Cookie", "b=2; HttpOnly"]] });
  assert.equal(cookieHeaderOf(response), "a=1; b=2");
});

/** A token endpoint that rotates refresh tokens and an API that takes only its last token. */
async function authorizationServer(expiresIn: number) {
  const state = { refreshToken: "refresh-1", issued: 0, current: "", grants: [] as Record<string, string>[] };
  const read = async (req: IncomingMessage) => { let body = ""; for await (const chunk of req) body += chunk; return body; };
  const server = createServer(async (req, res) => {
    if (req.url === "/token") {
      const form = Object.fromEntries(new URLSearchParams(await read(req)));
      state.grants.push(form);
      if (form.grant_type !== "refresh_token" || form.refresh_token !== state.refreshToken || form.client_id !== "app") {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      state.issued += 1;
      state.current = `access-${state.issued}`;
      state.refreshToken = `refresh-${state.issued + 1}`;
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ access_token: state.current, token_type: "Bearer", expires_in: expiresIn, refresh_token: state.refreshToken }));
      return;
    }
    res.writeHead(req.headers.authorization === `Bearer ${state.current}` ? 200 : 401).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { state, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("an authorization-code credential exchanges its refresh token, caches the token, keeps a rotated one and renews on a 401", async () => {
  const server = await authorizationServer(3600);
  const kept: string[] = [];
  let clock = 1_000_000;
  try {
    const auth = createAuthenticator({ kind: "oauth2_authorization_code", tokenUrl: `${server.url}/token`, clientId: "app", refreshToken: "refresh-1", scope: "read" }, { baseUrl: server.url, onRefreshToken: (token) => { kept.push(token); }, now: () => clock });
    assert.deepEqual(await auth.headers(), { Authorization: "Bearer access-1" });
    assert.equal((await auth.fetch(`${server.url}/things`)).status, 200);
    assert.equal(server.state.issued, 1, "the token is cached");
    assert.deepEqual(kept, ["refresh-2"]);
    assert.equal(server.state.grants[0].scope, "read");
    assert.equal(server.state.grants[0].client_secret, undefined, "a public client sends no secret");
    clock += 3_600_000;
    assert.equal((await auth.fetch(`${server.url}/things`)).status, 200);
    assert.equal(server.state.issued, 2, "an expired token is renewed with the rotated refresh token");
    server.state.current = "revoked";
    assert.equal((await auth.fetch(`${server.url}/things`)).status, 200);
    assert.equal(server.state.issued, 3, "a 401 renews once");
    assert.deepEqual(kept, ["refresh-2", "refresh-3", "refresh-4"]);
    const stale = createAuthenticator({ kind: "oauth2_authorization_code", tokenUrl: `${server.url}/token`, clientId: "app", refreshToken: "refresh-1" }, { baseUrl: server.url });
    await assert.rejects(stale.headers(), /answered 400 \(invalid_grant\)/);
  } finally {
    await server.close();
  }
});

test("a 401 is retried once, never in a loop, and not for kinds that cannot renew", async () => {
  let calls = 0;
  const always401: typeof fetch = async () => { calls += 1; return new Response(null, { status: 401 }); };
  const bearer = createAuthenticator({ kind: "bearer", token: "t" }, { baseUrl: "http://x", fetchImpl: always401 });
  assert.equal((await bearer.fetch("http://x/a")).status, 401);
  assert.equal(calls, 1);
  calls = 0;
  const cookie = createAuthenticator({ kind: "cookie", login: { path: "/login" } }, { baseUrl: "http://x", fetchImpl: async (input) => { calls += 1; return String(input).endsWith("/login") ? new Response(null, { status: 204, headers: { "Set-Cookie": "s=1" } }) : new Response(null, { status: 401 }); } });
  assert.equal((await cookie.fetch("http://x/a")).status, 401);
  assert.equal(calls, 4, "login, request, login again, request again");
});

test("a dispatcher travels with every request of the credential, the token request included", async () => {
  const seen: unknown[] = [];
  const dispatcher = { tls: true };
  const spy: typeof fetch = async (input, init) => {
    seen.push((init as { dispatcher?: unknown }).dispatcher);
    return String(input).endsWith("/token") ? Response.json({ access_token: "a", expires_in: 60 }) : new Response("{}");
  };
  const auth = createAuthenticator({ kind: "oauth2_client_credentials", tokenUrl: "http://x/token", clientId: "c", clientSecret: "s", tls: { cert: "c", key: "k" } }, { baseUrl: "http://x", fetchImpl: spy, dispatcher });
  await auth.fetch("http://x/a", { headers: { authorization: "stale" } });
  assert.deepEqual(seen, [dispatcher, dispatcher]);
});
