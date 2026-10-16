import assert from "node:assert/strict";
import test from "node:test";
import { conflictValue, deviceCode } from "../src/lib/sync.mjs";

test("a conflicting value is shown as text or indented JSON", () => {
  assert.equal(conflictValue("https://staging.example.com"), "https://staging.example.com");
  assert.equal(conflictValue({ default: 800 }), "{\n  \"default\": 800\n}");
  assert.equal(conflictValue(null), "null");
  assert.equal(conflictValue(false), "false");
  assert.equal(conflictValue(undefined), "—");
});

test("a device code from a link is normalized the way people type it", () => {
  assert.equal(deviceCode("bcdf2345"), "BCDF-2345");
  assert.equal(deviceCode(" BCDF-2345 "), "BCDF-2345");
  assert.equal(deviceCode(""), null);
  assert.equal(deviceCode(null), null);
  assert.equal(deviceCode("x"), null);
});
