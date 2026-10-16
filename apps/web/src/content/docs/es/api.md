# API REST

Todo lo que hace la app lo hace a través del API de Endpoint Quality, así que también lo puedes hacer desde un script o desde CI. Todo vive bajo `/v1`, en JSON, y los errores llegan como Problem Details (`application/problem+json`) con `detail` y, si aplica, `errors` por campo.

En modo local el API escucha en `http://127.0.0.1:4400`, solo en el loopback y sin autenticación. Donde dice `:project` vale el id o el slug. En un [despliegue en la nube](doc:deploy) cada petición lleva `Authorization: Bearer <token>`: un token de API (`eqt_…`, creado en Ajustes) o el de una sesión con `POST /v1/auth/login`. Un token de API ya pertenece a un workspace; con un token de sesión, `X-Workspace: <id>` elige el workspace (si no, el primero).

## Recursos

| Método y ruta | Qué hace |
| --- | --- |
| `GET /health` | Estado, modo y motor de base de datos. |
| `GET /v1/projects` · `POST /v1/projects` | Lista o crea proyectos (con `spec: { url }` o `spec: { document }` y `environments`). |
| `POST /v1/projects/import` | Crea un proyecto desde un `.eq.json` (`{ file, slug? }`). |
| `GET/PATCH/DELETE /v1/projects/:project` | El proyecto; cambiar `name` o `slug` (`expectedRev`); archivarlo. |
| `GET /v1/projects/:project/export` | El `.eq.json` del proyecto. |
| `GET /v1/examples` · `GET /v1/examples/:id` · `POST /v1/examples/:id/import` | Los proyectos de ejemplo incluidos; importar uno como proyecto. |
| `GET/POST /v1/projects/:project/spec-versions` | Versiones del contrato; importar una nueva (`{ source: { url } \| { document }, activate? }`). |
| `POST /v1/projects/:project/spec-versions/:version/activate` | Vuelve a otra versión del contrato. |
| `GET /v1/projects/:project/operations` | Operaciones de la versión activa. |
| `GET /v1/projects/:project/config` | La configuración y su `rev`. |
| `PUT /v1/projects/:project/config/:section` | `{ value, expectedRev? }`: guarda una sección, validada contra el contrato. |
| `POST /v1/projects/:project/config/generate` | `{ mode: "merge" \| "replace" }`: regenera desde el contrato. |
| `GET /v1/projects/:project/scenarios` | La matriz de casos (`?auth=true`, `?locale=en`). |
| `GET /v1/projects/:project/queue-preview` | La cola en orden (`?mode=safe\|contract\|custom`, `?readOnly=true`, `?auth=true`, `?endpoints=a,b`, `?order=`, `?locale=`). |
| `GET/POST /v1/projects/:project/environments` | Entornos. |
| `PATCH/DELETE …/environments/:environment` | Cambia o borra un entorno. |
| `GET …/environments/:environment/credentials` | Las credenciales configuradas, nunca el secreto: como mucho sus 4 últimos caracteres. |
| `PUT …/environments/:environment/credentials/:role` | Guarda una credencial (`primary`, `insufficient`, `alternate`). `kind`: `bearer`, `api_key` (+`headerName`), `basic` (+`username`), `oauth2_client_credentials` (+`tokenUrl`, `clientId`, `scope`). Sin `secret` conserva el que había. |
| `DELETE …/environments/:environment/credentials/:role` | Borra la credencial. |
| `POST /v1/projects/:project/runs` | Lanza una corrida funcional. **202** `{ id, total }`. |
| `POST /v1/projects/:project/load-runs` | Lanza una prueba de carga. **202** `{ id }`. |
| `POST /v1/projects/:project/probe` | Un caso suelto, sin guardar: `environment`, `operationId`, `scenarioId`, `parameters?`, `body?`. |
| `GET /v1/projects/:project/runs` | Historial (`?kind=functional\|load`, `?limit=`). |
| `GET /v1/runs/:run` | Una corrida y sus casos (`?steps=true` con cada solicitud). |
| `DELETE /v1/runs/:run` | Borra una corrida del historial. |
| `GET /v1/runs/:run/stream` | Server-sent events: `snapshot`, `case`, `progress`, `finished`. |
| `POST /v1/runs/:run/cancel` · `POST /v1/runs/:run/replay` | Cancelar o repetir una corrida. |

Con `expectedRev` evitas pisar cambios de otra persona: si el proyecto cambió desde que lo leíste, la respuesta es **409**.

## Crear un proyecto desde su contrato

```bash
curl -s -X POST http://127.0.0.1:4400/v1/projects \
  -H 'content-type: application/json' \
  -d '{"name":"Store API",
       "spec":{"url":"http://127.0.0.1:4010/openapi.json"},
       "environments":[{"name":"Local","baseUrl":"http://127.0.0.1:4010"}]}'
```

## Guardar una credencial

```bash
curl -s -X PUT http://127.0.0.1:4400/v1/projects/store-api/environments/local/credentials/primary \
  -H 'content-type: application/json' \
  -d "{\"kind\":\"bearer\",\"secret\":\"$STORE_TOKEN\"}"
```

El secreto se cifra al llegar y nunca vuelve en ninguna respuesta. Léelo de una variable de entorno, no lo escribas en el script.

## Lanzar una corrida y esperar el resultado

```bash
RUN=$(curl -s -X POST http://127.0.0.1:4400/v1/projects/store-api/runs \
  -H 'content-type: application/json' \
  -d '{"environment":"local","readOnly":true}' | jq -r .id)

# Seguir el progreso en vivo
curl -N http://127.0.0.1:4400/v1/runs/$RUN/stream
```

Campos del plan: `environment` (obligatorio), `readOnly`, `mode` (`safe`, `contract` o `custom`), `customOrder` (con `mode: "custom"`), `endpointIds`, `caseSelection`, `authEnabled`, `samples`, `delayMs`, `locale`, `scope`.

## En CI

Un script que falla el pipeline si algún caso falla:

```bash
#!/usr/bin/env bash
set -euo pipefail
API=http://127.0.0.1:4400
RUN=$(curl -sf -X POST "$API/v1/projects/store-api/runs" \
  -H 'content-type: application/json' -d '{"environment":"ci"}' | jq -r .id)
while true; do
  STATUS=$(curl -sf "$API/v1/runs/$RUN" | jq -r .status)
  case "$STATUS" in queued|running|cancelling) sleep 2 ;; *) break ;; esac
done
curl -sf "$API/v1/runs/$RUN" | jq '.totals'
[ "$STATUS" = "passed" ]
```

Estados de una corrida: `queued`, `running`, `cancelling`, `passed`, `failed`, `cancelled`, `interrupted` (el proceso se reinició durante la corrida) y `error` (no se pudo ejecutar).

## Una prueba de carga

```bash
curl -s -X POST http://127.0.0.1:4400/v1/projects/store-api/load-runs \
  -H 'content-type: application/json' \
  -d '{"environment":"local","type":"load","baseRps":20,"durationS":60,"mixId":"all-gets"}'
```

Campos: `type` (`load`, `stress`, `spike`, `soak`), `baseRps`, `peakRps`, `durationS`, `mixId` o `targets`, `data`, `latency` (`{ "mode": "project" | "custom" | "off", "p95Ms" }`), `maxInFlight`, `timeoutMs`, `onPreflightFailure`.

`eq run` y `eq load` hacen todo esto en un solo comando con exit code: ver [CLI y CI](doc:cli).

## Variables

El API se configura con variables de entorno. Con `pnpm start` (o `pnpm run api`) se leen todas. `eq serve` en modo local lee solo `EQ_PORT`, `EQ_HOST`, `EQ_DATA_DIR` y `EQ_SYNC_INTERVAL_SECONDS`; con `EQ_MODE=cloud` lee toda la configuración del entorno.

| Variable | Por defecto | Qué hace |
| --- | --- | --- |
| `EQ_MODE` | `local` | `local` o `cloud`. La nube exige PostgreSQL, `EQ_SECRETS_KEY` y `EQ_JWT_SECRET`, y siempre pide sesión. |
| `EQ_PORT` | `4400` | Puerto. |
| `EQ_HOST` | `127.0.0.1` en local, `0.0.0.0` en la nube | Interfaz en la que escucha. |
| `EQ_DATA_DIR` | `~/.endpoint-quality` | Solo `eq`: dónde guarda la base SQLite y la clave en local. |
| `EQ_DATABASE_FILE` | `~/.endpoint-quality/data.sqlite` | Archivo SQLite; `:memory:` para no guardar nada. |
| `EQ_DATABASE_URL` | — | `postgres://…`: usa PostgreSQL en lugar de SQLite. |
| `EQ_DATABASE_SCHEMA` | — | Esquema de PostgreSQL (se crea si no existe). |
| `EQ_SECRETS_KEY` | — | Clave que cifra las credenciales, 32 bytes en base64 (`openssl rand -base64 32`). Obligatoria en la nube. |
| `EQ_SECRETS_FILE` | `~/.endpoint-quality/secret.key` | En local, dónde vive la clave; se crea la primera vez. |
| `EQ_QUEUE_DRIVER` | `memory` | `memory` o `redis` (varios procesos; sobrevive a reinicios). |
| `EQ_REDIS_URL` | `redis://127.0.0.1:6379` | Redis de la cola. |
| `EQ_RUN_CONCURRENCY` | `2` | Corridas simultáneas por proceso. |
| `EQ_JWT_SECRET` | — | Firma los tokens de acceso; al menos 32 caracteres (`openssl rand -base64 48`). Obligatoria en la nube. |
| `EQ_AUTH` | — | `required` pide sesión también en local. |
| `EQ_REGISTRATION` | `invite` | `invite`: solo la primera cuenta se registra, el resto por invitación. `open`: cualquiera. |
| `EQ_ACCESS_TTL_SECONDS` | `900` | Vida del token de acceso. |
| `EQ_REFRESH_TTL_DAYS` | `30` | Vida de la sesión (token de refresco, rotado en cada uso). |
| `EQ_ALLOW_PRIVATE_TARGETS` | `false` en la nube | `true` deja alcanzar direcciones privadas (despliegue dentro de una red privada). En local siempre se permite. |
| `EQ_CORS_ORIGINS` | — | Orígenes permitidos, separados por comas, si la web se sirve desde otro dominio. |
| `EQ_TRUST_PROXY` | — | Saltos de proxy en los que confiar (`1` tras un balanceador), para la IP del cliente y HTTPS. |
| `EQ_SYNC_INTERVAL_SECONDS` | `300` en local | Cada cuánto sincroniza sola una instalación enlazada a la nube (`0`: solo a demanda). |
| `EQ_LOG` | — | `debug` para más detalle, `silent` para nada. Por defecto, errores y avisos. |
