# Functional verification

Functional verification checks that each operation answers **what its contract says**, including the cases almost nobody tests: the 404 of a write, the 409 of a duplicate key, the 422 of an empty body and the 401/403 of every protected operation. A 200 is not a test that passes.

## What each case checks

Every request is evaluated with the same assertions:

- **Status**: the one the case expects. A 405 is reported as "operation not implemented".
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

## Credential kinds

Each credential belongs to an environment and a role. Every secret it holds is encrypted when saved and never comes back: the form shows a hint at most (the last four characters, or `••••` for a PEM key). A secret left empty keeps the stored one.

| `kind` | What it stores | What it sends |
| --- | --- | --- |
| `bearer` | The token. | `Authorization: Bearer …` |
| `api_key` | The key and its header (`headerName`, the project's by default). | `X-API-Key: …` |
| `basic` | `username` and the password. | `Authorization: Basic …` |
| `oauth2_client_credentials` | `tokenUrl`, `clientId`, `scope` and the client secret. | The token it requests from `tokenUrl`, as `Bearer`. |
| `oauth2_authorization_code` | `tokenUrl`, `clientId`, `scope`, a **refresh token** (required) and the client secret (optional for public clients). | The access token it gets with the refresh token. |
| `cookie` | A pasted cookie (`options.cookieName` + its value), or a login (`options.login`). | `Cookie: …` |
| `hmac` | The HMAC key and how to sign (`options.hmac`). | The signature, the time and the key id in their headers. |
| `mtls` | A client certificate (`options.tls.cert`) and its private key. | The certificate in the TLS handshake. |

**OAuth2 authorization code.** The engine exchanges the refresh token for an access token, reuses it until it expires, renews it on a 401 and stores the new refresh token when the server rotates it. Interactive authorization (a browser redirect, PKCE) is not included: get the refresh token with your identity provider's tooling (a one-time login, for instance) and paste it.

**Cookie.** Two ways:

- *Pasted cookie*: `options.cookieName` and the value as the secret, as copied from the browser.
- *Login*: `options.login` with `method` (`POST` by default), `path` (relative to the environment's base URL, or an absolute URL), `body` (a template with `{{username}}` and `{{password}}`) and `contentType` (`application/json` by default). The user goes in `username` and the password is the secret (optional). The cookies of the answer's `Set-Cookie` are sent in `Cookie`; on a 401 it logs in again once.

**HMAC.** The secret is the key. `options.hmac`: `algorithm` (`sha256` by default, or `sha512`), the signature `header` (`X-Signature`), an optional `keyId` sent in `keyIdHeader` (`X-Key-Id`), `timestampHeader` (`X-Timestamp`, in Unix seconds), `encoding` (`hex` by default, or `base64`) and `template`, the string that is signed. By default `{method}\n{path}\n{timestamp}\n{bodyHash}`, where `\n` is a line break; the placeholders are `{method}`, `{path}` (with the query), `{timestamp}`, `{bodyHash}` (the hex hash of the body with the same algorithm) and `{keyId}`.

**Client certificate (mTLS).** `options.tls.cert` (the PEM certificate) and `tlsKey` (its PEM private key) are required; `tlsPassphrase` if the key is encrypted, and `options.tls.ca` (PEM) to trust a server with a certificate of its own. The API checks that the key pairs with the certificate and opens with the passphrase, and answers 422 otherwise. Any other kind may carry a certificate too (bearer + mTLS, for instance): its headers plus the handshake. Who presents it depends on the part it plays:

- **Combined** (another kind + a certificate on the `primary` credential): the certificate is transport. Cases without one of their own present it too, the no-credential one included, which so tests the API's authentication and not the handshake.
- **Alone** (`kind: "mtls"`): the certificate is the identity. The no-credential case presents none, so it can still expect a 401; the other roles only use their own certificate, if they have one.

```bash
curl -s -X PUT http://127.0.0.1:4400/v1/projects/store-api/environments/staging/credentials/primary \
  -H 'content-type: application/json' \
  -d "$(jq -n --arg token "$TOKEN" --rawfile cert client.crt --rawfile key client.key \
        '{kind:"bearer", secret:$token, options:{tls:{cert:$cert}}, tlsKey:$key}')"
```

## Probe a case or run the matrix

- **Probe** runs one case with the values you choose and saves nothing. Use it while tuning samples or bodies.
- **Run** saves a run: cases are planned when it starts, run on the server one after another, and progress can be followed from any tab. Runs are the evidence compared over time.

## Configure

The [Functional cases](guide:functional) guide walks through regenerating from the contract, samples, bodies, plugins and the matrix preview. Every field's reference is in [.eq.json format](doc:formato).
