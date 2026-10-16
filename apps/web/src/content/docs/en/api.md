# REST API

Everything the app does goes through the Endpoint Quality API, so you can do it from a script or from CI too. Everything lives under `/v1`, in JSON, and errors come as Problem Details (`application/problem+json`) with `detail` and, where it applies, per-field `errors`.

In local mode the API listens on `http://127.0.0.1:4400`, on the loopback only and with no authentication. Wherever it says `:project`, the id or the slug works. In a [cloud deployment](doc:deploy) every request carries `Authorization: Bearer <token>`: an API token (`eqt_…`, created in Settings) or a session's from `POST /v1/auth/login`. An API token already belongs to one workspace; with a session token, `X-Workspace: <id>` picks the workspace (otherwise, the first one).

## Resources

| Method and path | What it does |
| --- | --- |
| `GET /health` | Status, mode and database engine. |
| `GET /v1/projects` · `POST /v1/projects` | Lists or creates projects (with `spec: { url }` or `spec: { document }` and `environments`). |
| `POST /v1/projects/import` | Creates a project from a `.eq.json` (`{ file, slug? }`). |
| `GET/PATCH/DELETE /v1/projects/:project` | The project; change `name` or `slug` (`expectedRev`); archive it. |
| `GET /v1/projects/:project/export` | The project's `.eq.json`. |
| `GET /v1/examples` · `GET /v1/examples/:id` · `POST /v1/examples/:id/import` | The bundled example projects; import one as a project. |
| `GET/POST /v1/projects/:project/spec-versions` | Contract versions; import a new one (`{ source: { url } \| { document }, activate? }`). |
| `POST /v1/projects/:project/spec-versions/:version/activate` | Goes back to another contract version. |
| `GET /v1/projects/:project/operations` | Operations of the active version. |
| `GET /v1/projects/:project/config` | The configuration and its `rev`. |
| `PUT /v1/projects/:project/config/:section` | `{ value, expectedRev? }`: saves one section, validated against the contract. |
| `POST /v1/projects/:project/config/generate` | `{ mode: "merge" \| "replace" }`: regenerates from the contract. |
| `GET /v1/projects/:project/scenarios` | The case matrix (`?auth=true`, `?locale=en`). |
| `GET /v1/projects/:project/queue-preview` | The queue in order (`?mode=safe\|contract\|custom`, `?readOnly=true`, `?auth=true`, `?endpoints=a,b`, `?order=`, `?locale=`). |
| `GET/POST /v1/projects/:project/environments` | Environments. |
| `PATCH/DELETE …/environments/:environment` | Changes or deletes an environment. |
| `GET …/environments/:environment/credentials` | The configured credentials, never the secret: at most its last 4 characters. |
| `PUT …/environments/:environment/credentials/:role` | Saves a credential (`primary`, `insufficient`, `alternate`). `kind`: `bearer`, `api_key` (+`headerName`), `basic` (+`username`), `oauth2_client_credentials` (+`tokenUrl`, `clientId`, `scope`). Without `secret` it keeps the previous one. |
| `DELETE …/environments/:environment/credentials/:role` | Deletes the credential. |
| `POST /v1/projects/:project/runs` | Starts a functional run. **202** `{ id, total }`. |
| `POST /v1/projects/:project/load-runs` | Starts a load test. **202** `{ id }`. |
| `POST /v1/projects/:project/probe` | A single case, not saved: `environment`, `operationId`, `scenarioId`, `parameters?`, `body?`. |
| `GET /v1/projects/:project/runs` | History (`?kind=functional\|load`, `?limit=`). |
| `GET /v1/runs/:run` | A run and its cases (`?steps=true` with every request). |
| `DELETE /v1/runs/:run` | Deletes a run from the history. |
| `GET /v1/runs/:run/stream` | Server-sent events: `snapshot`, `case`, `progress`, `finished`. |
| `POST /v1/runs/:run/cancel` · `POST /v1/runs/:run/replay` | Cancel or repeat a run. |
| `GET/POST /v1/projects/:project/schedules` · `PATCH/DELETE …/schedules/:schedule` · `POST …/schedules/:schedule/run` | Schedules: runs the API starts on its own. See [Schedules and notifications](doc:automatizacion). |
| `GET/POST /v1/projects/:project/notifications` · `PATCH/DELETE …/notifications/:target` · `POST …/notifications/:target/test` | Where a finished run is announced (webhook, Slack, email). |

With `expectedRev` you avoid overwriting someone else's change: if the project changed since you read it, the answer is **409**.

## Create a project from its contract

```bash
curl -s -X POST http://127.0.0.1:4400/v1/projects \
  -H 'content-type: application/json' \
  -d '{"name":"Store API",
       "spec":{"url":"http://127.0.0.1:4010/openapi.json"},
       "environments":[{"name":"Local","baseUrl":"http://127.0.0.1:4010"}]}'
```

## Save a credential

```bash
curl -s -X PUT http://127.0.0.1:4400/v1/projects/store-api/environments/local/credentials/primary \
  -H 'content-type: application/json' \
  -d "{\"kind\":\"bearer\",\"secret\":\"$STORE_TOKEN\"}"
```

The secret is encrypted on arrival and never comes back in any response. Read it from an environment variable; do not write it into the script.

## Start a run and wait for the result

```bash
RUN=$(curl -s -X POST http://127.0.0.1:4400/v1/projects/store-api/runs \
  -H 'content-type: application/json' \
  -d '{"environment":"local","readOnly":true}' | jq -r .id)

# Follow the progress live
curl -N http://127.0.0.1:4400/v1/runs/$RUN/stream
```

Plan fields: `environment` (required), `readOnly`, `mode` (`safe`, `contract` or `custom`), `customOrder` (with `mode: "custom"`), `endpointIds`, `caseSelection`, `authEnabled`, `samples`, `delayMs`, `locale`, `scope`.

## In CI

A script that fails the pipeline when any case fails:

```bash
#!/usr/bin/env bash
set -euo pipefail
API=http://127.0.0.1:4400
RUN=$(curl -sf -X POST "$API/v1/projects/store-api/runs" \
  -H 'content-type: application/json' -d '{"environment":"ci"}' | jq -r .id)
while true; do
  STATUS=$(curl -sf "$API/v1/runs/$RUN" | jq -r .status)
  case "$STATUS" in queued|running|cancelling) sleep 2 ;; *) break ;; esac
done
curl -sf "$API/v1/runs/$RUN" | jq '.totals'
[ "$STATUS" = "passed" ]
```

Run states: `queued`, `running`, `cancelling`, `passed`, `failed`, `cancelled`, `interrupted` (the process restarted during the run) and `error` (it could not be executed).

## A load test

```bash
curl -s -X POST http://127.0.0.1:4400/v1/projects/store-api/load-runs \
  -H 'content-type: application/json' \
  -d '{"environment":"local","type":"load","baseRps":20,"durationS":60,"mixId":"all-gets"}'
```

Fields: `type` (`load`, `stress`, `spike`, `soak`), `baseRps`, `peakRps`, `durationS`, `mixId` or `targets`, `data`, `latency` (`{ "mode": "project" | "custom" | "off", "p95Ms" }`), `maxInFlight`, `timeoutMs`, `onPreflightFailure`.

`eq run` and `eq load` do all of this in one command with an exit code: see [CLI and CI](doc:cli).

## Variables

The API is configured with environment variables. With `pnpm start` (or `pnpm run api`) all of them are read. `eq serve` in local mode only reads `EQ_PORT`, `EQ_HOST`, `EQ_DATA_DIR`, `EQ_SYNC_INTERVAL_SECONDS`, `EQ_SCHEDULER_TICK_SECONDS`, `EQ_PUBLIC_URL` and the `EQ_SMTP_*` variables; with `EQ_MODE=cloud` it reads the whole configuration from the environment.

| Variable | Default | What it does |
| --- | --- | --- |
| `EQ_MODE` | `local` | `local` or `cloud`. The cloud requires PostgreSQL, `EQ_SECRETS_KEY` and `EQ_JWT_SECRET`, and always asks for a session. |
| `EQ_PORT` | `4400` | Port. |
| `EQ_HOST` | `127.0.0.1` locally, `0.0.0.0` in the cloud | Interface it listens on. |
| `EQ_DATA_DIR` | `~/.endpoint-quality` | `eq` only: where the SQLite database and the key live locally. |
| `EQ_DATABASE_FILE` | `~/.endpoint-quality/data.sqlite` | SQLite file; `:memory:` to keep nothing. |
| `EQ_DATABASE_URL` | — | `postgres://…`: uses PostgreSQL instead of SQLite. |
| `EQ_DATABASE_SCHEMA` | — | PostgreSQL schema (created if missing). |
| `EQ_SECRETS_KEY` | — | Key that encrypts credentials, 32 bytes in base64 (`openssl rand -base64 32`). Required in the cloud. |
| `EQ_SECRETS_FILE` | `~/.endpoint-quality/secret.key` | Locally, where the key lives; created the first time. |
| `EQ_QUEUE_DRIVER` | `memory` | `memory` or `redis` (several processes; survives restarts). |
| `EQ_REDIS_URL` | `redis://127.0.0.1:6379` | The queue's Redis. |
| `EQ_RUN_CONCURRENCY` | `2` | Simultaneous runs per process. |
| `EQ_JWT_SECRET` | — | Signs access tokens; at least 32 characters (`openssl rand -base64 48`). Required in the cloud. |
| `EQ_AUTH` | — | `required` asks for a session locally too. |
| `EQ_REGISTRATION` | `invite` | `invite`: only the first account registers, the rest by invitation. `open`: anyone. |
| `EQ_ACCESS_TTL_SECONDS` | `900` | Access token lifetime. |
| `EQ_REFRESH_TTL_DAYS` | `30` | Session lifetime (refresh token, rotated on every use). |
| `EQ_ALLOW_PRIVATE_TARGETS` | `false` in the cloud | `true` lets it reach private addresses (a deployment inside a private network). Always allowed locally. |
| `EQ_CORS_ORIGINS` | — | Allowed origins, comma-separated, if the web app is served from another domain. |
| `EQ_TRUST_PROXY` | — | Proxy hops to trust (`1` behind a load balancer), for the client address and HTTPS. |
| `EQ_SYNC_INTERVAL_SECONDS` | `300` locally | How often an installation linked to the cloud syncs on its own (`0`: only on demand). |
| `EQ_SCHEDULER_TICK_SECONDS` | `30` | How often the API looks for due schedules (`0`: schedules do not fire in this process). |
| `EQ_PUBLIC_URL` | `http://localhost:<port>` locally | The web app's public address, for the links in notifications. |
| `EQ_SMTP_HOST` · `EQ_SMTP_PORT` · `EQ_SMTP_SECURE` · `EQ_SMTP_USER` · `EQ_SMTP_PASSWORD` · `EQ_SMTP_FROM` | — · `587` · `true` on 465 | SMTP for email notifications; without `EQ_SMTP_HOST` email is not offered. See [Cloud deployment](doc:deploy). |
| `EQ_LOG` | — | `debug` for more detail, `silent` for nothing. By default, errors and warnings. |
