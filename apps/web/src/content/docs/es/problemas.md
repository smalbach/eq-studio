# Solución de problemas

## La app dice que no puede conectar con el API

La app habla con el API de Endpoint Quality (`http://127.0.0.1:4400`). Arráncalo con `eq serve` (o `npx endpoint-quality serve`), `pnpm run dev` (desarrollo) o `pnpm start`, y recarga. Comprueba que responde:

```bash
curl http://127.0.0.1:4400/health
```

Si el puerto está ocupado, arráncalo en otro con `EQ_PORT=4500` (o `eq serve --port 4500`) y, en desarrollo, apunta la app a él con `EQ_API_URL=http://127.0.0.1:4500`.

## Tu API no es alcanzable

Las solicitudes a tu API las hace **el API de Endpoint Quality**, no el navegador. Lo que importa es si *ese proceso* llega a tu API:

- **Probar conexión** en la guía [Entorno](guide:environment) envía un GET real y muestra el status o el error de red.
- Un error de red sin status (`ECONNREFUSED`, `ENOTFOUND`, timeout) es de red: URL, puerto, DNS, VPN o firewall. No es un fallo de la API.
- `localhost` es el equipo donde corre el API de Endpoint Quality. Si tu API corre en un contenedor o en otra máquina, usa su dirección.

## Certificados TLS autofirmados

Node rechaza certificados que no firma una autoridad conocida, y no hay opción por entorno para saltarse la verificación. Para una CA propia (la de tu empresa o la de un entorno de pruebas), arranca el API con `NODE_EXTRA_CA_CERTS` apuntando a su certificado en PEM; para un certificado autofirmado, al propio certificado:

```bash
NODE_EXTRA_CA_CERTS=/ruta/a/ca.pem pnpm run dev
NODE_EXTRA_CA_CERTS=/ruta/a/ca.pem npx endpoint-quality serve
```

Node lee la variable una sola vez, al arrancar: si cambias el archivo, reinicia el proceso. Como último recurso, solo en local y nunca contra algo que no controles, `NODE_TLS_REJECT_UNAUTHORIZED=0` desactiva la verificación para todo el proceso.

## VPN y redes corporativas

El modo local existe para esto: es el único que alcanza `localhost`, redes privadas y VPN. Si tu API solo es visible por VPN, conéctate antes de arrancar las corridas. Si la red pasa por un proxy corporativo, la respuesta puede llegar del proxy y no de tu API: el cuerpo suele ser HTML y fallan las aserciones de Content-Type y de schema. Mira el cuerpo en el detalle del caso.

## 401 contra 403 desde un proxy o gateway

Un gateway delante de la API puede responder él mismo, antes de que la solicitud llegue al servicio:

- Un **401** de un caso normal suele ser la credencial `primary` vencida o mal configurada. Pruébala en la guía [Credenciales](guide:credentials).
- Un **403** del gateway (IP no permitida, WAF, cuota) se parece a un 403 de permisos, pero el cuerpo no es el Problem Details de tu API. Mira el cuerpo en el detalle del caso.
- Un caso «sin credencial» que recibe **403** en vez de 401: el gateway decide antes que la API. Es un hallazgo sobre el gateway, no sobre el endpoint.
- Si la API no exige credenciales en ese entorno, apaga `authEnabled`: los casos 401/403 fallarían por la razón equivocada.

## Latencia medida a través de la red

Un presupuesto es una promesa **del servicio**, medida al lado del servicio. A través de VPN o de un gateway, cada solicitud gasta decenas o cientos de milisegundos antes de que la API haga nada, y todos los presupuestos saldrían en rojo por culpa del camino.

- En esos entornos apaga **Exigir presupuestos** (`enforceLatency: false`): la latencia se muestra pero no decide el caso.
- En las pruebas de carga usa un **p95 propio** (`latency.mode: "custom"`) en lugar de los presupuestos del proyecto.

## Las escrituras aparecen como bloqueadas

El entorno no permite escrituras (`writesAllowed: false`), que es el valor por defecto fuera de un entorno con seed. Ningún POST, PUT, PATCH ni DELETE salió a la red: el caso queda `blocked`, no `failed`. Actívalas en la guía [Entorno](guide:environment) solo si los datos son desechables.

## Un caso de detalle responde 404

Fuera del seed, el id `1` puede no existir. Marca el entorno como **sin seed** para que los ids reales se lean con `seed.sources` antes de cada corrida, o ajusta `ids.existing`.

## «crear y consultar» recibe 409

El body de creación usa una clave natural que ya existe. Usa en `bodies` valores que no puedan existir (`ORD-TEST-0001`).

## Windows

- Usa PowerShell o la terminal de Windows; `pnpm run dev` funciona igual.
- Las variables de entorno se ponen distinto: `$env:EQ_PORT = "4500"; pnpm run dev` en PowerShell.
- Los datos viven en `%USERPROFILE%\.endpoint-quality\`.
- En los ejemplos con `curl` de esta documentación, cambia las comillas simples por dobles y escapa las de dentro, o usa `curl.exe` desde Git Bash.
