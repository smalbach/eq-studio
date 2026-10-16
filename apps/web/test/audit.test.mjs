import assert from "node:assert/strict";
import test from "node:test";
import { auditDetail, auditQuery, resetTokenOf } from "../src/lib/audit.mjs";

test("a page of the audit log is asked for with only the filters that are set", () => {
  assert.equal(auditQuery({}), "?limit=50");
  assert.equal(auditQuery({ type: "credential.", from: "2026-10-01", to: "", cursor: null, limit: 20 }), "?type=credential.&from=2026-10-01&limit=20");
  assert.equal(auditQuery({ cursor: "0199-abc" }), "?cursor=0199-abc&limit=50");
});

test("an event's details read as one line, a role change as from → to", () => {
  assert.equal(auditDetail(null), "");
  assert.equal(auditDetail({ from: "viewer", to: "editor" }), "viewer → editor");
  assert.equal(auditDetail({ kind: "bearer", secretChanged: true, expiresAt: null }), "kind: bearer · secretChanged: true");
});

test("a reset link's token is read from the URL, and nothing that does not look like one", () => {
  assert.equal(resetTokenOf("?restablecer=eqp_abcdefghijklmnopqrstuvwxyz0123456789-_"), "eqp_abcdefghijklmnopqrstuvwxyz0123456789-_");
  assert.equal(resetTokenOf("?restablecer=nope"), null);
  assert.equal(resetTokenOf(""), null);
});
