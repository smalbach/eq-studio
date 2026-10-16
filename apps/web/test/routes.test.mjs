import assert from "node:assert/strict";
import test from "node:test";
import { isProjectSection, routeFromParams, routeToSearch } from "../src/lib/routes.ts";

const parse = (search) => routeFromParams(new URLSearchParams(search));

test("home is the list of projects, with no parameters", () => {
  assert.deepEqual(parse(""), { section: "home" });
  assert.equal(routeToSearch({ section: "home" }), "");
});

test("the project screens carry the project, and the round trip keeps it", () => {
  for (const route of [
    { section: "dashboard", project: "store-api" },
    { section: "functional", project: "store-api", page: "runs" },
    { section: "functional", project: "billing", page: "new" },
    { section: "load", project: "billing", page: "runs", run: "r1" },
  ]) assert.deepEqual(parse(routeToSearch(route)), route);
  assert.equal(routeToSearch({ section: "dashboard", project: "store-api" }), "?vista=panel&proyecto=store-api");
});

test("only the project screens keep a project in the URL", () => {
  assert.equal(routeToSearch({ section: "learn", doc: "carga", project: "x" }), "?vista=aprende&doc=carga");
  assert.deepEqual(parse("?vista=ajustes&proyecto=x"), { section: "settings" });
  assert.deepEqual(["home", "dashboard", "functional", "load", "guide", "learn", "settings"].filter(isProjectSection), ["dashboard", "functional", "load"]);
});

test("older links without a project still open the screen", () => {
  assert.deepEqual(parse("?vista=funcional"), { section: "functional", page: "runs" });
  assert.deepEqual(parse("?vista=nada"), { section: "home" });
});
