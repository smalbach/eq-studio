import assert from "node:assert/strict";
import test from "node:test";
import { uuidv7 } from "../src/shared/ids.ts";

test("UUIDv7 ids are well formed and sort in creation order, also within one millisecond", () => {
  const ids = Array.from({ length: 5000 }, () => uuidv7(1_800_000_000_000));
  for (const id of ids.slice(0, 3)) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual([...ids].sort(), ids);
  assert.equal(new Set(ids).size, ids.length);
});
