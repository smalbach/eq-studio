# Sync

The same project on the work laptop, the home desktop and CI. Every local installation keeps working on its own and offline; linked to a cloud workspace, it shares what changes with it, both ways.

## What syncs

| Data | Syncs | How |
| --- | --- | --- |
| Projects, environments (without secrets), configuration, contract versions | Yes | Merged field by field: two machines that change different fields are combined. |
| Functional and load runs | Yes, once finished (can be turned off) | Only ever added: never a conflict. They travel without response bodies. |
| Credential secrets | **No, by default** | They stay on your machine. Optional: end-to-end encryption with a passphrase; the cloud never sees the plain text. |

Browser preferences (theme, language) and deleting a run do not sync.

## The account

Accounts live in the cloud, not in the local app: local mode has no users. To create one, in **Settings → Sync** type the cloud's address and press **Create an account in the cloud**; its sign-up screen opens. A cloud's first account becomes the owner of its workspace; the next ones arrive by invitation, unless the cloud allows open registration (`EQ_REGISTRATION=open`).

No cloud yet? To try it on this machine:

```bash
pnpm run cloud
```

It starts a development cloud at `http://localhost:4500`, with open registration and its data in `~/.endpoint-quality/cloud-dev/` (SQLite, no PostgreSQL or Docker). Only for trying it out: a real deployment is in [Deployment](doc:deploy).

## Linking a machine

In the local app, **Settings → Sync**, type the cloud's address (or follow the [step-by-step guide](guide:sync)). The app shows a code and opens the cloud in the browser: sign in, check the code matches, pick the workspace and approve. The machine is linked within seconds.

From the terminal it is the same:

```bash
eq login https://eq.example.com --name "Work laptop"
```

For CI or a script, without a browser, with an API token from the cloud (Settings → API tokens):

```bash
EQ_SYNC_TOKEN=eqt_… eq login https://eq.example.com
```

The machine acts with the role of whoever approved it: a viewer receives changes but cannot send its own; environments and credentials need admin, as everywhere else in the app. If that person leaves the workspace, the machine stops syncing. Every linked machine shows up in the cloud's **Settings → API tokens** and can be revoked there.

## Syncing

```bash
eq sync              # brings the cloud's changes and sends this machine's
eq sync --status     # where it stands: last sync, pending, conflicts
```

While `eq serve` (or `pnpm start`) is open it syncs on its own every 5 minutes (`EQ_SYNC_INTERVAL_SECONDS`, `0` turns it off). Also from **Settings → Sync → Sync now**.

Offline, work goes on; the next sync catches up. `eq sync` exits `1` when a conflict or a change refused by the role is left, so a script notices.

## What to sync

```bash
eq sync --runs off                     # without the run history
eq sync --projects store-api,billing   # only these projects; --projects all goes back to all
```

## Conflicts

When two machines change **the same field** of the same thing (an environment's name, the `budgets` section of the configuration) in different ways, whichever reached the cloud first wins for now and the other value is kept as a **conflict**: never a silent overwrite. It shows in **Settings** on the machine that hit it and in the cloud's, with both values; you pick one and the other machine receives it on its next sync.

Changes to different fields of the same environment or project are no conflict: they are combined. A project's configuration is compared section by section.

The same contract imported on two machines ends up as a single version.

## End-to-end secrets

By default the environments' tokens, API keys and passwords never leave the machine: on another one they are typed again. To let them travel:

```bash
EQ_SYNC_PASSPHRASE='a long phrase only your team knows' eq sync --secrets on
```

The passphrase (12+ characters) is typed on each machine; it is never sent. A key derived from it (scrypt) encrypts each whole credential (of any kind: its setup, its secret and the others, such as a refresh token, an HMAC key or the client certificate with its private key) with AES-256-GCM before it leaves; the cloud keeps text it can neither read nor use. The first machine sets the workspace's passphrase; the others must use the same one, and the app checks it when you turn it on.

> If the passphrase is lost, the credentials are typed again: there is no way to recover them, by design. A workspace's passphrase cannot be changed.

Credentials you set up in the cloud itself (for runs executed there) are different ones: encrypted with the cloud's key and never sent to machines.

## Unlinking

```bash
eq logout
```

Or **Settings → Sync → Unlink**. The data stays on the machine and its token stops working in the cloud.
