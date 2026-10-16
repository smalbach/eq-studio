# Conceptos

El vocabulario de Endpoint Quality, de lo más general a lo más concreto.

## Proyecto

Una API que quieres verificar. Guarda su contrato, su configuración (qué probar y cómo) y sus entornos. Se exporta como un archivo `.eq.json` que puedes versionar en Git o importar en otro equipo. Ver [Formato .eq.json](doc:formato).

## Contrato y versión del contrato

El contrato de la API: un documento **OpenAPI 3**, o uno que se convierte a OpenAPI 3 al importarlo (Swagger 2.0, una colección de Postman). Al importarlo se guarda una **versión**: una copia inmutable identificada por su hash. Importar el mismo contenido dos veces da la misma versión; importar uno nuevo crea otra y la activa. Las corridas usan siempre la versión activa, nunca un documento que cambie a mitad de camino.

### Formatos aceptados

| Formato | Qué se hace con él |
| --- | --- |
| **OpenAPI 3.0 y 3.1** (JSON o YAML) | Se usa tal cual. En 3.1 se validan los tipos con `null` (`type: [string, "null"]`), `const`, `examples`, `prefixItems`, `exclusiveMinimum` numérico, `patternProperties`, `if`/`then`/`else` y el resto de JSON Schema 2020-12 que usan las respuestas. |
| **Swagger 2.0** (JSON o YAML) | Se **convierte a OpenAPI 3.0** al importarlo: `definitions` pasa a `components.schemas`, `host`/`basePath`/`schemes` a `servers`, los parámetros `body` y `formData` a `requestBody`, `produces`/`consumes` a `content`, y `securityDefinitions` a `securitySchemes`. La app avisa de que hubo conversión. |
| **Colección de Postman v2.1** (y v2.0) | Se **genera un OpenAPI 3.0** desde sus solicitudes: método y ruta (`{{var}}` y `:var` pasan a parámetros de ruta), query, cabeceras, body JSON, carpetas como tags y las respuestas guardadas como status. Los **schemas se infieren de los ejemplos**, así que revísalos: un ejemplo no dice qué campos son opcionales. La URL base del primer entorno sale de la variable de la colección (`{{baseUrl}}`) o del entorno de Postman que elijas junto a ella. |

Lo que se guarda como versión es el OpenAPI 3 resultante, y su hash es el de ese documento. La conversión es determinista: el mismo Swagger o la misma colección, importados dos veces, siguen siendo la misma versión.

De cada operación del contrato se toma el método, la ruta, el tag, los **status declarados** y los **parámetros**. Un status declarado habilita sus casos: si tu API responde 409 pero el contrato no lo declara, nadie lo prueba.

### Cambios entre versiones

Entre dos versiones del contrato se puede ver qué cambió, agrupado por operación (en el menú del
proyecto → **Versiones del contrato**, `GET /v1/projects/:project/specs/diff?from=&to=` o
`eq diff`). Cada cambio se marca como **rompe** o **compatible** con una regla: rompe si una
petición que antes era válida deja de aceptarse, o si una respuesta deja de dar algo de lo que un
cliente dependía.

| Rompe | Compatible |
|---|---|
| Operación eliminada | Operación nueva |
| Parámetro obligatorio nuevo, o uno opcional que pasa a obligatorio | Parámetro opcional nuevo, o eliminado |
| Campo obligatorio nuevo en el cuerpo de la petición | Campo opcional nuevo, o eliminado, en la petición |
| Tipo más estrecho en un parámetro o en la petición (`number` → `integer`) | Tipo más amplio (`integer` → `number`, admitir `null`) |
| Valor de enum eliminado de un parámetro o de la petición | Valor de enum nuevo en un parámetro o en la petición |
| Status eliminado de las respuestas | Status nuevo |
| Campo eliminado, de tipo cambiado o que deja de ser obligatorio en la respuesta | Campo nuevo en la respuesta |
| Valor de enum nuevo en la respuesta (un cliente que la valida no lo conoce) | Valor de enum eliminado de la respuesta |
| Exigir credencial donde no se exigía, o dejar de aceptar un esquema de seguridad | Dejar de exigirla, o aceptar un esquema más |

Los `$ref` se resuelven y los `allOf` se fusionan: mover campos a un componente compartido no es un
cambio. Al importar una versión nueva, la app avisa si trae cambios que rompen respecto a la que
estaba activa.

## Entorno

Dónde corre la API: una **URL base** y lo que se permite hacer allí.

- **Seed** (`seeded`): los ids del seed (`1` existe, `999999` no) son los del entorno. Si no, se descubren antes de cada corrida.
- **Escrituras** (`writesAllowed`): si pueden salir POST, PUT, PATCH y DELETE.
- **Presupuestos** (`enforceLatency`): si la latencia decide el caso o solo se informa.
- **Autenticación** (`authEnabled`): si la API exige credenciales, y por tanto tienen sentido los casos 401/403.

Un entorno nunca guarda secretos.

## Credencial

Lo que se presenta para autenticarse en un entorno: un token **bearer**, una **API key** en una cabecera, usuario y contraseña **Basic**, **OAuth2** (client credentials, o un refresh token de authorization code), una **cookie de sesión** (pegada u obtenida con un login), una **firma HMAC** por solicitud o un **certificado de cliente** (mTLS, solo o sumado a otro tipo). Detalle de cada uno en [Verificación funcional](doc:funcional). Cada entorno tiene hasta tres, por **rol**:

| Rol | Para qué |
| --- | --- |
| `primary` | Los casos normales. |
| `insufficient` | Los casos 403: una credencial válida sin permisos suficientes. |
| `alternate` | Los casos de una credencial que la operación no acepta (una API key en un DELETE, por ejemplo). |

Se guardan cifradas y nunca vuelven al navegador: como mucho, sus cuatro últimos caracteres.

## Escenario (caso)

Una pregunta concreta a una operación, con su status esperado: «listado sin filtros → 200», «recurso inexistente → 404», «sin credencial → 401». El motor los **genera** a partir del contrato y la configuración; el conjunto es la **matriz**. Ver [Verificación funcional](doc:funcional).

## Flujo encadenado

Un caso de escritura que no se puede comprobar con una sola solicitud. «Crear y consultar» crea un recurso, captura su id, lo lee y compara campo a campo; al final lo **borra**, aunque el caso falle. Así la matriz se puede correr dos veces seguidas sobre los mismos datos.

## Presupuesto de latencia

Cuánto puede tardar una operación, como una lista **ordenada** de reglas: la primera que coincide gana. Una operación sin regla no recibe aserción de latencia: **un presupuesto que no existe no es uno que pasa**.

## Corrida

Una ejecución guardada: funcional (la matriz o una parte) o de carga. Corre **en el servidor**: cerrar el navegador no la detiene. Cada caso termina en uno de estos estados:

| Estado | Significa |
| --- | --- |
| `passed` | Todas sus aserciones pasaron. |
| `failed` | La API respondió algo distinto de lo esperado. Es un hallazgo. |
| `blocked` | El caso no se envió: es una escritura en un entorno sin escrituras permitidas. No es un fallo. |
| `skipped` | No llegó a correr porque la corrida se canceló antes. |

## Prueba puntual (probe)

Un solo caso con los valores que elijas, sin guardar nada. Sirve para preguntar «¿esto funciona?» mientras configuras; las corridas son las que quedan como evidencia.

## Perfil de carga

Una prueba de carga: un **tipo** (carga, estrés, pico o resistencia), una **mezcla** de operaciones GET con pesos relativos, unas **etapas** (tasa en solicitudes por segundo a lo largo del tiempo) y unos **umbrales**. Ver [Carga y estrés](doc:carga).
