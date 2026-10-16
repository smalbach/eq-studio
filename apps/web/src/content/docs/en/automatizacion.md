# Schedules and notifications

A contract that held yesterday can break tonight. A **schedule** starts a run on its own: every hour, every night or every Monday. A **notification** says that a run finished: to a webhook, a Slack channel or an email. Both are configured per project in **Automation**, the button in the header next to the environment, and both live in the API: they keep working with every browser closed.

## Schedules

A schedule has a name, an environment, a frequency and what it runs:

- **Functional**: the case matrix, by default **read only** (only GET), the safe choice against an environment you do not control.
- **Load**: a load, stress, spike or soak test with its rate (RPS) and duration.

Frequencies:

| Preset | Fires | Cron |
| --- | --- | --- |
| Hourly | at minute 0 of every hour | `0 * * * *` |
| Daily | every day at 06:00 UTC | `0 6 * * *` |
| Weekly | Mondays at 06:00 UTC | `0 6 * * 1` |
| Custom | whatever the expression says | five fields |

A custom expression has five fields — minute, hour, day of the month, month, day of the week (0 or 7 is Sunday) — with lists (`0,30`), ranges (`1-5`) and steps (`*/15`). Names (`MON`, `JAN`) are not accepted. Examples: `*/30 8-18 * * 1-5` (every half hour during office hours, Monday to Friday), `0 2 1 * *` (the 1st of each month at 02:00).

**Times are in UTC**, always: the same schedule fires at the same instant on any server, and the change to and from daylight saving time never skips or repeats a run. The panel shows the next run in your local time.

What to expect:

- **Run now** starts the schedule's run outside its cadence; the next occurrence does not move.
- If the previous run of the same schedule has not finished, the occurrence is **skipped** and the panel says so: runs never pile up.
- If the API was off when a run was due, it runs **once** when it starts again, not once per missed occurrence.
- If the environment or the project is deleted, the schedule pauses itself with the reason.
- Scheduled runs appear in the history like any other one, started by `schedule:<id>`.

### Permissions

The same as starting the run by hand: an **editor** schedules read-only runs; a run with writes and a load test need an **admin**. Anyone in the workspace sees the schedules.

### With several API processes

In the cloud there may be several API processes over the same database. Each one checks the schedules every 30 seconds (`EQ_SCHEDULER_TICK_SECONDS`), and only one starts each occurrence: the occurrence is claimed in the database with a single conditional update, and whoever does not win it moves on. The run then goes through the same queue (memory or Redis) as one started by hand.

## Notifications

A notification target receives a message when a run of the project finishes. Kinds:

| Kind | What it sends |
| --- | --- |
| **Webhook** | A `POST` with JSON (see below), optionally signed with HMAC. |
| **Slack** | A message to an [incoming webhook](https://api.slack.com/messaging/webhooks) (`https://hooks.slack.com/services/…`). Works with chat tools that accept the same format. |
| **Email** | A plain-text email to one or more recipients. Only available if the server has SMTP configured (see [Cloud deployment](doc:deploy)). |

**When** it notifies:

- **Only when the verdict changes** (the default): passed → failed or failed → passed, compared with the previous run of the same environment and kind. With no previous run, the baseline is "passed": a first failure is announced, a first success is not.
- **Always**: every finished run.

A run that ended with an **error** (the environment did not answer, the preflight failed) counts as failed. A **cancelled** or **interrupted** run says nothing about the API: it only notifies targets set to "always".

The message goes in the run's language. **Send test** sends a sample message right away and shows whether it arrived; the last delivery of each target (ok or the error) stays visible.

### The URL is a secret

Whoever has a webhook URL can post to that channel. That is why it is stored **encrypted**, like credentials, it never comes back to the browser — only its host and last four characters are shown — and to change it you type it again. In the cloud, deliveries go through the same SSRF guards as runs: no internal addresses unless `EQ_ALLOW_PRIVATE_TARGETS=true`.

### The webhook's JSON

```json
{
  "event": "run.finished",
  "sentAt": "2026-10-16T06:01:12.000Z",
  "project": { "id": "…", "slug": "store-api", "name": "Store API" },
  "environment": { "id": "…", "key": "staging", "name": "Staging", "baseUrl": "https://staging.example.com" },
  "run": {
    "id": "…", "kind": "functional", "status": "failed",
    "verdict": "failed", "previousVerdict": "passed", "changed": true,
    "scope": "GET matrix", "totals": { "total": 42, "completed": 42, "passed": 40, "failed": 2, "blocked": 0 },
    "error": null, "triggeredBy": "schedule:…", "scheduleId": "…",
    "createdAt": "…", "startedAt": "…", "finishedAt": "…", "durationMs": 12000,
    "url": "https://eq.example.com/?vista=funcional&proyecto=store-api&corrida=…"
  }
}
```

A test message carries `"test": true`. `url` appears when the server knows its public address (`EQ_PUBLIC_URL`).

Headers: `X-EQ-Event: run.finished`, `X-EQ-Delivery` (a unique id per delivery) and, with a signing secret, `X-EQ-Timestamp` and `X-EQ-Signature`.

### Verifying the signature

The signature is `sha256=` followed by the HMAC-SHA256, in hex, of `<timestamp>.<body>` with the secret you configured (16 characters or more). The timestamp is signed too, so a captured message cannot be replayed later. In Node:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, headers, rawBody) {
  const timestamp = Number(headers["x-eq-timestamp"]);
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false; // more than 5 minutes old
  const expected = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
  const given = String(headers["x-eq-signature"] ?? "");
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
```

Verify it over the **raw** body, before parsing it: reformatting the JSON changes the signature.

## From the API

| Method and path | What it does |
| --- | --- |
| `GET/POST /v1/projects/:project/schedules` | Lists or creates schedules: `{ name, environment, cron, kind: "functional" \| "load", plan, enabled? }`. `plan` takes the same fields as starting the run (`readOnly`, `mode`… or `type`, `baseRps`, `durationS`…). |
| `PATCH/DELETE …/schedules/:schedule` | Changes (`name`, `environment`, `cron`, `enabled`, `plan`) or deletes a schedule. |
| `POST …/schedules/:schedule/run` | Runs it now. **202** `{ id }`. |
| `GET/POST /v1/projects/:project/notifications` | Lists (`{ emailAvailable, targets }`) or creates targets: `{ name, kind: "webhook" \| "slack" \| "email", notifyOn: "change" \| "always", url?, signingSecret?, recipients? }`. |
| `PATCH/DELETE …/notifications/:target` | Changes or deletes a target. Without `url` it keeps the previous one. |
| `POST …/notifications/:target/test` | Sends a test message; answers `{ ok, status, error }`. |

Creating, changing and testing targets requires the **admin** role.
