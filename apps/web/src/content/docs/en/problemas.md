# Troubleshooting

## The app says it cannot reach the API

The app talks to the Endpoint Quality API (`http://127.0.0.1:4400`). Start it with `eq serve` (or `npx endpoint-quality serve`), `pnpm run dev` (development) or `pnpm start`, then reload. Check that it answers:

```bash
curl http://127.0.0.1:4400/health
```

If the port is taken, start it on another one with `EQ_PORT=4500` (or `eq serve --port 4500`) and, in development, point the app at it with `EQ_API_URL=http://127.0.0.1:4500`.

## Your API is not reachable

Requests to your API are made by **the Endpoint Quality API**, not by the browser. What matters is whether *that process* reaches your API:

- **Test connection** in the [Environment](guide:environment) guide sends a real GET and shows the status or the network error.
- A network error with no status (`ECONNREFUSED`, `ENOTFOUND`, a timeout) is about the network: URL, port, DNS, VPN or firewall. It is not an API failure.
- `localhost` is the machine where the Endpoint Quality API runs. If your API runs in a container or on another machine, use its address.

## Self-signed TLS certificates

Node rejects certificates not signed by a known authority, and there is no per-environment option to skip the check. For your own CA (your company's or a test environment's), start the API with `NODE_EXTRA_CA_CERTS` pointing at its certificate in PEM; for a self-signed certificate, at the certificate itself:

```bash
NODE_EXTRA_CA_CERTS=/path/to/ca.pem pnpm run dev
NODE_EXTRA_CA_CERTS=/path/to/ca.pem npx endpoint-quality serve
```

Node reads the variable once, at start: if you change the file, restart the process. As a last resort, locally only and never against something you do not control, `NODE_TLS_REJECT_UNAUTHORIZED=0` turns verification off for the whole process.

## VPNs and corporate networks

Local mode exists for this: it is the only one that reaches `localhost`, private networks and VPNs. If your API is only visible over a VPN, connect before starting runs. If the network goes through a corporate proxy, the answer may come from the proxy and not from your API: the body is usually HTML and the Content-Type and schema assertions fail. Look at the body in the case details.

## 401 versus 403 from a proxy or gateway

A gateway in front of the API may answer by itself, before the request reaches the service:

- A **401** on a normal case is usually the `primary` credential expired or misconfigured. Test it in the [Credentials](guide:credentials) guide.
- A **403** from the gateway (IP not allowed, WAF, quota) looks like a permissions 403, but the body is not your API's Problem Details. Look at the body in the case details.
- A "no credential" case that gets **403** instead of 401: the gateway decides before the API. It is a finding about the gateway, not about the endpoint.
- If the API does not enforce credentials in that environment, turn `authEnabled` off: the 401/403 cases would fail for the wrong reason.

## Latency measured across the network

A budget is a promise **of the service**, measured next to the service. Across a VPN or a gateway, every request spends tens or hundreds of milliseconds before the API does anything, and every budget would be red because of the path.

- In those environments turn **Enforce budgets** off (`enforceLatency: false`): latency is shown but does not decide the case.
- In load tests use a **custom p95** (`latency.mode: "custom"`) instead of the project's budgets.

## Writes show as blocked

The environment does not allow writes (`writesAllowed: false`), the default outside a seeded environment. No POST, PUT, PATCH or DELETE went out: the case is `blocked`, not `failed`. Turn them on in the [Environment](guide:environment) guide only if the data is disposable.

## A detail case answers 404

Outside the seed, id `1` may not exist. Mark the environment as **not seeded** so real ids are read with `seed.sources` before each run, or set `ids.existing`.

## "Create and read" gets a 409

The create body uses a natural key that already exists. Use values in `bodies` that cannot exist (`ORD-TEST-0001`).

## Windows

- Use PowerShell or Windows Terminal; `pnpm run dev` works the same.
- Environment variables are set differently: `$env:EQ_PORT = "4500"; pnpm run dev` in PowerShell.
- Data lives in `%USERPROFILE%\.endpoint-quality\`.
- In this documentation's `curl` examples, swap single quotes for double quotes and escape the inner ones, or use `curl.exe` from Git Bash.
