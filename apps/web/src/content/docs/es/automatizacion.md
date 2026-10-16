# Programaciones y notificaciones

Un contrato que ayer se cumplía puede romperse esta noche. Una **programación** lanza una corrida sola: cada hora, cada noche o cada lunes. Una **notificación** avisa que una corrida terminó: a un webhook, a un canal de Slack o por email. Las dos se configuran por proyecto en **Automatización**, el botón de la cabecera junto al entorno, y las dos viven en el API: siguen funcionando con todos los navegadores cerrados.

## Programaciones

Una programación tiene un nombre, un entorno, una frecuencia y lo que corre:

- **Funcional**: la matriz de casos, por defecto **solo lectura** (solo GET), lo prudente contra un entorno que no controlas.
- **Carga**: una prueba de carga, estrés, pico o resistencia con su tasa (RPS) y su duración.

Frecuencias:

| Preajuste | Se dispara | Cron |
| --- | --- | --- |
| Cada hora | en el minuto 0 de cada hora | `0 * * * *` |
| Diaria | todos los días a las 06:00 UTC | `0 6 * * *` |
| Semanal | los lunes a las 06:00 UTC | `0 6 * * 1` |
| Personalizada | lo que diga la expresión | cinco campos |

Una expresión personalizada tiene cinco campos — minuto, hora, día del mes, mes, día de la semana (0 o 7 es domingo) — con listas (`0,30`), rangos (`1-5`) y pasos (`*/15`). No se aceptan nombres (`MON`, `JAN`). Ejemplos: `*/30 8-18 * * 1-5` (cada media hora en horario de oficina, de lunes a viernes), `0 2 1 * *` (el día 1 de cada mes a las 02:00).

**Las horas son UTC**, siempre: la misma programación se dispara en el mismo instante en cualquier servidor, y el cambio de horario de verano nunca salta ni repite una corrida. El panel muestra la próxima corrida en tu hora local.

Qué esperar:

- **Correr ahora** lanza la corrida de la programación fuera de su cadencia; la próxima no se mueve.
- Si la corrida anterior de la misma programación no terminó, la ocurrencia **se salta** y el panel lo dice: las corridas nunca se apilan.
- Si el API estaba apagado cuando tocaba, corre **una vez** al volver a arrancar, no una por cada ocurrencia perdida.
- Si se borra el entorno o el proyecto, la programación se pausa sola con el motivo.
- Las corridas programadas aparecen en el historial como cualquier otra, iniciadas por `schedule:<id>`.

### Permisos

Los mismos que para lanzar la corrida a mano: un **editor** programa corridas de solo lectura; una corrida con escrituras y una prueba de carga necesitan un **admin**. Cualquiera del espacio de trabajo ve las programaciones.

### Con varios procesos del API

En la nube puede haber varios procesos del API sobre la misma base de datos. Cada uno revisa las programaciones cada 30 segundos (`EQ_SCHEDULER_TICK_SECONDS`) y solo uno lanza cada ocurrencia: la ocurrencia se reclama en la base de datos con una única actualización condicional, y el que no la gana sigue de largo. La corrida va luego por la misma cola (memoria o Redis) que una lanzada a mano.

## Notificaciones

Un destino de notificación recibe un mensaje cuando termina una corrida del proyecto. Tipos:

| Tipo | Qué envía |
| --- | --- |
| **Webhook** | Un `POST` con JSON (ver abajo), opcionalmente firmado con HMAC. |
| **Slack** | Un mensaje a un [incoming webhook](https://api.slack.com/messaging/webhooks) (`https://hooks.slack.com/services/…`). Sirve con las herramientas de chat que aceptan el mismo formato. |
| **Email** | Un correo de texto a uno o varios destinatarios. Solo disponible si el servidor tiene SMTP configurado (ver [Despliegue en la nube](doc:deploy)). |

**Cuándo** avisa:

- **Solo si cambia el veredicto** (lo predeterminado): pasó → falló o falló → pasó, frente a la corrida anterior del mismo entorno y tipo. Sin corrida anterior, la base es «pasó»: un primer fallo se avisa, un primer éxito no.
- **Siempre**: cada corrida terminada.

Una corrida que terminó con **error** (el entorno no respondió, falló el preflight) cuenta como fallida. Una corrida **cancelada** o **interrumpida** no dice nada de la API: solo avisa a los destinos en «siempre».

El mensaje va en el idioma de la corrida. **Enviar prueba** manda un mensaje de ejemplo en el acto y muestra si llegó; el último envío de cada destino (ok o el error) queda a la vista.

### La URL es un secreto

Quien tiene la URL de un webhook puede publicar en ese canal. Por eso se guarda **cifrada**, como las credenciales, nunca vuelve al navegador — solo se muestra su host y sus últimos cuatro caracteres — y para cambiarla se escribe de nuevo. En la nube, los envíos pasan por las mismas protecciones SSRF que las corridas: nada de direcciones internas salvo con `EQ_ALLOW_PRIVATE_TARGETS=true`.

### El JSON del webhook

```json
{
  "event": "run.finished",
  "sentAt": "2026-10-16T06:01:12.000Z",
  "project": { "id": "…", "slug": "store-api", "name": "Store API" },
  "environment": { "id": "…", "key": "staging", "name": "Staging", "baseUrl": "https://staging.example.com" },
  "run": {
    "id": "…", "kind": "functional", "status": "failed",
    "verdict": "failed", "previousVerdict": "passed", "changed": true,
    "scope": "GET matrix", "totals": { "total": 42, "completed": 42, "passed": 40, "failed": 2, "blocked": 0 },
    "error": null, "triggeredBy": "schedule:…", "scheduleId": "…",
    "createdAt": "…", "startedAt": "…", "finishedAt": "…", "durationMs": 12000,
    "url": "https://eq.example.com/?vista=funcional&proyecto=store-api&corrida=…"
  }
}
```

Un mensaje de prueba lleva `"test": true`. `url` aparece cuando el servidor conoce su dirección pública (`EQ_PUBLIC_URL`).

Cabeceras: `X-EQ-Event: run.finished`, `X-EQ-Delivery` (un id único por envío) y, con secreto de firma, `X-EQ-Timestamp` y `X-EQ-Signature`.

### Verificar la firma

La firma es `sha256=` seguido del HMAC-SHA256, en hexadecimal, de `<timestamp>.<cuerpo>` con el secreto que configuraste (16 caracteres o más). El timestamp también se firma, así que un mensaje capturado no se puede repetir más tarde. En Node:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, headers, rawBody) {
  const timestamp = Number(headers["x-eq-timestamp"]);
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false; // más de 5 minutos
  const expected = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
  const given = String(headers["x-eq-signature"] ?? "");
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
```

Verifícala sobre el cuerpo **crudo**, antes de parsearlo: reformatear el JSON cambia la firma.

## Desde el API

| Método y ruta | Qué hace |
| --- | --- |
| `GET/POST /v1/projects/:project/schedules` | Lista o crea programaciones: `{ name, environment, cron, kind: "functional" \| "load", plan, enabled? }`. `plan` lleva los mismos campos que lanzar la corrida (`readOnly`, `mode`… o `type`, `baseRps`, `durationS`…). |
| `PATCH/DELETE …/schedules/:schedule` | Cambia (`name`, `environment`, `cron`, `enabled`, `plan`) o borra una programación. |
| `POST …/schedules/:schedule/run` | La corre ahora. **202** `{ id }`. |
| `GET/POST /v1/projects/:project/notifications` | Lista (`{ emailAvailable, targets }`) o crea destinos: `{ name, kind: "webhook" \| "slack" \| "email", notifyOn: "change" \| "always", url?, signingSecret?, recipients? }`. |
| `PATCH/DELETE …/notifications/:target` | Cambia o borra un destino. Sin `url` conserva la anterior. |
| `POST …/notifications/:target/test` | Envía un mensaje de prueba; responde `{ ok, status, error }`. |

Crear, cambiar y probar destinos requiere el rol **admin**.
