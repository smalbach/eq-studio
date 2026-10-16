import assert from "node:assert/strict";
import test from "node:test";
import { credentialPayload, credentialTyped, EMPTY_CREDENTIAL, formOf, unknownPlaceholders } from "../src/lib/credentials.mjs";

const form = (patch) => ({ ...EMPTY_CREDENTIAL, ...patch });
const CERT = "-----BEGIN CERTIFICATE-----\nMII…\n-----END CERTIFICATE-----";
const KEY = "-----BEGIN PRIVATE KEY-----\nMII…\n-----END PRIVATE KEY-----";

test("a bearer is cleaned and clears what other kinds left", () => {
  assert.deepEqual(credentialPayload(form({ secret: "  Bearer abc.def " })), { kind: "bearer", headerName: null, username: null, tokenUrl: null, clientId: null, scope: null, options: null, secret: "abc.def", refreshToken: null, tlsKey: null, tlsPassphrase: null });
  assert.equal(credentialPayload(form({})), null);
});

test("an empty secret is left out, and counts only when one is stored", () => {
  assert.equal(credentialPayload(form({ kind: "api_key", headerName: "X-Key" })), null);
  const payload = credentialPayload(form({ kind: "api_key", headerName: "X-Key" }), { hasSecret: true });
  assert.equal(payload.headerName, "X-Key");
  assert.equal("secret" in payload, false);
});

test("the authorization-code kind needs its refresh token; its client secret is optional", () => {
  const base = { kind: "oauth2_authorization_code", tokenUrl: "https://idp.example.com/token", clientId: "web" };
  assert.equal(credentialPayload(form(base)), null);
  const payload = credentialPayload(form({ ...base, refreshToken: " rt-1 " }));
  assert.equal(payload.refreshToken, "rt-1");
  assert.equal("secret" in payload, false);
  assert.equal("refreshToken" in credentialPayload(form(base), { secretHints: { refreshToken: "rt-1" } }), false);
});

test("a cookie is a pasted session or a login", () => {
  assert.deepEqual(credentialPayload(form({ kind: "cookie", cookieName: "sid", secret: "abc" })).options, { cookieName: "sid" });
  assert.equal(credentialPayload(form({ kind: "cookie", cookieName: "sid" })), null);
  const login = credentialPayload(form({ kind: "cookie", cookieMode: "login", loginPath: "/auth/login", loginBody: '{"u":"{{username}}"}', username: "admin", secret: "pw" }));
  assert.deepEqual(login.options, { login: { method: "POST", path: "/auth/login", body: '{"u":"{{username}}"}' } });
  assert.equal(login.username, "admin");
  assert.equal(credentialPayload(form({ kind: "cookie", cookieMode: "login" })), null);
});

test("hmac sends only the options set, and refuses an unknown placeholder", () => {
  assert.deepEqual(credentialPayload(form({ kind: "hmac", secret: "k", hmacKeyId: "demo" })).options, { hmac: { algorithm: "sha256", keyId: "demo", encoding: "hex" } });
  assert.deepEqual(unknownPlaceholders("{method}\\n{bodyhash}"), ["bodyhash"]);
  assert.equal(credentialPayload(form({ kind: "hmac", secret: "k", hmacTemplate: "{method}{nonce}" })), null);
});

test("a client certificate needs its key, alone (mtls) or with another kind", () => {
  assert.equal(credentialPayload(form({ kind: "mtls", tlsCert: CERT })), null);
  const mtls = credentialPayload(form({ kind: "mtls", tlsCert: CERT, tlsKey: KEY, tlsCa: CERT }));
  assert.deepEqual(mtls.options, { tls: { cert: CERT, ca: CERT } });
  assert.equal(mtls.tlsKey, KEY);
  assert.equal(mtls.tlsPassphrase, null, "a new key without a passphrase clears the old one");
  assert.equal(credentialPayload(form({ secret: "t", tlsCert: CERT })), null);
  const kept = credentialPayload(form({ tlsCert: CERT }), { hasSecret: true, secretHints: { tlsKey: "••••" } });
  assert.deepEqual(kept.options, { tls: { cert: CERT } });
  assert.equal("tlsKey" in kept, false);
});

test("a saved credential comes back as a form without its secrets", () => {
  const value = formOf({ kind: "cookie", headerName: null, username: "admin", tokenUrl: null, clientId: null, scope: null, options: { login: { path: "/auth/login" }, tls: { cert: CERT } } });
  assert.equal(value.cookieMode, "login");
  assert.equal(value.loginMethod, "POST");
  assert.equal(value.tlsCert, CERT);
  assert.equal(value.secret, "");
  assert.equal(credentialTyped(EMPTY_CREDENTIAL), false);
  assert.equal(credentialTyped(form({ kind: "hmac" })), false);
  assert.equal(credentialTyped(form({ hmacKeyId: "x" })), true);
});
