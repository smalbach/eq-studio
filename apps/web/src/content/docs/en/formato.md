# .eq.json format

A project as a file: what **Export .eq.json** writes, what **Import** reads and what `examples/` holds. It is plain JSON, with no functions and no secrets, so it can be versioned in Git and moved between machines. The complete reference example is `examples/mock-store/mock-store.eq.json`.

## Structure

```json
{
  "format": "endpoint-quality/project",
  "version": 1,
  "project": { "name": "Store API", "operations": [] },
  "environments": [],
  "load": {}
}
```

| Field | What it is |
| --- | --- |
| `format` | Always `"endpoint-quality/project"`. Without it, the file is read as a bare `project`, with no environments. |
| `version` | Always `1`. |
| `project` | What to test: the contract and its configuration. |
| `environments` | Where to test it. They never carry credentials. |
| `load` | Optional: load-test targets, mixes and data. |

On import it checks:

- `project.name`: required.
- `project.operations`: a non-empty list; each operation with a unique `id`, `method`, a `path` starting with `/`, `statuses` (numbers) and `parameters` (a list, even if empty).
- With `format`, `environments` is a list (it may be empty), and each environment has `id`, `name` and an http or https `baseUrl`.
- The keys of `bodies`, `responseShapes`, `operationKinds`, `operationScenarios` and `extraScenarios` are ids of operations that exist.

Everything else is optional and has a generic default.

## project.operations

The contract's operations, as the OpenAPI import produces them. Not edited by hand.

```json
{ "id": "getOrder", "method": "GET", "path": "/v1/orders/{order_id}", "summary": "Read an order",
  "tag": "orders", "statuses": [200, 401, 404], "parameters": ["order_id"] }
```

| Field | What it is |
| --- | --- |
| `id` | The `operationId`, or one derived from method and path. |
| `method` | `GET`, `POST`, `PUT`, `PATCH` or `DELETE`. |
| `path` | The path with `{name}` placeholders. |
| `summary`, `tag` | Description and group in the app. Not checked on import. |
| `statuses` | The declared statuses: each one enables its cases. |
| `parameters` | Names of path and query parameters. |
| `internal` | Optional: a route the API serves but the contract does not declare. Never counted as coverage. |

## Fields of project

| Field | For |
| --- | --- |
| `name`, `contractVersion` | Project name and contract version (`info.version`). |
| `implemented` | Ids of the operations the API serves today. Absent = all. The rest are reported as pending, not failing. |
| `bodies` | Per operation: `body` (what a write sends) and `replaceBody` (what the PUT of the replace flow sends). |
| `responseShapes` | Per operation: the expected shape when the contract declares no schema. |
| `operationKinds` | Per operation: `list`, `detail`, `create`, `bulk`, `replace`, `patch` or `delete`, when method and path do not say it. |
| `parameterSamples` | Per **parameter name**: values to try, each with its `expectedStatus` (200 by default) and a `description`. |
| `defaultSample` | Value for a parameter with no samples (default `"test"`). |
| `ids` | `existing` (default `"1"`) and `missing` (default `"999999"`). |
| `operationScenarios` | Cases that **replace** an operation's generated ones. |
| `extraScenarios` | Cases **appended** to the generated ones. |
| `plugins` | `geo` and `pagination`. |
| `auth` | `publicOperations`, `insufficientScope`, `apiKeyHeader`, `alternate`. |
| `budgets` | Latency budget rules, in order. |
| `envelope` | `dataKey` (the member wrapping the response, `"data"`; empty if none) and `idFallbackKey`. |
| `bulk` | `recordsKey` and `lookups`: how to find what a bulk wrote. |
| `seed` | `sources`, `mappedRows`, `bodyIdFields`: where to read real ids outside the seed. |

### parameterSamples

```json
"parameterSamples": {
  "limit": [
    { "value": "10" },
    { "value": "0", "expectedStatus": 422, "description": { "es": "Fuera de rango", "en": "Out of range" } }
  ],
  "status": [{ "value": "shipped" }, { "value": "nope", "expectedStatus": 422 }]
}
```

Texts (`description`, `label`, `name`) take a string or `{ "es": …, "en": … }`.

### Your own scenarios

```json
"extraScenarios": {
  "listOrders": [
    { "id": "late-orders", "name": { "es": "Pedidos atrasados", "en": "Late orders" },
      "description": "status=late", "expectedStatus": 200,
      "parameters": { "status": "late" }, "flow": "request" }
  ]
}
```

`flow` is `request` (a single request) or one of the chained flows: `create-read`, `replace-read`, `patch-read`, `delete-read`, `deleted-read`, `bulk-read`, `conflict`, `existing`. `auth` may be `default`, `none`, `insufficient` or `api-key`.

### plugins

```json
"plugins": {
  "pagination": { "cursorParam": "cursor", "invalidValue": "%%invalid-cursor%%", "expectedStatus": 422 },
  "geo": { "lat": "lat", "lon": "lon", "radius": "radius_km",
           "center": { "lat": "40.0000", "lon": "-100.0000" }, "radiiKm": ["1", "20"],
           "emptyPoint": { "lat": "0", "lon": "0" }, "loneRadiusKm": "5", "invalidStatus": 422 }
}
```

- `pagination` adds to every list with that parameter a case with a corrupt cursor.
- `geo` adds to every list with the `lat` parameter one case per radius, the default radius, an empty point, incomplete coordinates and a radius with no coordinates. `texts` overrides names and descriptions by case id.

### auth

```json
"auth": {
  "publicOperations": ["healthCheck"],
  "insufficientScope": { "default": "orders:read" },
  "apiKeyHeader": "X-API-Key",
  "alternate": { "methods": ["DELETE"], "expectedStatus": 401,
                 "name": "API key on a DELETE", "description": "DELETE only takes a bearer token." }
}
```

### budgets

```json
"budgets": [
  { "path": "/health", "ms": 50 },
  { "methods": ["POST"], "path": "**/bulk", "ms": 2000 },
  { "methods": ["GET"], "query": "[?&]q=", "ms": 400, "label": "Search < 400 ms" },
  { "methods": ["GET"], "ms": 200 },
  { "methods": ["POST", "PUT", "PATCH", "DELETE"], "ms": null }
]
```

The first matching rule wins. `path` is a glob over the templated path (`*` one segment, `**` any depth); `query` is a regular expression over the resolved path with its query string; `ms: null` means "no budget". Optional `source` says where the number comes from.

### seed and bulk

```json
"seed": {
  "sources": [
    { "name": "order_id", "path": "/v1/orders?limit=4", "operationPath": "/v1/orders" },
    { "name": "item_id", "path": "/v1/orders/{order_id}/items?limit=4",
      "operationPath": "/v1/orders/{order_id}/items", "needs": "order_id" }
  ],
  "mappedRows": 4,
  "bodyIdFields": ["customer_id"]
},
"bulk": { "recordsKey": "records",
  "lookups": { "/v1/orders/bulk": { "list": "/v1/orders", "keys": ["reference"], "id": "order_id", "item": "/v1/orders/{order_id}" } } }
```

## environments

```json
{ "id": "staging", "name": "Staging", "baseUrl": "https://staging.example.com",
  "specUrl": "/openapi.json", "seeded": false, "writesAllowed": false,
  "enforceLatency": false, "authEnabled": true,
  "description": { "es": "Compartido con QA", "en": "Shared with QA" } }
```

| Field | Default | What it does |
| --- | --- | --- |
| `id`, `name`, `baseUrl` | — | Required. |
| `specUrl` | `/openapi.json` | The OpenAPI document: a path under the base URL or an absolute URL. Read to validate schemas. |
| `seeded` | `true` on localhost | The seed's ids are the environment's own. |
| `writesAllowed` | same as `seeded` | Whether POST, PUT, PATCH and DELETE may go out. |
| `enforceLatency` | `true` on localhost | Whether budgets decide the case. |
| `authEnabled` | `false` | Whether the API enforces credentials: enables the 401/403 cases. |

## load

```json
"load": {
  "targets": [{ "id": "listOrders:q", "label": "GET /v1/orders?q=", "method": "GET",
                "path": "/v1/orders?q={q}&limit=20", "tag": "orders" }],
  "mixes": [{ "id": "search", "label": { "es": "Búsqueda", "en": "Search" },
              "targets": [{ "target": "listOrders:q", "weight": 1 }] }],
  "data": { "q": ["lamp", "mug"], "order_id": ["1", "2", "3"] }
}
```

- `targets`: GET variants beyond the contract's. GET only.
- `mixes`: traffic profiles; `target` is the id of a target or of a GET operation, `weight` is relative.
- `data`: values for each `{placeholder}`. See [Load and stress](doc:carga).
