import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { clearSettings, loadSettings, pick, redact, saveSettings, settingsKey } from "../src/lib/settings.mjs";

// A Map behind the localStorage API, the way the browser exposes it.
const store = new Map();
globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key), key: (index) => [...store.keys()][index] ?? null, get length() { return store.size; } };
beforeEach(() => store.clear());

const dashboard = { baseUrl: "https://staging.example.com", orderMode: "custom", token: "jwt", apiKey: "k", readToken: "r", basicUser: "reader", basicPass: "pw", importedEnvironments: [{ id: "e", name: "Staging", fields: { baseUrl: "https://staging.example.com", token: "imported-jwt" } }] };

test("configuration is always kept, credentials by default, secrets only when asked", () => {
  const kept = redact("dashboard", dashboard, { credentials: true, secrets: false });
  assert.equal(kept.token, "jwt");
  assert.equal(kept.basicUser, "reader");
  assert.equal("basicPass" in kept, false);
  assert.equal(redact("dashboard", dashboard, { credentials: true, secrets: true }).basicPass, "pw");
});

test("with credentials off nothing that authenticates is written, imported ones included", () => {
  const kept = redact("dashboard", dashboard, { credentials: false, secrets: false });
  for (const key of ["token", "apiKey", "readToken", "basicUser", "basicPass"]) assert.equal(key in kept, false, key);
  assert.deepEqual(kept.importedEnvironments[0].fields, { baseUrl: "https://staging.example.com" });
  assert.equal(kept.orderMode, "custom");
});

test("each project's dashboard settings follow the dashboard's tiers", () => {
  const kept = redact("dashboard:project:orders", dashboard, { credentials: true, secrets: false });
  assert.equal(kept.token, "jwt");
  assert.equal("basicPass" in kept, false);
});

test("a round trip through storage, and forgetting it", () => {
  saveSettings("dashboard:a", dashboard, { credentials: true, secrets: false });
  saveSettings("load", { type: "load" }, { credentials: false, secrets: false });
  store.set("unrelated", "kept");
  assert.equal(loadSettings("dashboard:a").token, "jwt");
  clearSettings();
  assert.equal(loadSettings("dashboard:a"), null);
  assert.equal(loadSettings("load"), null);
  assert.equal(store.get("unrelated"), "kept");
});

test("a corrupt or retyped value falls back to the default", () => {
  store.set(settingsKey("load"), "{not json");
  assert.equal(loadSettings("load"), null);
  assert.deepEqual(pick({ customOrder: "listOrders" }, "customOrder", []), []);
  assert.equal(pick({ delayMs: "500" }, "delayMs", 0), 0);
  assert.equal(pick({ delayMs: 250 }, "delayMs", 0), 250);
});
