# Formato .eq.json

Un proyecto como archivo: lo que exporta **Exportar .eq.json**, lo que importa **Importar** y lo que guarda `examples/`. Es JSON plano, sin funciones ni secretos, para que se pueda versionar en Git y mover entre equipos. El ejemplo de referencia completo es `examples/mock-store/mock-store.eq.json`.

## Estructura

```json
{
  "format": "endpoint-quality/project",
  "version": 1,
  "project": { "name": "Store API", "operations": [] },
  "environments": [],
  "load": {}
}
```

| Campo | Qué es |
| --- | --- |
| `format` | Siempre `"endpoint-quality/project"`. Sin él, el archivo se lee como un `project` suelto, sin entornos. |
| `version` | Siempre `1`. |
| `project` | Qué probar: el contrato y su configuración. |
| `environments` | Dónde probarlo. Nunca llevan credenciales. |
| `load` | Opcional: objetivos, mezclas y datos de las pruebas de carga. |

Al importar se comprueba:

- `project.name`: obligatorio.
- `project.operations`: una lista no vacía; cada operación con `id` único, `method`, `path` que empieza por `/`, `statuses` (números) y `parameters` (lista, aunque esté vacía).
- Con `format`, `environments` es una lista (puede estar vacía), y cada entorno lleva `id`, `name` y una `baseUrl` http o https.
- Las claves de `bodies`, `responseShapes`, `operationKinds`, `operationScenarios` y `extraScenarios` son ids de operaciones que existen.

Todo lo demás es opcional y tiene un valor por defecto genérico.

## project.operations

Las operaciones del contrato, tal como las produce la importación de OpenAPI. No se editan a mano.

```json
{ "id": "getOrder", "method": "GET", "path": "/v1/orders/{order_id}", "summary": "Read an order",
  "tag": "orders", "statuses": [200, 401, 404], "parameters": ["order_id"] }
```

| Campo | Qué es |
| --- | --- |
| `id` | El `operationId`, o uno derivado del método y la ruta. |
| `method` | `GET`, `POST`, `PUT`, `PATCH` o `DELETE`. |
| `path` | La ruta con placeholders `{nombre}`. |
| `summary`, `tag` | Descripción y grupo en la app. No se comprueban al importar. |
| `statuses` | Los status declarados: cada uno habilita sus casos. |
| `parameters` | Nombres de parámetros de ruta y de query. |
| `internal` | Opcional: una ruta que la API atiende pero el contrato no declara. No cuenta como cobertura. |

## Campos de project

| Campo | Para qué |
| --- | --- |
| `name`, `contractVersion` | Nombre del proyecto y versión del contrato (`info.version`). |
| `implemented` | Ids de las operaciones que la API ya atiende. Ausente = todas. Las demás se reportan como pendientes, no como fallos. |
| `bodies` | Por operación: `body` (lo que envía una escritura) y `replaceBody` (lo que envía el PUT del flujo de reemplazo). |
| `responseShapes` | Por operación: la forma esperada cuando el contrato no declara schema. |
| `operationKinds` | Por operación: `list`, `detail`, `create`, `bulk`, `replace`, `patch` o `delete`, si el método y la ruta no lo dicen. |
| `parameterSamples` | Por **nombre de parámetro**: valores a probar, cada uno con su `expectedStatus` (200 por defecto) y una `description`. |
| `defaultSample` | Valor para un parámetro sin samples (por defecto `"test"`). |
| `ids` | `existing` (por defecto `"1"`) y `missing` (por defecto `"999999"`). |
| `operationScenarios` | Casos que **reemplazan** los generados de una operación. |
| `extraScenarios` | Casos que se **añaden** a los generados. |
| `requestSchemas` | Por operación: el schema del `body` y de cada parámetro (`parameters`), sin `$ref`. Lo rellena la importación de OpenAPI; es lo que rompen los casos negativos. |
| `negativeCases` | Los casos negativos: `enabled`, `maxPerOperation`, `exclude`, `statuses`. |
| `plugins` | `geo` y `pagination`. |
| `auth` | `publicOperations`, `insufficientScope`, `apiKeyHeader`, `alternate`. |
| `budgets` | Reglas de presupuesto de latencia, en orden. |
| `envelope` | `dataKey` (el miembro que envuelve la respuesta, `"data"`; vacío si no hay) e `idFallbackKey`. |
| `bulk` | `recordsKey` y `lookups`: cómo encontrar lo que escribió un bulk. |
| `seed` | `sources`, `mappedRows`, `bodyIdFields`: de dónde leer ids reales fuera del seed. |

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

Los textos (`description`, `label`, `name`) aceptan una cadena o `{ "es": …, "en": … }`.

### Escenarios propios

```json
"extraScenarios": {
  "listOrders": [
    { "id": "late-orders", "name": { "es": "Pedidos atrasados", "en": "Late orders" },
      "description": "status=late", "expectedStatus": 200,
      "parameters": { "status": "late" }, "flow": "request" }
  ]
}
```

`flow` es `request` (una sola solicitud) o uno de los flujos encadenados: `create-read`, `replace-read`, `patch-read`, `delete-read`, `deleted-read`, `bulk-read`, `conflict`, `existing`, `negative`. `auth` puede ser `default`, `none`, `insufficient` o `api-key`.

### negativeCases y requestSchemas

```json
"requestSchemas": {
  "createOrder": { "body": { "type": "object", "required": ["reference"], "additionalProperties": false,
                             "properties": { "reference": { "type": "string", "maxLength": 32 }, "email": { "type": "string", "format": "email" } } } },
  "listOrders": { "parameters": { "limit": { "type": "integer", "minimum": 1, "maximum": 100 } } }
},
"negativeCases": { "enabled": true, "maxPerOperation": 10, "exclude": ["healthCheck"], "statuses": [400, 422] }
```

| Campo | Por defecto | Qué hace |
| --- | --- | --- |
| `enabled` | `true` | Apaga todos los casos negativos del proyecto. |
| `maxPerOperation` | `10` | Tope por operación: un caso de cada tipo antes de un segundo de cualquiera. `0` no genera ninguno. |
| `exclude` | `[]` | Operaciones (por `operationId`) que no reciben casos negativos. |
| `statuses` | los 4xx declarados | Los status que cuentan como rechazo. Sin él: los 4xx que declara la operación, salvo 401, 403, 405, 409 y 429, o 400/422 si no declara ninguno. |

Sin `requestSchemas` solo se genera el body que no es JSON. Volver a generar la configuración desde el contrato actualiza `requestSchemas` (el contrato manda) sin tocar lo demás. Cada caso tiene un id estable (`negative-body-missing-sku`, `negative-query-type-limit`…), y en `extraScenarios` un caso propio con `"flow": "negative"` y `expectedStatuses` funciona igual; `rawBody` envía un body tal cual. Ver [Verificación funcional](doc:funcional).

### plugins

```json
"plugins": {
  "pagination": { "cursorParam": "cursor", "invalidValue": "%%invalid-cursor%%", "expectedStatus": 422 },
  "geo": { "lat": "lat", "lon": "lon", "radius": "radius_km",
           "center": { "lat": "40.0000", "lon": "-100.0000" }, "radiiKm": ["1", "20"],
           "emptyPoint": { "lat": "0", "lon": "0" }, "loneRadiusKm": "5", "invalidStatus": 422 }
}
```

- `pagination` añade a cada listado con ese parámetro un caso con un cursor corrupto.
- `geo` añade a cada listado con el parámetro `lat` un caso por radio, el radio por defecto, un punto vacío, coordenadas incompletas y un radio sin coordenadas. `texts` sobrescribe nombres y descripciones por id de caso.

### auth

```json
"auth": {
  "publicOperations": ["healthCheck"],
  "insufficientScope": { "default": "orders:read" },
  "apiKeyHeader": "X-API-Key",
  "alternate": { "methods": ["DELETE"], "expectedStatus": 401,
                 "name": "API key en un DELETE", "description": "DELETE solo acepta bearer." }
}
```

### budgets

```json
"budgets": [
  { "path": "/health", "ms": 50 },
  { "methods": ["POST"], "path": "**/bulk", "ms": 2000 },
  { "methods": ["GET"], "query": "[?&]q=", "ms": 400, "label": "Búsqueda < 400 ms" },
  { "methods": ["GET"], "ms": 200 },
  { "methods": ["POST", "PUT", "PATCH", "DELETE"], "ms": null }
]
```

Gana la primera regla que coincide. `path` es un glob sobre la ruta con placeholders (`*` un segmento, `**` cualquier profundidad); `query` es una expresión regular sobre la ruta resuelta con su query string; `ms: null` es «sin presupuesto». `source` opcional dice de dónde sale el número.

### seed y bulk

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

| Campo | Por defecto | Qué hace |
| --- | --- | --- |
| `id`, `name`, `baseUrl` | — | Obligatorios. |
| `specUrl` | `/openapi.json` | El documento OpenAPI: ruta bajo la URL base o URL absoluta. Se lee para validar los schemas. |
| `seeded` | `true` en localhost | Los ids del seed son los del entorno. |
| `writesAllowed` | igual que `seeded` | Si pueden salir POST, PUT, PATCH y DELETE. |
| `enforceLatency` | `true` en localhost | Si los presupuestos deciden el caso. |
| `authEnabled` | `false` | Si la API exige credenciales: habilita los casos 401/403. |

Las credenciales no viajan en el `.eq.json`, de ningún tipo: ni los secretos (tokens, contraseñas, refresh tokens, claves HMAC, claves privadas) ni su configuración (el login de una cookie, cómo se firma un HMAC, el certificado de cliente). Viven en cada entorno del API, cifradas, y se configuran en la guía [Credenciales](guide:credentials), por el API o con los flags de `eq run`. Entre equipos solo se mueven con la [sincronización](doc:sync), cifradas de extremo a extremo, y únicamente si el workspace tiene una passphrase de sincronización.

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

- `targets`: variantes de GET además de las del contrato. Solo GET.
- `mixes`: perfiles de tráfico; `target` es el id de un objetivo o de una operación GET, `weight` es relativo.
- `data`: valores de cada `{placeholder}`. Ver [Carga y estrés](doc:carga).
