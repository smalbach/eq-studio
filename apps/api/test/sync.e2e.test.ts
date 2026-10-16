import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { databases, start, waitFor, type Harness } from "./helpers.ts";

const example = JSON.parse(readFileSync(new URL("../../../examples/mock-store/mock-store.eq.json", import.meta.url), "utf8"));
const PASSWORD = "correct horse battery staple";
const PASSPHRASE = "a long shared passphrase";
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/**
 * One cloud workspace and two local installations — "the work laptop" and "the home desktop" —
 * syncing through it, as two machines would.
 */
for (const database of databases()) {
  describe(`sync between two devices through the cloud over ${database.name}`, () => {
    let cloud: Harness;
    let work: Harness;
    let home: Harness;
    let owner = "";
    let workspace = "";
    let projectId = "";

    const sync = async (device: Harness) => {
      const answer = await device.request("POST", "/v1/sync/run");
      assert.equal(answer.status, 200, JSON.stringify(answer.body));
      return answer.body as { pulled: number; pushed: number; conflicts: number; rejected: unknown[] };
    };
    const environment = async (device: Harness, key = "local") => (await device.request("GET", `/v1/projects/mock-store/environments`)).body.find((item: { id: string }) => item.id === key);

    before(async () => {
      cloud = await start(database.config(), { cloud: { allowPrivateTargets: true } });
      [work, home] = await Promise.all([start({ type: "sqlite", file: null }), start({ type: "sqlite", file: null })]);
      const registered = await cloud.request("POST", "/v1/auth/register", { email: "owner@example.com", password: PASSWORD, name: "Owner", workspace: "Store team" });
      owner = registered.body.accessToken;
      workspace = registered.body.workspaces[0].id;
    });
    after(async () => { await Promise.all([cloud?.close(), work?.close(), home?.close()]); });

    test("a device signs in from the browser: code, approval, token", async () => {
      assert.equal((await work.request("GET", "/v1/sync")).body.linked, false);
      const started = await work.request("POST", "/v1/sync/link", { url: `${cloud.base}/`, deviceName: "Work laptop" });
      assert.equal(started.status, 201, JSON.stringify(started.body));
      const { userCode, verificationUri } = started.body.pending;
      assert.match(userCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      assert.equal(verificationUri, `${cloud.base}/?device=${userCode}`);

      assert.equal((await work.request("POST", "/v1/sync/link/check")).body.linked, false, "pending until someone approves");
      assert.equal((await cloud.request("GET", `/v1/auth/device/${userCode}`)).status, 401, "approving needs a signed-in person");
      const described = await cloud.request("GET", `/v1/auth/device/${userCode.toLowerCase().replace("-", "")}`, undefined, bearer(owner));
      assert.equal(described.body.name, "Work laptop");
      assert.equal((await cloud.request("POST", `/v1/auth/device/${userCode}/approve`, { workspaceId: workspace }, bearer(owner))).status, 204);

      const linked = await work.request("POST", "/v1/sync/link/check");
      assert.equal(linked.body.linked, true);
      assert.deepEqual(linked.body.workspace, { id: workspace, name: "Store team" });
      assert.equal(linked.body.pending, null);
      const tokens = await cloud.request("GET", "/v1/workspace/api-tokens", undefined, bearer(owner));
      assert.deepEqual(tokens.body.map((item: { kind: string; name: string }) => [item.kind, item.name]), [["device", "Device · Work laptop"]]);
      assert.equal((await cloud.request("POST", `/v1/auth/device/${userCode}/approve`, { workspaceId: workspace }, bearer(owner))).status, 404, "a code works once");
    });

    test("a device can also link with an API token (CI, scripts)", async () => {
      const issued = await cloud.request("POST", "/v1/workspace/api-tokens", { name: "Home desktop", role: "admin" }, bearer(owner));
      assert.equal((await home.request("POST", "/v1/sync/link", { url: cloud.base, token: "eqt_not-a-real-token" })).status, 502);
      const linked = await home.request("POST", "/v1/sync/link", { url: cloud.base, token: issued.body.token, deviceName: "Home desktop" });
      assert.equal(linked.status, 201, JSON.stringify(linked.body));
      assert.equal(linked.body.linked, true);
      assert.equal((await home.request("POST", "/v1/sync/link", { url: cloud.base, token: issued.body.token })).status, 409, "one link per installation");
    });

    test("a project made on one device reaches the cloud and the other device, with the same ids", async () => {
      assert.equal((await work.request("POST", "/v1/projects/import", { file: example })).status, 201);
      projectId = (await work.request("GET", "/v1/projects/mock-store")).body.id;
      assert.ok((await work.request("GET", "/v1/sync")).body.pendingChanges > 0);
      const pushed = await sync(work);
      assert.ok(pushed.pushed >= 4, JSON.stringify(pushed));
      assert.deepEqual(pushed.rejected, []);
      assert.equal((await work.request("GET", "/v1/sync")).body.pendingChanges, 0, "nothing left to push");
      assert.equal((await sync(work)).pushed, 0, "a second sync has nothing to do");

      const inCloud = await cloud.request("GET", "/v1/projects/mock-store", undefined, bearer(owner));
      assert.equal(inCloud.body.id, projectId, "the cloud's own app sees it");
      const pulled = await sync(home);
      assert.ok(pulled.pulled >= 4);
      assert.equal(pulled.pushed, 0, "what came from the cloud is not sent back");
      const there = await home.request("GET", "/v1/projects/mock-store");
      assert.equal(there.body.id, projectId);
      assert.equal((await home.request("GET", "/v1/projects/mock-store/operations")).body.length, example.project.operations.length);
      assert.deepEqual((await home.request("GET", "/v1/projects/mock-store/environments")).body.map((item: { environmentId: string }) => item.environmentId), (await work.request("GET", "/v1/projects/mock-store/environments")).body.map((item: { environmentId: string }) => item.environmentId));
    });

    test("two devices that change different fields of the same environment both keep their change", async () => {
      const id = (await environment(work)).environmentId;
      await work.request("PATCH", `/v1/projects/mock-store/environments/${id}`, { name: "Local (work)" });
      await home.request("PATCH", `/v1/projects/mock-store/environments/${id}`, { baseUrl: home.mock });
      await sync(work);
      const merged = await sync(home);
      assert.equal(merged.conflicts, 0);
      for (const device of [home, work]) {
        if (device === work) await sync(work);
        const row = await environment(device);
        assert.deepEqual([row.name, row.baseUrl], ["Local (work)", home.mock]);
      }
    });

    test("two devices that change the same field: a conflict, shown, never overwritten silently", async () => {
      const id = (await environment(work)).environmentId;
      await work.request("PATCH", `/v1/projects/mock-store/environments/${id}`, { name: "Name from work" });
      await home.request("PATCH", `/v1/projects/mock-store/environments/${id}`, { name: "Name from home" });
      await sync(work);
      assert.equal((await sync(home)).conflicts, 1);
      assert.equal((await environment(home)).name, "Name from work", "the cloud's value until someone chooses");
      const conflicts = await home.request("GET", "/v1/sync/conflicts");
      assert.equal(conflicts.body.length, 1);
      assert.deepEqual([conflicts.body[0].field, conflicts.body[0].mine, conflicts.body[0].theirs], ["name", "Name from home", "Name from work"]);
      assert.equal((await home.request("GET", "/v1/sync")).body.openConflicts, 1);
      assert.equal((await cloud.request("GET", "/v1/sync/conflicts", undefined, bearer(owner))).body.length, 1, "the cloud lists it too");

      assert.equal((await home.request("POST", `/v1/sync/conflicts/${conflicts.body[0].id}/resolve`, { choice: "mine" })).status, 204);
      assert.equal((await environment(home)).name, "Name from home");
      await sync(home);
      assert.deepEqual((await cloud.request("GET", "/v1/sync/conflicts", undefined, bearer(owner))).body, [], "resolved in the cloud as well");
      await sync(work);
      assert.equal((await environment(work)).name, "Name from home");
      assert.deepEqual((await home.request("GET", "/v1/sync/conflicts")).body, []);
    });

    test("a conflict can be resolved in the cloud; the device drops it on its next sync", async () => {
      const id = (await environment(work)).environmentId;
      await work.request("PATCH", `/v1/projects/mock-store/environments/${id}`, { specUrl: "http://work.example/openapi.json" });
      await home.request("PATCH", `/v1/projects/mock-store/environments/${id}`, { specUrl: "http://home.example/openapi.json" });
      await sync(work);
      await sync(home);
      const [conflict] = (await cloud.request("GET", "/v1/sync/conflicts", undefined, bearer(owner))).body;
      assert.equal(conflict.device, "Home desktop");
      assert.equal((await cloud.request("POST", `/v1/sync/conflicts/${conflict.id}/resolve`, { choice: "mine" }, bearer(owner))).status, 204);
      await sync(home);
      assert.deepEqual((await home.request("GET", "/v1/sync/conflicts")).body, []);
      assert.equal((await environment(home)).specUrl, "http://home.example/openapi.json");
      await sync(work);
      assert.equal((await environment(work)).specUrl, "http://home.example/openapi.json");
    });

    test("the same contract imported on both devices becomes one version, under the first one's id", async () => {
      const spec = await (await fetch(`${work.mock}/openapi.json`)).json() as { info: { version: string } };
      spec.info.version = "2.0.0";
      const first = await work.request("POST", "/v1/projects/mock-store/spec-versions", { source: { document: spec } });
      const second = await home.request("POST", "/v1/projects/mock-store/spec-versions", { source: { document: spec } });
      assert.notEqual(first.body.id, second.body.id);
      await sync(work);
      await sync(home);
      for (const device of [home, work]) {
        if (device === work) await sync(work);
        const versions = (await device.request("GET", "/v1/projects/mock-store/spec-versions")).body as { id: string; version: string; active: boolean }[];
        assert.deepEqual(versions.filter((item) => item.version === "2.0.0").map((item) => [item.id, item.active]), [[first.body.id, true]]);
      }
    });

    test("runs travel once finished, append-only", async () => {
      await home.request("PATCH", "/v1/projects/mock-store/environments/local", { baseUrl: home.mock });
      const started = await home.request("POST", "/v1/projects/mock-store/runs", { environment: "local", readOnly: true });
      assert.equal(started.status, 202, JSON.stringify(started.body));
      const run = await waitFor(home, started.body.id);
      await sync(home);
      await sync(work);
      const copy = await work.request("GET", `/v1/runs/${run.id}`);
      assert.equal(copy.status, 200);
      assert.equal(copy.body.status, run.status);
      assert.equal(copy.body.totals.total, run.totals.total);
    });

    test("credentials stay on the device, unless a passphrase seals them end to end", async () => {
      const id = (await environment(work)).environmentId;
      assert.equal((await work.request("PUT", `/v1/projects/mock-store/environments/${id}/credentials/primary`, { kind: "bearer", secret: "work-secret-token-1234" })).status, 200);
      await sync(work);
      await sync(home);
      assert.deepEqual((await home.request("GET", `/v1/projects/mock-store/environments/${id}/credentials`)).body, [], "not without a passphrase");

      assert.equal((await work.request("PATCH", "/v1/sync", { passphrase: "short" })).status, 422);
      const on = await work.request("PATCH", "/v1/sync", { passphrase: PASSPHRASE });
      assert.equal(on.body.secrets, true, JSON.stringify(on.body));
      await sync(work);
      const inCloud = await cloud.request("GET", `/v1/projects/mock-store/environments/${id}/credentials`, undefined, bearer(owner));
      assert.deepEqual(inCloud.body, [], "the cloud keeps ciphertext it cannot use, never a credential");

      const wrong = await home.request("PATCH", "/v1/sync", { passphrase: "not the same passphrase" });
      assert.equal(wrong.status, 422);
      assert.match(wrong.body.detail, /passphrase/);
      await home.request("PATCH", "/v1/sync", { passphrase: PASSPHRASE });
      await sync(home);
      const there = await home.request("GET", `/v1/projects/mock-store/environments/${id}/credentials`);
      assert.deepEqual(there.body.map((item: { role: string; kind: string; lastFour: string }) => [item.role, item.kind, item.lastFour]), [["primary", "bearer", "1234"]]);
    });

    test("every credential kind travels sealed: its settings and its extra secrets too", async () => {
      const id = (await environment(work)).environmentId;
      const path = `/v1/projects/mock-store/environments/${id}/credentials`;
      assert.equal((await work.request("PUT", `${path}/insufficient`, { kind: "oauth2_authorization_code", tokenUrl: "https://idp.example/token", clientId: "app", refreshToken: "refresh-token-abcd" })).status, 200);
      assert.equal((await work.request("PUT", `${path}/alternate`, { kind: "hmac", secret: "hmac-key-5678", options: { hmac: { keyId: "k1", algorithm: "sha512" } } })).status, 200);
      await sync(work);
      await sync(home);
      const there = (await home.request("GET", path)).body as { role: string; kind: string; options: unknown; secretHints: unknown; lastFour: string }[];
      const byRole = Object.fromEntries(there.map((item) => [item.role, item]));
      assert.deepEqual([byRole.insufficient.kind, byRole.insufficient.secretHints], ["oauth2_authorization_code", { refreshToken: "abcd" }]);
      assert.deepEqual([byRole.alternate.kind, byRole.alternate.options, byRole.alternate.lastFour], ["hmac", { hmac: { keyId: "k1", algorithm: "sha512" } }, "5678"]);
      assert.equal((await home.request("GET", "/v1/sync")).body.pendingChanges, 0, "what arrived is not pushed back");
    });

    test("a device acts with its person's role: a viewer's changes are refused, entity by entity", async () => {
      const issued = await cloud.request("POST", "/v1/workspace/api-tokens", { name: "Read only", role: "viewer" }, bearer(owner));
      const reader = await start({ type: "sqlite", file: null });
      try {
        await reader.request("POST", "/v1/sync/link", { url: cloud.base, token: issued.body.token });
        assert.ok((await sync(reader)).pulled > 0, "a viewer pulls");
        await reader.request("PATCH", "/v1/projects/mock-store/environments/local", { name: "Not allowed" });
        const answer = await sync(reader);
        assert.equal(answer.rejected.length, 1);
        assert.match(JSON.stringify(answer.rejected), /admin role/);
        assert.equal((await reader.request("GET", "/v1/sync")).body.pendingChanges, 1, "kept, to push once the role allows it");
      } finally { await reader.close(); }
    });

    test("ids are global: a push from another workspace can neither overwrite nor point at this one's rows", async () => {
      const other = await cloud.request("POST", "/v1/auth/workspaces", { name: "Other team" }, bearer(owner));
      const token = (await cloud.request("POST", "/v1/workspace/api-tokens", { name: "intruder", role: "admin" }, { ...bearer(owner), "x-workspace": other.body.id })).body.token;
      const project = await cloud.request("GET", "/v1/projects/mock-store", undefined, bearer(owner));
      const environments = (await cloud.request("GET", "/v1/projects/mock-store/environments", undefined, bearer(owner))).body.length;
      const items = [
        { type: "project", id: project.body.id, data: { slug: "taken", name: "Taken", config: {}, load: null, activeSpecVersionId: null, deletedAt: null } },
        { type: "environment", id: "0199aaaa-0000-7000-8000-000000000001", data: { projectId: project.body.id, key: "x", name: "x", baseUrl: "http://x" } },
      ];
      const pushed = await cloud.request("POST", "/v1/sync/changes", { items }, bearer(token));
      assert.deepEqual(pushed.body.results.map((item: { status: string }) => item.status), ["rejected", "rejected"]);
      assert.equal((await cloud.request("GET", "/v1/projects/mock-store", undefined, bearer(owner))).body.name, project.body.name);
      assert.equal((await cloud.request("GET", "/v1/projects/mock-store/environments", undefined, bearer(owner))).body.length, environments);
      assert.deepEqual((await cloud.request("GET", "/v1/sync/changes?since=0", undefined, bearer(token))).body.changes, [], "nothing of the first workspace in the other's feed");
    });

    test("a device whose person leaves the workspace, or that unlinks, stops syncing", async () => {
      const tokens = await cloud.request("GET", "/v1/workspace/api-tokens", undefined, bearer(owner));
      const device = tokens.body.find((item: { kind: string }) => item.kind === "device");
      assert.equal((await work.request("DELETE", "/v1/sync/link")).status, 204);
      assert.equal((await work.request("GET", "/v1/sync")).body.linked, false);
      const after = await cloud.request("GET", "/v1/workspace/api-tokens", undefined, bearer(owner));
      assert.ok(after.body.find((item: { id: string }) => item.id === device.id).revokedAt, "unlinking revokes the device's token");
      assert.equal((await work.request("GET", "/v1/projects/mock-store")).status, 200, "the data stays on the device");
    });
  });
}
