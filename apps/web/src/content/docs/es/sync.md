# Sincronización

El mismo proyecto en el equipo del trabajo, el de casa y el de CI. Cada instalación local sigue funcionando sola y sin conexión; enlazada a un workspace de la nube, comparte con él lo que cambia, en las dos direcciones.

## Qué se sincroniza

| Dato | Se sincroniza | Cómo |
| --- | --- | --- |
| Proyectos, entornos (sin secretos), configuración, versiones del contrato | Sí | Merge por campo: dos equipos que cambian campos distintos se combinan. |
| Corridas funcionales y de carga | Sí, al terminar (desactivable) | Solo se añaden: nunca hay conflicto. Viajan sin los cuerpos de las respuestas. |
| Secretos de las credenciales | **No, por defecto** | Se quedan en tu equipo. Opcional: cifrado de extremo a extremo con una passphrase; la nube nunca ve el texto plano. |

No se sincronizan las preferencias del navegador (tema, idioma) ni el borrado de una corrida.

## La cuenta

Las cuentas viven en la nube, no en la app local: en modo local no hay usuarios. Para crearla, en **Ajustes → Sincronización** escribe la dirección de la nube y pulsa **Crear cuenta en la nube**; se abre su pantalla de registro. La primera cuenta de una nube queda como propietaria de su workspace; las siguientes llegan por invitación, salvo que la nube permita el registro abierto (`EQ_REGISTRATION=open`).

¿Sin nube todavía? Para probar en este equipo:

```bash
pnpm run cloud
```

Levanta una nube de desarrollo en `http://localhost:4500`, con registro abierto y sus datos en `~/.endpoint-quality/cloud-dev/` (SQLite, sin PostgreSQL ni Docker). Solo para probar: un despliegue real está en [Despliegue](doc:deploy).

## Enlazar un equipo

En la app local, **Ajustes → Sincronización**, escribe la dirección de la nube (o sigue la [guía paso a paso](guide:sync)). La app muestra un código y abre la nube en el navegador: inicia sesión, comprueba que el código coincide, elige el workspace y aprueba. El equipo queda enlazado en unos segundos.

Desde la terminal es lo mismo:

```bash
eq login https://eq.example.com --name "Portátil del trabajo"
```

Para CI o un script, sin navegador, con un token de API de la nube (Ajustes → Tokens de API):

```bash
EQ_SYNC_TOKEN=eqt_… eq login https://eq.example.com
```

El equipo actúa con el rol de quien lo aprobó: un lector recibe cambios pero no puede enviar los suyos; los entornos y las credenciales piden administrador, como en el resto de la app. Si esa persona sale del workspace, el equipo deja de sincronizar. Cada equipo enlazado aparece en **Ajustes → Tokens de API** de la nube y se puede revocar.

## Sincronizar

```bash
eq sync              # trae lo de la nube y envía lo de aquí
eq sync --status     # cómo está: último sync, pendientes, conflictos
```

Mientras `eq serve` (o `pnpm start`) está abierto, sincroniza solo cada 5 minutos (`EQ_SYNC_INTERVAL_SECONDS`, `0` lo desactiva). También desde **Ajustes → Sincronización → Sincronizar ahora**.

Sin conexión se sigue trabajando; la próxima sincronización se pone al día. `eq sync` sale con `1` si queda un conflicto o un cambio rechazado por el rol, para que un script lo note.

## Qué sincronizar

```bash
eq sync --runs off                     # sin el historial de corridas
eq sync --projects store-api,billing   # solo estos proyectos; --projects all vuelve a todos
```

## Conflictos

Si dos equipos cambian **el mismo campo** de lo mismo (el nombre de un entorno, la sección `budgets` de la configuración) de formas distintas, gana provisionalmente el que llegó primero a la nube y el otro valor se guarda como **conflicto**: nunca se sobrescribe en silencio. Aparece en **Ajustes** del equipo que lo encontró y en los de la nube, con los dos valores; eliges uno y el otro equipo lo recibe en su siguiente sincronización.

Cambios en campos distintos del mismo entorno o proyecto no son conflicto: se combinan. La configuración de un proyecto se compara por sección.

Un mismo contrato importado en dos equipos queda como una sola versión.

## Secretos de extremo a extremo

Por defecto, los tokens, API keys y contraseñas de los entornos no salen del equipo: en otro equipo se vuelven a escribir. Si quieres que viajen:

```bash
EQ_SYNC_PASSPHRASE='una frase larga que solo conoce tu equipo' eq sync --secrets on
```

La passphrase (12+ caracteres) se escribe en cada equipo; nunca se envía. De ella se deriva una clave (scrypt) que cifra cada credencial con AES-256-GCM antes de salir; la nube guarda un texto que no puede leer ni usar. El primer equipo fija la passphrase del workspace; los demás deben usar la misma, y la app lo comprueba al activarla.

> Si se pierde la passphrase, las credenciales se vuelven a escribir: no hay forma de recuperarlas, por diseño. La passphrase de un workspace no se puede cambiar.

Las credenciales que configuras en la propia nube (para corridas que se ejecutan allí) son otras: cifradas con la clave de la nube y nunca enviadas a los equipos.

## Desenlazar

```bash
eq logout
```

O **Ajustes → Sincronización → Desenlazar**. Los datos se quedan en el equipo y su token deja de valer en la nube.
