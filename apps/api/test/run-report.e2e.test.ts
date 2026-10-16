import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createMockServer } from "../../mock-target/server.mjs";
import { databases, start, waitFor, type Harness } from "./helpers.ts";

const example = JSON.parse(readFileSync(new URL("../../../examples/mock-store/mock-store.eq.json", import.meta.url), "utf8"));

let h: Harness;
const broken = createMockServer({ faults: { brokenEnvelope: true }, auth: true });
let runId = "";
let loadId = "";
before(async () => {
  h = await start(databases()[0].config());
  const { url } = await broken.listen(0);
  await h.request("POST", "/v1/projects/import", { file: example });
  await h.request("PATCH", "/v1/projects/mock-store/environments/local", { baseUrl: h.mock });
  await h.request("PATCH", "/v1/projects/mock-store/environments/local-auth", { baseUrl: url });
  await h.request("PUT", "/v1/projects/mock-store/environments/local-auth/credentials/primary", { kind: "bearer", secret: "admin-token" });
  runId = (await h.request("POST", "/v1/projects/mock-store/runs", { environment: "local-auth", readOnly: true })).body.id;
  assert.equal((await waitFor(h, runId)).status, "failed");
  loadId = (await h.request("POST", "/v1/projects/mock-store/load-runs", { environment: "local", type: "load", baseRps: 5, durationS: 1, mixId: "all-gets", latency: { mode: "off" } })).body.id;
  await waitFor(h, loadId);
});
after(async () => { await h?.close(); await broken.close(); });

const get = (path: string) => fetch(`${h.base}${path}`);

test("GET /v1/runs/:id/report renders HTML, SARIF and JUnit, as downloads, with no secret", async () => {
  const html = await get(`/v1/runs/${runId}/report`);
  assert.equal(html.status, 200);
  assert.match(html.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(html.headers.get("content-disposition") ?? "", /^attachment; filename="mock-store-[\w-]+\.html"$/);
  assert.match(html.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  const page = await html.text();
  assert.match(page, /^<!doctype html>/);
  assert.match(page, /mock-store · /);
  assert.match(page, /<dt>Contract version<\/dt><dd>1\.0\.0<\/dd>/);
  assert.match(page, /<dt>Environment<\/dt><dd>Local \(auth\)<\/dd>/);
  assert.match(page, /id="failures"/);

  const sarif = await get(`/v1/runs/${runId}/report?format=sarif`);
  assert.match(sarif.headers.get("content-type") ?? "", /^application\/sarif\+json/);
  const log = await sarif.json() as { version: string; runs: { results: { ruleId: string; level: string; locations: { logicalLocations: { fullyQualifiedName: string }[] }[] }[] }[] };
  assert.equal(log.version, "2.1.0");
  assert.ok(log.runs[0].results.length > 0);
  assert.ok(log.runs[0].results.every((result) => result.ruleId && result.level === "error" && /^(GET|POST|PUT|PATCH|DELETE) \//.test(result.locations[0].logicalLocations[0].fullyQualifiedName)));

  const junit = await get(`/v1/runs/${runId}/report?format=junit&download=false&locale=es`);
  assert.match(junit.headers.get("content-type") ?? "", /^application\/xml/);
  assert.match(junit.headers.get("content-disposition") ?? "", /^inline/);
  const xml = await junit.text();
  assert.match(xml, /<testsuites name="mock-store · Local \(auth\)/);

  for (const body of [page, JSON.stringify(log), xml]) assert.equal(body.includes("admin-token"), false);
});

test("a load run's report has its percentiles; a wrong format is a 422, a missing run a 404", async () => {
  const page = await (await get(`/v1/runs/${loadId}/report`)).text();
  assert.match(page, /p95/);
  assert.match(page, /Verdict criteria/);
  assert.equal((await get(`/v1/runs/${runId}/report?format=pdf`)).status, 422);
  assert.equal((await get("/v1/runs/nope/report")).status, 404);
});
