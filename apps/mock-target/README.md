# Mock store (`@eq/mock-target`)

A fictional store API with zero dependencies, used to exercise Endpoint Quality end to end with no
network and no database. It is strict on purpose — 404 before validation, 409 on natural keys, 422
on corrupt cursors and empty PATCHes, Problem Details on every error, 405 on a wrong method — so the
whole test matrix has something real to check. The project that drives it is
[`examples/mock-store`](../../examples/mock-store/README.md).

```sh
node apps/mock-target/server.mjs --port 4010            # no authentication
node apps/mock-target/server.mjs --port 4011 --auth     # credentials enforced
node apps/mock-target/server.mjs --port 4010 --latency 30   # +30 ms per response
node apps/mock-target/server.mjs --port 4012 --auth --tls-cert server.pem --tls-key server-key.pem --tls-ca ca.pem   # HTTPS, mutual TLS
```

Without the repository, `npx endpoint-quality mock` (or `eq mock`, `pnpm eq mock`) starts both at
once: no authentication on 4010 and credentials enforced on 4011 (`--port` moves the pair).

The OpenAPI 3.1 document is at `GET /openapi.json`; `GET /health` is the liveness probe. Both are
always public. Data lives in memory and starts from the same seed every time: ids 1..4 in products
and stores, four reviews (three on product 1).

| Resource | Operations |
| --- | --- |
| Products | `GET/POST /v1/products` (`limit`, `cursor`, `q`, `category`, `sku`), `GET/PUT/PATCH/DELETE /v1/products/{product_id}`, `POST /v1/products/bulk` (upsert by `sku`) |
| Reviews | `GET/POST /v1/products/{product_id}/reviews`, `GET/DELETE /v1/products/{product_id}/reviews/{review_id}` (key answered as `id`) |
| Stores | `GET/POST /v1/stores` (`lat`, `lon`, `radius_km`, `limit`, `cursor`), `GET/PUT/PATCH/DELETE /v1/stores/{store_id}` |

Credentials, with `--auth`:

| Credential | Allowed |
| --- | --- |
| `Authorization: Bearer admin-token` | everything |
| `Authorization: Bearer read-token` | GETs only; writes → 403 |
| `X-API-Key: demo-key` | everything except DELETE, which answers 401 |
| `Cookie: eq_session=…` from `POST /auth/login` `{"username":"admin","password":"admin-password"}` (JSON or form) | everything |
| the same with `reader` / `read-password` | GETs only |
| `Cookie: eq_session=admin-session` (or `read-session`): a fixed session, for a pasted cookie | everything (GETs only) |
| HMAC: `X-Key-Id: demo-hmac` (key `hmac-secret`; `read-hmac` / `hmac-read-secret` for GETs only), `X-Timestamp` (Unix seconds, ±5 min), `X-Signature` = hex HMAC-SHA256 of `METHOD\npath?query\ntimestamp\nsha256(body)` | everything |
| a client certificate signed by `--tls-ca`, over HTTPS | everything |
| none or unknown | 401 |

`POST /auth/login` is outside the OpenAPI document: it is how a cookie credential logs in, not an
operation of the store. `mock.expireSessions()` forgets every login session, to test that a
credential logs in again on a 401. With `--tls-ca` a connection without a client certificate still
opens: its requests answer 401. The tests generate their certificates at run time; none is committed.

From code:

```js
import { createMockServer } from "./apps/mock-target/server.mjs";

const mock = createMockServer({ auth: true, latencyMs: 0, faults: { brokenEnvelope: false }, tls: undefined /* or { cert, key, ca } */ });
const { url } = await mock.listen(0); // 0 = a free port
mock.reset();                          // back to the seed
await mock.close();
```

`faults.brokenEnvelope` drops the `data` member from single-resource responses: a regression the
schema assertion must catch, used by the negative E2E test.
