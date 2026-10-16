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

Webhook and Slack notifications need nothing on the server. Email does: without `EQ_SMTP_HOST` the panel does not offer it.

| Variable | Default | What it does |
| --- | --- | --- |
| `EQ_SMTP_HOST` | — | The SMTP server. Turns email notifications on. |
| `EQ_SMTP_PORT` | `587` | Port: `587` with STARTTLS, `465` with TLS from the start. |
| `EQ_SMTP_SECURE` | `true` on port 465 | `true`: TLS from the first byte. `false`: plain, upgraded with STARTTLS if the server offers it. |
| `EQ_SMTP_USER` · `EQ_SMTP_PASSWORD` | — | Credentials (AUTH PLAIN). They are only ever sent over an encrypted connection. |
| `EQ_SMTP_FROM` | `Endpoint Quality <noreply@<host>>` | The sender. |
| `EQ_PUBLIC_URL` | — | The deployment's public address (`https://eq.example.com`), so every notification links to its run. |

```bash
EQ_SMTP_HOST=smtp.example.com EQ_SMTP_PORT=587 \
EQ_SMTP_USER=eq@example.com EQ_SMTP_PASSWORD=… \
EQ_SMTP_FROM="Endpoint Quality <eq@example.com>" \
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
- **Rate limits** on registration, sign-in and invitations, per address and per email.

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

Every variable is in the [API reference](doc:api).
