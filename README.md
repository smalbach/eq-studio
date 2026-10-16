# Endpoint Quality

Verificación de cualquier API HTTP contra su contrato OpenAPI: **funcional** (status, schema,
autenticación, persistencia real de lo escrito, flujos encadenados que limpian lo que crean),
**carga**, **estrés**, **pico** y **resistencia**.

Un 200 no es un test que pasa. Cada respuesta se valida contra el schema que el propio documento
OpenAPI declara para esa operación y ese status; cada escritura se vuelve a leer para comprobar
que persistió; cada operación protegida recibe sus casos 401 y 403; y el orden de ejecución
corre las lecturas primero y los DELETE al final, para que un borrado roto no contagie de rojo al
resto de la matriz.

> Listo para usar: en local (web + API), como app de escritorio para macOS, Windows y Linux,
> desde la CLI `eq` (paquete npm y binarios para macOS, Windows y Linux), desplegado en la nube con cuentas, roles y tokens de API, y sincronizado entre
> equipos a través de la nube. El [plan de producto](docs/decoupling-plan.md) cuenta cómo se llegó
> aquí.

## Inicio rápido

Sin clonar el repositorio (Node 22.13+; los binarios no necesitan nada):

```bash
npx endpoint-quality serve --open     # la app y el API en http://127.0.0.1:4400
npx endpoint-quality mock             # en otra terminal: la API de ejemplo en :4010 y :4011
```

Desde el repositorio (Node 22.18+ y pnpm):

```bash
pnpm install
pnpm run dev
```

Abre `http://localhost:3000`. `dev` levanta el API (`:4400`, con su base SQLite en
`~/.endpoint-quality/`), la web con recarga en caliente y la **API de ejemplo** incluida
(`apps/mock-target`) en `:4010` y, con autenticación, en `:4011`. Sin proyectos, la app abre la
guía del primer proyecto: elige el ejemplo **Mock Store** y en un par de pasos tendrás una corrida
en verde.

Para usarlo sin modo desarrollo, en un solo proceso y un solo puerto:

```bash
pnpm start            # compila la web y la sirve desde el API en http://127.0.0.1:4400
pnpm eq mock          # la API de ejemplo, si la necesitas
```

El entorno `Local (auth)` del ejemplo (`:4011`) exige credenciales: `Bearer admin-token`
(principal), `Bearer read-token` (permisos insuficientes) y `X-API-Key: demo-key` (alternativa).

## App de escritorio

La misma app en una ventana propia, sin terminal ni Node: instaladores para macOS (`.dmg`),
Windows (`.exe`) y Linux (`.AppImage`, `.deb`) en cada release. Usa los mismos datos que `eq`
(`~/.endpoint-quality`). Desde el repositorio:

```bash
pnpm desktop          # compila y abre la app
pnpm desktop:dist     # el instalador de este sistema en apps/desktop/release
```

Detalles en [`apps/desktop`](apps/desktop/README.md).

## CLI y CI

```bash
npx endpoint-quality serve --open                                  # la app, sin clonar el repo
npx endpoint-quality run --file proyecto.eq.json --env staging \
  --base-url "$URL" --token "$TOKEN" --junit eq-report.xml          # en CI, sin servidor
```

El `.eq.json` sale de **Exportar** en la app o de `eq export <proyecto> -o archivo.eq.json`.
`eq run` sale con `0` si todo pasó, `1` si algún caso falló, `2` si el comando estaba mal y `3` si
no pudo correr. Hay binarios de un solo archivo (sin Node) para macOS, Windows y Linux en cada
release. Detalles en [`apps/cli`](apps/cli/README.md) y en la documentación de la app (CLI y CI).

## En la nube, para un equipo

```bash
cp docker/.env.example docker/.env        # y pon EQ_SECRETS_KEY y EQ_JWT_SECRET
docker compose -f docker/compose.yml --env-file docker/.env up -d
```

El mismo API en modo `cloud`, sobre PostgreSQL y Redis, con la web incluida en `:4400`. La primera
cuenta queda como propietaria; el resto entra por invitación con un rol (lector, editor,
administrador, propietario). La CI usa tokens de API (`eq run … --api https://… --api-token …`).
En la nube el API no alcanza direcciones internas (guardas SSRF). Detalles en la documentación de
la app (Despliegue en la nube) y en [`apps/api`](apps/api/README.md#cuentas-y-roles).

## Varios equipos, un proyecto

Cada instalación local se puede enlazar a un workspace de la nube y sincronizar con él:

```bash
eq login https://eq.example.com    # aprueba el código en el navegador
eq sync                            # trae y envía; sola cada 5 min mientras "eq serve" corre
```

Se sincronizan proyectos, entornos, configuración, versiones del contrato y corridas, con merge
por campo: dos equipos que cambian campos distintos se combinan, y el mismo campo cambiado de
dos formas queda como conflicto visible en Ajustes, nunca se sobrescribe. Los secretos se quedan
en cada equipo salvo que actives una passphrase: entonces viajan cifrados de extremo a extremo.
También desde la app: **Ajustes → Sincronización**. Detalles en la documentación (Sincronización).

## Probar tu propia API

1. En **Proyectos** (la pantalla de inicio) pulsa **Nuevo proyecto** para la guía paso a paso,
   o **Importar** para hacerlo de una vez.
2. Importa el contrato: la URL de su documento OpenAPI 3 (`https://tu-api/openapi.json`), un
   archivo `.json`/`.yaml`, o pégalo. Indica la URL base si el documento no declara `servers`.
   El proyecto se abre en su panel; vuelve a **Proyectos** para cambiar a otro.
3. Se genera un proyecto: operaciones, casos por operación, bodies de ejemplo a partir de los
   schemas, valores de prueba por parámetro y de dónde leer ids existentes. Revísalo con
   **Proyecto** (en la cabecera) → **Editar configuración** — sobre todo los bodies (claves naturales que no choquen con datos
   existentes) y los presupuestos de latencia, que nunca se inventan.
4. En **Entorno** elige o escribe la URL base y decide qué permite: si tiene la semilla del
   proyecto, si admite escrituras, si se exigen presupuestos de latencia y si la API exige
   autenticación (activa los casos 401/403). Las credenciales del entorno (principal, de
   permisos insuficientes y alternativa) se guardan cifradas en el API.
5. Empieza por **Matriz GET**. La matriz completa escribe y borra datos.

Cada proyecto se puede exportar como `.eq.json` e importar en otro equipo o navegador.

## Configuración de un proyecto

Un proyecto es un archivo `.eq.json` (`ProjectFile` en
[`packages/runner-core/src/types.ts`](packages/runner-core/src/types.ts)): el contrato, cómo se
generan y ejecutan sus casos, los entornos donde corre y su perfil de carga. Nada de esto vive en
el código.

La guía sección por sección, con el ejemplo completo, está en
[`examples/mock-store/README.md`](examples/mock-store/README.md): `bodies`, `parameterSamples`,
`operationScenarios` y `extraScenarios`, `plugins` (geo, paginación), `auth`, `budgets`,
`envelope`, `bulk`, `seed`, `environments` y `load`.

## Qué se guarda y dónde

- **En el API** (SQLite local en `~/.endpoint-quality`, `EQ_DATA_DIR` para cambiarlo con `eq`; o
  PostgreSQL en la nube): proyectos, versiones del contrato,
  entornos, configuración, credenciales **cifradas** y el historial de corridas funcionales y de
  carga. Otra pestaña, otro navegador o un script ven lo mismo.
- **En este navegador**: solo preferencias de la interfaz — idioma, tema, el proyecto y entorno
  abiertos, el orden y la selección del banco de trabajo, delay y muestras.

Las corridas se ejecutan en el servidor: cerrar la pestaña no las detiene.

## Pantallas

| URL | Pantalla |
|---|---|
| `/` | Proyectos: buscar, entrar en uno, crear (guía o importación rápida) o eliminar. |
| `?vista=panel&proyecto=<slug>` | Panel de control del proyecto: contrato, última corrida funcional y última prueba de carga. |
| `?vista=funcional&proyecto=<slug>` | Corridas funcionales guardadas; **Nueva ejecución** abre el banco de verificación. |
| `?vista=funcional&pagina=nueva&proyecto=<slug>` | Matriz GET, matriz completa, selección o un endpoint con sus casos. |
| `?vista=carga&proyecto=<slug>` | Pruebas de carga guardadas y configuración de una nueva. |
| `?vista=guia&guia=<id>` | Guías paso a paso: nuevo proyecto, entorno, credenciales, casos funcionales, presupuestos, carga, sincronización. |
| `?vista=aprende&doc=<id>` | Documentación integrada, en español e inglés. |

## Código

- `packages/runner-core/` — el motor, sin framework: generación de escenarios, orden de
  ejecución, presupuestos, validación de schema, flujos encadenados, ejecución de un caso,
  importación OpenAPI, archivos de proyecto y el motor de carga.
- `apps/api/` — el backend (NestJS + CQRS, SQLite o PostgreSQL); ver su README.
- `apps/web/` — la web: SPA de Vite + React que habla con el API (React Query, SSE).
- `apps/cli/` — `eq`: el paquete npm `endpoint-quality` (CLI + API + web en un archivo) y los
  binarios de un solo ejecutable.
- `apps/desktop/` — la app de escritorio (Electron): el API local y la web en una ventana.
- `apps/mock-target/` — la API de ejemplo, sin dependencias.
- `examples/` — proyectos de ejemplo.
- `tests/` — la matriz completa del ejemplo contra la API de ejemplo.

## Pruebas

```bash
pnpm test           # motor + web + E2E contra la API de ejemplo + backend + CLI
pnpm run test:core  # solo el motor
pnpm run test:e2e   # la matriz completa de Mock Store contra apps/mock-target, con y sin auth
pnpm run test:api   # el backend sobre SQLite (y PostgreSQL con EQ_TEST_POSTGRES_URL)
pnpm run test:cli   # la CLI como la usa un pipeline: códigos de salida, JUnit, modo remoto
pnpm run bundle     # apps/cli/dist: el paquete npm
pnpm run binary     # apps/cli/build: el ejecutable de este sistema operativo
pnpm desktop:dist   # apps/desktop/release: el instalador de escritorio de este sistema
```

---

## English

Endpoint Quality verifies any HTTP API against its OpenAPI contract: **functional** checks
(status, schema, auth, persistence of what was written, chained flows that clean up after
themselves) and **load**, **stress**, **spike** and **soak** tests. It is ready to use locally, as a
desktop app for macOS, Windows and Linux ([`apps/desktop`](apps/desktop/README.md)), from the `eq`
command line, deployed in the cloud for a team, and synced between machines.

### Quick start

Without cloning (Node 22.13+; the single-file binaries need nothing):

```bash
npx endpoint-quality serve --open     # the app and the API on http://127.0.0.1:4400
npx endpoint-quality mock             # in another terminal: the example API on :4010 and :4011
```

From the repository (Node 22.18+ and pnpm): `pnpm install && pnpm run dev`, then open
`http://localhost:3000`. With no projects, the app opens the new-project guide: pick the
**Mock Store** example and run its matrix. Its `Local (auth)` environment takes `Bearer admin-token`,
`Bearer read-token` and `X-API-Key: demo-key`.

To test your own API, go to **Projects** (the home screen) and choose **New project** (the guide)
or **Import** (OpenAPI document by URL, file or pasted, or an `.eq.json`). The new project opens on
its dashboard; review the generated configuration under **Project → Edit configuration** in the
header and pick an environment. Go back to **Projects** to switch to another one. The format is documented
in [`examples/mock-store/README.md`](examples/mock-store/README.md) and in the in-app docs.

### CLI and CI

```bash
npx endpoint-quality run --file project.eq.json --env staging \
  --base-url "$URL" --token "$TOKEN" --junit eq-report.xml        # no server needed
```

The `.eq.json` comes from **Export** in the app or `eq export <project> -o file.eq.json`. Exit codes:
`0` passed, `1` cases failed, `2` wrong command, project or environment, `3` could not run.
`eq load` runs load, stress, spike and soak tests the same way. See [`apps/cli`](apps/cli/README.md).

### In the cloud, for a team

```bash
cp docker/.env.example docker/.env        # then set EQ_SECRETS_KEY and EQ_JWT_SECRET
docker compose -f docker/compose.yml --env-file docker/.env up -d
```

PostgreSQL, Redis, accounts, roles and API tokens for CI (`eq run … --api https://… --api-token …`),
with SSRF guards. See the in-app docs (Cloud deployment) and [`apps/api`](apps/api/README.md).

### Several machines, one project

`eq login <url>` and `eq sync` (or Settings → Sync) link a local installation to a cloud workspace:
field-by-field merges, visible conflicts, and secrets that stay on each machine unless a passphrase
encrypts them end to end.

### Where data lives

Locally in `~/.endpoint-quality` (`EQ_DATA_DIR` to change it): a SQLite database and the key that
encrypts credentials. In the cloud, in PostgreSQL. The browser only keeps interface preferences.
