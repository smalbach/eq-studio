# Despliegue en la nube

El mismo API, en modo `cloud`, para un equipo: cuentas, workspaces, roles y tokens de API, sobre
PostgreSQL y Redis. La web viene incluida: el API la sirve en la misma dirección.

La nube no sustituye al modo local: un servidor en la nube no puede probar la API que corre en tu
portátil o detrás de tu VPN. Para eso sigue el modo local, y la [sincronización](doc:sync) une
los dos.

## Con Docker

```bash
cp docker/.env.example docker/.env
openssl rand -base64 32     # EQ_SECRETS_KEY
openssl rand -base64 48     # EQ_JWT_SECRET
docker compose -f docker/compose.yml --env-file docker/.env up -d
```

Pon las dos claves en `docker/.env` y abre `http://localhost:4400`. La **primera cuenta** que se
registra queda como propietaria de su workspace; las siguientes llegan por invitación (salvo
`EQ_REGISTRATION=open`).

> **Guarda `EQ_SECRETS_KEY` fuera del servidor.** Cifra las credenciales de los entornos y nunca
> está en la base de datos: si se pierde, las credenciales se vuelven a escribir, no se recuperan.

Delante pon un proxy con HTTPS (ver [Operarlo](#operarlo)) y `EQ_TRUST_PROXY=1`, para que los
límites de intentos vean la IP real del cliente.

## Sin Docker

Node 22.13 o superior con PostgreSQL y, opcionalmente, Redis:

```bash
EQ_MODE=cloud \
EQ_DATABASE_URL=postgres://eq:secreto@db:5432/eq \
EQ_QUEUE_DRIVER=redis EQ_REDIS_URL=redis://cache:6379 \
EQ_SECRETS_KEY=… EQ_JWT_SECRET=… \
npx endpoint-quality serve
```

Con `EQ_MODE=cloud`, `eq serve` lee toda la configuración del entorno y escucha en `0.0.0.0` (o
en `--host` / `EQ_HOST`). Sin Redis la cola vive en memoria: funciona con un solo proceso, pero una
corrida en curso se pierde si el proceso se reinicia.

## Roles

| Rol | Puede |
|---|---|
| Lector | Verlo todo: proyectos, configuración, corridas, reportes. |
| Editor | Además, editar proyectos y configuración, y lanzar corridas de solo lectura. |
| Administrador | Además, entornos, credenciales, corridas con escrituras, carga y estrés, miembros, invitaciones y tokens de API. |
| Propietario | Además, cambiar roles. Siempre queda al menos uno. |

Los miembros, las invitaciones y los tokens se gestionan en **Ajustes**. Una invitación es un
enlace de un solo uso; quien invita nunca puede dar un rol mayor que el suyo.

## CI contra la nube

En **Ajustes → Tokens de API** crea un token con el rol que necesite la CI (normalmente editor
para corridas de solo lectura, administrador si escriben). Se muestra una sola vez:

```bash
eq run store-api --env staging --api https://eq.example.com --api-token "$EQ_API_TOKEN"
```

El token pertenece a un workspace; revocarlo lo corta en la siguiente petición.

## El ejemplo Mock Store en la nube

El ejemplo **Mock Store** apunta a `http://127.0.0.1:4010`, y las guardas SSRF bloquean el
loopback en la nube: el API se niega a enviar sus corridas (y en un contenedor, `127.0.0.1` es el
propio contenedor). Úsalo en local ([Inicio rápido](doc:inicio)). Para probarlo en la nube, arranca
el mock en una máquina que el servidor alcance, cambia la URL base del entorno y, solo si esa
dirección es privada y el despliegue vive en una red privada, activa `EQ_ALLOW_PRIVATE_TARGETS=true`.

## Notificaciones por email (SMTP)

Las notificaciones por webhook y Slack no necesitan nada en el servidor. El email sí: sin `EQ_SMTP_HOST` el panel no lo ofrece.

| Variable | Por defecto | Qué hace |
| --- | --- | --- |
| `EQ_SMTP_HOST` | — | El servidor SMTP. Activa las notificaciones por email. |
| `EQ_SMTP_PORT` | `587` | Puerto: `587` con STARTTLS, `465` con TLS desde el inicio. |
| `EQ_SMTP_SECURE` | `true` en el puerto 465 | `true`: TLS desde el primer byte. `false`: en claro, y se sube a STARTTLS si el servidor lo ofrece. |
| `EQ_SMTP_USER` · `EQ_SMTP_PASSWORD` | — | Credenciales (AUTH PLAIN). Solo se envían por una conexión cifrada. |
| `EQ_SMTP_FROM` | `Endpoint Quality <noreply@<host>>` | El remitente. |
| `EQ_PUBLIC_URL` | — | La dirección pública del despliegue (`https://eq.example.com`), para que cada notificación enlace a su corrida. |

```bash
EQ_SMTP_HOST=smtp.example.com EQ_SMTP_PORT=587 \
EQ_SMTP_USER=eq@example.com EQ_SMTP_PASSWORD=… \
EQ_SMTP_FROM="Endpoint Quality <eq@example.com>" \
EQ_PUBLIC_URL=https://eq.example.com
```

Las programaciones se disparan desde los propios procesos del API, cada `EQ_SCHEDULER_TICK_SECONDS` (30); con varios procesos, cada ocurrencia se lanza igual una sola vez. Ver [Programaciones y notificaciones](doc:automatizacion).

## Seguridad

- **Credenciales** cifradas con AES-256-GCM; el API solo devuelve sus 4 últimos caracteres.
- **Contraseñas** con scrypt; los tokens de refresco rotan en cada uso, y reutilizar uno gastado
  cierra toda esa sesión. En la web el refresco vive en una cookie `httpOnly`.
- **Guardas SSRF**: el API no lee contratos ni prueba APIs en direcciones internas (loopback,
  redes privadas, link-local, metadatos de la nube). Valida la IP ya resuelta, sigue como mucho 3
  redirecciones y limita tiempo y tamaño. Si tu despliegue vive dentro de una red privada y sus
  APIs también, `EQ_ALLOW_PRIVATE_TARGETS=true`.
- **Límite de intentos** en registro, inicio de sesión, restablecimiento de contraseña e invitaciones, por IP y por correo.
- **Registro de auditoría** de cada cambio relevante para la seguridad, de solo añadir (ver [Registro de auditoría](#registro-de-auditoria)).

## Correo y contraseñas olvidadas

Con un servidor SMTP el API envía por correo los enlaces para restablecer la contraseña:

```bash
EQ_PUBLIC_URL=https://eq.example.com
EQ_SMTP_URL=smtps://eq%40example.com:clave-de-app@smtp.example.com:465
EQ_MAIL_FROM="Endpoint Quality <eq@example.com>"
```

`EQ_PUBLIC_URL` es obligatoria con SMTP: los enlaces se construyen con ella, nunca con la cabecera
`Host` de la petición (que controla el cliente). Caracteres como `@` en el usuario o la clave van
codificados (`%40`).

- **¿Olvidaste la contraseña?** en la pantalla de inicio de sesión pide un enlace. La respuesta es
  la misma exista o no una cuenta con ese correo, y tiene un límite por IP y por correo.
- El enlace es **de un solo uso** y dura **30 minutos**; solo se guarda su SHA-256. Usarlo gasta
  los demás enlaces de la cuenta y **cierra todas sus sesiones**, igual que cambiar la contraseña.
- En **Ajustes → Miembros** un administrador crea el enlace de un miembro con un rol menor que el
  suyo (un propietario, el de cualquiera). Con SMTP va al correo del miembro y no se muestra. Sin
  SMTP el administrador recibe el enlace para pasárselo, solo si la cuenta no pertenece a ningún
  otro workspace.
- **Sin SMTP** no se envía nada y el API solo anota en su log que se pidió un restablecimiento.
  Únicamente la nube de desarrollo (`pnpm run cloud`) escribe el propio enlace en su log, como
  aviso, para poder probar el flujo en una sola máquina.

## Inicio de sesión único (OpenID Connect)

Cualquier proveedor OpenID Connect (Google, Microsoft Entra ID, Okta, Auth0, Keycloak…) puede
iniciar la sesión de la gente, con código de autorización y PKCE:

```bash
EQ_PUBLIC_URL=https://eq.example.com
EQ_OIDC_ISSUER=https://accounts.google.com
EQ_OIDC_CLIENT_ID=…
EQ_OIDC_CLIENT_SECRET=…
EQ_OIDC_ALLOWED_DOMAINS=example.com
EQ_OIDC_NAME=Google
```

Registra `https://eq.example.com/v1/auth/oidc/callback` como URI de redirección en el proveedor.
La pantalla de inicio de sesión muestra entonces **Entrar con Google**.

- La cuenta se busca por el correo **verificado** del proveedor (`email_verified`): una cuenta que
  ya existe entra como ella misma y conserva su contraseña, si la tiene.
- Un correo nuevo: con `EQ_REGISTRATION=open` recibe una cuenta y un workspace propio; con
  `invite` (por defecto) solo entra quien tiene una invitación pendiente, y se une a ese workspace.
  La invitación se acepta al entrar.
- `EQ_OIDC_ALLOWED_DOMAINS` limita el SSO a esos dominios de correo.
- El emisor debe usar HTTPS; HTTP solo se acepta en `localhost` (un Keycloak local, las pruebas).

## Registro de auditoría

**Ajustes → Registro de auditoría** (administradores y propietarios) lista los eventos de
seguridad del workspace: inicios de sesión y los fallidos, cambios y restablecimientos de
contraseña, invitaciones, miembros que entran o salen, cambios de rol, tokens de API creados y
revocados, credenciales creadas, cambiadas o borradas, proyectos borrados y dispositivos enlazados o
desenlazados. Cada uno con quién, sobre qué, desde qué dirección y cuándo; nunca una contraseña, un
token ni el valor de una credencial. Se filtra por tipo y fechas; `GET /v1/audit` da lo mismo a los
scripts.

El registro es **de solo añadir**: un trigger en la base de datos se niega a cambiar o borrar sus
filas. Va en las copias de seguridad con todo lo demás.

## Métricas

`EQ_METRICS=true` sirve `GET /metrics` en formato Prometheus: el proceso (CPU, memoria, event loop,
GC), las peticiones HTTP por ruta, método y estado con un histograma de duración
(`eq_http_request_duration_seconds`), las corridas encoladas, empezadas y terminadas por estado
(`eq_runs_queued_total`, `eq_runs_started_total`, `eq_runs_finished_total`) y las corridas en
espera o en curso (`eq_run_queue_depth`). No pide sesión; con `EQ_METRICS_TOKEN` pide un token
bearer:

```yaml
scrape_configs:
  - job_name: endpoint-quality
    metrics_path: /metrics
    authorization: { credentials: "<EQ_METRICS_TOKEN>" }
    static_configs: [{ targets: ["eq.example.com:4400"] }]
```

Los contadores son por proceso: con varios procesos del API, raspa cada uno.

## Operarlo

**HTTPS.** Un `Caddyfile` mínimo, con el certificado automático:

```text
eq.example.com {
  reverse_proxy 127.0.0.1:4400
}
```

**Copias de seguridad.** Todo vive en PostgreSQL; Redis solo guarda la cola, no hace falta
copiarlo.

```bash
docker compose -f docker/compose.yml exec -T postgres pg_dump -U eq eq > eq-backup.sql
docker compose -f docker/compose.yml exec -T postgres psql -U eq eq < eq-backup.sql   # restaurar
```

Guarda `EQ_SECRETS_KEY` aparte de la copia: sin ella, las credenciales de la copia no se pueden
descifrar.

**Actualizar.** Haz una copia, trae la versión nueva y reconstruye:

```bash
git pull
docker compose -f docker/compose.yml --env-file docker/.env up -d --build
```

Las migraciones de la base de datos corren solas al arrancar, hacia delante. No hay comando para
deshacerlas: para volver a una versión anterior, restaura la copia.

## Variables

Todas las variables que lee un despliegue en la nube (las solo locales están en la [referencia del API](doc:api)):

| Variable | Por defecto | Qué hace |
| --- | --- | --- |
| `EQ_MODE` | `local` | `cloud` para un despliegue de equipo. |
| `EQ_PORT` · `EQ_HOST` | `4400` · `0.0.0.0` | Dónde escucha. |
| `EQ_DATABASE_URL` | — | `postgres://…`. Obligatoria. |
| `EQ_DATABASE_SCHEMA` | — | Esquema de PostgreSQL (se crea si no existe). |
| `EQ_SECRETS_KEY` | — | Cifra las credenciales (`openssl rand -base64 32`). Obligatoria; guárdala aparte de las copias. |
| `EQ_JWT_SECRET` | — | Firma las sesiones, al menos 32 caracteres (`openssl rand -base64 48`). Obligatoria. |
| `EQ_REGISTRATION` | `invite` | `invite`: la primera cuenta y luego invitaciones. `open`: cualquiera se registra. También decide a quién deja entrar el SSO. |
| `EQ_ACCESS_TTL_SECONDS` · `EQ_REFRESH_TTL_DAYS` | `900` · `30` | Duración del token de acceso y de la sesión. |
| `EQ_QUEUE_DRIVER` · `EQ_REDIS_URL` | `memory` · `redis://127.0.0.1:6379` | `redis` para varios procesos y corridas que sobreviven a un reinicio. |
| `EQ_RUN_CONCURRENCY` | `2` | Corridas simultáneas por proceso. |
| `EQ_TRUST_PROXY` | — | Saltos de proxy en los que confiar (`1`), para la dirección del cliente (límites, auditoría) y HTTPS. |
| `EQ_ALLOW_PRIVATE_TARGETS` | `false` | `true` deja a las corridas llegar a direcciones privadas. |
| `EQ_CORS_ORIGINS` | — | Orígenes permitidos si la web se sirve desde otro dominio. |
| `EQ_PUBLIC_URL` | — | La dirección que abre la gente. Obligatoria con SMTP o SSO. |
| `EQ_SMTP_URL` · `EQ_MAIL_FROM` | — · `Endpoint Quality <no-reply@localhost>` | Correo (enlaces para restablecer la contraseña). |
| `EQ_METRICS` · `EQ_METRICS_TOKEN` | `false` · — | `GET /metrics` y su token bearer. |
| `EQ_OIDC_ISSUER` · `EQ_OIDC_CLIENT_ID` · `EQ_OIDC_CLIENT_SECRET` | — | Inicio de sesión único. |
| `EQ_OIDC_ALLOWED_DOMAINS` · `EQ_OIDC_NAME` · `EQ_OIDC_SCOPES` | — · `SSO` · `openid email profile` | Dominios de correo permitidos, nombre del botón, scopes. |
| `EQ_LOG` | — | `debug` o `silent`. Por defecto, errores y avisos. |
