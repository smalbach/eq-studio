import assert from "node:assert/strict";
import { test } from "node:test";
import { merge, sameSnapshot, stable, withField } from "../src/modules/sync/domain/merge.ts";

const base = { slug: "store", name: "Store", config: { budgets: [{ match: "*", p95: 300 }], bodies: { a: 1 } }, deletedAt: null };

test("stable JSON ignores key order and undefined", () => {
  assert.equal(stable({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } }), stable({ a: { d: [1, { x: 1, y: 2 }] }, b: 1 }));
});

test("a field only one side changed takes that side's value", () => {
  const result = merge("project", base, { ...base, name: "Cloud name" }, { ...base, slug: "store-api" });
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.changed, true);
  assert.deepEqual([result.data.name, result.data.slug], ["Cloud name", "store-api"]);
});

test("each configuration section merges on its own", () => {
  const theirs = { ...base, config: { ...base.config, bodies: { a: 2 } } };
  const mine = { ...base, config: { ...base.config, budgets: [{ match: "*", p95: 500 }] } };
  const result = merge("project", base, theirs, mine);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.data.config, { bodies: { a: 2 }, budgets: [{ match: "*", p95: 500 }] });
});

test("the same field changed differently is a conflict that keeps the cloud's value", () => {
  const result = merge("project", base, { ...base, name: "A" }, { ...base, name: "B" });
  assert.deepEqual(result.conflicts, [{ field: "name", mine: "B", theirs: "A" }]);
  assert.equal(result.data.name, "A");
  assert.equal(result.changed, false);
});

test("the same change on both sides is no conflict", () => {
  const result = merge("project", base, { ...base, name: "A" }, { ...base, name: "A" });
  assert.deepEqual([result.conflicts, result.changed], [[], false]);
});

test("a section added on one side and another removed on the other", () => {
  const theirs = { ...base, config: { budgets: base.config.budgets } };
  const mine = { ...base, config: { ...base.config, seed: { x: 1 } } };
  assert.deepEqual(merge("project", base, theirs, mine).data.config, { budgets: base.config.budgets, seed: { x: 1 } });
});

test("deleted on one side, edited on the other: stays deleted, with the edit", () => {
  const result = merge("environment", { name: "x", deletedAt: null }, { name: "x", deletedAt: "2026-01-01T00:00:00.000Z" }, { name: "y", deletedAt: null });
  assert.deepEqual(result.data, { name: "y", deletedAt: "2026-01-01T00:00:00.000Z" });
});

test("encrypted secrets compare by tag, not by ciphertext", () => {
  const a = { environmentId: "e", role: "primary", tag: "t1", sealed: "x" };
  assert.equal(sameSnapshot("credential", a, { ...a, sealed: "y" }), true);
  assert.equal(sameSnapshot("credential", a, { ...a, tag: "t2", sealed: "y" }), false);
  const result = merge("credential", a, { ...a, sealed: "z" }, { ...a, tag: "t2", sealed: "w" });
  assert.deepEqual([result.changed, result.data.tag, result.data.sealed], [true, "t2", "w"]);
});

test("a conflict resolved for one side sets that field only", () => {
  assert.deepEqual(withField("project", base, "config.bodies", { a: 9 }).config, { budgets: base.config.budgets, bodies: { a: 9 } });
});
