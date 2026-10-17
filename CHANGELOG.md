# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

First public version: Endpoint Quality verifies any HTTP API against its OpenAPI contract.

### Added

- **Functional verification** generated from an OpenAPI 3.0/3.1 document (URL, file or pasted):
  status and response schema per operation, 401/403 cases for protected operations, read-back of
  every write, chained create → read → delete flows that clean up after themselves, and a safe
  execution order (reads first, deletes last).
- **Load testing**: load, stress, spike and soak profiles with p95 latency budgets, error rates,
  recovery and degradation checks.
- **Projects** as `.eq.json` files: bodies, parameter samples, extra scenarios, plugins (geo,
  pagination), auth, latency budgets, response envelope, seed discovery and environments.
  Import and export from the app or the CLI.
- **Web app** with step-by-step guides and bilingual (Spanish/English) in-app documentation;
  runs execute on the server and stream their progress.
- **API** (NestJS + CQRS) in two modes: local on SQLite with encrypted credentials, and cloud on
  PostgreSQL and Redis with accounts, roles, invitations, API tokens and SSRF guards. Docker
  Compose deployment.
- **Sync** between local installations and a cloud workspace: field-by-field merge, visible
  conflicts, device login and optional end-to-end encrypted secrets.
- **CLI `eq`** (npm package `endpoint-quality`): `serve`, `run` with JUnit output and CI exit
  codes, `load`, `projects`, `import`, `export`, `mock`, `login`, `logout`, `sync`, `diff` and `report`;
  single-file binaries for macOS, Windows and Linux.
- **Desktop app** (Electron) for macOS, Windows and Linux, sharing data with the CLI, with update
  checks against GitHub releases (installs in place on Windows and Linux, announces on macOS).
- **Example API** (`apps/mock-target`) and the **Mock Store** example project.
- Postman environment import into the connection fields.
- **More contract formats**: Swagger 2.0 is converted to OpenAPI 3.0 on import, OpenAPI 3.1
  responses are validated with JSON Schema 2020-12, and a Postman collection (v2.0/v2.1) becomes an
  OpenAPI 3.0 with schemas inferred from its examples.
- **Contract diff** between versions, each change marked breaking or compatible: in the app
  (Contract versions, with a warning when an import breaks the active one), at
  `GET /v1/projects/:project/specs/diff` and as `eq diff`, which exits `1` on a breaking change.
- **Negative cases** generated from the request schemas: one fault per case (malformed body,
  missing field, wrong type, `null`, length, range, enum, format, undeclared field), passing on a
  declared 4xx and failing on a 2xx or 5xx. Configured with `negativeCases`.
- **Credential kinds**: OAuth2 authorization code (refresh token), cookie (pasted or by login),
  HMAC request signing and client certificates (mTLS, alone or alongside another kind), besides
  bearer, API key, basic and OAuth2 client credentials.
- **Shareable reports**: a self-contained HTML page and SARIF 2.1.0 (pointing at the contract line),
  besides JUnit, from `eq run`/`eq load` (`--html`, `--sarif`), `eq report`,
  `GET /v1/runs/:id/report` and the run view. Secrets are masked.
- **Schedules** (hourly, daily, weekly or a cron expression) for functional and load runs, and
  **notifications** when a run finishes: webhook (optionally HMAC-signed), Slack and email.
- **Cloud operations**: password reset by email, single sign-on with any OpenID Connect provider,
  an append-only audit log (Settings → Audit log, `GET /v1/audit`) and Prometheus metrics
  (`EQ_METRICS=true`, `GET /metrics`).
- One SMTP configuration for every email (`EQ_SMTP_URL` and `EQ_MAIL_FROM`, or `EQ_SMTP_HOST` and
  its parts).

[Unreleased]: https://github.com/smalbach/eq-studio/commits/main
