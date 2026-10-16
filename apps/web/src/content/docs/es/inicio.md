# Inicio rápido

En cinco minutos tendrás la app corriendo en tu equipo, el proyecto de ejemplo importado y su matriz de verificación ejecutada contra la API de ejemplo incluida. No hace falta cuenta ni conexión a internet (salvo para descargar el paquete la primera vez).

## Requisitos

- **Sin clonar el repositorio**: Node.js **22.13** o superior para `npx`, o nada con el binario de un solo archivo (ver [CLI y CI](doc:cli)).
- **Desde el repositorio**: Node.js **22.18** o superior y **pnpm** (`npm install -g pnpm`, o `corepack enable pnpm`).

## Sin clonar el repositorio

En una terminal, la app y el API:

```bash
npx endpoint-quality serve --open
```

En otra terminal, la API de ejemplo:

```bash
npx endpoint-quality mock
```

| Proceso | Dirección | Qué es |
| --- | --- | --- |
| `serve` | `http://127.0.0.1:4400` | La app y el API de Endpoint Quality: guarda los proyectos y ejecuta las corridas. |
| `mock` | `http://127.0.0.1:4010` | La API de ejemplo: una tienda ficticia, sin autenticación. |
| `mock` | `http://127.0.0.1:4011` | La misma API exigiendo credenciales (casos 401/403). |

Sigue en [Importar el ejemplo](#importar-el-ejemplo).

## Desde el repositorio

Desde la raíz del repositorio:

```bash
pnpm install
pnpm run dev
```

Arranca cuatro procesos a la vez:

| Proceso | Dirección | Qué es |
| --- | --- | --- |
| `api` | `http://127.0.0.1:4400` | El API de Endpoint Quality: guarda los proyectos y ejecuta las corridas. |
| `web` | La que imprime Vite (por defecto `http://localhost:3000`) | Esta app. |
| `mock` | `http://127.0.0.1:4010` | La API de ejemplo: una tienda ficticia, sin autenticación. |
| `mock-auth` | `http://127.0.0.1:4011` | La misma API exigiendo credenciales (casos 401/403). |

> Si solo quieres la API de ejemplo, `pnpm run mock` (puerto 4010) o `pnpm run mock:auth` (puerto 4011) la arrancan sola; `pnpm eq mock` arranca las dos.

En los dos casos los proyectos se guardan en `~/.endpoint-quality/data.sqlite`. Las credenciales se guardan cifradas con una clave que vive en `~/.endpoint-quality/secret.key`, nunca en la base de datos.

## Importar el ejemplo

Abre la app en el navegador. Sin proyectos, la app abre directamente la guía [Nuevo proyecto](guide:first-project):

1. Escribe un nombre o deja el del ejemplo.
2. En **Contrato**, elige **Usar un ejemplo → Mock Store**. Trae su contrato, su configuración completa y dos entornos: `Local` (puerto 4010) y `Local (auth)` (puerto 4011).
3. Revisa el resumen de operaciones detectadas.
4. Elige el entorno `Local` y pulsa **Probar conexión**.
5. Salta la credencial: el mock del puerto 4010 no la pide.

## Ejecutar la matriz

El último paso de la guía lanza una **verificación de solo lectura**: todos los casos de las operaciones GET, sin escribir nada. Al terminar verás cuántos casos pasaron, fallaron o quedaron bloqueados.

Después, en **Verificación funcional → Nueva ejecución**, puedes correr la matriz completa con las escrituras. El entorno `Local` las permite porque el mock arranca siempre desde el mismo seed: reiniciarlo deja los datos como estaban.

## Con autenticación

El entorno `Local (auth)` apunta al mock del puerto 4011, que exige credenciales y genera los casos 401/403. Configura sus tres credenciales en la guía [Credenciales](guide:credentials):

| Rol | Tipo | Valor |
| --- | --- | --- |
| `primary` | Bearer | `admin-token` (puede todo) |
| `insufficient` | Bearer | `read-token` (solo GET: las escrituras responden 403) |
| `alternate` | API key en `X-API-Key` | `demo-key` (todo menos DELETE, que responde 401) |

Son valores de prueba del mock, no secretos reales. El mock acepta también una cookie de sesión, una firma HMAC y un certificado de cliente para probar esos tipos: los valores están en [CLI y CI](doc:cli).

## Sin modo desarrollo

```bash
pnpm start
```

Compila la app y la sirve desde el propio API en `http://127.0.0.1:4400`: un solo proceso y un solo puerto. Arranca el mock por separado si lo necesitas (`pnpm eq mock`).

## Varios proyectos

Cada proyecto es una API: su contrato, sus entornos, credenciales y corridas. Puedes tener todos los que quieras en la misma instalación. La pantalla de inicio, **Proyectos**, los lista con un buscador y un orden (recientes o por nombre).

1. **Proyectos → Nuevo proyecto** abre la guía desde cero. **Proyectos → Importar** crea uno de una vez desde un contrato —OpenAPI 3.0/3.1, Swagger 2.0 o una colección de Postman— (URL, archivo o pegado) o un `.eq.json`. Ver [formatos aceptados](doc:conceptos).
2. El proyecto nuevo se abre en su **Panel**: contrato, última corrida funcional y última prueba de carga.
3. Para cambiar, vuelve a **Proyectos** (primera entrada del menú, o **Proyecto → Cambiar de proyecto** en el encabezado) y pulsa **Entrar** en otro.

**Panel**, **Verificación funcional** y **Carga y estrés** trabajan sobre el proyecto abierto, y su dirección lo nombra (`?vista=panel&proyecto=store-api`): un enlace compartido abre el mismo proyecto.

Desde la terminal, `eq projects` lista los proyectos y `eq import otro.eq.json` añade uno.

## Siguientes pasos

- [Conceptos](doc:conceptos): el vocabulario que usa toda la app.
- Tu propia API: vuelve a la guía [Nuevo proyecto](guide:first-project) y elige **URL de OpenAPI** o **Archivo**. El camino completo, del contrato a la CI, está en [CLI y CI](doc:cli).
- [Verificación funcional](doc:funcional) y [Carga y estrés](doc:carga), cuando quieras entender qué se prueba y por qué.
