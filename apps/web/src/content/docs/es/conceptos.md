# Conceptos

El vocabulario de Endpoint Quality, de lo más general a lo más concreto.

## Proyecto

Una API que quieres verificar. Guarda su contrato, su configuración (qué probar y cómo) y sus entornos. Se exporta como un archivo `.eq.json` que puedes versionar en Git o importar en otro equipo. Ver [Formato .eq.json](doc:formato).

## Contrato y versión del contrato

El documento **OpenAPI 3** de la API. Al importarlo se guarda una **versión**: una copia inmutable identificada por su hash. Importar el mismo contenido dos veces da la misma versión; importar uno nuevo crea otra y la activa. Las corridas usan siempre la versión activa, nunca un documento que cambie a mitad de camino.

De cada operación del contrato se toma el método, la ruta, el tag, los **status declarados** y los **parámetros**. Un status declarado habilita sus casos: si tu API responde 409 pero el contrato no lo declara, nadie lo prueba.

## Entorno

Dónde corre la API: una **URL base** y lo que se permite hacer allí.

- **Seed** (`seeded`): los ids del seed (`1` existe, `999999` no) son los del entorno. Si no, se descubren antes de cada corrida.
- **Escrituras** (`writesAllowed`): si pueden salir POST, PUT, PATCH y DELETE.
- **Presupuestos** (`enforceLatency`): si la latencia decide el caso o solo se informa.
- **Autenticación** (`authEnabled`): si la API exige credenciales, y por tanto tienen sentido los casos 401/403.

Un entorno nunca guarda secretos.

## Credencial

Lo que se presenta para autenticarse en un entorno: un token **bearer**, una **API key** en una cabecera, usuario y contraseña **Basic**, u **OAuth2 client credentials** (el API pide el token una vez por corrida). Cada entorno tiene hasta tres, por **rol**:

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
