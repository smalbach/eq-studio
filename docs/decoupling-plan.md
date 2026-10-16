# Plan de producto — Endpoint Quality (v2)

Convertir este dashboard, hoy atado a un único cliente, en un producto genérico de verificación
de APIs HTTP: **funcional** (contrato, schema, auth, persistencia, flujos encadenados), **carga** y
**estrés**, configurable para cualquier API, ejecutable **en local** y **en la nube**, con
**sincronización** entre equipos macOS, Windows y Linux.

**Avance**: P0–P8 hechas (motor extraído, cliente eliminado, API NestJS + CQRS, ejecución en el
servidor, web SPA con guías y documentación, CLI `eq` con paquete npm, binarios y CI en tres
sistemas, nube con cuentas, roles, tokens de API, guardas SSRF y Docker, sincronización local ⇄
nube con merge por campo, conflictos visibles, login de dispositivo y secretos E2E opcionales).
P8 cerró con la documentación completa en español e inglés, `eq mock` (la API de ejemplo sin
clonar el repositorio) y la verificación desde cero siguiendo solo la documentación, con `npx` y con
`docker compose`. La E2E de sync corre dos instalaciones y una nube en un mismo proceso, en la
matriz de CI de tres sistemas.

Cambios respecto a la v1 de este documento:

- **Mismo repositorio.** El producto nace aquí; no se crea un repo hermano.
- **Sin rastro del cliente original.** Ningún dato de dominio (contrato, ids, bodies, entornos,
  tokens de gateway, relays) queda en código, tests, docs ni ejemplos. Se sustituye por
  **proyectos de ejemplo** contra APIs públicas o un target simulado incluido.
- **Local-first con sincronización.** Nuevo: modo local con SQLite, sin cuenta, y sincronización
  opcional con un espacio en la nube.
- **Guías integradas.** Nuevo: asistentes paso a paso (steppers) para configurar cada cosa, con
  ejemplos y documentación.

**Criterio de éxito no negociable**: todo lo que el dashboard verifica hoy — schema contra el
OpenAPI vivo, matriz 401/403, persistencia real de escrituras, flujos create→read→delete con
limpieza, orden seguro, presupuestos de latencia con p95, carga y degradación — sigue
funcionando como comportamiento **por defecto** sobre cualquier API. La paridad se demuestra
con un test de golden file (ver §8.5) ejecutado una vez fuera del repo antes de borrar el código
acoplado.

---

## 1. Diagnóstico: dónde está el acoplamiento

| # | Origen | Qué acopla | Destino |
|---|--------|-----------|---------|
| 1 | `lib/contract-operations.ts` | Operaciones de un contrato concreto, compiladas en el bundle por un generador de otro repo | `SpecVersion` + `Operation`: importación OpenAPI en runtime (URL, archivo, pegar) |
| 2 | `lib/endpoints.ts` — `implemented` | Set literal de operationIds | `ImplementationFlag` por proyecto; probe automático (405/501 ⇒ no implementada) |
| 3 | `lib/endpoints.ts` — bodies | Payloads con FKs y claves del seed del cliente | `BodyTemplate` por operación, con `{{variables}}`; generación automática desde el schema como punto de partida |
| 4 | `lib/scenarios.ts` — `values` | Valores de muestra del dominio por parámetro | `ParameterSample` por proyecto; autogenerados desde `example`/`enum`/tipo del schema |
| 5 | `lib/scenarios.ts` — geo | Coordenadas y caso "océano" fijos | Plugin de generación `geo` configurable (centro, radio, punto fuera) |
| 6 | `lib/budgets.mjs` | Umbrales fijos de un documento de requisitos, con `if` por path | `BudgetRule[]` ordenadas: método + path glob + query → umbral |
| 7 | `app/api/run/route.ts` | Envelope `{data}`, health shape, `/openapi.json` fijo | `EnvelopeProfile` (fallback) + `specUrl` por entorno |
| 8 | `lib/environments.mjs`, endpoint de token del gateway, relay TLS | Entornos fijos, un proveedor de token concreto, un relay a una IP | `Environment` + `Credential` genéricos; `oauth2_client_credentials` como tipo de credencial; relay TLS genérico opcional (`insecureTls` por entorno, solo en modo local) |
| 9 | `lib/scenario-runner.ts`, `lib/seed-ids.mjs` | Inferencia de flujos, bulks por clave natural, remapeo de ids del seed | Inferencia REST por defecto + `FlowOverride` (ops create/read/delete, `idPointer`, `naturalKey`) + `SeedDiscovery` genérico |
| 10 | `package.json` scripts | `cd ../../<backend>` en `test:e2e`, `test:auth`, `dev:e2e` | Tests contra el target simulado incluido (`apps/mock-target`) |
| 11 | `lib/glossary*.ts`, textos en `scenarios.ts`, README | Terminología y códigos de decisión del cliente | i18n neutral; documentación propia del producto |
| 12 | `worker/`, `vite.config.ts`, vinext beta, `.openai/hosting.json` | Despliegue Cloudflare Worker | SPA + API Node; misma build para local y nube |

---

## 2. Arquitectura objetivo

```
endpoint-quality-dashboard/            (este repo, renombrado a endpoint-quality al final)
├─ apps/
│  ├─ api/            NestJS 11 + @nestjs/cqrs — mismo código en local y nube
│  ├─ web/            Vite + React 19 + Tailwind 4 (SPA)
│  ├─ cli/            `eq` — arranca el modo local, ejecuta corridas en CI, sincroniza
│  └─ mock-target/    API de ejemplo configurable (para tests, demos y el tutorial)
├─ packages/
│  ├─ runner-core/    Dominio puro: escenarios, plan, presupuestos, validación, carga
│  ├─ spec-import/    OpenAPI 3.0/3.1 → Operation[]
│  ├─ contracts/      DTOs + zod compartidos
│  └─ sync/           Protocolo de sincronización (cliente y servidor)
├─ examples/          Proyectos de ejemplo (JSON) + specs
├─ docs/              Documentación de usuario (también servida dentro de la app)
└─ docker/
```

**Un solo backend, dos modos.** `apps/api` corre igual en la nube y en el equipo del usuario.
Lo que cambia es el adaptador, elegido por `EQ_MODE=local|cloud`:

| Puerto | Local | Nube |
|--------|-------|------|
| Base de datos | SQLite (`~/.endpoint-quality/data.db`) | PostgreSQL |
| Cola | En memoria | BullMQ + Redis |
| Auth | Usuario local implícito, sin login | Email + password, OAuth opcional |
| Secretos | Llavero del SO (Keychain / Credential Manager / libsecret) | AES-256-GCM con `SECRETS_KEY` / KMS |
| Red | Permite `localhost` y redes privadas; `insecureTls` opcional | Guardas SSRF activas |

TypeORM soporta ambos motores; las migraciones se escriben y prueban contra los dos en CI.

`runner-core` no depende de NestJS ni de React: lo usan la API (ejecuta), la web (previsualiza
la cola) y la CLI (corridas en CI).

---

## 3. Modo local y multiplataforma

**Distribución**, de más simple a más cómoda:

1. `npx endpoint-quality` — requiere Node 22. Arranca API + web en `http://localhost:4400` y abre
   el navegador.
2. Binario único por plataforma (Node SEA o `pkg`): `eq-macos-arm64`, `eq-macos-x64`,
   `eq-windows-x64.exe`, `eq-linux-x64`. Sin Node instalado.
3. `docker compose up` — para quien prefiera contenedores.
4. (Post-lanzamiento) App de escritorio con Tauri envolviendo el mismo binario.

CI construye y prueba los tres SO en matriz (GitHub Actions `macos-latest`, `windows-latest`,
`ubuntu-latest`). Reglas para que funcione en Windows: rutas con `path.join`, sin `VAR=x cmd` en
scripts (usar `cross-env` o leer config), sin comillas simples en scripts npm, finales de línea
normalizados con `.gitattributes`.

**Por qué el modo local importa además de "sin cuenta"**: es el único que alcanza `localhost`,
VPNs corporativas y certificados autofirmados. Un backend en la nube no puede probar la API que
el usuario tiene corriendo en su portátil; la CLI local sí.

---

## 4. Sincronización local ⇄ nube

Objetivo: el mismo proyecto (contrato, entornos, configuración, historial de corridas) en el Mac
del trabajo, el Windows de casa y el Linux de CI.

### 4.1 Qué se sincroniza

| Dato | Se sincroniza | Estrategia |
|------|---------------|------------|
| Proyectos, entornos (sin secretos), config, SpecVersions | Sí | Versionado por entidad, merge por campo |
| Corridas funcionales y de carga | Sí | Solo-anexar: nunca hay conflicto |
| Secretos de credenciales | **No por defecto** | Quedan en el llavero local. Opt-in: cifrado de extremo a extremo con una passphrase del espacio; el servidor nunca ve el texto plano |
| Preferencias de UI (tema, idioma) | Sí, por usuario | Último gana |

### 4.2 Protocolo

- Cada entidad sincronizable lleva `id` (UUIDv7, generado en el cliente), `rev` (contador),
  `updatedAt`, `updatedBy`, `deletedAt` (borrado lógico).
- Cada instalación local tiene un `deviceId`. La nube mantiene un **log de cambios** por espacio
  con un cursor monótono.
- `eq sync` (y la app, automáticamente cada N minutos si está enlazada):
  1. **pull** `GET /sync/changes?since=<cursor>` → aplica cambios remotos.
  2. **push** `POST /sync/changes` con los cambios locales desde el último push, cada uno con la
     `rev` base que conocía.
  3. El servidor acepta si `rev` base == `rev` actual; si no, intenta **merge por campo** (dos
     equipos cambiaron campos distintos de la misma regla ⇒ se combinan). Si chocan en el mismo
     campo, guarda ambas versiones y marca un **conflicto** que la UI muestra para resolver.
- Las corridas suben comprimidas y sin cuerpos de respuesta por defecto (configurable).
- Enlazar: `eq login` (device code flow) y `eq link <workspace>`. Se puede trabajar sin conexión
  indefinidamente; la sincronización se pone al día al volver.

### 4.3 Exportar / importar sin nube

`eq export <proyecto> > proyecto.eq.json` y `eq import proyecto.eq.json`. El mismo formato que
los ejemplos de `examples/`. Permite versionar la configuración en Git del propio usuario.

---

## 5. Modelo de dominio

### 5.1 Identidad y acceso (nube)

- **Workspace** (tenant), **User**, **Membership** `(user, workspace, role)` con
  `owner | admin | editor | viewer`, **ApiToken** para CI, **Device** (instalaciones locales
  enlazadas), **RefreshToken** con rotación.

### 5.2 Contrato y configuración

- **Project** — `(workspace, name, slug)`.
- **SpecSource** — `url` (con credencial opcional), `upload`, `inline`.
- **SpecVersion** — snapshot inmutable con hash; una `active` por proyecto.
- **Operation** — operationId, método, path, tag, summary, statuses, parámetros, security, refs.
- **Environment** — `baseUrl`, `specUrl`, `variables`, `writesAllowed`, `insecureTls` (solo local),
  `latencyBudgetsEnforced`.
- **Credential** — `role`: `primary | insufficient | alternate | none`; `kind`:
  `bearer | api_key (header/query) | basic | oauth2_client_credentials | none`. Para
  `oauth2_client_credentials` el motor obtiene y renueva el token solo (sustituye al endpoint
  específico de token que hay hoy).
- **ParameterSample**, **PathDefault**, **BodyTemplate**, **BudgetRule**, **EnvelopeProfile**,
  **FlowOverride**, **ImplementationFlag**, **SeedDiscovery** (cómo encontrar ids existentes
  en el entorno: operación de listado + `idPointer`).
- **ScenarioPlugin** — generadores opcionales activables por operación: `geo`, `pagination`
  (cursor corrupto, límites), `auth-matrix`, `idempotency`.

### 5.3 Ejecución

- **RunPlan**, **Run**, **RunCase**, **RunStep** (funcional).
- **LoadProfile** — tipo (`load | stress | spike | soak`), etapas (VUs/RPS por tiempo), mezcla de
  operaciones, umbrales (p95, tasa de error). **LoadRun** + series temporales + análisis de
  degradación (lo que hoy hacen `lib/load.mjs` y `lib/load-degradation.mjs`).

---

## 6. Backend — NestJS + CQRS

Se mantiene la estructura de la v1: módulos `auth`, `iam`, `projects`, `specs`, `environments`,
`config`, `runs`, `load`, `execution`, `sync`, `reports`, `shared`; cada uno con
`domain / application (commands, queries, events, sagas) / infrastructure / presentation`, y
reglas de capas forzadas con `eslint-plugin-boundaries`.

Comandos nuevos respecto a la v1: `StartLoadRun`, `CancelLoadRun`, `PushChanges`, `PullChanges`,
`ResolveConflict`, `LinkDevice`, `ExportProject`, `ImportProject`, `GenerateConfigFromSpec`
(rellena samples, bodies y paths por defecto a partir del schema).

Superficie REST (`/v1`) igual que en la v1 más:

```
POST /projects/:id/load-runs        GET /load-runs/:id   GET /load-runs/:id/stream (SSE)
GET  /sync/changes?since=           POST /sync/changes   POST /sync/conflicts/:id/resolve
POST /devices/link                  POST /projects/import   GET /projects/:id/export
POST /projects/:id/config/generate
```

Seguridad: SSRF (validar IP resuelta, cap de redirecciones, timeout, tamaño) **solo en modo
nube**; enmascarado de secretos en los steps guardados; `writesAllowed: false` bloquea en el
motor; rate limit; Helmet; CORS por lista.

---

## 7. Frontend, guías y ejemplos

SPA con TanStack Query y SSE. Se reutilizan los componentes actuales (monitor, orden de ejecución,
detalle de corrida, gráficas de carga, comparación, matriz de estabilidad); cambian sus fuentes
de datos.

Rutas: `/` proyectos · `/p/:slug` panel · `/p/:slug/functional` · `/p/:slug/load` ·
`/p/:slug/environments` · `/p/:slug/contract` · `/p/:slug/config` · `/settings` (cuenta,
dispositivos, sincronización) · `/learn` (documentación y ejemplos).

Implementado: la SPA usa una sola ruta con parámetros de consulta (`?vista=funcional`,
`?vista=carga`, `?vista=guia&guia=<id>`, `?vista=aprende&doc=<id>`) y el proyecto abierto se
recuerda en el navegador.

### 7.1 Steppers (asistentes paso a paso)

Cada asistente valida cada paso antes de avanzar, muestra un ejemplo rellenado al lado y enlaza a
la página de documentación correspondiente. Se puede salir y retomar.

1. **Primer proyecto** — nombre → importar contrato (URL / archivo / pegar / usar un ejemplo) →
   resumen de operaciones detectadas → primer entorno (base URL + probar conexión) → credencial →
   "Ejecutar verificación de solo lectura".
2. **Entorno** — base URL, URL del contrato, variables, permitir escrituras (con confirmación),
   TLS no verificado (solo local), presupuestos de latencia sí/no.
3. **Credenciales** — tipo (bearer, API key, basic, OAuth2 client credentials) → valor → rol
   (principal / insuficiente para 403 / alternativa) → probar contra una operación protegida.
4. **Casos funcionales** — generar desde el schema → revisar samples por parámetro (con estado
   esperado por valor) → bodies por operación (editor JSON validado contra el schema del
   request) → flujos encadenados (create→read→delete) → plugins (`geo`, paginación, auth) →
   vista previa de la matriz resultante.
5. **Presupuestos de latencia** — reglas ordenadas con vista previa de qué operación casa con
   qué regla.
6. **Prueba de carga** — elegir tipo (carga, estrés, pico, resistencia) con explicación de
   cuándo usar cada uno → mezcla de operaciones → etapas con gráfico en vivo del perfil →
   umbrales → advertencia si el entorno es compartido.
7. **Sincronización** — iniciar sesión → enlazar dispositivo → elegir qué sincronizar → qué
   pasa con los secretos.

### 7.2 Ejemplos (`examples/`)

Implementado: **`mock-store`** es el ejemplo incluido, cargable desde el stepper 1 y desde
`GET /v1/examples`. Los demás de esta lista quedaron fuera de la primera versión: las guías y la
documentación cubren sus casos (importación por URL, entorno compartido sin seed, OAuth2 client
credentials) con fragmentos.

Plan original — proyectos completos `*.eq.json`, cada uno con su README, cargables desde el stepper 1:

- **`mock-store`** — contra `apps/mock-target` (incluido, sin red). Cubre *todo*: CRUD con flujos,
  bulk, 401/403 con tres credenciales, paginación por cursor, búsqueda geo, presupuestos, y un
  perfil de carga y otro de estrés. Es el ejemplo de referencia y la base de los tests E2E.
- **`petstore`** — Swagger Petstore público: importación por URL y matriz de solo lectura.
- **`jsonplaceholder`** — API pública sin OpenAPI: spec mínima incluida; enseña a escribir
  bodies y overrides de flujo a mano.
- **`oauth2-client-credentials`** — entorno con token automático contra el target simulado.

### 7.3 Documentación (`apps/web/src/content/docs/{es,en}/`, servida en `?vista=aprende`)

Inicio rápido (local, en 5 minutos) · Conceptos (proyecto, entorno, credencial, escenario, flujo,
presupuesto, perfil de carga) · Guía de verificación funcional · Guía de carga y estrés ·
Referencia del formato `.eq.json` (escrita a mano, contrastada con `ProjectFile`) · CLI y CI · Sincronización · Despliegue
en la nube · Solución de problemas (TLS, VPN, 401 vs 403 de un proxy, latencia de red vs servicio).

Todo en español e inglés.

---

## 8. Pruebas

1. **Unitarias puras** (`runner-core`, `spec-import`, `sync`): generación de escenarios,
   percentiles, orden, validación de schema, merge por campo y detección de conflictos.
2. **Handlers** con puertos en memoria.
3. **Integración BD** contra SQLite y PostgreSQL (Testcontainers), aislamiento por workspace.
4. **E2E** con `supertest` contra `apps/mock-target` configurado para responder bien, romper el
   envelope, tardar, devolver 405, etc. Incluye **sync E2E**: dos instancias locales + una nube,
   cambios concurrentes, conflicto, resolución.
5. **Paridad** (una sola vez, fuera del repo): golden file de la matriz actual generado desde el
   commit etiquetado `legacy-final`, comparado con el proyecto migrado cargado como datos. El
   golden file y la config migrada **no se suben al repo** (contienen datos del cliente).
6. **Matriz de SO** en CI: unitarias + E2E local en macOS, Windows y Linux.

---

## 9. Fases

| Fase | Alcance | Aceptación | Est. |
|------|---------|-----------|------|
| **P0 — Extracción** | Monorepo pnpm; `runner-core` parametrizado por `ProjectConfig`; dashboard actual alimentado por una config literal; golden file de paridad generado fuera del repo; etiqueta `legacy-final` | Tests actuales en verde; matriz idéntica al golden | 3 d |
| **P1 — Neutralizar** | `apps/mock-target` + ejemplo `mock-store`; borrar todo dato del cliente (contrato, bodies, entornos, relay, token del gateway, glosario, README, scripts); importación OpenAPI en runtime en el front actual | `grep` de términos del cliente vacío; el dashboard actual corre `mock-store` completo | 3–4 d |
| **P2 — API base** | NestJS + CQRS + TypeORM (SQLite y Postgres); `projects`, `specs`, `environments`, `config`; modo local sin auth | Importar spec, crear entorno, generar config desde schema, por API | 4–5 d |
| **P3 — Motor** | `runs` + `load` en servidor, saga, cola, SSE, secretos en llavero / cifrados | Corridas funcional, carga y estrés contra mock-target desde la API; sobreviven a cerrar el navegador | 5 d |
| **P4 — Web nueva** | SPA con todas las pantallas actuales reconectadas; steppers 1–6; `/learn` | Paridad funcional con la UI actual; un usuario nuevo llega a una corrida verde siguiendo solo el stepper | 6–7 d |
| **P5 — CLI y empaquetado local** | `eq` (serve, run, export/import), binarios por SO, CI en matriz de 3 SO | `npx endpoint-quality` y los binarios arrancan en macOS, Windows, Linux; `eq run` devuelve exit code en CI | 3 d |
| **P6 — Nube y cuentas** | Auth, workspaces, roles, API tokens, guardas SSRF, despliegue Docker | Registro → proyecto → corrida en la nube; RBAC probado por endpoint | 4 d |
| **P7 — Sincronización** | Protocolo §4, device login, conflictos en UI, stepper 7, secretos E2E opt-in | Sync E2E con dos equipos y conflicto resuelto; probado entre macOS y Windows reales | 5–6 d |
| **P8 — Cierre** | Docs completas es/en, ejemplos pulidos, `eq mock` (vinext/worker ya se retiraron en P4; el repositorio no se renombra: `endpoint-quality-dashboard` ya es genérico) | `docker compose up` y `npx` funcionan siguiendo solo la documentación | 2–3 d |

**Total: ~35–40 días de una persona.** Cada fase se entrega como su propio PR.

---

## 10. Decisiones fijadas

1. Mismo repo; el código acoplado se conserva solo en la historia de Git (etiqueta
   `legacy-final`).
2. La spec se importa como snapshot con hash; nunca se enlaza en vivo durante una corrida.
3. El envelope se deriva del schema; `EnvelopeProfile` es fallback.
4. Sin presupuesto no hay aserción de latencia.
5. Escrituras bloqueadas por defecto por entorno.
6. Multi-tenant desde la primera migración de la nube.
7. Local-first: todo funciona sin cuenta; la nube es opcional.
8. Los secretos no salen del equipo salvo opt-in cifrado de extremo a extremo.

## 11. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| La generalización pierde aserciones | Golden file de paridad en P0 como gate antes de borrar en P1 |
| Conflictos de sync mal resueltos pierden configuración | Merge por campo, nunca sobrescritura silenciosa; conflicto visible; historial de `rev` |
| Diferencias SQLite vs Postgres | Migraciones probadas contra ambos en CI |
| Windows (rutas, scripts, llavero) | CI en matriz desde P5; sin sintaxis POSIX en scripts |
| SSRF en la nube | Guardas en P6; auditoría antes de exponer |
| Alcance del front (editores visuales) | Editores JSON validados primero; editores visuales post-lanzamiento |
