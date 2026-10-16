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
- **Límite de intentos** en registro, inicio de sesión e invitaciones, por IP y por correo.

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

Todas las variables están en la [referencia del API](doc:api).
