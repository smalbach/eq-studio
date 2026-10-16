# Load and stress

A functional run measures one request at a time: it tells whether the API answers correctly, not whether it holds the expected traffic. Load tests send **GET only** at a set rate and measure what happens.

## Open model

The targets are **rates** (requests per second). The generator sends at that rate without waiting for the previous answer, as real clients do. A closed model (N users in a loop) slows down when the API slows down and hides exactly the saturation you are looking for.

When the cap of requests in flight is reached (`maxInFlight`, 256 by default), the arrival is **dropped and counted**, never silently delayed.

Limits: 500 req/s, 30 minutes and 30 targets per test.

## The four types

| Type | Question | Stages | Use it when |
| --- | --- | --- | --- |
| Load | Does it meet the targets at nominal traffic? | A short ramp to the base rate, then held. | Before each release, at the rate you expect in production. |
| Stress | Where does it break, and how? | Five steps from the base rate to the peak. | To learn the capacity and whether it fails in a controlled way (429/503) or falls over (500s, connections). |
| Spike | Does it survive an instantaneous jump? | Base (30 %), a jump with no ramp to the peak (20 %), back to the base. | Campaigns, mass retries, a cron that wakes every client at once. |
| Soak | Does it degrade over time? | The base rate, held for a long time. | For memory leaks, exhausted pools, growing caches. |

The ramp is not measured against the thresholds: the first seconds carry cold connections and cold caches.

## Mixes

A mix splits the traffic between targets with **relative weights**. Every GET of the contract is already a target; `load.targets` adds variants that walk a different query plan (a search, a filter). Every API gets three mixes with no configuration:

- **Every GET in the project**: finds the operation that degrades first.
- **Lists only**: the reads that walk the most rows.
- **Health**: the latency floor to read the others against.

```json
"mixes": [
  { "id": "browse", "label": { "es": "Navegación", "en": "Browsing" },
    "targets": [{ "target": "listOrders", "weight": 30 }, { "target": "getOrder", "weight": 70 }] }
]
```

## Placeholder data

Each `{placeholder}` in a path is filled at send time with a value from `load.data`, drawn with a **Zipf** distribution (a few values take most of the traffic, as in reality). Uniform values would give an almost always cold cache; a fixed one, an always warm cache.

```json
"data": { "order_id": ["1", "2", "3", "4"], "q": ["lamp", "mug"] }
```

A nested path uses **one correlated placeholder** for all its ids: `/orders/{order_id}/items/{item_id}` is sent as `/orders/{item_path}`, with values like `7/items/3`. An item only exists under its own order: drawing both ids independently would almost always give a 404.

If you give no data in a shared environment, the API reads real ids with `seed.sources` when the test starts.

## Preflight

Before the load, **one request per target** is sent with the first value of each list. A target whose data does not exist would answer 404 to thousands of requests and the verdict would say "40 % errors": true, but about the data. What to do when a target fails (`onPreflightFailure`):

- `skip` (default): that target is left out and the test goes on.
- `stop`: nothing is sent.
- `ignore`: no preflight.

## Verdict

Every type shares:

- **Errors < 0.1 %** over the measured stages.
- **Latency**: each target's p95 under its threshold. The threshold comes from the project's budgets (`latency.mode: "project"`), from a p95 of your own (`"custom"`, useful across a VPN or gateway) or from none (`"off"`, informative only).

And each type adds its question:

- **Load and soak**: sustains the requested rate (delivered ≥ 95 %, nothing dropped).
- **Stress**: sustained capacity (the last step before the first one that breaks), the breaking point (informative) and whether it fails in a controlled way: no 500s or dropped connections.
- **Spike**: errors outside the spike < 0.1 %; during the spike 429/503 are tolerated (gateway protection) but not 500s, timeouts or dropped connections; it recovers if the p95 of the second half of the return is ≤ 1.5× the base's.
- **Soak**: the p95 of the last 20 % stays within 1.3× the first 20 %'s.

A test stopped by hand has no verdict.

## Shared environments

Load hits a service other people use. In an environment without the seed, the app asks for explicit confirmation before starting; coordinate the test with whoever runs that environment and start with low rates.

## Get started

The [Load test](guide:load) guide walks through type, mix, stages with their chart, and thresholds.
