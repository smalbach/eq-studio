# CLI y CI

`eq` es la línea de comandos de Endpoint Quality: arranca la app y el API en tu equipo, ejecuta
corridas desde scripts y CI y mueve proyectos como archivos `.eq.json`. `eq --help` lista cada
comando y flag.

## Instalar

Elige una:

- **Con Node 22.13 o superior**, sin instalar nada: `npx endpoint-quality <comando>`.
- **Binario de un solo archivo**, sin Node: descarga `eq-macos-arm64`, `eq-macos-x64`,
  `eq-linux-x64`, `eq-linux-arm64` o `eq-windows-x64.exe` de la release y ejecútalo.
- **Desde el repositorio** (Node 22.18 o superior): `pnpm eq <comando>`.

En esta página, `eq` es cualquiera de las tres formas.

## La app en tu equipo

```bash
eq serve --open
```

La app y el API en `http://127.0.0.1:4400`, con los datos en `~/.endpoint-quality`
(`EQ_DATA_DIR` para cambiarlo). `--port` o `EQ_PORT` cambian el puerto; `--host` o `EQ_HOST`, la
interfaz. Por defecto solo escucha en tu equipo.

> **No expongas el modo local.** Con `--host 0.0.0.0` cualquiera en tu red llega a un API sin
> cuentas ni guardas SSRF: ve tus proyectos, lanza corridas con tus credenciales y alcanza
> direcciones internas. `eq serve` lo avisa al arrancar. Para un equipo, usa el
> [despliegue en la nube](doc:deploy).

## La API de ejemplo

```bash
eq mock
```

La tienda ficticia del proyecto **Mock Store**: sin autenticación en `http://127.0.0.1:4010` y
exigiendo credenciales en `:4011` (`Bearer admin-token`; `Bearer read-token` para los 403;
`X-API-Key: demo-key`). `--port` cambia el primero; el segundo es el siguiente. Reiniciarlo deja
los datos como el seed del ejemplo.

El de `:4011` acepta también los otros tipos de credencial, para probarlos sin un servidor real
(con permisos de administración; los valores entre paréntesis son de solo lectura, para los 403):

- **Cookie por login**: `POST /auth/login` con `{"username":"admin","password":"admin-password"}`
  (`reader` / `read-password`) responde un `Set-Cookie: eq_session=…`.
- **Cookie pegada**: `eq_session=admin-session` (`read-session`).
- **HMAC**: `X-Key-Id: demo-hmac` con la clave `hmac-secret` (`read-hmac` / `hmac-read-secret`), la
  plantilla por defecto en sha256 hex y una hora a ±5 minutos.
- **mTLS**: `node apps/mock-target/server.mjs --port 4011 --auth --tls-cert server.crt --tls-key server.key --tls-ca ca.crt`
  sirve HTTPS y acepta como administrador un certificado de cliente firmado por esa CA.

## Corridas en CI

Lo más simple en un pipeline es correr **desde el archivo del proyecto**: `eq` levanta un API
solo para esa corrida, en memoria, y lo apaga al terminar. No hace falta servidor.

```bash
eq run --file store-api.eq.json --env staging \
  --base-url "$STAGING_URL" --token "$STAGING_TOKEN" \
  --junit eq-report.xml
```

- `--base-url` sustituye la URL del entorno: el mismo archivo sirve para cada rama o despliegue.
- Las credenciales llegan por flags o variables (`EQ_TOKEN`, `EQ_READ_TOKEN`, `EQ_API_KEY`,
  `EQ_COOKIE`, `EQ_HMAC_KEY`, `EQ_CLIENT_KEY_PASSPHRASE`), nunca desde el archivo: el `.eq.json`
  se versiona sin secretos.
- `--junit` escribe un reporte JUnit XML, `--html` una página autocontenida para compartir y
  `--sarif` un archivo SARIF para el escaneo de código (ver "Informes para compartir" más abajo).
  `--json` guarda la corrida completa.

| Opción | Qué hace |
|---|---|
| `-f, --file <archivo>` | Corre desde un `.eq.json`, sin servidor. |
| `-e, --env <entorno>` | El entorno, por id o por nombre (por defecto, el primero). |
| `--base-url <url>` | Sustituye la URL base del entorno. |
| `--read-only` | Solo las operaciones GET. |
| `--endpoints a,b` | Solo esas operaciones (por id). |
| `--auth` · `--no-auth` | Corre (o no) los casos 401/403, diga lo que diga el entorno. |
| `--token T` | Credencial `primary`, bearer (o `EQ_TOKEN`). |
| `--read-token T` | Credencial `insufficient`, bearer, para los 403 (o `EQ_READ_TOKEN`). |
| `--api-key K` · `--api-key-header H` | Credencial `alternate`, API key (o `EQ_API_KEY`), y su cabecera. |
| `--cookie NOMBRE=VALOR` | Credencial `primary` como cookie de sesión pegada (o `EQ_COOKIE`). En lugar de `--token`. |
| `--hmac-key K` · `--hmac-key-id ID` | Credencial `primary` como clave HMAC, con la firma por defecto (o `EQ_HMAC_KEY`). En lugar de `--token`. |
| `--client-cert ARCHIVO --client-key ARCHIVO` | Certificado de cliente (mTLS) PEM en la credencial `primary`: solo, o sumado a `--token`, `--cookie` o `--hmac-key`. |
| `--client-key-passphrase P` · `--client-ca ARCHIVO` | La frase de la clave (o `EQ_CLIENT_KEY_PASSPHRASE`) y la CA PEM con la que confiar en el servidor. |
| `--samples N` · `--delay MS` | Muestras por caso y pausa entre casos. |
| `--locale es\|en` | Idioma de los nombres de los casos (por defecto `en`). |
| `--scope "nombre"` | Un nombre para la corrida en el historial y en el reporte. |
| `--junit archivo.xml` · `--json archivo.json` | Reportes. |
| `--html informe.html` · `--sarif informe.sarif` | Informes para compartir: una página HTML, SARIF 2.1.0. Combinables con `--junit`. |
| `--contract <archivo>` | El archivo del contrato al que apuntan los resultados SARIF (por defecto, el de `--file`). |
| `--format text\|json` · `-q, --quiet` | Qué se imprime: texto (por defecto), JSON o nada. |
| `--fail-on-blocked` | Sale con `1` si el entorno bloqueó escrituras. |

### Archivo o servidor

- **En CI, `--file`**: el `.eq.json` versionado es la única entrada; nada que instalar ni mantener
  corriendo, y nada queda guardado.
- **Contra un API que ya corre** (el de tu equipo o uno compartido), nombra el proyecto: la corrida
  queda en su historial y se ve en la app.

```bash
eq run store-api --env staging --api http://eq.internal:4400
```

Si ese API es un [despliegue en la nube](doc:deploy), añade un token de API: `--api-token` o
`EQ_API_TOKEN` (y `--workspace` / `EQ_WORKSPACE` solo con un token de sesión). `--api` también se
lee de `EQ_API_URL`.

### Códigos de salida

| Código | Significa |
|---|---|
| `0` | Todos los casos pasaron |
| `1` | Algún caso falló (o hubo escrituras bloqueadas, con `--fail-on-blocked`); en `eq diff`, algún cambio rompe |
| `2` | El comando estaba mal: un flag, un proyecto o un entorno que no existe |
| `3` | No se pudo correr: el API no responde, o la corrida terminó en error |

### Ejemplo: GitHub Actions

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 22 }
- run: >-
    npx endpoint-quality run --file store-api.eq.json --env staging --base-url ${{ vars.STAGING_URL }}
    --junit eq-report.xml --html eq-report.html --sarif eq-report.sarif --contract openapi.yaml
  env:
    EQ_TOKEN: ${{ secrets.STAGING_TOKEN }}
# Los casos fallidos como alertas de code scanning, junto al contrato (necesita `security-events: write`).
- uses: github/codeql-action/upload-sarif@v3
  if: always()
  with:
    sarif_file: eq-report.sarif
    category: endpoint-quality
# La página HTML y el JUnit, adjuntos a la ejecución del workflow.
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: eq-report
    path: |
      eq-report.html
      eq-report.xml
```

El job necesita `permissions: { contents: read, security-events: write }` para subir el SARIF.

### Otras CI

El reporte es JUnit XML estándar: cada operación es una suite y cada caso un test. Las escrituras
bloqueadas salen como `skipped`.

GitLab (`EQ_TOKEN` como variable de CI/CD protegida):

```yaml
eq:
  image: node:22
  script:
    - npx endpoint-quality run --file store-api.eq.json --env staging --base-url "$STAGING_URL" --junit eq-report.xml
  artifacts:
    when: always
    reports:
      junit: eq-report.xml
```

Jenkins:

```groovy
sh 'npx endpoint-quality run --file store-api.eq.json --env staging --junit eq-report.xml'
// en post { always { … } }
junit 'eq-report.xml'
```

Azure DevOps:

```yaml
- script: npx endpoint-quality run --file store-api.eq.json --env staging --junit eq-report.xml
- task: PublishTestResults@2
  condition: always()
  inputs: { testResultsFormat: JUnit, testResultsFiles: eq-report.xml }
```

## Informes para compartir

Una corrida terminada se puede escribir como tres tipos de archivo, desde la CLI o desde la app:

- **HTML** (`--html informe.html`): una sola página autocontenida — estilos y el pequeño script
  en línea, ninguna petición a ningún sitio, clara u oscura según el sistema de quien la lee,
  imprimible. Primero el resumen (veredicto, totales, duraciones, entorno, versión del contrato),
  luego los fallos con cada solicitud, respuesta y aserción, y al final una tabla filtrable con
  todos los casos. Una prueba de carga muestra sus percentiles y los criterios de su veredicto.
- **SARIF 2.1.0** (`--sarif informe.sarif`): cada caso fallido es un resultado cuya regla es el
  tipo de escenario (`not-found`, `auth-none`, `create-read`…), con nivel `error` —`warning`
  cuando solo falló el presupuesto de latencia—, ubicado en la operación (`GET /orders/{id}`).
  Si se conoce el archivo del contrato (`--file`, o `--contract openapi.yaml`), el resultado
  apunta además a la línea que declara la operación, y GitHub muestra la alerta junto al
  contrato. Los casos bloqueados no son resultados.
- **JUnit XML** (`--junit informe.xml`): ver arriba.

Los secretos nunca llegan a un informe: los tokens que recibió la corrida, los miembros con
nombre de credencial (`authorization`, `token`, `password`…), los valores `Bearer`/`Basic` y los
parámetros de query con pinta de credencial se enmascaran como `••••••••`.

Una corrida guardada se puede volver a generar con `eq report`:

```bash
# Una corrida guardada con --json: sin servidor.
eq report run.json --format html -o informe.html
# Una corrida de un API, por su id.
eq report 01a144b9-f552-7092-9e12-ec62710a18f2 --format sarif -o informe.sarif --api http://eq.internal:4400
```

`--format` es `html` (por defecto), `sarif` o `junit`; sin `-o` se imprime por la salida estándar.
El API responde lo mismo en `GET /v1/runs/{id}/report?format=html|sarif|junit`, y en la app la
vista de la corrida tiene un menú **Descargar informe**.

## Pruebas de carga

```bash
eq load --file store-api.eq.json --env staging --type stress --rps 10 --peak 100 --duration 120 --p95 800
```

`--type` es `load`, `stress`, `spike` o `soak`; `--mix` elige una mezcla del proyecto; `--p95` fija
un límite propio (o `--no-latency` para no exigir latencia); `--preflight stop|skip|ignore` decide
qué hacer con un objetivo que falla la verificación previa (por defecto `skip`). Sale con `1` si el
veredicto falla. `--junit`, `--html`, `--sarif`, `--json` y `--format` funcionan igual que en
`eq run` (SARIF trae un resultado por criterio fallido): el JUnit trae un
test por criterio del veredicto. Contra un entorno compartido, coordínalo con el equipo.

Como compuerta en CI, una prueba corta a la tasa esperada con un p95 propio:

```bash
eq load --file store-api.eq.json --env staging --base-url "$STAGING_URL" \
  --type load --rps 20 --duration 60 --p95 500 --junit eq-load.xml
```

## Cambios del contrato

`eq diff` compara dos contratos OpenAPI 3 (archivos o URLs http(s), JSON o YAML) y lista qué
cambió por operación, marcando lo que rompe a los clientes del anterior. Sale con `1` si hay algún
cambio que rompe: un paso de CI que frena un cambio de contrato antes de publicarlo.

```bash
eq diff https://api.example.com/openapi.json openapi.yaml
```

```text
GET /v1/products (listProducts)
  ✖ breaking  response 200: field $.data[].price removed
POST /v1/products (createProduct)
  ✖ breaking  request: required field $.currency added
  · change    query.dry_run: optional parameter added
2 breaking · 1 non-breaking
```

`--json` imprime los cambios y sus conteos como JSON; `--locale es` describe los cambios en
español. Qué cuenta como cambio que rompe está en [Conceptos](doc:conceptos).

En GitHub Actions, contra el contrato de la rama principal (`actions/checkout` con `fetch-depth: 0`):

```yaml
- run: git show origin/main:openapi.yaml > /tmp/openapi-main.yaml
- run: npx endpoint-quality diff /tmp/openapi-main.yaml openapi.yaml
```

## Proyectos como archivos

```bash
eq projects                                  # los proyectos del API
eq export store-api -o store-api.eq.json     # el proyecto como archivo
eq import store-api.eq.json                  # un archivo como proyecto nuevo
```

`eq import` también crea un proyecto desde un contrato: OpenAPI 3.0/3.1 o Swagger 2.0 (se
convierte a OpenAPI 3), en JSON o YAML, o una colección de Postman v2.1 (se genera un OpenAPI 3
con schemas inferidos de sus ejemplos). El primer entorno toma la URL base del contrato,
`--base-url`, o la que da a `{{baseUrl}}` un entorno de Postman pasado con `--env`:

```bash
eq import petstore-swagger.yaml --name "Petstore"
eq import store.postman_collection.json --env staging.postman_environment.json
```

Estos comandos hablan con el API de `--api` (por defecto el local, así que `eq serve` debe estar
corriendo). Versiona el `.eq.json` junto al código de tu API: los cambios de configuración se
revisan en el mismo pull request que los cambios del contrato.

## Tu propia API, del contrato a la CI

**1. Crea el proyecto desde el contrato.** Con `eq serve --open`, la guía
[Nuevo proyecto](guide:first-project) → **URL de OpenAPI** (`https://tu-api/openapi.json`). O por
el API:

```bash
curl -s -X POST http://127.0.0.1:4400/v1/projects -H 'content-type: application/json' \
  -d '{"name":"Store API","spec":{"url":"https://staging.example.com/openapi.json"},
       "environments":[{"name":"Staging","baseUrl":"https://staging.example.com"}]}'
```

**2. Revisa la configuración generada**: los bodies (claves naturales que no choquen con datos
reales), los presupuestos de latencia y qué permite cada entorno. Lanza una verificación de solo
lectura desde la app hasta que salga como esperas.

**3. Expórtalo y versiónalo** junto al código de la API, sin secretos:

```bash
eq export store-api -o store-api.eq.json
```

**4. Córrelo en CI**:

```bash
eq run --file store-api.eq.json --env staging --base-url "$URL" --token "$TOKEN" --junit eq-report.xml
```

Cuando cambie el contrato, importa la nueva versión en la app (o `POST …/spec-versions`), ajusta y
vuelve a exportar.

## Sincronización

`eq login <url>`, `eq sync` y `eq logout` enlazan esta instalación con un workspace de la nube. Ver
[Sincronización](doc:sync).
