# Carga y estrés

Una corrida funcional mide una solicitud cada vez: dice si la API responde bien, no si aguanta el tráfico esperado. Las pruebas de carga envían **solo GET** a una tasa fija y miden qué pasa.

## Modelo abierto

Los objetivos son **tasas** (solicitudes por segundo). El generador envía a esa tasa sin esperar la respuesta anterior, como hacen los clientes reales. Un modelo cerrado (N usuarios en bucle) frena cuando la API frena y esconde justo la saturación que se busca.

Cuando se alcanza el límite de solicitudes en vuelo (`maxInFlight`, 256 por defecto), la llegada se **descarta y se cuenta**, nunca se retrasa en silencio.

Límites: 500 req/s, 30 minutos y 30 objetivos por prueba.

## Los cuatro tipos

| Tipo | Pregunta | Etapas | Úsalo cuando |
| --- | --- | --- | --- |
| Carga | ¿Cumple los objetivos con el tráfico nominal? | Rampa corta hasta la tasa base y la sostiene. | Antes de cada versión, con la tasa que esperas en producción. |
| Estrés | ¿Dónde se rompe y cómo? | Cinco escalones de la tasa base a la pico. | Para conocer la capacidad y si falla de forma controlada (429/503) o se cae (500, conexiones). |
| Pico | ¿Sobrevive a un salto instantáneo? | Base (30 %), salto sin rampa a la pico (20 %), regreso a la base. | Campañas, reintentos masivos, un cron que despierta a todos los clientes. |
| Resistencia | ¿Se degrada con el tiempo? | Tasa base sostenida mucho tiempo. | Para fugas de memoria, pools que se agotan, cachés que crecen. |

La rampa no se mide contra los umbrales: los primeros segundos traen conexiones y cachés frías.

## Mezclas

Una mezcla reparte el tráfico entre objetivos con **pesos relativos**. Cada GET del contrato ya es un objetivo; `load.targets` añade variantes que recorren otro plan de consulta (una búsqueda, un filtro). Toda API recibe tres mezclas sin configurar nada:

- **Todos los GET del proyecto**: encuentra la operación que se degrada primero.
- **Solo listados**: las lecturas que más filas recorren.
- **Health**: el piso de latencia contra el que leer las demás.

```json
"mixes": [
  { "id": "browse", "label": { "es": "Navegación", "en": "Browsing" },
    "targets": [{ "target": "listOrders", "weight": 30 }, { "target": "getOrder", "weight": 70 }] }
]
```

## Datos de los placeholders

Cada `{placeholder}` de una ruta se llena al enviar con un valor de `load.data`, elegido con una distribución **Zipf** (unos pocos valores reciben la mayoría del tráfico, como en la realidad). Un valor uniforme daría una caché casi siempre fría; uno fijo, siempre caliente.

```json
"data": { "order_id": ["1", "2", "3", "4"], "q": ["lamp", "mug"] }
```

Una ruta anidada usa **un solo placeholder correlacionado** para todos sus ids: `/orders/{order_id}/items/{item_id}` se envía como `/orders/{item_path}`, con valores como `7/items/3`. Un item solo existe bajo su pedido: sortear los dos ids por separado daría casi siempre 404.

Si no das datos en un entorno compartido, el API lee ids reales con `seed.sources` al empezar.

## Verificación previa

Antes de la carga se envía **una solicitud por objetivo** con el primer valor de cada lista. Un objetivo cuyos datos no existen respondería 404 a miles de solicitudes y el veredicto diría «40 % de errores»: verdad, pero sobre los datos. Qué hacer si un objetivo falla (`onPreflightFailure`):

- `skip` (por defecto): se omite ese objetivo y la prueba sigue.
- `stop`: no se envía nada.
- `ignore`: no hay verificación previa.

## Veredicto

Todos los tipos comparten:

- **Errores < 0,1 %** en las etapas medidas.
- **Latencia**: el p95 de cada objetivo bajo su umbral. El umbral sale de los presupuestos del proyecto (`latency.mode: "project"`), de un p95 propio (`"custom"`, útil a través de VPN o gateway) o de ninguno (`"off"`, solo informativa).

Y cada tipo añade su pregunta:

- **Carga y resistencia**: sostiene la tasa pedida (entregada ≥ 95 %, sin descartes).
- **Estrés**: capacidad sostenida (el último escalón antes del primero que se rompe), el punto de quiebre (informativo) y si falla de forma controlada: sin 500 ni conexiones caídas.
- **Pico**: errores fuera del pico < 0,1 %; durante el pico se toleran 429/503 (protección del gateway) pero no 500, timeouts ni conexiones caídas; se recupera si el p95 de la segunda mitad del regreso es ≤ 1,5× el de la base.
- **Resistencia**: el p95 del último 20 % no supera 1,3× el del primer 20 %.

Una prueba detenida a mano no tiene veredicto.

## Entornos compartidos

La carga golpea un servicio que otros usan. En un entorno sin seed, la app pide confirmación explícita antes de empezar; coordina la prueba con quien opere ese entorno y empieza con tasas bajas.

## Empezar

La guía [Prueba de carga](guide:load) recorre tipo, mezcla, etapas con su gráfico y umbrales.
