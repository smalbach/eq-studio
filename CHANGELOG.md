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
  codes, `load`, `projects`, `import`, `export`, `mock`, `login`, `logout` and `sync`;
  single-file binaries for macOS, Windows and Linux.
- **Desktop app** (Electron) for macOS, Windows and Linux, sharing data with the CLI, with update
  checks against GitHub releases (installs in place on Windows and Linux, announces on macOS).
- **Example API** (`apps/mock-target`) and the **Mock Store** example project.
- Postman environment import into the connection fields.

[Unreleased]: https://github.com/smalbach/eq-studio/commits/main
