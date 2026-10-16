# Cloud deployment

The same API, in `cloud` mode, for a team: accounts, workspaces, roles and API tokens, on
PostgreSQL and Redis. The web app is included: the API serves it at the same address.

The cloud does not replace local mode: a server in the cloud cannot test the API running on your
laptop or behind your VPN. Local mode is for that, and [sync](doc:sync) joins the two.

## With Docker

```bash
cp docker/.env.example docker/.env
openssl rand -base64 32     # EQ_SECRETS_KEY
openssl rand -base64 48     # EQ_JWT_SECRET
docker compose -f docker/compose.yml --env-file docker/.env up -d
```

Put both keys in `docker/.env` and open `http://localhost:4400`. The **first account** to register
becomes the owner of its workspace; everyone after it arrives by invitation (unless
`EQ_REGISTRATION=open`).

> **Keep `EQ_SECRETS_KEY` somewhere other than the server.** It encrypts the environments'
> credentials and is never in the database: if it is lost, the credentials are typed again, not
> recovered.

Put an HTTPS proxy in front (see [Operating it](#operating-it)) and set `EQ_TRUST_PROXY=1`, so the
rate limits see the client's real address.

## Without Docker

Node 22.13 or later with PostgreSQL and, optionally, Redis:

```bash
EQ_MODE=cloud \
EQ_DATABASE_URL=postgres://eq:secret@db:5432/eq \
EQ_QUEUE_DRIVER=redis EQ_REDIS_URL=redis://cache:6379 \
EQ_SECRETS_KEY=… EQ_JWT_SECRET=… \
npx endpoint-quality serve
```

With `EQ_MODE=cloud`, `eq serve` reads the whole configuration from the environment and listens on
`0.0.0.0` (or on `--host` / `EQ_HOST`). Without Redis the queue lives in memory: it works with a
single process, but a run in progress is lost if the process restarts.

## Roles

| Role | Can |
|---|---|
| Viewer | See everything: projects, configuration, runs, reports. |
| Editor | Also edit projects and configuration, and start read-only runs. |
| Admin | Also environments, credentials, runs that write, load and stress, members, invitations and API tokens. |
| Owner | Also change roles. There is always at least one. |

Members, invitations and tokens are managed in **Settings**. An invitation is a single-use link;
no one can invite with a role above their own.

## CI against the cloud

In **Settings → API tokens** create a token with the role CI needs (usually editor for read-only
runs, admin if they write). It is shown once:

```bash
eq run store-api --env staging --api https://eq.example.com --api-token "$EQ_API_TOKEN"
```

The token belongs to one workspace; revoking it cuts it off on its next request.

## The Mock Store example in the cloud

The **Mock Store** example points at `http://127.0.0.1:4010`, and the SSRF guards block loopback in
the cloud: the API refuses to send its runs (and in a container, `127.0.0.1` is the container
itself). Use it locally ([Quick start](doc:inicio)). To try it in the cloud, start the mock on a
machine the server reaches, change the environment's base URL and, only if that address is private
and the deployment lives in a private network, set `EQ_ALLOW_PRIVATE_TARGETS=true`.

## Email notifications (SMTP)

Webhook and Slack notifications need nothing on the server. Email does: without SMTP the panel does not offer it. It is the same server that sends the password reset links (see [Email and forgotten passwords](#email-and-forgotten-passwords)): it is configured once.

| Variable | Default | What it does |
| --- | --- | --- |
| `EQ_SMTP_URL` | — | The server, as a URL: `smtp://user:password@host:587` (STARTTLS) or `smtps://user:password@host:465` (TLS from the start). Encode `@` as `%40`. |
| `EQ_MAIL_FROM` | `Endpoint Quality <no-reply@localhost>` | The sender of every email. |
| `EQ_PUBLIC_URL` | — | The deployment's public address (`https://eq.example.com`), so every email links to its run. Required with SMTP in the cloud. |

If your provider hands out the parts separately, instead of `EQ_SMTP_URL` you can use `EQ_SMTP_HOST`, `EQ_SMTP_PORT` (`587`), `EQ_SMTP_SECURE` (`true` on 465), `EQ_SMTP_USER`, `EQ_SMTP_PASSWORD` and `EQ_SMTP_FROM`: the API builds the URL from them. With both forms set, `EQ_SMTP_URL` wins. With a user over `smtp://`, the server must offer STARTTLS: the password never travels in clear.

```bash
EQ_SMTP_URL=smtp://eq%40example.com:app-password@smtp.example.com:587
EQ_MAIL_FROM="Endpoint Quality <eq@example.com>"
EQ_PUBLIC_URL=https://eq.example.com
```

Schedules fire from the API processes themselves, every `EQ_SCHEDULER_TICK_SECONDS` (30); with several processes each occurrence still starts once. See [Schedules and notifications](doc:automatizacion).

## Security

- **Credentials** encrypted with AES-256-GCM; the API only returns their last 4 characters.
- **Passwords** with scrypt; refresh tokens rotate on every use, and reusing a spent one closes
  that whole session. In the browser the refresh token lives in an `httpOnly` cookie.
- **SSRF guards**: the API does not read contracts or test APIs on internal addresses (loopback,
  private networks, link-local, cloud metadata). It checks the resolved IP, follows at most 3
  redirects and caps time and size. If your deployment lives inside a private network along with
  its APIs, set `EQ_ALLOW_PRIVATE_TARGETS=true`.
- **Rate limits** on registration, sign-in, password resets and invitations, per address and per email.
- **Audit log** of every security-relevant change, append-only (see [Audit log](#audit-log)).

## Email and forgotten passwords

With an SMTP server the API emails password reset links:

```bash
EQ_PUBLIC_URL=https://eq.example.com
EQ_SMTP_URL=smtps://eq%40example.com:app-password@smtp.example.com:465
EQ_MAIL_FROM="Endpoint Quality <eq@example.com>"
```

`EQ_PUBLIC_URL` is required with SMTP: the links are built from it, never from the request's
`Host` header (which a client controls). Characters such as `@` in the user or password are
URL-encoded (`%40`).

- **Forgot your password?** on the sign-in screen asks for a link. The answer is the same whether
  the email has an account or not, and it is limited per address and per email.
- The link is **single use** and lasts **30 minutes**; only its SHA-256 is stored. Using it spends
  every other link of the account and **closes all its sessions**, as changing the password does.
- **Settings → Members** lets an admin create a reset link for a member below their role (an owner
  for anyone). With SMTP it goes to the member's email and is not shown. Without SMTP the admin gets
  the link to pass on — only if the account belongs to no other workspace.
- **Without SMTP** nothing is emailed and the API only logs that a reset was asked for. Only the
  development cloud (`pnpm run cloud`) writes the link itself in its log, as a warning, so the flow
  can be tried on one machine.

## Single sign-on (OpenID Connect)

Any OpenID Connect provider (Google, Microsoft Entra ID, Okta, Auth0, Keycloak…) can sign people
in, with authorization code and PKCE:

```bash
EQ_PUBLIC_URL=https://eq.example.com
EQ_OIDC_ISSUER=https://accounts.google.com
EQ_OIDC_CLIENT_ID=…
EQ_OIDC_CLIENT_SECRET=…
EQ_OIDC_ALLOWED_DOMAINS=example.com
EQ_OIDC_NAME=Google
```

Register `https://eq.example.com/v1/auth/oidc/callback` as the redirect URI with the provider. The
sign-in screen then shows **Sign in with Google**.

- The account is found by the provider's **verified** email (`email_verified`): an existing account
  signs in as itself and keeps its password, if it has one.
- A new email: with `EQ_REGISTRATION=open` it gets an account and a workspace of its own; with
  `invite` (the default) only someone with a pending invitation gets in, and joins that workspace.
  The invitation is accepted on the way in.
- `EQ_OIDC_ALLOWED_DOMAINS` limits SSO to those email domains.
- The issuer must use HTTPS; plain HTTP is accepted only on `localhost` (a local Keycloak, tests).

## Audit log

**Settings → Audit log** (admins and owners) lists the workspace's security events: sign-ins and
failed sign-ins, password changes and resets, invitations, members who join or leave, role changes,
API tokens created and revoked, credentials created, changed or deleted, deleted projects, and
devices linked or unlinked. Each one with who, on what, from which address and when; never a
password, a token or a credential's value. Filter by kind and dates; `GET /v1/audit` gives the same
to scripts.

The log is **append-only**: a trigger in the database refuses to change or delete its rows. It is
in the backups with everything else.

## Metrics

`EQ_METRICS=true` serves `GET /metrics` in Prometheus format: the process (CPU, memory, event loop,
GC), HTTP requests by route, method and status with a duration histogram
(`eq_http_request_duration_seconds`), runs queued, started and finished by status
(`eq_runs_queued_total`, `eq_runs_started_total`, `eq_runs_finished_total`) and the runs waiting or
in progress (`eq_run_queue_depth`). It does not need a session; set `EQ_METRICS_TOKEN` to ask for a
bearer token:

```yaml
scrape_configs:
  - job_name: endpoint-quality
    metrics_path: /metrics
    authorization: { credentials: "<EQ_METRICS_TOKEN>" }
    static_configs: [{ targets: ["eq.example.com:4400"] }]
```

Counters are per process: with several API processes, scrape each one.

## Operating it

**HTTPS.** A minimal `Caddyfile`, with an automatic certificate:

```text
eq.example.com {
  reverse_proxy 127.0.0.1:4400
}
```

**Backups.** Everything lives in PostgreSQL; Redis only holds the queue and needs no copy.

```bash
docker compose -f docker/compose.yml exec -T postgres pg_dump -U eq eq > eq-backup.sql
docker compose -f docker/compose.yml exec -T postgres psql -U eq eq < eq-backup.sql   # restore
```

Keep `EQ_SECRETS_KEY` apart from the backup: without it, the credentials in the backup cannot be
decrypted.

**Upgrading.** Take a backup, fetch the new version and rebuild:

```bash
git pull
docker compose -f docker/compose.yml --env-file docker/.env up -d --build
```

Database migrations run on their own at start, forward only. There is no command to undo them: to
go back to an earlier version, restore the backup.

## Variables

Every variable a cloud deployment reads (the local-only ones are in the [API reference](doc:api)):

| Variable | Default | What it does |
| --- | --- | --- |
| `EQ_MODE` | `local` | `cloud` for a team deployment. |
| `EQ_PORT` · `EQ_HOST` | `4400` · `0.0.0.0` | Where it listens. |
| `EQ_DATABASE_URL` | — | `postgres://…`. Required. |
| `EQ_DATABASE_SCHEMA` | — | PostgreSQL schema (created if missing). |
| `EQ_SECRETS_KEY` | — | Encrypts the credentials (`openssl rand -base64 32`). Required; keep it apart from the backups. |
| `EQ_JWT_SECRET` | — | Signs sessions, at least 32 characters (`openssl rand -base64 48`). Required. |
| `EQ_REGISTRATION` | `invite` | `invite`: the first account, then invitations. `open`: anyone registers. Also decides who SSO lets in. |
| `EQ_ACCESS_TTL_SECONDS` · `EQ_REFRESH_TTL_DAYS` | `900` · `30` | Access token and session lifetimes. |
| `EQ_QUEUE_DRIVER` · `EQ_REDIS_URL` | `memory` · `redis://127.0.0.1:6379` | `redis` for several processes and runs that survive restarts. |
| `EQ_RUN_CONCURRENCY` | `2` | Simultaneous runs per process. |
| `EQ_TRUST_PROXY` | — | Proxy hops to trust (`1`), for client addresses (rate limits, audit log) and HTTPS. |
| `EQ_ALLOW_PRIVATE_TARGETS` | `false` | `true` lets runs reach private addresses. |
| `EQ_CORS_ORIGINS` | — | Allowed origins if the web app is served elsewhere. |
| `EQ_PUBLIC_URL` | — | The address people open. Required with SMTP or SSO. |
| `EQ_SMTP_URL` · `EQ_MAIL_FROM` | — · `Endpoint Quality <no-reply@localhost>` | Email: password reset links and notifications (or `EQ_SMTP_HOST` and its parts). |
| `EQ_METRICS` · `EQ_METRICS_TOKEN` | `false` · — | `GET /metrics` and its bearer token. |
| `EQ_OIDC_ISSUER` · `EQ_OIDC_CLIENT_ID` · `EQ_OIDC_CLIENT_SECRET` | — | Single sign-on. |
| `EQ_OIDC_ALLOWED_DOMAINS` · `EQ_OIDC_NAME` · `EQ_OIDC_SCOPES` | — · `SSO` · `openid email profile` | Allowed email domains, button name, scopes. |
| `EQ_LOG` | — | `debug` or `silent`. By default, errors and warnings. |
