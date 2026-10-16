# Verificación funcional

La verificación funcional comprueba que cada operación responde **lo que su contrato dice**, incluidos los casos que casi nadie prueba: el 404 de una escritura, el 409 de una clave duplicada, el 422 de un body vacío y el 401/403 de cada operación protegida. Un 200 no es una prueba que pasa.

## Qué comprueba cada caso

Toda solicitud se evalúa con las mismas aserciones:

- **Status**: el esperado por el caso. Un 405 se reporta como «operación no implementada».
- **Schema OpenAPI**: el cuerpo se valida contra el schema que el contrato declara para ese status. Si no declara ninguno, se verifica la forma (el envelope `{ data }`, por ejemplo).
- **Content-Type**: JSON cuando hay cuerpo.
- **Latencia**: solo si una regla de presupuesto cubre la operación. Ver [Conceptos](doc:conceptos).

## Los casos que se generan

El tipo de operación se deduce del método y la ruta (un GET que termina en `{id}` es un detalle; un POST a `…/bulk`, un bulk). `operationKinds` lo sobrescribe.

| Tipo | Casos |
| --- | --- |
| Listado (`GET /orders`) | Sin filtros (200); un caso por cada valor de `parameterSamples` de cada parámetro de query, con su status esperado; cursor corrupto (plugin de paginación); radios geográficos (plugin geo). |
| Detalle (`GET /orders/{order_id}`) | Recurso existente (200) y recurso inexistente (404). |
| Creación (`POST /orders`) | Crear y consultar; payload vacío (422); clave natural duplicada (409, si el contrato lo declara). |
| Bulk (`POST /orders/bulk`) | Upsert, consultar y limpiar; payload vacío (422). |
| Reemplazo (`PUT`) | Crear, reemplazar y consultar; recurso inexistente (404); payload inválido (422). |
| Cambio parcial (`PATCH`) | Crear, actualizar y consultar; recurso inexistente (404); payload sin campos (422). |
| Borrado (`DELETE`) | Crear, eliminar y confirmar (204); consultar el recurso eliminado (404 en el GET y en un segundo DELETE). |

Los 404 y 422 de escritura solo se generan si el contrato declara ese status para la operación.

## La matriz de autenticación

Con `authEnabled` en el entorno, cada operación protegida recibe además:

- **Sin credencial → 401**, si declara 401.
- **Scope insuficiente → 403**, con la credencial `insufficient`, si declara 403.
- **Credencial no aceptada**, con la credencial `alternate`, en los métodos que diga `auth.alternate` (por ejemplo una API key en un DELETE → 401).

Las operaciones de `auth.publicOperations` (las que el contrato marca con `security: []`) no reciben estos casos. Contra una API que no exige credenciales, estos casos fallarían por la razón equivocada: por eso solo corren con `authEnabled`.

## Flujos encadenados y limpieza

Las escrituras se prueban como flujos:

```text
POST /orders            → 201, captura order_id
GET  /orders/{order_id} → 200, compara cada campo enviado
DELETE /orders/{order_id}  (limpieza, aunque el caso falle)
```

- **El id** se lee de la respuesta: el miembro con el nombre del placeholder (`order_id`) o, si no, `envelope.idFallbackKey` (`id`).
- **PUT** crea con `body`, reemplaza con `replaceBody` y vuelve a leer. Si `replaceBody` fuera igual a lo creado, un PUT que no hace nada pasaría igual.
- **Bulk** responde contadores, no ids: el flujo busca cada registro por su clave natural (`bulk.lookups`) antes y después, y al final borra solo los que no existían antes.
- **Cancelar** una corrida espera a que el flujo en curso termine su limpieza.

Usa en los bodies claves naturales que no existan en el entorno (`ORD-TEST-0001`, no una real): si no, «crear» recibe un 409 en vez de un 201.

## Entornos con seed y entornos compartidos

Los casos se escriben contra un **seed** donde el id `1` existe y `999999` no.

- **Con seed** (`seeded: true`): una base local o desechable que arranca siempre igual. Se permiten escrituras por defecto.
- **Compartido** (`seeded: false`): antes de correr se leen ids reales con `seed.sources` y los ids `1..mappedRows` se mapean sobre ellos. Las escrituras quedan **bloqueadas** salvo que las actives a propósito: el caso aparece como `blocked`, no como `failed`, y ninguna solicitud de escritura sale a la red.

La **verificación de solo lectura** corre solo las operaciones GET: es la forma segura de empezar contra cualquier entorno.

### Ejemplo: un staging compartido con OAuth2

El entorno, en el `.eq.json`: sin seed, sin escrituras, sin exigir presupuestos (se mide a través de la red) y con autenticación:

```json
"environments": [
  { "id": "staging", "name": "Staging", "baseUrl": "https://staging.example.com",
    "seeded": false, "writesAllowed": false, "enforceLatency": false, "authEnabled": true }
]
```

En `project.seed`, de dónde leer ids reales antes de cada corrida:

```json
"seed": {
  "sources": [
    { "name": "order_id", "path": "/v1/orders?limit=4", "operationPath": "/v1/orders" }
  ],
  "mappedRows": 4
}
```

La credencial nunca va en el archivo. En la guía [Credenciales](guide:credentials) elige **OAuth2 client credentials**, o por el API:

```bash
curl -s -X PUT http://127.0.0.1:4400/v1/projects/store-api/environments/staging/credentials/primary \
  -H 'content-type: application/json' \
  -d "{\"kind\":\"oauth2_client_credentials\",\"tokenUrl\":\"https://auth.example.com/oauth/token\",\"clientId\":\"eq-ci\",\"scope\":\"orders:read\",\"secret\":\"$CLIENT_SECRET\"}"
```

El API pide el token a `tokenUrl` (`grant_type=client_credentials` con `client_id`, `client_secret` y `scope`) una vez por corrida y lo envía como `Bearer`. Empieza con `eq run store-api --env staging --read-only`.

## Tipos de credencial

Cada credencial es de un entorno y de un rol. Todos sus secretos se cifran al guardarse y nunca vuelven: el formulario muestra como mucho una pista (los cuatro últimos caracteres, o `••••` para una clave PEM). Un secreto que dejas vacío conserva el guardado.

| `kind` | Qué guarda | Qué envía |
| --- | --- | --- |
| `bearer` | El token. | `Authorization: Bearer …` |
| `api_key` | La clave y su cabecera (`headerName`, por defecto la del proyecto). | `X-API-Key: …` |
| `basic` | `username` y la contraseña. | `Authorization: Basic …` |
| `oauth2_client_credentials` | `tokenUrl`, `clientId`, `scope` y el client secret. | El token que pide a `tokenUrl`, como `Bearer`. |
| `oauth2_authorization_code` | `tokenUrl`, `clientId`, `scope`, un **refresh token** (obligatorio) y el client secret (opcional en clientes públicos). | El access token que obtiene con el refresh token. |
| `cookie` | Una cookie pegada (`options.cookieName` + su valor), o un login (`options.login`). | `Cookie: …` |
| `hmac` | La clave HMAC y cómo firmar (`options.hmac`). | La firma, la hora y el key id en sus cabeceras. |
| `mtls` | Un certificado de cliente (`options.tls.cert`) y su clave privada. | El certificado en el handshake TLS. |

**OAuth2 authorization code.** El motor cambia el refresh token por un access token, lo reutiliza hasta que vence, lo renueva ante un 401 y guarda el refresh token nuevo cuando el servidor lo rota. La autorización interactiva (redirección del navegador, PKCE) no está incluida: obtén el refresh token con las herramientas de tu proveedor de identidad (un login único, por ejemplo) y pégalo.

**Cookie.** Dos formas:

- *Cookie pegada*: `options.cookieName` y el valor como secreto, tal como lo copiaste del navegador.
- *Login*: `options.login` con `method` (`POST` por defecto), `path` (relativa a la URL base del entorno, o una URL absoluta), `body` (una plantilla con `{{username}}` y `{{password}}`) y `contentType` (`application/json` por defecto). El usuario va en `username` y la contraseña es el secreto (opcional). Las cookies del `Set-Cookie` de la respuesta se envían en `Cookie`; ante un 401 vuelve a hacer login una vez.

**HMAC.** El secreto es la clave. `options.hmac`: `algorithm` (`sha256` por defecto, o `sha512`), `header` de la firma (`X-Signature`), `keyId` opcional enviado en `keyIdHeader` (`X-Key-Id`), `timestampHeader` (`X-Timestamp`, en segundos Unix), `encoding` (`hex` por defecto, o `base64`) y `template`, el texto que se firma. Por defecto `{method}\n{path}\n{timestamp}\n{bodyHash}`, donde `\n` es un salto de línea; los marcadores son `{method}`, `{path}` (con la query), `{timestamp}`, `{bodyHash}` (el hash hex del cuerpo con el mismo algoritmo) y `{keyId}`.

**Certificado de cliente (mTLS).** `options.tls.cert` (el certificado PEM) y `tlsKey` (su clave privada PEM) son obligatorios; `tlsPassphrase` si la clave está cifrada, y `options.tls.ca` (PEM) para confiar en un servidor con un certificado propio. El API comprueba que la clave sea la pareja del certificado y que abra con la frase, y si no responde 422. Cualquier otro tipo puede llevar también un certificado (bearer + mTLS, por ejemplo): sus cabeceras más el handshake. Quién lo presenta depende de qué papel juega:

- **Combinado** (otro tipo + certificado en la credencial `primary`): el certificado es transporte. Lo presentan también los casos que no tienen uno propio, incluido el de «sin credencial», que así prueba la autenticación del API y no el handshake.
- **Solo** (`kind: "mtls"`): el certificado es la identidad. El caso «sin credencial» no presenta ninguno, así que puede seguir esperando un 401; los otros roles usan solo su propio certificado, si lo tienen.

```bash
curl -s -X PUT http://127.0.0.1:4400/v1/projects/store-api/environments/staging/credentials/primary \
  -H 'content-type: application/json' \
  -d "$(jq -n --arg token "$TOKEN" --rawfile cert client.crt --rawfile key client.key \
        '{kind:"bearer", secret:$token, options:{tls:{cert:$cert}}, tlsKey:$key}')"
```

## Probar un caso o correr la matriz

- **Probar** (probe) ejecuta un caso con los valores que elijas y no guarda nada. Úsalo mientras ajustas samples o bodies.
- **Ejecutar** guarda una corrida: los casos se planifican al empezar, corren en el servidor uno tras otro y el progreso se puede seguir desde cualquier pestaña. Las corridas son la evidencia que se compara en el tiempo.

## Configurar

La guía [Casos funcionales](guide:functional) recorre la regeneración desde el contrato, los samples, los bodies, los plugins y la vista previa de la matriz. La referencia de cada campo está en [Formato .eq.json](doc:formato).
