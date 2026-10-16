import assert from "node:assert/strict";
import test from "node:test";
import { basicAuthHeader, cleanToken, resolveTarget, inspectToken } from "../src/lib/environments.mjs";

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (payload) => `${b64({ alg: "RS256" })}.${b64(payload)}.signature`;
const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);

test("a pasted token loses the Bearer prefix, quotes and newline", () => {
  assert.equal(cleanToken('  "Bearer abc.def.ghi"\n'), "abc.def.ghi");
});

test("the expiry is read from the payload", () => {
  const info = inspectToken(jwt({ exp: NOW / 1000 + 30 * 60, email: "dev@example.com" }), NOW);
  assert.equal(info.state, "valid");
  assert.equal(info.minutesLeft, 30);
  assert.equal(info.email, "dev@example.com");
  assert.equal(inspectToken(jwt({ exp: NOW / 1000 - 1 }), NOW).state, "expired");
});

test("empty, opaque and unreadable tokens are told apart", () => {
  assert.equal(inspectToken("", NOW).state, "empty");
  assert.equal(inspectToken("not-a-jwt", NOW).state, "opaque");
  assert.equal(inspectToken("a.%%%.c", NOW).state, "invalid");
});

test("Basic credentials are UTF-8 before base64, so an ñ does not throw", () => {
  assert.equal(basicAuthHeader("reader", "secret"), `Basic ${Buffer.from("reader:secret").toString("base64")}`);
  assert.equal(basicAuthHeader("reader", "contraseña"), `Basic ${Buffer.from("reader:contraseña", "utf8").toString("base64")}`);
  assert.equal(basicAuthHeader("", "x"), "");
});

test("a case keeps the base URL's path: an API published under a prefix keeps it", () => {
  const gateway = "https://gateway.example.com/teams/orders-api";
  assert.equal(resolveTarget(gateway, "/health").href, `${gateway}/health`);
  assert.equal(resolveTarget(`${gateway}/`, "/v1/orders?limit=2").href, `${gateway}/v1/orders?limit=2`);
  assert.equal(resolveTarget("http://127.0.0.1:4010", "/v1/stores/1").href, "http://127.0.0.1:4010/v1/stores/1");
});
