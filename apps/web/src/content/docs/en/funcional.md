# Functional verification

Functional verification checks that each operation answers **what its contract says**, including the cases almost nobody tests: the 404 of a write, the 409 of a duplicate key, the 422 of an empty body, the 4xx of every input the schema rejects and the 401/403 of every protected operation. A 200 is not a test that passes.

## What each case checks

Every request is evaluated with the same assertions:

- **Status**: the one the case expects (in a negative case, any of the 4xx it accepts). A 405 is reported as "operation not implemented".
- **OpenAPI schema**: the body is validated against the schema the contract declares for that status. If it declares none, the shape is checked (the `{ data }` envelope, for instance).
- **Content-Type**: JSON whenever there is a body.
- **Latency**: only if a budget rule covers the operation. See [Concepts](doc:conceptos).

## The generated cases

The kind of operation follows from its method and path (a GET ending in `{id}` is a detail; a POST to `…/bulk`, a bulk). `operationKinds` overrides it.

| Kind | Cases |
| --- | --- |
| List (`GET /orders`) | Unfiltered (200); one case per `parameterSamples` value of each query parameter, with its expected status; corrupt cursor (pagination plugin); geographic radii (geo plugin). |
| Detail (`GET /orders/{order_id}`) | Existing resource (200) and missing resource (404). |
| Create (`POST /orders`) | Create and read; empty payload (422); duplicate natural key (409, if the contract declares it). |
| Bulk (`POST /orders/bulk`) | Upsert, read and clean up; empty payload (422). |
| Replace (`PUT`) | Create, replace and read; missing resource (404); invalid payload (422). |
| Partial update (`PATCH`) | Create, update and read; missing resource (404); payload with no fields (422). |
| Delete (`DELETE`) | Create, delete and confirm (204); read the deleted resource (404 on the GET and on a second DELETE). |

The 404 and 422 write cases are only generated when the contract declares that status for the operation.

## Negative cases

On top of that, every operation that takes a body or parameters gets **negative cases**: input its contract declares invalid, with **a single fault per case** over its valid body (`bodies`), so that the fault is the only thing under test. They are generated from `requestSchemas`, which the OpenAPI import fills with the schema of the body and of each parameter.

| Kind | What it sends | id |
| --- | --- | --- |
| `malformed` | A body that is not JSON (the valid one, cut short of its closing brace) | `negative-body-malformed` |
| `missing` | Without a required field | `negative-body-missing-sku` |
| `type` | A wrong type (a number where a string goes, `abc` where an integer goes…) | `negative-body-type-price`, `negative-query-type-limit`, `negative-path-type-order_id` |
| `null` | `null` in a field that is not nullable | `negative-body-null-name` |
| `min-length`, `max-length` | A string shorter than `minLength` or longer than `maxLength` | `negative-body-max-length-sku` |
| `minimum`, `maximum` | A number outside `minimum`/`maximum` (or their exclusive versions) | `negative-query-maximum-limit` |
| `enum` | A value not in the `enum` | `negative-query-enum-sort` |
| `format` | An invalid `email`, `uuid`, `date`, `date-time` or `uri` | `negative-body-format-email` |
| `extra` | An undeclared field, when the schema has `additionalProperties: false` | `negative-body-extra` |

- **Passes** with any 4xx the operation declares, except 401, 403, 405, 409 and 429 (they are no verdict on the input); if it declares none, with 400 or 422. `negativeCases.statuses` sets them by hand.
- **Fails** with a 2xx (the API accepted the invalid input) and always with a 5xx (it broke on it): the status assertion says so in those words.
- **Cleanup**: a POST that accepts the invalid input created something, and it is deleted. A PUT or PATCH runs over a temporary row (created, the case sent, deleted), so accepted input changes no row the rest of the matrix reads. A fault in the path id is sent as it is.
- **Bounded and deterministic**: at most `negativeCases.maxPerOperation` per operation (10 by default), taking one case of each kind, in the order of the table, before a second of any. The same input always generates the same cases.
- They are writes when the operation is one: in an environment without writes they are **blocked**, not failed, and they follow the safe order (reads first, deletes last).

In the app, negative cases carry the "negative" tag and can be filtered in the endpoint's case list and in a run's cases. They are configured in [`negativeCases`](doc:formato).

## The authentication matrix

With `authEnabled` on the environment, every protected operation also gets:

- **No credential → 401**, if it declares 401.
- **Insufficient scope → 403**, with the `insufficient` credential, if it declares 403.
- **Credential not accepted**, with the `alternate` credential, on the methods `auth.alternate` lists (for instance an API key on a DELETE → 401).

Operations in `auth.publicOperations` (the ones the contract marks with `security: []`) get none of these. Against an API that does not enforce credentials these cases would fail for the wrong reason, which is why they only run with `authEnabled`.

## Chained flows and cleanup

Writes are tested as flows:

```text
POST /orders            → 201, captures order_id
GET  /orders/{order_id} → 200, compares every field sent
DELETE /orders/{order_id}  (cleanup, even if the case fails)
```

- **The id** is read from the response: the member named like the placeholder (`order_id`) or, failing that, `envelope.idFallbackKey` (`id`).
- **PUT** creates with `body`, replaces with `replaceBody` and reads again. If `replaceBody` matched what was created, a PUT that does nothing would pass anyway.
- **Bulk** answers counters, not ids: the flow looks each record up by its natural key (`bulk.lookups`) before and after, and at the end deletes only those that did not exist before.
- **Cancelling** a run waits for the flow in progress to finish its cleanup.

Use natural keys in the bodies that cannot exist in the environment (`ORD-TEST-0001`, not a real one): otherwise "create" gets a 409 instead of a 201.

## Seeded and shared environments

Cases are written against a **seed** where id `1` exists and `999999` does not.

- **Seeded** (`seeded: true`): a local or disposable database that always starts the same. Writes are allowed by default.
- **Shared** (`seeded: false`): before running, real ids are read with `seed.sources` and ids `1..mappedRows` are mapped onto them. Writes are **blocked** unless you turn them on deliberately: the case shows as `blocked`, not `failed`, and no write request goes out.

The **read-only check** runs only the GET operations: the safe way to start against any environment.

### Example: a shared staging with OAuth2

The environment, in the `.eq.json`: no seed, no writes, budgets not enforced (measured across the network) and with authentication:

```json
"environments": [
  { "id": "staging", "name": "Staging", "baseUrl": "https://staging.example.com",
    "seeded": false, "writesAllowed": false, "enforceLatency": false, "authEnabled": true }
]
```

In `project.seed`, where to read real ids before each run:

```json
"seed": {
  "sources": [
    { "name": "order_id", "path": "/v1/orders?limit=4", "operationPath": "/v1/orders" }
  ],
  "mappedRows": 4
}
```

The credential never goes in the file. In the [Credentials](guide:credentials) guide choose **OAuth2 client credentials**, or through the API:

```bash
curl -s -X PUT http://127.0.0.1:4400/v1/projects/store-api/environments/staging/credentials/primary \
  -H 'content-type: application/json' \
  -d "{\"kind\":\"oauth2_client_credentials\",\"tokenUrl\":\"https://auth.example.com/oauth/token\",\"clientId\":\"eq-ci\",\"scope\":\"orders:read\",\"secret\":\"$CLIENT_SECRET\"}"
```

The API requests the token from `tokenUrl` (`grant_type=client_credentials` with `client_id`, `client_secret` and `scope`) once per run and sends it as `Bearer`. Start with `eq run store-api --env staging --read-only`.

## Probe a case or run the matrix

- **Probe** runs one case with the values you choose and saves nothing. Use it while tuning samples or bodies.
- **Run** saves a run: cases are planned when it starts, run on the server one after another, and progress can be followed from any tab. Runs are the evidence compared over time.

## Configure

The [Functional cases](guide:functional) guide walks through regenerating from the contract, samples, bodies, plugins and the matrix preview. Every field's reference is in [.eq.json format](doc:formato).
