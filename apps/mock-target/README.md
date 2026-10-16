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
| none or unknown | 401 |

From code:

```js
import { createMockServer } from "./apps/mock-target/server.mjs";

const mock = createMockServer({ auth: true, latencyMs: 0, faults: { brokenEnvelope: false } });
const { url } = await mock.listen(0); // 0 = a free port
mock.reset();                          // back to the seed
await mock.close();
```

`faults.brokenEnvelope` drops the `data` member from single-resource responses: a regression the
schema assertion must catch, used by the negative E2E test.
