/**
 * The whole engine, end to end, against the bundled mock store.
 *
 * The example project in `examples/mock-store` is loaded exactly as a user would load it, pointed
 * at a mock started on a free port, and every case it generates is run through the same runner
 * the dashboard uses. Every case must be green — and the reverse must hold too: a mock that
 * breaks its envelope must turn a case red for the schema, and one that accepts or crashes on
 * invalid input must turn the negative cases red, or a green matrix would prove nothing.
 *
 *   node --test tests/mock-store.e2e.test.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, before, describe } from "node:test";
import { buildEndpoints, buildQueue, clearSpecCache, createScenarioRunner, directExecutor, parseProjectFile, projectFromOpenApi } from "@eq/runner-core";
import { createMockServer } from "../apps/mock-target/server.mjs";

const file = parseProjectFile(await readFile(new URL("../examples/mock-store/mock-store.eq.json", import.meta.url), "utf8"));
const project = file.project;
const endpoints = buildEndpoints(project);

/** The credentials each kind of case authenticates with. The project never holds them. */
function credentialsFor(scenario) {
  switch (scenario.auth) {
    case "none": return {};
    case "insufficient": return { Authorization: "Bearer read-token" };
    case "api-key": return { "X-API-Key": "demo-key" };
    default: return { Authorization: "Bearer admin-token" };
  }
}

function environmentFor(environmentId, baseUrl) {
  const environment = file.environments.find((candidate) => candidate.id === environmentId);
  assert.ok(environment, `the example declares the ${environmentId} environment`);
  return { ...environment, baseUrl };
}

/** Runs the matrix in the dashboard's safe order and returns every case with its outcome. */
async function runMatrix(environment) {
  const env = { baseUrl: environment.baseUrl, credentialsFor, enforceLatency: environment.enforceLatency, locale: "en" };
  const runner = createScenarioRunner(endpoints, project, directExecutor(project, env), undefined, undefined, "en");
  const queue = buildQueue(endpoints, project, { mode: "safe", customOrder: [], caseSelection: {}, authEnabled: Boolean(environment.authEnabled), locale: "en" });
  const outcomes = [];
  for (const { endpoint, scenario } of queue) outcomes.push({ endpoint, scenario, result: await runner.runScenario(endpoint, scenario) });
  return outcomes;
}

/** Every failing step's failing assertions, readable enough to fix the cause from the log. */
function describeFailures(outcomes) {
  return outcomes.filter((outcome) => !outcome.result.ok).map(({ endpoint, scenario, result }) => {
    const steps = result.steps.filter((step) => !step.ok).map((step) => {
      const failed = step.assertions.filter((assertion) => !assertion.pass && !assertion.informative).map((assertion) => `${assertion.label}: ${assertion.detail}`);
      return `    ${step.request.method} ${step.request.url} → ${step.actual?.status ?? step.error ?? "no response"}\n      ${failed.join("\n      ")}\n      body: ${JSON.stringify(step.actual?.body)?.slice(0, 300)}`;
    });
    return `  ${endpoint.id} · ${scenario.id} (${scenario.name})\n${steps.join("\n")}`;
  }).join("\n");
}

function assertGreen(outcomes) {
  const failures = describeFailures(outcomes);
  assert.equal(failures, "", `failing cases:\n${failures}`);
  // Green is only worth something if every response was checked against a schema the document
  // declares. A status the document leaves out, or a document that failed to load, falls back to
  // a weaker shape check that would pass here without saying so.
  const unchecked = outcomes.flatMap(({ endpoint, scenario, result }) => result.steps.flatMap((step) => step.assertions
    .filter((assertion) => assertion.label === "Schema OpenAPI" && assertion.detail !== "JSON valid against the schema")
    .map((assertion) => `${endpoint.id} · ${scenario.id} · ${step.request.method} ${step.request.url}: ${assertion.detail}`)));
  assert.deepEqual(unchecked, [], "every response is validated against a declared schema");
}

async function counts(baseUrl) {
  const read = async (path) => (await (await fetch(`${baseUrl}${path}`, { headers: { Authorization: "Bearer admin-token" } })).json()).data.length;
  return { products: await read("/v1/products?limit=100"), stores: await read("/v1/stores?limit=100"), reviews: await read("/v1/products/1/reviews?limit=100") };
}

const SEED_COUNTS = { products: 4, stores: 4, reviews: 3 };

test("every load mix points at a known target, and every placeholder has data", () => {
  const load = file.load ?? {};
  const targets = new Map([...endpoints.filter((endpoint) => endpoint.method === "GET").map((endpoint) => [endpoint.id, endpoint.path]), ...(load.targets ?? []).map((target) => [target.id, target.path])]);
  assert.ok((load.mixes ?? []).length >= 3);
  for (const mix of load.mixes ?? []) {
    for (const { target } of mix.targets) {
      assert.ok(targets.has(target), `${mix.id} → ${target}`);
      for (const [, name] of targets.get(target).matchAll(/\{([a-z_]+)\}/g)) assert.ok(load.data?.[name]?.length, `${target} needs data for {${name}}`);
    }
  }
});

describe("mock store, authentication off", () => {
  const mock = createMockServer();
  let environment;
  before(async () => {
    clearSpecCache();
    const { url } = await mock.listen(0);
    environment = environmentFor("local", url);
  });
  after(() => mock.close());

  test("the full matrix is green, twice in a row, and leaves the seed as it found it", async () => {
    assert.deepEqual(await counts(environment.baseUrl), SEED_COUNTS);
    const first = await runMatrix(environment);
    assert.ok(first.length > 60, `a real matrix, not a handful of cases (${first.length})`);
    assertGreen(first);
    assert.deepEqual(await counts(environment.baseUrl), SEED_COUNTS, "every flow cleans up what it created");
    // The second run is the one that catches a flow that does not clean up: its POST would be a
    // 409 over the key the first run left behind.
    const second = await runMatrix(environment);
    assertGreen(second);
    assert.equal(second.length, first.length);
    assert.deepEqual(await counts(environment.baseUrl), SEED_COUNTS);
    console.log(`auth off: ${first.length} cases green, twice`);
  });

  test("no authorization case runs against an API that does not enforce it", async () => {
    const queue = buildQueue(endpoints, project, { mode: "safe", customOrder: [], caseSelection: {}, authEnabled: false });
    assert.equal(queue.filter(({ scenario }) => scenario.auth && scenario.auth !== "default").length, 0);
  });

  test("the example's operations are exactly what importing the mock's own OpenAPI yields", async () => {
    const spec = await (await fetch(`${environment.baseUrl}/openapi.json`)).json();
    const imported = projectFromOpenApi(spec).config;
    const shape = (operations) => operations.map(({ id, method, path, statuses, parameters }) => ({ id, method, path, statuses, parameters }));
    assert.deepEqual(shape(project.operations), shape(imported.operations));
    assert.deepEqual(project.auth?.publicOperations, imported.auth?.publicOperations);
    assert.deepEqual(project.requestSchemas, imported.requestSchemas, "the negative cases break the schemas the mock declares");
  });

  test("the negative cases cover every kind of bad input, and every one is answered with a 4xx", async () => {
    const outcomes = (await runMatrix(environment)).filter(({ scenario }) => scenario.negative);
    assert.ok(outcomes.length >= 100, `a real set of negative cases (${outcomes.length})`);
    const kinds = new Set(outcomes.map(({ scenario }) => scenario.negative));
    for (const kind of ["malformed", "missing", "type", "null", "min-length", "max-length", "minimum", "maximum", "enum", "format", "extra"]) assert.ok(kinds.has(kind), `a ${kind} case ran`);
    const cap = project.negativeCases?.maxPerOperation ?? 10;
    for (const endpoint of endpoints) assert.ok(outcomes.filter((outcome) => outcome.endpoint.id === endpoint.id).length <= cap, `${endpoint.id} stays within the cap`);
    for (const { endpoint, scenario, result } of outcomes) {
      const answered = result.steps.find((step) => step.request.method === endpoint.method)?.actual?.status;
      assert.ok(answered >= 400 && answered < 500, `${endpoint.id} · ${scenario.id} answered ${answered}`);
    }
    assert.deepEqual(await counts(environment.baseUrl), SEED_COUNTS);
  });
});

describe("mock store, authentication on", () => {
  const mock = createMockServer({ auth: true });
  let environment;
  before(async () => {
    clearSpecCache();
    const { url } = await mock.listen(0);
    environment = environmentFor("local-auth", url);
  });
  after(() => mock.close());

  test("the full matrix is green, including every 401 and 403", async () => {
    const outcomes = await runMatrix(environment);
    assertGreen(outcomes);
    const byAuth = (kind) => outcomes.filter(({ scenario }) => scenario.auth === kind).length;
    assert.ok(byAuth("none") > 0 && byAuth("insufficient") > 0 && byAuth("api-key") > 0, "all three credential cases ran");
    assert.equal(byAuth("api-key"), endpoints.filter((endpoint) => endpoint.method === "DELETE").length, "the API-key case runs on every DELETE");
    assert.deepEqual(await counts(environment.baseUrl), SEED_COUNTS);
    console.log(`auth on: ${outcomes.length} cases green (${byAuth("none")} × 401 without credential, ${byAuth("insufficient")} × 403, ${byAuth("api-key")} × 401 API key)`);
  });

  test("health and the OpenAPI document stay public", async () => {
    assert.equal((await fetch(`${environment.baseUrl}/health`)).status, 200);
    assert.equal((await fetch(`${environment.baseUrl}/openapi.json`)).status, 200);
    assert.equal((await fetch(`${environment.baseUrl}/v1/products`)).status, 401);
  });
});

/** Every negative case of the matrix, run against an environment. */
async function runNegatives(environment) {
  const env = { baseUrl: environment.baseUrl, credentialsFor, enforceLatency: false, locale: "en" };
  const runner = createScenarioRunner(endpoints, project, directExecutor(project, env), undefined, undefined, "en");
  const queue = buildQueue(endpoints, project, { mode: "safe", customOrder: [], caseSelection: {}, authEnabled: false, locale: "en" }).filter(({ scenario }) => scenario.negative);
  const outcomes = [];
  for (const { endpoint, scenario } of queue) outcomes.push({ endpoint, scenario, result: await runner.runScenario(endpoint, scenario) });
  return outcomes;
}

const statusAssertion = (result) => result.steps.flatMap((step) => step.assertions).find((assertion) => assertion.label.startsWith("Status") && !assertion.pass);

describe("mock store that accepts invalid bodies", () => {
  const mock = createMockServer({ faults: { validation: "lenient" } });
  let environment;
  before(async () => {
    clearSpecCache();
    const { url } = await mock.listen(0);
    environment = environmentFor("local", url);
  });
  after(() => mock.close());

  test("every body case it accepts is red, and whatever it created is deleted", async () => {
    const outcomes = await runNegatives(environment);
    // Only the members of a body are lax: a body that is not JSON, the bulk's envelope, a
    // parameter and an id are still rejected.
    const lax = outcomes.filter(({ endpoint, scenario }) => scenario.id.startsWith("negative-body-") && scenario.negative !== "malformed" && !endpoint.path.endsWith("/bulk"));
    assert.ok(lax.length > 40);
    for (const { endpoint, scenario, result } of lax) {
      assert.equal(result.ok, false, `${endpoint.id} · ${scenario.id} must fail`);
      assert.match(statusAssertion(result)?.detail ?? "", /accepted invalid input/, `${endpoint.id} · ${scenario.id}`);
    }
    const cleaned = lax.filter(({ endpoint }) => endpoint.method === "POST");
    assert.ok(cleaned.every(({ result }) => result.steps.some((step) => step.request.method === "DELETE" && step.actual?.status === 204)), "every create that was accepted is deleted");
    const isolated = lax.filter(({ endpoint }) => endpoint.method === "PUT" || endpoint.method === "PATCH");
    assert.ok(isolated.every(({ result }) => result.steps[0].request.method === "POST" && result.steps.at(-1).request.method === "DELETE"), "a PUT or PATCH runs over a temporary row");
    assert.ok(outcomes.filter((outcome) => !lax.includes(outcome)).every(({ result }) => result.ok), "everything still validated stays green");
    assert.deepEqual(await counts(environment.baseUrl), SEED_COUNTS, "nothing is left behind");
    assert.deepEqual((await (await fetch(`${environment.baseUrl}/v1/stores/1`)).json()).data.name, "Market Square", "the seed rows were never the target");
  });
});

describe("mock store that crashes on invalid bodies", () => {
  const mock = createMockServer({ faults: { validation: "crash" } });
  let environment;
  before(async () => {
    clearSpecCache();
    const { url } = await mock.listen(0);
    environment = environmentFor("local", url);
  });
  after(() => mock.close());

  test("a 5xx to invalid input is always a failure, and says so", async () => {
    const outcomes = await runNegatives(environment);
    const crashed = outcomes.filter(({ result }) => result.steps.some((step) => step.actual?.status === 500));
    assert.ok(crashed.length > 40);
    for (const { endpoint, scenario, result } of crashed) {
      assert.equal(result.ok, false, `${endpoint.id} · ${scenario.id}`);
      assert.match(statusAssertion(result)?.detail ?? "", /never a server error/);
    }
  });
});

describe("mock store with a broken envelope", () => {
  const mock = createMockServer({ faults: { brokenEnvelope: true } });
  let environment;
  before(async () => {
    clearSpecCache();
    const { url } = await mock.listen(0);
    environment = environmentFor("local", url);
  });
  after(() => mock.close());

  test("a detail read fails, and it fails on the schema", async () => {
    const env = { baseUrl: environment.baseUrl, credentialsFor, enforceLatency: true, locale: "en" };
    const runner = createScenarioRunner(endpoints, project, directExecutor(project, env), undefined, undefined, "en");
    const endpoint = endpoints.find((candidate) => candidate.id === "getProduct");
    const scenario = buildQueue([endpoint], project, { mode: "contract", customOrder: [], caseSelection: {}, authEnabled: false, locale: "en" }).find((item) => item.scenario.id === "found").scenario;
    const result = await runner.runScenario(endpoint, scenario);
    assert.equal(result.ok, false);
    const failed = result.steps.flatMap((step) => step.assertions.filter((assertion) => !assertion.pass).map((assertion) => assertion.label));
    assert.deepEqual(failed, ["Schema OpenAPI"]);
    assert.equal(result.steps[0].actual.status, 200, "the status alone would have passed");
  });

  test("a create-read also fails on the schema, and cannot even capture its id", async () => {
    const env = { baseUrl: environment.baseUrl, credentialsFor, enforceLatency: true, locale: "en" };
    const runner = createScenarioRunner(endpoints, project, directExecutor(project, env), undefined, undefined, "en");
    const endpoint = endpoints.find((candidate) => candidate.id === "createProduct");
    const scenario = buildQueue([endpoint], project, { mode: "contract", customOrder: [], caseSelection: {}, authEnabled: false, locale: "en" }).find((item) => item.scenario.id === "create-read").scenario;
    const result = await runner.runScenario(endpoint, scenario);
    assert.equal(result.ok, false);
    const created = result.steps[0];
    assert.ok(created.assertions.some((assertion) => assertion.label === "Schema OpenAPI" && !assertion.pass));
  });
});
