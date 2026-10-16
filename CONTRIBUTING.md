# Contributing to Endpoint Quality

> **En español:** las contribuciones son bienvenidas en español o en inglés. Este archivo está en
> inglés para quien llegue de fuera; el README y la documentación de la app están en los dos
> idiomas.

Thanks for helping. Issues and pull requests are welcome in English or Spanish.

## Setup

Requirements: **Node 22.18+** and **pnpm** (the version CI uses is in `.github/workflows/ci.yml`).

```bash
pnpm install
pnpm run dev          # API on :4400, web on :3000, example API on :4010 and :4011 (auth)
```

Repository layout:

| Path | What it is |
|---|---|
| `packages/runner-core/` | The engine, no framework: scenarios, plan, budgets, schema validation, load |
| `apps/api/` | NestJS + CQRS API, SQLite locally or PostgreSQL in the cloud |
| `apps/web/` | Vite + React SPA, including the in-app docs |
| `apps/cli/` | `eq`, published as the npm package `endpoint-quality`, plus single-file binaries |
| `apps/desktop/` | Electron app: the local API and the web in one window |
| `apps/mock-target/` | The example API the tests and the tutorial run against |
| `examples/` | Example projects (`*.eq.json`) |

## Checks

Run these before opening a pull request; CI runs the same on Linux, macOS and Windows.

```bash
pnpm run lint
pnpm run typecheck
pnpm test             # engine + web + E2E against the example API + API + CLI
```

Narrower suites: `pnpm run test:core`, `test:web`, `test:e2e`, `test:api` (set
`EQ_TEST_POSTGRES_URL` to also run against PostgreSQL) and `test:cli`. Packaging:
`pnpm run bundle`, `pnpm run binary`, `pnpm desktop:dist`.

Add or update tests with the change. Behaviour that can be checked without a browser lives in
plain modules (`.mjs`/`.ts`) so it can be tested with `node --test`.

## Commits and pull requests

- One logical change per commit. The subject is an imperative sentence in English that says what
  the change does ("Retry the token request once on 503"), under ~72 characters; the body says why.
- Keep pull requests focused, fill in the template, and link the issue they close.
- Do not commit secrets, real API hosts or customer data. Examples and tests use the bundled
  example API (`apps/mock-target`) or `*.example` hosts.

## Bilingual docs and UI

The product ships in Spanish and English, and both must stay in step:

- **UI text**: every string has both languages. Components declare their copy with
  `defineMessages({ es: {…}, en: {…} })` (`apps/web/src/lib/i18n`); plain modules use
  `tr(locale, "es…", "en…")`. Spanish comes first.
- **In-app docs**: `apps/web/src/content/docs/es/*.md` and `apps/web/src/content/docs/en/*.md`
  have the same files and the same sections. Change both in the same pull request.
- **READMEs** are written in Spanish; the root README has an English section that summarises it.
  If you can only write one language, say so in the pull request and a maintainer will translate.

## Releases

Maintainers tag `v*` on `main`; `.github/workflows/release.yml` builds the binaries, the desktop
installers and the npm package. Move the `Unreleased` notes in [CHANGELOG.md](CHANGELOG.md) under the new version before tagging.

## Code of conduct and security

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities
privately as described in [SECURITY.md](SECURITY.md), never in a public issue.
