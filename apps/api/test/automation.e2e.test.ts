import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { CommandBus } from "@nestjs/cqrs";
import type { DataSource } from "typeorm";
import type { AppConfig } from "../src/config.ts";
import type { NotificationTargetRow, RunRow } from "../src/database/entities.ts";
import { uuidv7 } from "../src/shared/ids.ts";
import type { SecretBox } from "../src/shared/secret-box.ts";
import { APP_CONFIG, DATA_SOURCE, SECRET_BOX } from "../src/shared/tokens.ts";
import { nextOccurrence, parseCron } from "../src/modules/schedules/domain/cron.ts";
import { Scheduler } from "../src/modules/schedules/application/scheduler.ts";
import { ScheduleRepository } from "../src/modules/schedules/infrastructure/schedule.repository.ts";
import { emailMessage, shouldNotify, signature, slackMessage, verdictOf, type RunPayload } from "../src/modules/notifications/domain/notification.ts";
import { NotificationService, RunFinishedNotifier } from "../src/modules/notifications/application/notifications.ts";
import { sendMail } from "../src/modules/notifications/infrastructure/smtp.ts";
import { databases, start, waitFor, type Harness } from "./helpers.ts";

const example = JSON.parse(readFileSync(new URL("../../../examples/mock-store/mock-store.eq.json", import.meta.url), "utf8"));
const at = (iso: string) => new Date(iso);

describe("cron", () => {
  test("presets and five fields, in UTC, strictly after the given instant", () => {
    assert.equal(nextOccurrence("@hourly", at("2026-10-16T10:00:00Z")).toISOString(), "2026-10-16T11:00:00.000Z");
    assert.equal(nextOccurrence("@hourly", at("2026-10-16T10:59:59Z")).toISOString(), "2026-10-16T11:00:00.000Z");
    assert.equal(nextOccurrence("@daily", at("2026-10-16T07:00:00Z")).toISOString(), "2026-10-17T06:00:00.000Z");
    // 2026-10-16 is a Friday: the next Monday at 06:00.
    assert.equal(nextOccurrence("@weekly", at("2026-10-16T07:00:00Z")).toISOString(), "2026-10-19T06:00:00.000Z");
    assert.equal(nextOccurrence("*/15 * * * *", at("2026-10-16T10:07:00Z")).toISOString(), "2026-10-16T10:15:00.000Z");
    assert.equal(nextOccurrence("30 2 * * 1-5", at("2026-10-16T03:00:00Z")).toISOString(), "2026-10-19T02:30:00.000Z");
    assert.equal(nextOccurrence("0 0 1 1 *", at("2026-10-16T03:00:00Z")).toISOString(), "2027-01-01T00:00:00.000Z");
    assert.equal(nextOccurrence("0 0 29 2 *", at("2026-10-16T03:00:00Z")).toISOString(), "2028-02-29T00:00:00.000Z");
    // Both day fields restricted: either one matching is enough (the 1st, or a Sunday).
    assert.equal(nextOccurrence("0 12 1 * 0", at("2026-10-16T03:00:00Z")).toISOString(), "2026-10-18T12:00:00.000Z");
    assert.equal(nextOccurrence("0 12 * * 7", at("2026-10-16T03:00:00Z")).toISOString(), "2026-10-18T12:00:00.000Z");
  });

  test("invalid expressions are 422s that say why", () => {
    for (const bad of ["", "* * * *", "61 * * * *", "* * * * MON", "5-1 * * * *", "*/0 * * * *"]) assert.throws(() => parseCron(bad), (error: { status?: number }) => error.status === 422, bad);
    assert.throws(() => nextOccurrence("0 0 31 2 *", new Date()), /never fires/);
  });
});

describe("notification rules", () => {
  test("a verdict is passed or failed; an error fails, a cancelled run says nothing", () => {
    assert.deepEqual(["passed", "failed", "error", "cancelled", "interrupted"].map(verdictOf), ["passed", "failed", "failed", null, null]);
  });

  test("`change` lets through only a flip, with passed as the baseline; `always` lets everything through", () => {
    assert.equal(shouldNotify("change", "passed", null), false);
    assert.equal(shouldNotify("change", "failed", null), true);
    assert.equal(shouldNotify("change", "failed", "passed"), true);
    assert.equal(shouldNotify("change", "failed", "failed"), false);
    assert.equal(shouldNotify("change", "passed", "failed"), true);
    assert.equal(shouldNotify("change", null, "failed"), false);
    assert.equal(shouldNotify("always", "passed", "passed"), true);
    assert.equal(shouldNotify("always", null, null), true);
  });

  test("Slack and email read the same headline, in the run's language", () => {
    const payload = { event: "run.finished", sentAt: "", project: { id: "p", slug: "store", name: "Store" }, environment: { id: "e", key: "prod", name: "Production", baseUrl: "https://api.example.com" }, run: { id: "r", kind: "functional", status: "failed", verdict: "failed", previousVerdict: "passed", changed: true, scope: "GET matrix", totals: { total: 10, completed: 10, passed: 8, failed: 2, blocked: 0 }, error: null, triggeredBy: "schedule:s", scheduleId: "s", createdAt: "", startedAt: "", finishedAt: "", durationMs: 4000, url: "https://eq.example.com/?corrida=r" } } satisfies RunPayload;
    const slack = slackMessage(payload, "en");
    assert.match(slack.text, /^:x: \*Store · Production: Functional run failed \(was passed\)\*/);
    assert.match(slack.text, /8 of 10 cases passed, 2 failed/);
    assert.match(slack.text, /<https:\/\/eq\.example\.com\/\?corrida=r\|Open the run>/);
    const email = emailMessage(payload, "es");
    assert.equal(email.subject, "Store · Production: Verificación funcional falló (antes pasaba)");
    assert.match(email.text, /Iniciada por una programación/);
  });
});

describe("smtp", () => {
  test("sends one message to every recipient, the subject encoded", async () => {
    const received: string[] = [];
    let data = "";
    const server = createTcpServer((socket) => {
      let inData = false;
      let buffer = "";
      socket.write("220 fake ESMTP\r\n");
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        if (inData) {
          if (!buffer.includes("\r\n.\r\n")) return;
          data = buffer.slice(0, buffer.indexOf("\r\n.\r\n"));
          buffer = buffer.slice(buffer.indexOf("\r\n.\r\n") + 5);
          inData = false;
          socket.write("250 queued\r\n");
        }
        let index: number;
        while ((index = buffer.indexOf("\r\n")) >= 0 && !inData) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          received.push(line);
          if (line.startsWith("EHLO")) socket.write("250-fake\r\n250 8BITMIME\r\n");
          else if (line === "DATA") { inData = true; socket.write("354 go\r\n"); }
          else if (line === "QUIT") { socket.end("221 bye\r\n"); }
          else socket.write("250 ok\r\n");
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    await sendMail({ host: "127.0.0.1", port, secure: false, from: "EQ <eq@example.com>" }, { to: ["a@example.com", "b@example.com"], subject: "Tienda · Producción: falló", text: "línea 1\nlínea 2" });
    server.close();
    assert.deepEqual(received.filter((line) => /^(MAIL|RCPT)/.test(line)), ["MAIL FROM:<eq@example.com>", "RCPT TO:<a@example.com>", "RCPT TO:<b@example.com>"]);
    assert.match(data, /^Subject: =\?UTF-8\?B\?/m);
    const body = data.split("\r\n\r\n")[1];
    assert.equal(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8"), "línea 1\r\nlínea 2");
  });

  test("never sends a password over a connection without TLS", async () => {
    const server = createTcpServer((socket) => { socket.write("220 fake\r\n"); socket.on("data", () => socket.write("250 fake\r\n")); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    await assert.rejects(sendMail({ host: "127.0.0.1", port, secure: false, user: "u", password: "p", from: "eq@example.com" }, { to: ["a@example.com"], subject: "s", text: "t" }), /not sent in clear/);
    server.close();
  });
});

/** A webhook receiver: every request it got, body and headers. */
async function receiver(status = 200) {
  const requests: { headers: IncomingHttpHeaders; body: string }[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => { requests.push({ headers: request.headers, body }); response.statusCode = status; response.end(); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

for (const database of databases()) {
  describe(`schedules and notifications over ${database.name}`, () => {
    let h: Harness;
    let db: DataSource;
    before(async () => {
      h = await start(database.config());
      db = h.app.get<DataSource>(DATA_SOURCE);
      assert.equal((await h.request("POST", "/v1/projects/import", { file: example })).status, 201);
      await h.request("PATCH", "/v1/projects/mock-store/environments/local", { baseUrl: h.mock });
    });
    after(async () => { await h?.close(); });

    const runsOf = async (scheduleId: string) => (await db.getRepository("Run").find({ where: { triggeredBy: `schedule:${scheduleId}` } })) as RunRow[];
    const makeDue = (id: string) => db.getRepository("Schedule").update({ id }, { nextRunAt: "2000-01-01T00:00:00.000Z" });

    test("a schedule is saved with its next occurrence, and a bad expression is refused", async () => {
      const created = await h.request("POST", "/v1/projects/mock-store/schedules", { name: "Nightly GETs", environment: "local", cron: "@daily", kind: "functional", plan: { readOnly: true } });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.enabled, true);
      assert.ok(Date.parse(created.body.nextRunAt) > Date.now());
      assert.equal(new Date(created.body.nextRunAt).getUTCHours(), 6);
      assert.equal((await h.request("POST", "/v1/projects/mock-store/schedules", { name: "Bad", environment: "local", cron: "99 * * * *", kind: "functional" })).status, 422);
      assert.equal((await h.request("POST", "/v1/projects/mock-store/schedules", { name: "Nowhere", environment: "missing", cron: "@daily", kind: "functional" })).status, 404);
      const paused = await h.request("PATCH", `/v1/projects/mock-store/schedules/${created.body.id}`, { enabled: false });
      assert.equal(paused.body.nextRunAt, null);
      const listed = await h.request("GET", "/v1/projects/mock-store/schedules");
      assert.deepEqual(listed.body.map((item: { name: string }) => item.name), ["Nightly GETs"]);
      assert.equal((await h.request("DELETE", `/v1/projects/mock-store/schedules/${created.body.id}`)).status, 204);
    });

    test("a due schedule fires once, starts its run through the queue and moves to its next occurrence", async () => {
      const created = await h.request("POST", "/v1/projects/mock-store/schedules", { name: "Every minute", environment: "local", cron: "* * * * *", kind: "functional", plan: { readOnly: true } });
      const scheduler = h.app.get(Scheduler);
      assert.equal(await scheduler.tick(), 0, "not due yet");
      await makeDue(created.body.id);
      assert.equal(await scheduler.tick(), 1);
      assert.equal(await scheduler.tick(), 0, "already moved on");
      const [run] = await runsOf(created.body.id);
      assert.equal(run.kind, "functional");
      assert.equal((run.plan as { readOnly: boolean }).readOnly, true);
      const finished = await waitFor(h, run.id);
      assert.equal(finished.status, "passed");
      const [schedule] = (await h.request("GET", "/v1/projects/mock-store/schedules")).body.filter((item: { id: string }) => item.id === created.body.id);
      assert.equal(schedule.lastRunId, run.id);
      assert.equal(schedule.lastRunStatus, "passed");
      assert.ok(Date.parse(schedule.nextRunAt) > Date.now());
    });

    test("two API processes over the same database never fire the same occurrence twice", async () => {
      const created = await h.request("POST", "/v1/projects/mock-store/schedules", { name: "Contended", environment: "local", cron: "*/5 * * * *", kind: "functional", plan: { readOnly: true } });
      // A second scheduler with its own state, as another process would have.
      const other = new Scheduler(h.app.get(ScheduleRepository), h.app.get(CommandBus), h.app.get<AppConfig>(APP_CONFIG));
      const first = h.app.get(Scheduler);
      for (let round = 0; round < 3; round += 1) {
        for (const run of await runsOf(created.body.id)) await waitFor(h, run.id);
        await makeDue(created.body.id);
        const [mine, theirs] = await Promise.all([first.tick(), other.tick()]);
        assert.equal(mine + theirs, 1, `round ${round}: ${mine} + ${theirs}`);
      }
      assert.equal((await runsOf(created.body.id)).length, 3);
    });

    test("an occurrence is skipped while the schedule's previous run is still going", async () => {
      const created = await h.request("POST", "/v1/projects/mock-store/schedules", { name: "Slow", environment: "local", cron: "* * * * *", kind: "functional", plan: { readOnly: true, delayMs: 200 } });
      const now = await h.request("POST", `/v1/projects/mock-store/schedules/${created.body.id}/run`);
      assert.equal(now.status, 202);
      assert.ok(now.body.id);
      await makeDue(created.body.id);
      assert.equal(await h.app.get(Scheduler).tick(), 0);
      const [schedule] = (await h.request("GET", "/v1/projects/mock-store/schedules")).body.filter((item: { id: string }) => item.id === created.body.id);
      assert.match(schedule.lastError, /still in progress/);
      await h.request("POST", `/v1/runs/${now.body.id}/cancel`);
      await waitFor(h, now.body.id);
    });

    test("a webhook gets the run as JSON, signed with HMAC over timestamp and body; its URL is never read back", async () => {
      const hook = await receiver();
      const secret = "a-signing-secret-of-some-length";
      const created = await h.request("POST", "/v1/projects/mock-store/notifications", { name: "CI hook", kind: "webhook", url: hook.url, signingSecret: secret, notifyOn: "always" });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.signed, true);
      assert.match(created.body.urlHint, /^127\.0\.0\.1:\d+\/…hook$/);
      const listed = await h.request("GET", "/v1/projects/mock-store/notifications");
      assert.equal(JSON.stringify(listed.body).includes(hook.url), false);
      assert.equal(JSON.stringify(listed.body).includes(secret), false);
      const stored = await db.getRepository("NotificationTarget").findOneBy({ id: created.body.id }) as NotificationTargetRow;
      assert.ok(stored.url!.startsWith("v1.") && stored.signingSecret!.startsWith("v1."));

      const started = await h.request("POST", "/v1/projects/mock-store/runs", { environment: "local", readOnly: true });
      await waitFor(h, started.body.id);
      await h.app.get(RunFinishedNotifier).idle();
      assert.equal(hook.requests.length, 1);
      const [delivery] = hook.requests;
      assert.equal(delivery.headers["content-type"], "application/json");
      assert.equal(delivery.headers["x-eq-event"], "run.finished");
      const timestamp = Number(delivery.headers["x-eq-timestamp"]);
      assert.ok(Math.abs(timestamp - Date.now() / 1000) < 60);
      assert.equal(delivery.headers["x-eq-signature"], signature(secret, timestamp, delivery.body));
      const payload = JSON.parse(delivery.body) as RunPayload;
      assert.equal(payload.event, "run.finished");
      assert.equal(payload.run.id, started.body.id);
      assert.equal(payload.run.verdict, "passed");
      assert.equal(payload.project.slug, "mock-store");
      assert.equal(payload.environment.key, "local");
      assert.equal(payload.run.totals.total, started.body.total);

      const tested = await h.request("POST", `/v1/projects/mock-store/notifications/${created.body.id}/test`);
      assert.deepEqual(tested.body, { ok: true, status: 200, error: null });
      assert.equal(JSON.parse(hook.requests[1].body).test, true);
      const after = (await h.request("GET", "/v1/projects/mock-store/notifications")).body.targets.find((item: { id: string }) => item.id === created.body.id);
      assert.equal(after.lastStatus, "ok");
      assert.equal((await h.request("DELETE", `/v1/projects/mock-store/notifications/${created.body.id}`)).status, 204);
      await hook.close();
    });

    test("a failing receiver is recorded on the target, not thrown", async () => {
      const hook = await receiver(500);
      const created = await h.request("POST", "/v1/projects/mock-store/notifications", { name: "Broken", kind: "slack", url: hook.url });
      const tested = await h.request("POST", `/v1/projects/mock-store/notifications/${created.body.id}/test?locale=en`);
      assert.deepEqual(tested.body, { ok: false, status: 500, error: "HTTP 500" });
      assert.match(JSON.parse(hook.requests[0].body).text, /^:x: \*\[test\] Mock Store/);
      const listed = (await h.request("GET", "/v1/projects/mock-store/notifications")).body.targets.find((item: { id: string }) => item.id === created.body.id);
      assert.equal(listed.lastStatus, "failed");
      await h.request("DELETE", `/v1/projects/mock-store/notifications/${created.body.id}`);
      await hook.close();
    });

    test("`change` notifies a flip of the verdict only; `always` notifies every run", async () => {
      const changes = await receiver();
      const every = await receiver();
      const onChange = await h.request("POST", "/v1/projects/mock-store/notifications", { name: "Flips", kind: "webhook", url: changes.url, notifyOn: "change" });
      const always = await h.request("POST", "/v1/projects/mock-store/notifications", { name: "All", kind: "webhook", url: every.url, notifyOn: "always" });
      // A separate environment, so the runs of the other tests are not part of its history.
      const environment = await h.request("POST", "/v1/projects/mock-store/environments", { key: "verdicts", name: "Verdicts", baseUrl: h.mock });
      const project = (await h.request("GET", "/v1/projects/mock-store")).body;
      const notifier = h.app.get(RunFinishedNotifier);
      const sequence = ["passed", "failed", "failed", "cancelled", "error", "passed", "passed"] as const;
      const flips: boolean[] = [];
      for (const [index, status] of sequence.entries()) {
        const run: RunRow = { id: uuidv7(), workspaceId: "00000000-0000-7000-8000-000000000001", projectId: project.id, environmentId: environment.body.id, specVersionId: null, kind: "functional", status, scope: "GET matrix", plan: { locale: "en" }, totals: { total: 1, completed: 1, passed: status === "passed" ? 1 : 0, failed: status === "passed" ? 0 : 1, blocked: 0 }, report: null, error: null, triggeredBy: "local", createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), startedAt: null, finishedAt: null, durationMs: null };
        await db.getRepository("Run").insert(run as never);
        const before = changes.requests.length;
        await notifier.notify(run.id);
        flips.push(changes.requests.length > before);
      }
      assert.deepEqual(flips, [false, true, false, false, false, true, false]);
      assert.equal(every.requests.length, sequence.length);
      const flipped = JSON.parse(changes.requests[1].body) as RunPayload;
      assert.deepEqual([flipped.run.previousVerdict, flipped.run.verdict, flipped.run.changed], ["failed", "passed", true]);
      for (const target of [onChange, always]) await h.request("DELETE", `/v1/projects/mock-store/notifications/${target.body.id}`);
      await changes.close();
      await every.close();
    });

    test("email is offered only with SMTP configured", async () => {
      const listed = await h.request("GET", "/v1/projects/mock-store/notifications");
      assert.equal(listed.body.emailAvailable, false);
      const refused = await h.request("POST", "/v1/projects/mock-store/notifications", { name: "Team", kind: "email", recipients: ["team@example.com"] });
      assert.equal(refused.status, 422);
      assert.match(refused.body.detail, /EQ_SMTP_HOST/);
    });
  });
}

describe("notifications in a hosted deployment", () => {
  let h: Harness;
  before(async () => { h = await start(databases()[0].config(), { cloud: { allowPrivateTargets: false } }); });
  after(async () => { await h?.close(); });

  test("a webhook to a private address is refused by the SSRF guard", async () => {
    const box = h.app.get<SecretBox>(SECRET_BOX);
    const id = uuidv7();
    const row: NotificationTargetRow = { id, workspaceId: "w", projectId: "p", name: "internal", kind: "webhook", notifyOn: "always", enabled: true, url: box.encrypt("http://169.254.169.254/latest/meta-data", `${id}:url`), urlHint: null, signingSecret: null, recipients: null, lastSentAt: null, lastStatus: null, lastError: null, rev: 1, createdAt: "", updatedAt: "" };
    const result = await h.app.get(NotificationService).deliver(row, { event: "run.finished", test: true } as RunPayload, "en");
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /private, loopback or link-local/);
  });
});
