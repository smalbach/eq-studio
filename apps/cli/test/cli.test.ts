import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { createMockServer } from "../../mock-target/server.mjs";
import { startServer, type Server } from "../src/server.ts";

const example = fileURLToPath(new URL("../../../examples/mock-store/mock-store.eq.json", import.meta.url));
const entry = fileURLToPath(new URL("../src/entry.ts", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "eq-cli-"));
/** The JSON a command printed. Editor extensions that hook into a developer's node_modules can
 * print a banner first; the document starts at the first line that opens one. */
const json = (stdout: string) => JSON.parse(stdout.slice(Math.max(0, stdout.search(/^[[{]/m))));

/** Runs `eq` as a user would, in its own process, and returns what it printed and its exit code. */
function eq(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    // The child is a plain process, not a test: without the runner's own variables, which make
    // a spawned Node report to the parent runner instead of running the command.
    const { NODE_TEST_CONTEXT: _context, NODE_OPTIONS: _options, ...inherited } = process.env;
    void _context; void _options;
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), entry, ...args], { env: { ...inherited, EQ_DATA_DIR: join(work, "data"), NO_COLOR: "1", TSX_TSCONFIG_PATH: fileURLToPath(new URL("../tsconfig.json", import.meta.url)), ...env }, cwd: work });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

const mock = createMockServer();
const broken = createMockServer({ faults: { brokenEnvelope: true } });
const authMock = createMockServer({ auth: true });
let mockUrl = "";
let brokenUrl = "";
let authUrl = "";
let server: Server;
before(async () => {
  mockUrl = (await mock.listen(0)).url;
  brokenUrl = (await broken.listen(0)).url;
  authUrl = (await authMock.listen(0)).url;
  server = await startServer({ port: 0, host: "127.0.0.1", persistent: false, quiet: true });
});
after(async () => {
  await Promise.all([mock.close(), broken.close(), authMock.close(), server.close()]);
  rmSync(work, { recursive: true, force: true });
});

test("a project file runs with no server: exit 0, a summary and a JUnit report", async () => {
  const junit = join(work, "report.xml");
  const result = await eq(["run", "--file", example, "--env", "local", "--base-url", mockUrl, "--junit", junit]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Full matrix · Local · PASSED/);
  assert.match(result.stdout, /181 passed · 0 failed/);
  const xml = readFileSync(junit, "utf8");
  assert.match(xml, /<testsuites name="mock-store · Local · Full matrix" tests="181" failures="0"/);
  assert.equal((xml.match(/<testcase /g) ?? []).length, 181);
});

test("failing cases exit 1 and name what failed", async () => {
  const result = await eq(["run", "--file", example, "--env", "local", "--base-url", brokenUrl, "--read-only", "--format", "json"]);
  assert.equal(result.code, 1, result.stderr);
  const run = json(result.stdout);
  assert.equal(run.status, "failed");
  assert.ok(run.cases.some((item: { status: string; steps: { assertions: { label: string; pass: boolean }[] }[] }) => item.status === "failed" && item.steps.some((step) => step.assertions.some((assertion) => assertion.label === "Schema OpenAPI" && !assertion.pass))));
});

test("credentials come from flags or the environment, and drive the 401/403 cases", async () => {
  const result = await eq(["run", "--file", example, "--env", "local-auth", "--base-url", authUrl, "--auth", "--read-token", "read-token", "--api-key", "demo-key"], { EQ_TOKEN: "admin-token" });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASSED/);
  const unauthenticated = await eq(["run", "--file", example, "--env", "local-auth", "--base-url", authUrl, "--read-only", "--quiet"]);
  assert.equal(unauthenticated.code, 1, "without a token the protected reads are 401");
});

test("wrong commands, environments and flags exit 2; an API that is not there exits 3", async () => {
  assert.equal((await eq(["run", "--file", example, "--env", "nope"])).code, 2);
  assert.equal((await eq(["frobnicate"])).code, 2);
  assert.equal((await eq(["run", "--bogus-flag"])).code, 2);
  assert.equal((await eq(["run", "--file", join(work, "missing.json")])).code, 2);
  const unreachable = await eq(["run", "mock-store", "--api", "http://127.0.0.1:9"]);
  assert.equal(unreachable.code, 3);
  assert.match(unreachable.stderr, /not reachable/);
});

test("against a running API: import, list, run and export", async () => {
  const api = ["--api", server.url];
  assert.equal((await eq(["import", example, ...api])).code, 0);
  const listed = await eq(["projects", "--format", "json", ...api]);
  assert.deepEqual(json(listed.stdout).map((item: { slug: string }) => item.slug), ["mock-store"]);
  const run = await eq(["run", "mock-store", "--env", "local", "--base-url", mockUrl, "--read-only", "--quiet", ...api]);
  assert.equal(run.code, 0, run.stderr);
  const output = join(work, "exported.eq.json");
  assert.equal((await eq(["export", "mock-store", "-o", output, ...api])).code, 0);
  assert.equal(JSON.parse(readFileSync(output, "utf8")).project.name, "Mock Store");
});

test("a short load test passes and prints its verdict", async () => {
  const junit = join(work, "load.xml");
  const result = await eq(["load", "--file", example, "--env", "local", "--base-url", mockUrl, "--rps", "5", "--duration", "2", "--p95", "1000", "--junit", junit]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASSED/);
  assert.match(result.stdout, /req\/s/);
  const xml = readFileSync(junit, "utf8");
  assert.match(xml, /<testcase classname="[^"]+\.load" name="[^"]+"\/>/, "one case per criterion of the verdict");
  assert.match(xml, /failures="0"/);
});

test("login links this installation to a cloud workspace with a token, pulls, and sync reports it", async () => {
  const { createApp } = await import("@eq/api/app");
  const { randomBytes } = await import("node:crypto");
  const cloud = await createApp({ mode: "cloud", host: "127.0.0.1", port: 0, database: { type: "sqlite", file: null }, secrets: { type: "key", key: randomBytes(32).toString("base64") }, queue: { driver: "memory", concurrency: 1 }, auth: { required: true, jwtSecret: randomBytes(48).toString("base64"), registration: "invite", accessTtlSeconds: 900, refreshTtlDays: 30 }, network: { allowPrivateTargets: true, corsOrigins: [] } });
  await cloud.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${(cloud.getHttpServer().address() as { port: number }).port}`;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are read loosely by the tests
    const post = async (path: string, body: unknown, token?: string): Promise<any> => (await fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })).json();
    const owner = await post("/v1/auth/register", { email: "ci@example.com", password: "correct horse battery staple", name: "CI", workspace: "CI" });
    await post("/v1/projects/import", { file: JSON.parse(readFileSync(example, "utf8")) }, owner.accessToken);
    const { token } = await post("/v1/workspace/api-tokens", { name: "laptop", role: "admin" }, owner.accessToken);
    // No local server on this port: the command starts one on the same data, for itself.
    const env = { EQ_PORT: "1", EQ_DATA_DIR: join(work, "synced") };
    assert.equal((await eq(["sync"], env)).code, 2, "not linked yet");
    const login = await eq(["login", url, "--name", "CI runner"], { ...env, EQ_SYNC_TOKEN: token });
    assert.equal(login.code, 0, login.stderr);
    assert.match(login.stderr, /linked to CI/);
    assert.match(login.stderr, /first sync: ↓ [1-9]/);
    const again = await eq(["sync"], env);
    assert.equal(again.code, 0, again.stderr);
    assert.match(again.stderr, /↓ 0 · ↑ 0/);
    const status = await eq(["sync", "--status"], env);
    assert.match(status.stdout, /pending here: 0 · open conflicts: 0/);
    assert.equal((await eq(["sync", "--secrets", "on"], env)).code, 2, "the passphrase only from the environment");
    assert.equal((await eq(["logout"], env)).code, 0);
    assert.equal((await eq(["sync"], env)).code, 2);
  } finally { await cloud.close(); }
});
