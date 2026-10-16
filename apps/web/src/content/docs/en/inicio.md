# Quick start

In five minutes you will have the app running on your machine, the example project imported and its verification matrix run against the bundled example API. No account and no internet connection needed (except to download the package the first time).

## Requirements

- **Without cloning the repository**: Node.js **22.13** or later for `npx`, or nothing with the single-file binary (see [CLI and CI](doc:cli)).
- **From the repository**: Node.js **22.18** or later and **pnpm** (`npm install -g pnpm`, or `corepack enable pnpm`).

## Without cloning the repository

In one terminal, the app and the API:

```bash
npx endpoint-quality serve --open
```

In another terminal, the example API:

```bash
npx endpoint-quality mock
```

| Process | Address | What it is |
| --- | --- | --- |
| `serve` | `http://127.0.0.1:4400` | The Endpoint Quality app and API: stores projects and executes runs. |
| `mock` | `http://127.0.0.1:4010` | The example API: a fictional store, no authentication. |
| `mock` | `http://127.0.0.1:4011` | The same API enforcing credentials (401/403 cases). |

Go on to [Import the example](#import-the-example).

## From the repository

From the repository root:

```bash
pnpm install
pnpm run dev
```

It starts four processes at once:

| Process | Address | What it is |
| --- | --- | --- |
| `api` | `http://127.0.0.1:4400` | The Endpoint Quality API: stores projects and executes runs. |
| `web` | The one Vite prints (by default `http://localhost:3000`) | This app. |
| `mock` | `http://127.0.0.1:4010` | The example API: a fictional store, no authentication. |
| `mock-auth` | `http://127.0.0.1:4011` | The same API enforcing credentials (401/403 cases). |

> If you only want the example API, `pnpm run mock` (port 4010) or `pnpm run mock:auth` (port 4011) start it on its own; `pnpm eq mock` starts both.

Either way, projects are stored in `~/.endpoint-quality/data.sqlite`. Credentials are stored encrypted with a key that lives in `~/.endpoint-quality/secret.key`, never in the database.

## Import the example

Open the app in your browser. With no projects, it opens the [New project](guide:first-project) guide straight away:

1. Type a name, or keep the example's.
2. Under **Contract**, choose **Use an example → Mock Store**. It brings its contract, its complete configuration and two environments: `Local` (port 4010) and `Local (auth)` (port 4011).
3. Review the summary of detected operations.
4. Choose the `Local` environment and press **Test connection**.
5. Skip the credential: the mock on port 4010 does not ask for one.

## Run the matrix

The guide's last step starts a **read-only check**: every case of the GET operations, writing nothing. When it ends you will see how many cases passed, failed or were blocked.

Then, under **Functional verification → New run**, you can run the whole matrix including writes. The `Local` environment allows them because the mock always starts from the same seed: restarting it puts the data back.

## With authentication

The `Local (auth)` environment points at the mock on port 4011, which enforces credentials and gets the 401/403 cases. Set its three credentials in the [Credentials](guide:credentials) guide:

| Role | Kind | Value |
| --- | --- | --- |
| `primary` | Bearer | `admin-token` (may do everything) |
| `insufficient` | Bearer | `read-token` (GET only: writes answer 403) |
| `alternate` | API key in `X-API-Key` | `demo-key` (everything except DELETE, which answers 401) |

They are the mock's test values, not real secrets.

## Without development mode

```bash
pnpm start
```

Builds the app and serves it from the API itself at `http://127.0.0.1:4400`: one process, one port. Start the mock separately if you need it (`pnpm eq mock`).

## Several projects

Each project is one API: its contract, environments, credentials and runs. Keep as many as you want in the same installation. The home screen, **Projects**, lists them with a search and an order (recent or by name).

1. **Projects → New project** opens the guide from scratch. **Projects → Import** creates one in one go from a contract —OpenAPI 3.0/3.1, Swagger 2.0 or a Postman collection— (URL, file or pasted) or an `.eq.json`. See [accepted formats](doc:conceptos).
2. The new project opens on its **Dashboard**: contract, latest functional run and latest load test.
3. To switch, go back to **Projects** (the first menu entry, or **Project → Switch project** in the header) and press **Enter** on another one.

**Dashboard**, **Functional verification** and **Load and stress** work on the open project, and their address names it (`?vista=panel&proyecto=store-api`): a shared link opens the same project.

From the terminal, `eq projects` lists them and `eq import another.eq.json` adds one.

## Next steps

- [Concepts](doc:conceptos): the vocabulary the whole app uses.
- Your own API: go back to the [New project](guide:first-project) guide and choose **OpenAPI URL** or **File**. The whole path, from the contract to CI, is in [CLI and CI](doc:cli).
- [Functional verification](doc:funcional) and [Load and stress](doc:carga), when you want to understand what is tested and why.
