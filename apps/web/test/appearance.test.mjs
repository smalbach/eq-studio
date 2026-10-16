import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_APPEARANCE, parseAppearance } from "../src/lib/appearance.ts";

test("nothing saved gives the defaults", () => {
  assert.deepEqual(parseAppearance(null), DEFAULT_APPEARANCE);
});

test("a saved appearance comes back as saved", () => {
  const saved = { theme: "dark", accentColor: "iris", grayColor: "mauve", radius: "large", scaling: "95%", panelBackground: "translucent" };
  assert.deepEqual(parseAppearance(JSON.stringify(saved)), saved);
});

test("unknown or missing fields fall back one by one", () => {
  const parsed = parseAppearance(JSON.stringify({ theme: "sepia", accentColor: "blue", radius: 3 }));
  assert.equal(parsed.theme, DEFAULT_APPEARANCE.theme);
  assert.equal(parsed.accentColor, "blue");
  assert.equal(parsed.radius, DEFAULT_APPEARANCE.radius);
  assert.equal(parsed.scaling, DEFAULT_APPEARANCE.scaling);
});

test("corrupt JSON gives the defaults", () => {
  assert.deepEqual(parseAppearance("{not json"), DEFAULT_APPEARANCE);
  assert.deepEqual(parseAppearance("null"), DEFAULT_APPEARANCE);
});

test("the light/dark choice saved before the appearance settings is carried over", () => {
  assert.equal(parseAppearance(null, "dark").theme, "dark");
  assert.equal(parseAppearance(JSON.stringify({ theme: "light" }), "dark").theme, "light");
});
