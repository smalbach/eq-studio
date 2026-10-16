# Ejemplo: Mock Store

`mock-store.eq.json` es un proyecto completo de Endpoint Quality contra la API de ejemplo incluida en
[`apps/mock-target`](../../apps/mock-target/README.md): una tienda ficticia con productos, reseñas y
tiendas físicas. Ejercita **todo** lo que el motor sabe hacer — CRUD con flujos encadenados, bulk,
409 por clave natural, 401/403 con tres credenciales, paginación por cursor, búsqueda geográfica,
presupuestos de latencia y perfiles de carga — y es la base de los tests E2E del repositorio.

Úsalo como plantilla: cada sección de abajo explica qué hace un campo del archivo, por qué el
ejemplo lo configura así y qué tendrías que poner tú para tu propia API.

## Arrancar el mock

```sh
# Sin autenticación (entorno "local")
node apps/mock-target/server.mjs --port 4010

# Exigiendo credenciales (entorno "local-auth"): habilita los casos 401/403
node apps/mock-target/server.mjs --port 4011 --auth

# Los dos a la vez, también sin el repositorio
npx endpoint-quality mock
```

Credenciales del entorno `local-auth` (valores de prueba del mock, no secretos):

| Rol | Credencial | Puede |
| --- | --- | --- |
| `primary` | `Authorization: Bearer admin-token` | Todo. |
| `insufficient` | `Authorization: Bearer read-token` | Solo GET: las escrituras responden 403. |
| `alternate` | `X-API-Key: demo-key` | Todo menos DELETE, que responde 401. |

Los datos viven en memoria y arrancan siempre del mismo seed: productos y tiendas con ids 1..4, y
cuatro reseñas (tres del producto 1). Reiniciar el proceso vuelve al seed. El documento OpenAPI está
en `http://127.0.0.1:4010/openapi.json`.

Para correr la matriz completa contra el mock (ambos modos, dos veces seguidas):

```sh
node --test tests/mock-store.e2e.test.mjs
```

## Estructura del archivo

```json
{
  "format": "endpoint-quality/project",
  "version": 1,
  "project": { "...": "qué probar" },
  "environments": [ { "...": "dónde probarlo" } ],
  "load": { "...": "cómo cargarlo" }
}
```

`format` y `version` identifican el archivo; sin ellos el importador lo trata como un `project`
suelto, sin entornos. `project` no guarda ningún secreto: las credenciales se configuran aparte,
por entorno, y nunca viajan en el archivo.

## `project.operations` — el contrato

```json
{ "id": "getProduct", "method": "GET", "path": "/v1/products/{product_id}", "summary": "Read a product",
  "tag": "products", "statuses": [200, 401, 404], "parameters": ["product_id"] }
```

La lista sale **tal cual** de importar el OpenAPI del mock (`projectFromOpenApi`); no se edita a mano.
Dos campos deciden casi todo lo que se genera:

- `statuses`: cada status declarado habilita sus casos. Un `404` en un PUT genera el caso "recurso
  inexistente"; un `409` en un POST genera el de "clave natural duplicada"; un `401`/`403` genera los
  de autorización. Si tu API responde un status que tu OpenAPI no declara, decláralo: si no, nadie
  lo prueba.
- `parameters`: los nombres de path (`{product_id}`) y de query (`limit`, `q`…). Los de query son
  los que reciben los valores de `parameterSamples`.

El tipo de caso se deduce del método y la ruta: un GET que termina en `{…}` es un detalle, cualquier
otro GET es un listado, un POST a `…/bulk` es un bulk. `operationKinds` lo sobrescribe si tu API no
sigue esa convención (este ejemplo no lo necesita).

## `project.bodies` — qué se envía en cada escritura

```json
"createProduct": { "body": { "sku": "EQ-TEST-0001", "name": "Test Lamp", "category": "lighting", "price": 31.5, "stock": 7 } },
"replaceProduct": {
  "body":        { "sku": "EQ-TEST-0001", "name": "Test Lamp", "category": "lighting", "price": 31.5, "stock": 7 },
  "replaceBody": { "sku": "EQ-TEST-0002", "name": "Test Lamp, replaced", "category": "lighting", "price": 35, "stock": 2 }
},
"updateProduct": { "body": { "price": 27.25 } }
```

El importador genera bodies a partir de los `example` del schema, pero hay que ajustarlos:

- **Claves naturales distintas del seed.** El seed usa `SKU-0001..0004`; el ejemplo usa
  `EQ-TEST-…`. Si el body de creación repitiera un SKU existente, el caso "crear y consultar"
  recibiría un 409 en vez de un 201.
- **`replaceBody` cambia algo.** El flujo de PUT crea una entidad con el body del POST, la
  reemplaza con `replaceBody` y la vuelve a leer comparando campo a campo. Si `replaceBody` fuera
  igual a lo creado, un PUT que no hace nada pasaría igual.
- **El PATCH lleva un solo campo.** Basta para probar que un cambio parcial persiste sin tocar el
  resto.
- **El bulk tiene su propio SKU** (`EQ-BULK-0001`), para que el flujo pueda distinguir lo que creó
  de lo que ya existía.
- **La reseña referencia la tienda 1** (`store_id: 1`): un id del seed. Ver `seed.bodyIdFields`.

Todo lo que un flujo crea, el mismo flujo lo borra al final, aunque el caso falle. Por eso la matriz
se puede correr dos veces seguidas sobre los mismos datos.

## `project.parameterSamples` — qué valores probar en cada filtro

```json
"limit": [
  { "value": "10" },
  { "value": "0",   "expectedStatus": 422, "description": { "es": "Fuera del rango 1..100…", "en": "…" } },
  { "value": "101", "expectedStatus": 422, "description": { "es": "…", "en": "…" } }
],
"q": [
  { "value": "lamp" },
  { "value": "zzz-nothing", "description": { "es": "Búsqueda sin coincidencias: 200 con lista vacía, nunca 404.", "en": "…" } }
]
```

Cada valor es un caso del listado que lo declara. Las claves son **nombres de parámetro**, no de
operación: `limit` y `cursor` se prueban en los tres listados.

- `limit` fuera de rango debe ser 422: una API que recorta en silencio a 100 esconde un bug del
  cliente.
- `q` y `category` incluyen un valor que no encuentra nada: debe ser 200 con lista vacía.
- `cursor` usa un cursor **válido** emitido por la API (`offset` 2). Sin esta muestra se enviaría el
  valor por defecto `"test"`, que no es un cursor, y el caso esperaría un 200 que nunca llega. El
  cursor corrupto lo prueba `plugins.pagination`.
- `sku` usa un SKU del seed: el filtro exacto debe devolver ese producto.

Los parámetros de `plugins.geo` (`lat`, `lon`, `radius_km`) no necesitan muestras: el plugin genera
sus propios casos.

## `project.plugins.geo` — búsqueda por radio

```json
"geo": {
  "lat": "lat", "lon": "lon", "radius": "radius_km",
  "center": { "lat": "40.0000", "lon": "-100.0000" },
  "radiiKm": ["1", "20"],
  "emptyPoint": { "lat": "0", "lon": "0" },
  "loneRadiusKm": "5",
  "invalidStatus": 422
}
```

Genera seis casos en `GET /v1/stores`: un radio por cada valor de `radiiKm`, el radio por defecto,
un punto vacío, coordenadas incompletas (`lat` sin `lon`) y un radio sin coordenadas.

- `center` está junto a las tiendas del seed: dos a menos de 1 km y las cuatro a menos de 20 km.
  Con todas las tiendas en el mismo punto, cualquier radio devolvería todo y el filtro no se podría
  distinguir de no filtrar.
- `emptyPoint` es un punto sin nada cerca (0, 0): un filtro ignorado devolvería la colección
  completa en vez de una lista vacía.
- `loneRadiusKm` y las coordenadas incompletas esperan `invalidStatus` (422): media búsqueda es un
  error del cliente, no una búsqueda sin filtro.

## `project.plugins.pagination`

```json
"pagination": { "cursorParam": "cursor", "invalidValue": "%%invalid-cursor%%", "expectedStatus": 422 }
```

Añade a cada listado con `cursor` un caso con un cursor corrupto, que debe ser 422 en Problem
Details y nunca un 500 ni, peor, la primera página.

## `project.auth` — credenciales y los casos 401/403

```json
"auth": {
  "publicOperations": ["healthCheck"],
  "insufficientScope": { "default": "catalog:read" },
  "apiKeyHeader": "X-API-Key",
  "alternate": {
    "methods": ["DELETE"], "expectedStatus": 401,
    "name": { "es": "API key en un DELETE", "en": "API key on a DELETE" },
    "description": { "es": "Los DELETE solo aceptan token bearer…", "en": "…" }
  }
}
```

Los casos de autorización solo corren en un entorno con `authEnabled: true`; contra una API que no
exige credenciales fallarían por la razón equivocada.

- `publicOperations`: operaciones sin credencial (el OpenAPI las marca con `security: []`). No
  reciben casos 401/403.
- Cada operación que declara `401` recibe un caso **sin credencial**. Cada una que declara `403`
  recibe un caso con una credencial de **scope insuficiente**; `insufficientScope` solo pone nombre
  a ese scope en la descripción del caso (por método, o `default`). En el mock, los GET no declaran
  403: el token de lectura sí puede leer.
- `alternate` describe una credencial que la operación **no acepta**: en el mock, una API key
  válida en un DELETE debe ser 401, no 403 (no es un problema de permisos: ese tipo de credencial
  no vale ahí).
- `apiKeyHeader` dice en qué cabecera viaja la API key. Los valores nunca están en el proyecto.

Las credenciales que usa el test (configúralas igual en tu entorno):

| Tipo de caso | Cabecera |
| --- | --- |
| normal | `Authorization: Bearer admin-token` |
| sin credencial | ninguna |
| scope insuficiente | `Authorization: Bearer read-token` |
| API key | `X-API-Key: demo-key` |

## `project.budgets` — presupuestos de latencia

```json
"budgets": [
  { "path": "/health", "ms": 50 },
  { "methods": ["POST"], "path": "**/bulk", "ms": 2000 },
  { "methods": ["GET"], "ms": 200 },
  { "methods": ["POST", "PUT", "PATCH", "DELETE"], "ms": null }
]
```

Las reglas se prueban **en orden** y gana la primera que coincide, así que lo específico va antes
que lo general: `/health` antes de "todos los GET", el bulk antes de "todas las escrituras".
`path` es un glob sobre la ruta con placeholders (`*` un segmento, `**` cualquier profundidad).

`ms: null` significa "sin presupuesto": las escrituras del ejemplo no llevan aserción de latencia.
Un presupuesto que no existe no es uno que pasa — sin regla no se emite ninguna aserción. No
inventes números: pon los que tu servicio se compromete a cumplir.

## `project.envelope`

```json
"envelope": { "dataKey": "data", "idFallbackKey": "id" }
```

- `dataKey`: el miembro que envuelve la respuesta (`{ "data": … }`). De ahí se leen los ids
  creados y los campos que se comparan. Vacío si tu API no usa envelope.
- `idFallbackKey`: dónde buscar el id cuando no se llama como el placeholder. Los productos
  responden `product_id` (igual que `{product_id}`), pero las reseñas responden `id` y no
  `review_id`: sin este campo el flujo no encontraría el id de la reseña creada y no podría borrarla.

## `project.bulk`

```json
"bulk": {
  "recordsKey": "records",
  "lookups": { "/v1/products/bulk": { "list": "/v1/products", "keys": ["sku"], "id": "product_id", "item": "/v1/products/{product_id}" } }
}
```

Un bulk responde contadores (`created`, `updated`, `unchanged`), no ids. Para verificar y limpiar
lo que escribió, el flujo busca cada registro por su clave natural (`GET /v1/products?sku=…`)
**antes** y **después** del bulk, y al final borra solo los que no existían antes. Un registro que
ya existía no es del test, y en un entorno compartido es dato de alguien.

## `project.seed`

```json
"seed": {
  "sources": [
    { "name": "product_id", "path": "/v1/products?limit=4", "operationPath": "/v1/products" },
    { "name": "store_id",   "path": "/v1/stores?limit=4",   "operationPath": "/v1/stores" },
    { "name": "review_id",  "path": "/v1/products/{product_id}/reviews?limit=4",
      "operationPath": "/v1/products/{product_id}/reviews", "needs": "product_id" }
  ],
  "mappedRows": 4,
  "bodyIdFields": ["store_id"]
}
```

Los casos se escriben contra un seed donde el id `1` siempre existe y `999999` nunca. En un entorno
que **no** es ese seed (`seeded: false`), antes de correr se leen las primeras filas de cada
colección desde `sources` y los ids 1..`mappedRows` se mapean sobre ellas. `needs` encadena las
colecciones anidadas: las reseñas se leen bajo un producto que ya se conoce. `bodyIdFields` lista los
campos de los bodies que guardan ids del seed (`store_id` de la reseña), para remapearlos también.

Contra el mock (`seeded: true`) nada de esto se usa, pero está listo para cuando apuntes el mismo
proyecto a un entorno compartido.

## `environments` — dónde correr

```json
{ "id": "local", "name": "Local", "baseUrl": "http://127.0.0.1:4010",
  "seeded": true, "writesAllowed": true, "enforceLatency": true, "authEnabled": false,
  "description": { "es": "…", "en": "…" } }
```

| Campo | Qué hace | En el ejemplo |
| --- | --- | --- |
| `baseUrl` | La raíz de la API; el OpenAPI se lee de `specUrl` (por defecto `/openapi.json`). | 4010 y 4011 |
| `seeded` | Los ids del seed son los del entorno. Si es `false`, se descubren con `seed.sources`. | `true`: el mock arranca del seed |
| `writesAllowed` | Si POST/PUT/PATCH/DELETE pueden correr. | `true`: los datos son desechables |
| `enforceLatency` | Si los presupuestos deciden el caso. Apágalo para entornos detrás de VPN o gateway. | `true`: local, sin red de por medio |
| `authEnabled` | Si la API exige credenciales, para incluir los casos 401/403. | `false` en `local`, `true` en `local-auth` |

## `load` — pruebas de carga

```json
"targets": [
  { "id": "listProducts:q", "label": "GET /v1/products?q=", "method": "GET", "path": "/v1/products?q={q}&limit=20", "tag": "products" },
  { "id": "listStores:geo", "label": "GET /v1/stores?lat&lon&radius_km", "method": "GET", "path": "/v1/stores?lat=40.0000&lon=-100.0000&radius_km=20", "tag": "stores" }
],
"mixes": [
  { "id": "search", "label": { "es": "Búsqueda", "en": "Search" }, "hint": { "es": "…", "en": "…" },
    "targets": [{ "target": "listProducts:q", "weight": 50 }, { "target": "listProducts:sku", "weight": 30 }, { "target": "listStores:geo", "weight": 20 }] }
],
"data": { "product_id": ["1", "2", "3", "4"], "q": ["lamp", "mug", "oak", "shelf"] }
```

- Todo GET del contrato ya es un objetivo de carga por su `id`. `targets` añade variantes que
  recorren otro plan de consulta (búsqueda de texto, SKU exacto, radio geográfico).
- `mixes` son perfiles de tráfico: cada uno reparte peso relativo entre objetivos. El ejemplo trae
  tres: navegación (lecturas por clave y listados), búsqueda, y health (el piso de latencia).
- `data` llena cada `{placeholder}` de las rutas en el momento de enviar. Usa ids que existan: un
  404 mide otra cosa.

---

## English

`mock-store.eq.json` is a complete Endpoint Quality project for the bundled mock API
(`apps/mock-target`), a fictional store with products, nested reviews and stores. It exercises every
feature of the engine and backs the repository's E2E tests.

Run the mock with `node apps/mock-target/server.mjs --port 4010` (no auth, environment `local`) or
`node apps/mock-target/server.mjs --port 4011 --auth` (environment `local-auth`, enables the 401/403
cases), or both at once with `npx endpoint-quality mock` (no repository needed). Then
`node --test tests/mock-store.e2e.test.mjs` runs the whole matrix. The `local-auth` credentials are
test values: `Bearer admin-token` (primary), `Bearer read-token` (insufficient, writes get 403) and
`X-API-Key: demo-key` (alternate, DELETE gets 401).

What the example tunes after importing the OpenAPI document, and why:

- **bodies** — natural keys (`EQ-TEST-…`) distinct from the seed so creates do not collide; a
  `replaceBody` that actually changes fields; a one-field PATCH; a bulk with its own SKU.
- **parameterSamples** — out-of-range `limit` values expecting 422, a search and a category that
  match nothing (200, empty list), a valid cursor issued by the API.
- **plugins.geo** — a centre next to the seeded stores (two within 1 km, four within 20 km), an empty
  point at (0, 0) and the incomplete-coordinate cases expecting 422.
- **auth** — `healthCheck` is public; writes expect 403 with a read-only token; an API key on a
  DELETE expects 401 because DELETE does not accept that credential at all.
- **budgets** — ordered, first match wins: `/health` < 50 ms, bulk < 2000 ms, GET < 200 ms, writes
  with no budget (`ms: null`). A missing budget emits no assertion; it never passes silently.
- **envelope / bulk / seed** — `data` envelope; reviews answer their key as `id`
  (`idFallbackKey`); the bulk's records are found again by `sku`; id sources and `store_id` remapping
  for environments that are not the seed.
- **load** — search, SKU and geo variants as extra targets, three traffic mixes, and data for every
  placeholder.
