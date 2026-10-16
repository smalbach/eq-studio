# @eq/api

El backend de Endpoint Quality: NestJS 11 + `@nestjs/cqrs` sobre TypeORM. **El mismo código** corre
en local (SQLite, sin cuenta) y en la nube (PostgreSQL, con cuentas): proyectos, versiones de
contrato, entornos, configuración, credenciales cifradas, **corridas ejecutadas en el servidor**
(funcionales, carga y estrés) y, en la nube, cuentas, workspaces, roles y tokens de API; y la
**sincronización** entre instalaciones locales a través de un workspace de la nube. El
[plan](../../docs/decoupling-plan.md) cuenta las decisiones de diseño.

## Arrancar

```bash
pnpm install
pnpm run api          # desde la raíz: http://127.0.0.1:4400
pnpm run api:dev      # lo mismo, recargando al guardar
```

`pnpm run api`, `pnpm start` y `pnpm run dev` leen todas las variables de abajo. `eq serve` (la
CLI) en modo local solo lee `EQ_PORT`, `EQ_HOST`, `EQ_DATA_DIR` y `EQ_SYNC_INTERVAL_SECONDS`, y
guarda todo en `EQ_DATA_DIR`; con `EQ_MODE=cloud` lee toda la configuración del entorno, como el
API.

| Variable | Por defecto | Qué hace |
|---|---|---|
| `EQ_MODE` | `local` | `local` o `cloud`. La nube exige PostgreSQL, `EQ_SECRETS_KEY` y `EQ_JWT_SECRET`, y siempre pide sesión. |
| `EQ_PORT` | `4400` | Puerto. |
| `EQ_HOST` | `127.0.0.1` en local, `0.0.0.0` en la nube | Interfaz. En local, solo el loopback salvo que lo cambies (sin cuentas ni guardas SSRF: no lo expongas). |
| `EQ_DATA_DIR` | `~/.endpoint-quality` | Solo `eq`: la carpeta de `data.sqlite` y `secret.key` en local. |
| `EQ_DATABASE_FILE` | `~/.endpoint-quality/data.sqlite` | Archivo SQLite; `:memory:` para no guardar nada. |
| `EQ_DATABASE_URL` | — | `postgres://…`: usa PostgreSQL en lugar de SQLite. |
| `EQ_DATABASE_SCHEMA` | — | Esquema de PostgreSQL (se crea si no existe). |
| `EQ_SECRETS_KEY` | — | Clave de cifrado de credenciales, 32 bytes en base64 (`openssl rand -base64 32`). Obligatoria en la nube. |
| `EQ_SECRETS_FILE` | `~/.endpoint-quality/secret.key` | En local, dónde vive la clave; se crea la primera vez, legible solo por el usuario. |
| `EQ_QUEUE_DRIVER` | `memory` | `memory` (local) o `redis` (BullMQ: varios procesos, sobrevive a reinicios). |
| `EQ_REDIS_URL` | `redis://127.0.0.1:6379` | Redis de la cola. |
| `EQ_RUN_CONCURRENCY` | `2` | Corridas simultáneas por proceso. |
| `EQ_JWT_SECRET` | — | Firma los tokens de acceso; al menos 32 caracteres (`openssl rand -base64 48`). Obligatoria en la nube. |
| `EQ_AUTH` | — | `required` pide sesión también en local (por defecto, local no tiene cuentas). |
| `EQ_REGISTRATION` | `invite` | `invite`: solo la primera cuenta se registra, el resto llega por invitación. `open`: cualquiera. |
| `EQ_ACCESS_TTL_SECONDS` | `900` | Vida del token de acceso. |
| `EQ_REFRESH_TTL_DAYS` | `30` | Vida de la sesión (token de refresco, rotado en cada uso). |
| `EQ_ALLOW_PRIVATE_TARGETS` | `false` en la nube | `true` deja leer contratos y probar APIs en direcciones privadas (despliegue dentro de una red privada). En local siempre se permite. |
| `EQ_CORS_ORIGINS` | — | Orígenes permitidos, separados por comas, si la web se sirve desde otro dominio. |
| `EQ_TRUST_PROXY` | — | Saltos de proxy en los que confiar (`1` tras un balanceador), para la IP del cliente y HTTPS. |
| `EQ_SYNC_INTERVAL_SECONDS` | `300` en local | Una instalación local enlazada a la nube sincroniza sola cada tantos segundos (`0`: solo a demanda). |
| `EQ_EXAMPLES_DIR` | `examples/` del repositorio | De dónde salen los proyectos de ejemplo (`/v1/examples`). |
| `EQ_WEB_DIR` | `apps/web/dist` | La web compilada que sirve el API. |
| `EQ_LOG` | — | `debug` para más detalle, `silent` para nada. Por defecto, errores y avisos. |

SQLite corre con **sql.js** (SQLite compilado a WebAssembly): no hay módulo nativo que compilar,
así que funciona igual en macOS, Windows y Linux.

## API

Todo bajo `/v1`, errores en `application/problem+json`. `:project` acepta el id o el slug.

| Método y ruta | Qué hace |
|---|---|
| `GET /health` | Estado, modo y motor de base de datos. |
| `GET /v1/projects` | Proyectos del workspace. |
| `POST /v1/projects` | Crea un proyecto. Con `spec: { url }` o `spec: { document }` importa el contrato, genera la configuración (salvo `generateConfig: false`) y crea los `environments` dados, en una sola transacción. El documento se lee antes de escribir nada. |
| `POST /v1/projects/import` | Crea un proyecto desde un archivo `.eq.json` (`{ file, slug? }`). |
| `GET /v1/examples` · `GET /v1/examples/:id` | Los proyectos de ejemplo incluidos (`EQ_EXAMPLES_DIR`). |
| `POST /v1/examples/:id/import` | Importa un ejemplo como proyecto (editor). |
| `GET /v1/projects/:project` | El proyecto con su archivo de proyecto completo. |
| `PATCH /v1/projects/:project` | `name`, `slug`; `expectedRev` para no pisar cambios ajenos (409). |
| `DELETE /v1/projects/:project` | Archiva (borrado lógico; el slug queda libre). |
| `GET /v1/projects/:project/export` | El `.eq.json`, el mismo formato que los ejemplos. |
| `GET /v1/projects/:project/spec-versions` | Versiones del contrato, la activa marcada. |
| `POST /v1/projects/:project/spec-versions` | `{ source: { url } \| { document }, activate? }`. El mismo contenido dos veces es la misma versión. |
| `POST /v1/projects/:project/spec-versions/:version/activate` | Vuelve a una versión anterior (o posterior). |
| `GET /v1/projects/:project/operations` | Operaciones de la versión activa (o de `?specVersionId=`). |
| `GET/POST /v1/projects/:project/environments` | Entornos. Nunca guardan credenciales. |
| `PATCH/DELETE /v1/projects/:project/environments/:environment` | Por id o por clave; `null` borra un campo opcional. |
| `GET /v1/projects/:project/config` | La configuración completa y su `rev`. |
| `PUT /v1/projects/:project/config/:section` | `{ value, expectedRev? }`. Se valida contra el contrato activo antes de guardar (422). Secciones: `implemented`, `bodies`, `responseShapes`, `operationKinds`, `parameterSamples`, `defaultSample`, `ids`, `operationScenarios`, `extraScenarios`, `plugins`, `auth`, `budgets`, `envelope`, `bulk`, `seed`, `load`. |
| `POST /v1/projects/:project/config/generate` | `{ mode: "merge" \| "replace", expectedRev? }`. `merge` conserva lo ajustado a mano y solo rellena lo que falta. |
| `GET /v1/projects/:project/scenarios` | La matriz que genera el motor (`?auth=true`, `?locale=en`). |
| `GET /v1/projects/:project/queue-preview` | La cola en orden (`?mode=safe\|contract\|custom`, `?readOnly=true`, `?auth=true`, `?endpoints=a,b`, `?order=`, `?locale=`). |
| `GET /v1/projects/:project/environments/:environment/credentials` | Credenciales configuradas, nunca el secreto: como mucho sus 4 últimos caracteres. |
| `PUT /v1/projects/:project/environments/:environment/credentials/:role` | `primary` (casos normales), `insufficient` (los 403), `alternate` (una credencial que la operación no acepta). `kind`: `bearer`, `api_key` (+`headerName`), `basic` (+`username`), `oauth2_client_credentials` (+`tokenUrl`, `clientId`, `scope`). Sin `secret` conserva el que había. |
| `DELETE …/credentials/:role` | Borra el secreto definitivamente. |
| `POST /v1/projects/:project/runs` | **202** `{ id, total }`. Planifica y encola la matriz: `environment`, `mode`, `customOrder`, `readOnly`, `endpointIds`, `caseSelection`, `authEnabled`, `samples`, `delayMs`, `locale`, `scope`. |
| `POST /v1/projects/:project/load-runs` | **202** `{ id }`. `type` (`load\|stress\|spike\|soak`), `baseRps`, `peakRps`, `durationS`, `mixId` o `targets`, `data`, `latency`, `maxInFlight`, `timeoutMs`, `onPreflightFailure`, `locale`. |
| `POST /v1/projects/:project/probe` | Un caso suelto, sin guardar: `environment`, `operationId`, `scenarioId`, `parameters?`, `body?`, `samples?`. |
| `GET /v1/projects/:project/runs` | Historial (`?kind=functional\|load`, `?limit=`, `?full=true`). |
| `GET /v1/runs/:run` | La corrida y sus casos (`?steps=true` con cada solicitud y aserción). |
| `GET /v1/runs/:run/stream` | Server-sent events: `snapshot`, `case`, `progress`, `finished`. |
| `DELETE /v1/runs/:run` | Borra una corrida del historial (admin). |
| `POST /v1/runs/:run/cancel` | Para tras el caso en curso (con su limpieza); el resto queda `skipped`. |
| `POST /v1/runs/:run/replay` | El mismo plan como una corrida nueva. |

Ejemplo:

```bash
curl -X POST localhost:4400/v1/projects -H 'content-type: application/json' \
  -d '{"spec":{"url":"http://127.0.0.1:4010/openapi.json"},"environments":[{"name":"Local","baseUrl":"http://127.0.0.1:4010"}]}'
```

## Cuentas y roles

En la nube (o con `EQ_AUTH=required`) todo pide `Authorization: Bearer <token>`: un token de
acceso de una sesión o un token de API (`eqt_…`). Con una sesión, `X-Workspace: <id>` elige el
workspace (si no, el primero); un token de API ya pertenece a uno. En local no hay cuentas: cada
petición actúa como propietario del workspace único.

| Rol | Puede |
|---|---|
| `viewer` | Leerlo todo: proyectos, configuración, corridas, reportes. |
| `editor` | Además, editar proyectos y configuración y lanzar corridas de solo lectura. |
| `admin` | Además, entornos, credenciales, corridas con escrituras, carga y estrés, miembros, invitaciones y tokens de API. |
| `owner` | Además, cambiar roles. Siempre queda al menos un propietario. |

Una ruta sin rol declarado pide `viewer` para leer y `admin` para todo lo demás (falla cerrada).

| Método y ruta | Qué hace |
|---|---|
| `POST /v1/auth/register` | `{ email, password, name, workspace? }`. Con `EQ_REGISTRATION=invite`, solo la primera cuenta. |
| `POST /v1/auth/login` | `{ email, password }`. Devuelve `accessToken`, `refreshToken` y los workspaces; la web recibe el refresco en una cookie `httpOnly`. |
| `POST /v1/auth/refresh` | Rota el token de refresco. Usar uno ya gastado revoca toda la sesión. |
| `POST /v1/auth/logout` | Cierra la sesión. |
| `POST /v1/auth/accept-invitation` | `{ token, password, name? }`: entra al workspace con el rol de la invitación. |
| `GET /v1/auth/me` | La cuenta y sus workspaces. |
| `POST /v1/auth/password` | `{ current, next }`. Cierra las demás sesiones. |
| `POST /v1/auth/workspaces` | Crea otro workspace, del que la cuenta es propietaria. |
| `GET /v1/workspace` | El workspace actual y el rol que se tiene en él. |
| `GET /v1/workspace/members` · `PATCH/DELETE …/members/:user` | Miembros; cambiar rol (owner) o quitar (admin). |
| `GET/POST /v1/workspace/invitations` · `DELETE …/:id` | Invitaciones de un solo uso, nunca con un rol mayor que el de quien invita. |
| `GET/POST /v1/workspace/api-tokens` · `DELETE …/:id` | Tokens para CI con un rol; el token se muestra una vez y se guarda solo su hash. |

Contraseñas con scrypt; tokens de refresco y de API guardados como hash; límite de intentos por
IP y por correo en el registro, el inicio de sesión y las invitaciones (en memoria, por proceso:
con varios procesos, añade el mismo límite en el balanceador). En la nube, el API no lee contratos
ni ejecuta corridas contra direcciones internas (loopback, privadas, link-local, metadatos de la
nube): valida la IP resuelta, sigue a mano como mucho 3 redirecciones y limita tiempo y tamaño.

## Sincronización

Una instalación local se enlaza a un workspace de la nube y comparte con él proyectos, entornos
(sin secretos), versiones del contrato, configuración y corridas terminadas; con una passphrase,
también las credenciales, cifradas de extremo a extremo. El módulo es `modules/sync`: en local
registra el cliente, en la nube el servidor.

- **Cursor de cambios.** Toda escritura de una fila sincronizable toma el siguiente número del
  contador de su workspace (`sync_counters`, `shared/sync-seq.ts`) **dentro de su transacción**:
  en PostgreSQL la fila del contador queda bloqueada hasta el commit, así que los números se
  hacen visibles en orden y "todo lo posterior a N" nunca salta una fila a medio escribir.
- **Pull, luego push.** El dispositivo pide `GET /v1/sync/changes?since=<cursor>` (páginas
  ordenadas por número; una corrida aparece al terminar) y aplica lo que no cambió él mismo. Luego
  envía `POST /v1/sync/changes` con lo que cambió desde el último acuerdo, cada entidad con la
  revisión y el snapshot que ambos tenían (`sync_state`: la base del merge).
- **Merge de tres vías por campo** (`modules/sync/domain/merge.ts`, sin framework): un campo que
  cambió un solo lado toma ese valor; el mismo campo cambiado distinto en los dos lados conserva el
  valor de la nube y queda como **conflicto** (`sync_conflicts`) hasta que alguien elige. La
  configuración de un proyecto cuenta como un campo por sección. Contratos y corridas son
  inmutables: nunca chocan; un mismo contrato subido por dos equipos queda bajo el id del primero
  (`sync_aliases`).
- **Permisos por entidad.** Un push se revisa entidad por entidad con el rol que ese cambio pediría
  en el resto del API; lo rechazado queda pendiente en el dispositivo.
- **Equipos.** El flujo de autorización de dispositivos (RFC 8628, recortado) emite un token
  `kind: device` que actúa como la persona que lo aprobó, con el rol que tenga en cada petición.
- **Secretos E2E (opcional).** scrypt sobre la passphrase con una sal del workspace; AES-256-GCM
  con el workspace, el entorno y el rol como datos asociados; un HMAC como etiqueta para comparar
  sin descifrar. La nube guarda el texto cifrado en `sync_objects` y nunca la clave.

| Método y ruta | Dónde | Qué hace |
|---|---|---|
| `GET /v1/sync` · `PATCH /v1/sync` | local | Estado del enlace; qué sincronizar (`includeRuns`, `projects`, `passphrase`). |
| `POST /v1/sync/link` · `POST /v1/sync/link/check` · `DELETE /v1/sync/link` | local | Enlazar (con `token`, o mostrando un código para aprobar en el navegador), consultar la aprobación, desenlazar. |
| `POST /v1/sync/run` | local | Sincroniza ahora: `{ pulled, pushed, conflicts, rejected }`. |
| `GET /v1/sync/conflicts` · `POST /v1/sync/conflicts/:id/resolve` | ambos | Conflictos abiertos; `{ choice: "mine" \| "theirs" }`. |
| `GET/POST /v1/sync/changes` | nube | El feed de cambios y los pushes de los dispositivos. |
| `GET/PUT /v1/sync/keycheck` | nube | La comprobación de la passphrase del workspace (texto conocido, cifrado por el primer equipo). |
| `POST /v1/auth/device` · `POST /v1/auth/device/token` | nube | El dispositivo pide un código y recoge su token (202 mientras espera, 410 si caducó). |
| `GET /v1/auth/device/:code` · `POST …/approve` · `POST …/deny` | nube | La persona, con sesión, revisa y aprueba (eligiendo workspace) o rechaza. |
| `DELETE /v1/auth/device/self` | nube | Un dispositivo que se desenlaza revoca su propio token. |

## Corridas

```
POST /runs ─▶ StartRun ─▶ RunQueued ─▶ (saga) EnqueueRun ─▶ cola ─▶ RunExecutor
                                                              │  caso a caso, en la base de datos
GET /runs/:id/stream ◀── lee la base de datos ◀───────────────┘
```

- **La corrida vive en el servidor.** El navegador que la lanzó solo observa: cerrarlo no cambia
  nada. El progreso se escribe caso a caso, y el stream lo lee de la base de datos, así que
  cualquier proceso puede servir el stream de una corrida que ejecuta otro.
- **La cola se planifica al empezar**: los casos quedan guardados antes de correr, y una corrida
  reabierta muestra exactamente los que tuvo.
- **Escrituras bloqueadas en el motor**: en un entorno sin `writesAllowed` ningún POST/PUT/PATCH/
  DELETE sale a la red; el caso queda `blocked`, no `failed`.
- **Cancelar es ordenado**: la marca vive en la base de datos y se lee entre casos, de modo que
  un flujo encadenado siempre termina su limpieza.
- **Tras un reinicio** con la cola en memoria, las corridas en espera vuelven a la cola y la que
  estaba ejecutándose queda `interrupted`. Con Redis, otro proceso puede seguir con ella.
- **Credenciales**: AES-256-GCM con el id de la fila como dato asociado; la clave nunca está en la
  base de datos. En local es un archivo del usuario; en la nube, `EQ_SECRETS_KEY`.

## Arquitectura

```
src/modules/<módulo>/
├─ domain/          TypeScript puro: sin Nest, sin TypeORM (lo impone el lint)
├─ application/
│  ├─ commands/     <Nombre>Command + Handler: devuelven un id o un resultado mínimo
│  └─ queries/      <Nombre>Query + Handler: toda lectura pasa por aquí
├─ infrastructure/  repositorios TypeORM y adaptadores (lectura de contratos por HTTP)
└─ presentation/    controllers: validan con zod, resuelven el workspace y despachan (lo impone el lint)
```

- **Inyección explícita.** El código se ejecuta con `tsx` (esbuild), que no emite la metadata de
  tipos de los decoradores: cada dependencia se inyecta con `@Inject(Token)`, y las tablas son
  `EntitySchema`, no clases decoradas.
- **Un handler, una transacción**; los eventos (`modules/shared/events.ts`) se publican después
  del commit, nunca por filas que se revirtieron.
- **Multi-tenant desde la primera migración**: toda fila lleva `workspace_id`; en local hay un
  único workspace implícito.
- **Listo para sincronizar**: ids UUIDv7 generados en el cliente y monótonos, `rev`,
  `updated_at` y borrado lógico en todo lo que se sincroniza.
- **Migraciones, nunca `synchronize`**, escritas con la API neutral de TypeORM para que la misma
  corra en SQLite y en PostgreSQL.

## Pruebas

```bash
pnpm run test:api                                                   # SQLite en memoria (+ BullMQ si hay redis-server)
EQ_TEST_POSTGRES_URL=postgres://user@host:5432/db pnpm run test:api  # además, PostgreSQL
```

Con PostgreSQL cada corrida usa un esquema propio (`eq_test_<pid>_<ts>`) que borra al terminar.
Si `redis-server` está instalado, la prueba de la cola BullMQ levanta uno desechable en un puerto
libre (o usa `EQ_TEST_REDIS_URL`).
Las pruebas levantan la API de ejemplo (`apps/mock-target`) en un puerto efímero, así que no
necesitan red.
