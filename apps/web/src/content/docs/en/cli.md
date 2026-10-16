# CLI and CI

`eq` is Endpoint Quality's command line: it starts the app and the API on your machine, runs
checks from scripts and CI, and moves projects around as `.eq.json` files. `eq --help` lists every
command and flag.

## Install

Pick one:

- **With Node 22.13 or newer**, nothing to install: `npx endpoint-quality <command>`.
- **Single-file binary**, no Node: download `eq-macos-arm64`, `eq-macos-x64`, `eq-linux-x64`,
  `eq-linux-arm64` or `eq-windows-x64.exe` from the release and run it.
- **From the repository** (Node 22.18 or newer): `pnpm eq <command>`.

On this page, `eq` is any of the three.

## The app on your machine

```bash
eq serve --open
```

The app and the API on `http://127.0.0.1:4400`, with the data in `~/.endpoint-quality`
(`EQ_DATA_DIR` to change it). `--port` or `EQ_PORT` change the port; `--host` or `EQ_HOST`, the
interface. By default it only listens on your machine.

> **Do not expose local mode.** With `--host 0.0.0.0` anyone on your network reaches an API with
> no accounts and no SSRF guards: they see your projects, start runs with your credentials and
> reach internal addresses. `eq serve` warns about it on start. For a team, use the
> [cloud deployment](doc:deploy).

## The example API

```bash
eq mock
```

The fictional store of the **Mock Store** project: no authentication on `http://127.0.0.1:4010`
and enforcing credentials on `:4011` (`Bearer admin-token`; `Bearer read-token` for the 403s;
`X-API-Key: demo-key`). `--port` changes the first one; the second is the next. Restarting it puts
the data back as the example's seed.

## Runs in CI

The simplest thing in a pipeline is to run **from the project file**: `eq` starts an API for
that run only, in memory, and shuts it down at the end. No server needed.

```bash
eq run --file store-api.eq.json --env staging \
  --base-url "$STAGING_URL" --token "$STAGING_TOKEN" \
  --junit eq-report.xml
```

- `--base-url` replaces the environment's URL: the same file serves every branch or deployment.
- Credentials come from flags or variables (`EQ_TOKEN`, `EQ_READ_TOKEN`, `EQ_API_KEY`), never
  from the file: the `.eq.json` is versioned without secrets.
- `--junit` writes a JUnit XML report. `--json` saves the whole run.

| Option | What it does |
|---|---|
| `-f, --file <file>` | Runs from a `.eq.json`, with no server. |
| `-e, --env <environment>` | The environment, by id or by name (by default, the first one). |
| `--base-url <url>` | Replaces the environment's base URL. |
| `--read-only` | Only the GET operations. |
| `--endpoints a,b` | Only these operations (by id). |
| `--auth` · `--no-auth` | Runs (or not) the 401/403 cases, whatever the environment says. |
| `--token T` | `primary` credential, bearer (or `EQ_TOKEN`). |
| `--read-token T` | `insufficient` credential, bearer, for the 403s (or `EQ_READ_TOKEN`). |
| `--api-key K` · `--api-key-header H` | `alternate` credential, API key (or `EQ_API_KEY`), and its header. |
| `--samples N` · `--delay MS` | Samples per case and pause between cases. |
| `--locale es\|en` | Language of the case names (default `en`). |
| `--scope "name"` | A name for the run in the history and in the report. |
| `--junit file.xml` · `--json file.json` | Reports. |
| `--format text\|json` · `-q, --quiet` | What is printed: text (default), JSON or nothing. |
| `--fail-on-blocked` | Exits `1` if the environment blocked writes. |

### File or server

- **In CI, `--file`**: the versioned `.eq.json` is the only input; nothing to install or keep
  running, and nothing is kept.
- **Against an API that is already running** (yours or a shared one), name the project: the run
  stays in its history and shows in the app.

```bash
eq run store-api --env staging --api http://eq.internal:4400
```

If that API is a [cloud deployment](doc:deploy), add an API token: `--api-token` or
`EQ_API_TOKEN` (and `--workspace` / `EQ_WORKSPACE` only with a session token). `--api` is also
read from `EQ_API_URL`.

### Exit codes

| Code | Means |
|---|---|
| `0` | Every case passed |
| `1` | A case failed (or writes were blocked, with `--fail-on-blocked`); for `eq diff`, a change breaks |
| `2` | The command was wrong: a flag, a project or an environment that does not exist |
| `3` | It could not run: the API does not answer, or the run ended in error |

### Example: GitHub Actions

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 22 }
- run: npx endpoint-quality run --file store-api.eq.json --env staging --base-url ${{ vars.STAGING_URL }} --junit eq-report.xml
  env:
    EQ_TOKEN: ${{ secrets.STAGING_TOKEN }}
- uses: actions/upload-artifact@v4
  if: always()
  with: { name: eq-report, path: eq-report.xml }
```

### Other CI systems

The report is standard JUnit XML: each operation is a suite and each case a test. Blocked writes
show as `skipped`.

GitLab (`EQ_TOKEN` as a protected CI/CD variable):

```yaml
eq:
  image: node:22
  script:
    - npx endpoint-quality run --file store-api.eq.json --env staging --base-url "$STAGING_URL" --junit eq-report.xml
  artifacts:
    when: always
    reports:
      junit: eq-report.xml
```

Jenkins:

```groovy
sh 'npx endpoint-quality run --file store-api.eq.json --env staging --junit eq-report.xml'
// in post { always { … } }
junit 'eq-report.xml'
```

Azure DevOps:

```yaml
- script: npx endpoint-quality run --file store-api.eq.json --env staging --junit eq-report.xml
- task: PublishTestResults@2
  condition: always()
  inputs: { testResultsFormat: JUnit, testResultsFiles: eq-report.xml }
```

## Load tests

```bash
eq load --file store-api.eq.json --env staging --type stress --rps 10 --peak 100 --duration 120 --p95 800
```

`--type` is `load`, `stress`, `spike` or `soak`; `--mix` picks one of the project's mixes; `--p95`
sets a limit of your own (or `--no-latency` to not enforce latency); `--preflight stop|skip|ignore`
decides what happens to a target that fails the preflight (default `skip`). Exits with `1` when the
verdict fails. `--junit`, `--json` and `--format` work as in `eq run`: the JUnit has one test per
verdict criterion. Against a shared environment, coordinate with the team.

As a CI gate, a short test at the expected rate with a p95 of your own:

```bash
eq load --file store-api.eq.json --env staging --base-url "$STAGING_URL" \
  --type load --rps 20 --duration 60 --p95 500 --junit eq-load.xml
```

## Contract changes

`eq diff` compares two OpenAPI 3 contracts (files or http(s) URLs, JSON or YAML) and lists what
changed per operation, marking what breaks clients of the older one. It exits `1` when any change
breaks: a CI step that stops a contract change before it ships.

```bash
eq diff https://api.example.com/openapi.json openapi.yaml
```

```text
GET /v1/products (listProducts)
  ✖ breaking  response 200: field $.data[].price removed
POST /v1/products (createProduct)
  ✖ breaking  request: required field $.currency added
  · change    query.dry_run: optional parameter added
2 breaking · 1 non-breaking
```

`--json` prints the changes and their counts as JSON; `--locale es` describes them in Spanish.
What counts as breaking is in [Concepts](doc:conceptos).

In GitHub Actions, against the main branch's contract (`actions/checkout` with `fetch-depth: 0`):

```yaml
- run: git show origin/main:openapi.yaml > /tmp/openapi-main.yaml
- run: npx endpoint-quality diff /tmp/openapi-main.yaml openapi.yaml
```

## Projects as files

```bash
eq projects                                  # the API's projects
eq export store-api -o store-api.eq.json     # a project as a file
eq import store-api.eq.json                  # a file as a new project
```

`eq import` also creates a project from a contract: OpenAPI 3.0/3.1 or Swagger 2.0 (converted to
OpenAPI 3), as JSON or YAML, or a Postman collection v2.1 (an OpenAPI 3 is generated with schemas
inferred from its examples). The first environment gets the contract's base URL, `--base-url`, or
the one a Postman environment passed with `--env` gives `{{baseUrl}}`:

```bash
eq import petstore-swagger.yaml --name "Petstore"
eq import store.postman_collection.json --env staging.postman_environment.json
```

These commands talk to the API at `--api` (by default the local one, so `eq serve` must be
running). Version the `.eq.json` next to your API's code: configuration changes get reviewed in
the same pull request as the contract changes.

## Your own API, from the contract to CI

**1. Create the project from the contract.** With `eq serve --open`, the
[New project](guide:first-project) guide → **OpenAPI URL** (`https://your-api/openapi.json`). Or
through the API:

```bash
curl -s -X POST http://127.0.0.1:4400/v1/projects -H 'content-type: application/json' \
  -d '{"name":"Store API","spec":{"url":"https://staging.example.com/openapi.json"},
       "environments":[{"name":"Staging","baseUrl":"https://staging.example.com"}]}'
```

**2. Review the generated configuration**: the bodies (natural keys that do not collide with real
data), the latency budgets and what each environment allows. Start a read-only check from the app
until it comes out as you expect.

**3. Export it and version it** next to the API's code, without secrets:

```bash
eq export store-api -o store-api.eq.json
```

**4. Run it in CI**:

```bash
eq run --file store-api.eq.json --env staging --base-url "$URL" --token "$TOKEN" --junit eq-report.xml
```

When the contract changes, import the new version in the app (or `POST …/spec-versions`), adjust
and export again.

## Sync

`eq login <url>`, `eq sync` and `eq logout` link this installation to a cloud workspace. See
[Sync](doc:sync).
