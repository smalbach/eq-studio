import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { DataSource } from "typeorm";
import { DATA_SOURCE } from "../src/shared/tokens.ts";
import { createMockServer } from "../../mock-target/server.mjs";
import { databases, start, waitFor, type Harness } from "./helpers.ts";

const example = JSON.parse(readFileSync(new URL("../../../examples/mock-store/mock-store.eq.json", import.meta.url), "utf8"));
const failures = (run: { cases: { status: string; operationId: string; scenarioId: string }[] }) => run.cases.filter((item) => item.status !== "passed").map((item) => `${item.operationId}:${item.scenarioId}=${item.status}`);

const hasOpenssl = (() => { try { execFileSync("openssl", ["version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const PASSPHRASE = "client-key-passphrase";

/**
 * A throwaway PKI, made for this run and deleted after it: a CA, a server certificate for
 * 127.0.0.1 and a client certificate whose key is encrypted with `PASSPHRASE`. No key is ever
 * committed.
 */
function generatePki() {
  const dir = mkdtempSync(join(tmpdir(), "eq-mtls-"));
  const run = (...args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
  const file = (name: string) => readFileSync(join(dir, name), "utf8");
  try {
    run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.crt", "-subj", "/CN=EQ Test CA", "-days", "1");
    writeFileSync(join(dir, "server.ext"), "subjectAltName=IP:127.0.0.1\n");
    for (const name of ["server", "client"]) {
      run("req", "-newkey", "rsa:2048", "-nodes", "-keyout", `${name}.key`, "-out", `${name}.csr`, "-subj", `/CN=eq-test-${name}`);
      run("x509", "-req", "-in", `${name}.csr`, "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", `${name}.crt`, "-days", "1", ...(name === "server" ? ["-extfile", "server.ext"] : []));
    }
    run("pkcs8", "-topk8", "-in", "client.key", "-out", "client.enc.key", "-passout", `pass:${PASSPHRASE}`, "-v2", "aes-256-cbc");
    return { ca: file("ca.crt"), serverCert: file("server.crt"), serverKey: file("server.key"), clientCert: file("client.crt"), clientKey: file("client.enc.key"), otherKey: file("server.key") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const database of databases()) {
  describe(`credential kinds over ${database.name}`, () => {
    let h: Harness;
    const authMock = createMockServer({ auth: true });
    let authUrl = "";
    before(async () => {
      h = await start(database.config());
      authUrl = (await authMock.listen(0)).url;
      assert.equal((await h.request("POST", "/v1/projects/import", { file: example })).status, 201);
    });
    after(async () => { await h?.close(); await authMock.close(); });

    /** A new environment of the mock with auth on, its three credentials set, and a full run. */
    async function runWith(key: string, baseUrl: string, credentials: Record<string, object>) {
      const created = await h.request("POST", "/v1/projects/mock-store/environments", { key, name: key, baseUrl, authEnabled: true });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      for (const [role, body] of Object.entries(credentials)) {
        const saved = await h.request("PUT", `/v1/projects/mock-store/environments/${key}/credentials/${role}`, body);
        assert.equal(saved.status, 200, `${role}: ${JSON.stringify(saved.body)}`);
      }
      const started = await h.request("POST", "/v1/projects/mock-store/runs", { environment: key });
      assert.equal(started.status, 202, JSON.stringify(started.body));
      return waitFor(h, started.body.id);
    }

    const apiKey = { kind: "api_key", secret: "demo-key", headerName: "X-API-Key" };

    test("HMAC credentials sign every case, and their keys are stored like any secret", async () => {
      const run = await runWith("hmac", authUrl, {
        primary: { kind: "hmac", secret: "hmac-secret", options: { hmac: { keyId: "demo-hmac" } } },
        insufficient: { kind: "hmac", secret: "hmac-read-secret", options: { hmac: { keyId: "read-hmac", algorithm: "sha256" } } },
        alternate: apiKey,
      });
      assert.equal(run.status, "passed", failures(run).join(", "));
      assert.ok(run.cases.some((item: { scenarioId: string }) => item.scenarioId === "auth-insufficient"));
      const listed = await h.request("GET", "/v1/projects/mock-store/environments/hmac/credentials");
      assert.equal(JSON.stringify(listed.body).includes("hmac-secret"), false);
      assert.deepEqual(listed.body.find((item: { role: string }) => item.role === "primary").options, { hmac: { keyId: "demo-hmac" } });
      const unknown = await h.request("PUT", "/v1/projects/mock-store/environments/hmac/credentials/primary", { kind: "hmac", options: { hmac: { template: "{method}{nonce}" } } });
      assert.equal(unknown.status, 422);
      assert.match(unknown.body.detail, /nonce/);
    });

    test("a cookie login and a pasted session cookie drive the matrix", async () => {
      const run = await runWith("cookie", authUrl, {
        primary: { kind: "cookie", username: "admin", secret: "admin-password", options: { login: { path: "/auth/login", body: "{\"username\":\"{{username}}\",\"password\":\"{{password}}\"}" } } },
        insufficient: { kind: "cookie", secret: "read-session", options: { cookieName: "eq_session" } },
        alternate: apiKey,
      });
      assert.equal(run.status, "passed", failures(run).join(", "));
      const missing = await h.request("PUT", "/v1/projects/mock-store/environments/cookie/credentials/insufficient", { kind: "cookie", options: {} });
      assert.equal(missing.status, 422);
    });

    test("a login that does not work fails the run up front, with the reason", async () => {
      const run = await runWith("bad-cookie", authUrl, { primary: { kind: "cookie", username: "admin", secret: "wrong", options: { login: { path: "/auth/login", body: "{\"username\":\"{{username}}\",\"password\":\"{{password}}\"}" } } } });
      assert.equal(run.status, "error");
      assert.match(run.error, /primary credential \(cookie\) did not authenticate: The login answered 401/);
    });

    test("an authorization-code credential needs its refresh token, which is encrypted and only hinted", async () => {
      const key = "oauth";
      await h.request("POST", "/v1/projects/mock-store/environments", { key, name: key, baseUrl: authUrl });
      const path = `/v1/projects/mock-store/environments/${key}/credentials/primary`;
      assert.equal((await h.request("PUT", path, { kind: "oauth2_authorization_code", tokenUrl: "https://idp.example/token", clientId: "app" })).status, 422);
      const saved = await h.request("PUT", path, { kind: "oauth2_authorization_code", tokenUrl: "https://idp.example/token", clientId: "app", refreshToken: "rt-0123456789-wxyz" });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      const listed = (await h.request("GET", `/v1/projects/mock-store/environments/${key}/credentials`)).body[0];
      assert.deepEqual([listed.kind, listed.hasSecret, listed.secretHints], ["oauth2_authorization_code", false, { refreshToken: "wxyz" }]);
      const stored = await h.app.get<DataSource>(DATA_SOURCE).getRepository("Credential").findOneByOrFail({ kind: "oauth2_authorization_code" }) as { extraSecrets: string };
      assert.ok(stored.extraSecrets.startsWith("v1.") && !stored.extraSecrets.includes("rt-0123"));
      // Changing the scope keeps the stored refresh token; an empty one clears it, which the kind refuses.
      assert.equal((await h.request("PUT", path, { kind: "oauth2_authorization_code", scope: "read" })).status, 200);
      assert.equal((await h.request("PUT", path, { kind: "oauth2_authorization_code", refreshToken: "" })).status, 422);
    });

    test("mutual TLS: a client certificate alone authenticates, over a CA the credential trusts", { skip: !hasOpenssl && "openssl is not installed" }, async () => {
      const pki = generatePki();
      const tlsMock = createMockServer({ auth: true, tls: { cert: pki.serverCert, key: pki.serverKey, ca: pki.ca } });
      const { url } = await tlsMock.listen(0);
      try {
        const mtls = { kind: "mtls", options: { tls: { cert: pki.clientCert, ca: pki.ca } }, tlsKey: pki.clientKey, tlsPassphrase: PASSPHRASE };
        const path = "/v1/projects/mock-store/environments/mtls/credentials/primary";
        // The insufficient token rides on a certificate of its own; the alternate API key and the
        // case without credentials present none — the 401 cases still get their 401.
        const run = await runWith("mtls", url, { primary: mtls, insufficient: { kind: "bearer", secret: "read-token", options: { tls: { cert: pki.clientCert, ca: pki.ca } }, tlsKey: pki.clientKey, tlsPassphrase: PASSPHRASE }, alternate: apiKey });
        assert.equal(run.status, "passed", failures(run).join(", "));
        const listed = (await h.request("GET", "/v1/projects/mock-store/environments/mtls/credentials")).body;
        assert.equal(JSON.stringify(listed).includes("PRIVATE KEY"), false, "the private key is never read back");
        assert.deepEqual(listed.find((item: { role: string }) => item.role === "primary").secretHints, { tlsKey: "••••", tlsPassphrase: "••••" });
        assert.equal((await h.request("PUT", "/v1/projects/mock-store/environments/mtls/credentials/alternate", { ...apiKey, tlsKey: pki.clientKey })).status, 422, "a key without its certificate");

        assert.equal((await h.request("PUT", path, { ...mtls, tlsPassphrase: "wrong" })).status, 422, "a passphrase that does not open the key");
        const mismatch = await h.request("PUT", path, { ...mtls, tlsKey: pki.otherKey, tlsPassphrase: "" });
        assert.equal(mismatch.status, 422);
        assert.match(mismatch.body.detail, /does not belong/);
        assert.equal((await h.request("PUT", path, { kind: "mtls", options: {} })).status, 422, "a certificate is what the kind is");
      } finally {
        await tlsMock.close();
      }
    });
  });
}
