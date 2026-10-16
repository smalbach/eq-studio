/**
 * Load and stress tests, as data and as one engine.
 *
 * A functional run measures one request at a time: the p95 of a single client asking politely,
 * which says nothing about what the API does at its expected traffic. Four kinds of traffic
 * test answer four different questions — a load test that passes says nothing about twice the
 * traffic, nor about whether the service recovers:
 *
 * | Type      | Question                                         |
 * |-----------|--------------------------------------------------|
 * | `load`    | Does it meet the targets at nominal traffic?     |
 * | `stress`  | Where does it break, and **how**?                |
 * | `spike`   | Does it survive an instantaneous jump?           |
 * | `soak`    | Does it degrade over time?                       |
 *
 * **Open model, not closed.** The targets are rates (req/s), so the generator sends at a rate
 * and does not wait for the previous answer to send the next one. A closed model — N users in a
 * loop — slows down when the API slows down and hides exactly the saturation a stress test is
 * looking for ("coordinated omission"). When the in-flight cap is reached the arrival is
 * **dropped and counted**, never silently delayed, the same as k6's `dropped_iterations`.
 *
 * **GET only.** Repeating a write hundreds of times creates hundreds of rows in a shared
 * environment. The targets and mixes come from the project: every GET of its contract, plus the
 * variants and mixes its load configuration declares.
 *
 * Plain `.mjs` and no framework: the dashboard's `/api/load` route, the API's run worker and
 * `tests/load.test.mjs` (under `node --test`, with a fake clock) all run this same engine.
 */
import { budgetFor, percentile } from "./budgets.mjs";
import { tr } from "./i18n.mjs";

export const LOAD_LIMITS = { maxRps: 500, maxDurationS: 1800, maxInFlight: 512, timeoutMs: 10_000, maxTargets: 30 };

/** The error rate any GET profile must stay under. */
export const ERROR_RATE_MAX = 0.001;
/** A stage that delivers less than this fraction of its rate did not sustain it. */
export const THROUGHPUT_FLOOR = 0.95;

export const TEST_TYPES = [
  { id: "load", label: "Carga", question: "¿Cumple los objetivos con el tráfico nominal?", hint: "Rampa corta hasta la tasa base y la sostiene. Pasa si el p95 de cada objetivo queda bajo su presupuesto, los errores bajo 0,1 % y la tasa entregada ≥ 95 % de la pedida.",
    en: { label: "Load", question: "Does it meet the targets at nominal traffic?", hint: "A short ramp up to the base rate, then held. Passes if every target's p95 stays under its budget, errors under 0.1 % and the delivered rate ≥ 95 % of the requested one." } },
  { id: "stress", label: "Estrés", question: "¿Dónde se rompe y cómo se rompe?", hint: "Cinco escalones de la tasa base a la pico. Reporta el último escalón sostenido y el primero que se rompe, con el motivo: errores, latencia o tasa no entregada.",
    en: { label: "Stress", question: "Where does it break, and how?", hint: "Five steps from the base rate to the peak. Reports the last step it sustained and the first one that breaks, with the reason: errors, latency or rate not delivered." } },
  { id: "spike", label: "Pico", question: "¿Sobrevive a un salto instantáneo?", hint: "Base, salto sin rampa a la tasa pico y regreso a la base. Durante el pico se tolera que el gateway rechace con 429/503; no se toleran 500, timeouts ni conexiones caídas. Lo que importa es la recuperación: el p95 de la segunda mitad del regreso debe volver a ≤ 1,5× el de la base.",
    en: { label: "Spike", question: "Does it survive an instantaneous jump?", hint: "Base, a jump with no ramp to the peak rate, and back to the base. During the spike the gateway may reject with 429/503; 500s, timeouts and dropped connections are not tolerated. What matters is the recovery: the p95 of the second half of the return must come back to ≤ 1.5× the base's." } },
  { id: "soak", label: "Resistencia", question: "¿Se degrada con el tiempo?", hint: "Tasa base sostenida. Compara el p95 de todas las solicitudes del primer 20 % de la prueba con el del último 20 %: más de 1,3× es degradación (fugas, pool, caché que crece).",
    en: { label: "Soak", question: "Does it degrade over time?", hint: "The base rate, sustained. Compares the p95 of every request in the first 20 % of the test with the last 20 %: more than 1.3× is degradation (leaks, pool, a growing cache)." } },
];

/**
 * The texts of a test type, mix or latency mode in the active language: the Spanish fields are
 * the item itself, the English ones live under `en`.
 * @template {{ en?: object }} T @param {T} item @param {"es" | "en"} [locale] @returns {T}
 */
export const localized = (item, locale = "es") => locale === "en" && item?.en ? { ...item, ...item.en } : item;

/**
 * Every GET of the project as a load target, plus the variants its load configuration declares
 * (a search, a filter, a geographic radius — reads that hit a different query plan). A list
 * that takes `limit` is asked for a page of 20, as a client would.
 *
 * A nested read takes one **correlated** placeholder for all its ids: `/orders/{order_id}/items/
 * {item_id}` becomes `/orders/{item_path}`, drawn from values like `7/items/3`. An item id only
 * exists under its own order, and drawing the two independently makes most requests a 404.
 *
 * @param {{ id: string, method: string, path: string, tag: string, parameters?: string[] }[]} operations
 * @param {{ targets?: { id: string, label: string, path: string, tag?: string }[] }} [config]
 * @returns {{ id: string, tag: string, label: string, path: string, template?: string }[]}
 */
export function loadCatalog(operations, config = {}) {
  const gets = operations.filter((operation) => operation.method === "GET").map((operation) => {
    const list = !operation.path.split("/").pop()?.startsWith("{");
    const page = list && operation.parameters?.includes("limit") ? "?limit=20" : "";
    const names = placeholdersOf(operation.path);
    if (names.length < 2) return { id: operation.id, tag: operation.tag, label: `GET ${operation.path}`, path: `${operation.path}${page}` };
    const start = operation.path.indexOf("{");
    const key = correlatedKey(names.at(-1));
    return { id: operation.id, tag: operation.tag, label: `GET ${operation.path}`, path: `${operation.path.slice(0, start)}{${key}}${page}`, template: operation.path.slice(start) };
  });
  const extra = (config.targets ?? []).map((target) => ({ id: target.id, tag: target.tag ?? "Variants", label: target.label, path: target.path }));
  return [...gets, ...extra];
}

/** The correlated placeholder of a nested id: `review_id` → `review_path`. */
export const correlatedKey = (name) => `${String(name).replace(/_?id$/i, "") || name}_path`;

/** The placeholders of a path, in order. */
export function placeholdersOf(path) {
  return [...String(path).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]);
}

/** Every placeholder the catalog's targets carry: the data lists a load test needs. */
export function dataKeysOf(catalog) {
  return [...new Set(catalog.flatMap((target) => placeholdersOf(target.path)))];
}

/** A text given once, or as `{ es, en }`. @param {unknown} text @param {"es" | "en"} locale */
const textIn = (text, locale) => typeof text === "string" ? text : text && typeof text === "object" ? /** @type {Record<string, string>} */ (text)[locale] ?? "" : "";

/** The profiles every project gets, whatever its configuration says; their targets are filled in. */
const GENERIC_MIXES = [
  { id: "all-gets", label: "Todos los GET del proyecto", hint: "Cada lectura del contrato y sus variantes con el mismo peso: encuentra la operación que se degrada primero. Los objetivos sin datos en el entorno se omiten en la verificación previa.", en: { label: "Every GET in the project", hint: "Every read of the contract and its variants with equal weight: finds the operation that degrades first. Targets with no data in the environment are skipped in the preflight." } },
  { id: "lists", label: "Solo listados", hint: "Las lecturas sin identificador: las que más filas recorren por solicitud.", en: { label: "Lists only", hint: "The reads with no identifier: the ones that walk the most rows per request." } },
  { id: "health", label: "Health", hint: "Solo el endpoint de salud: el piso de latencia contra el que se leen los demás.", en: { label: "Health", hint: "Only the health endpoint: the latency floor the others are read against." } },
];

/**
 * The traffic profiles: the project's own, then three that need no configuration. `{name}` in a
 * path is filled from the data lists at send time. The weights are relative.
 *
 * @param {{ id: string, tag: string, label: string, path: string }[]} catalog
 * @param {{ mixes?: { id: string, label: unknown, hint?: unknown, targets: { target: string, weight: number }[] }[] }} [config]
 */
export function loadMixes(catalog, config = {}) {
  const byId = new Map(catalog.map((target) => [target.id, target]));
  const toTarget = (target, weight = 1) => ({ label: target.label, method: "GET", path: target.path, weight });
  const own = (config.mixes ?? []).map((mix) => ({
    id: mix.id,
    label: textIn(mix.label, "es"),
    hint: textIn(mix.hint, "es"),
    en: { label: textIn(mix.label, "en"), hint: textIn(mix.hint, "en") },
    targets: mix.targets.flatMap((item) => { const target = byId.get(item.target); return target ? [toTarget(target, item.weight)] : []; }),
  })).filter((mix) => mix.targets.length);
  const lists = catalog.filter((target) => !placeholdersOf(target.path.split("?")[0]).length);
  const health = catalog.filter((target) => /\/(health|healthz|ping|status)$/.test(target.path.split("?")[0]));
  const generic = [
    { ...GENERIC_MIXES[0], targets: catalog.slice(0, LOAD_LIMITS.maxTargets).map((target) => toTarget(target)) },
    { ...GENERIC_MIXES[1], targets: lists.slice(0, LOAD_LIMITS.maxTargets).map((target) => toTarget(target)) },
    { ...GENERIC_MIXES[2], targets: health.map((target) => toTarget(target)) },
  ].filter((mix) => mix.targets.length && !own.some((item) => item.id === mix.id));
  return [...own, ...generic];
}

/**
 * The starting data of each placeholder: the project's lists, or the seed's id `1`. A correlated
 * one is its template filled with the first value of each id — a path that exists in the seed.
 * @param {string[]} keys @param {{ data?: Record<string, string[]> }} [config] @param {{ path: string, template?: string }[]} [catalog]
 */
export function defaultLoadData(keys, config = {}, catalog = []) {
  const first = (name) => config.data?.[name]?.[0] ?? "1";
  const templates = new Map(catalog.filter((target) => target.template).map((target) => [placeholdersOf(target.path.split("?")[0]).at(-1), target.template]));
  return Object.fromEntries(keys.map((key) => {
    if (config.data?.[key]) return [key, config.data[key]];
    const template = templates.get(key);
    return [key, template ? [template.replace(/\{([A-Za-z0-9_]+)\}/g, (_, name) => first(name))] : ["1"]];
  }));
}

/**
 * The latency each target is held to.
 *
 * - `project` — the project's budget rules. They are budgets of the service, and only mean
 *   something measured from next to it.
 * - `custom` — one p95 limit for every target. Across a VPN or a gateway a request can spend
 *   hundreds of milliseconds before the API does anything, and every project budget would be
 *   red for a reason that is the path, not the API.
 * - `off` — latency is reported and decides nothing.
 */
export const LATENCY_MODES = [
  { id: "project", label: "Presupuestos del proyecto", en: { label: "Project budgets" } },
  { id: "custom", label: "Límite p95 propio", en: { label: "Custom p95 limit" } },
  { id: "off", label: "Solo informativa", en: { label: "Informative only" } },
];

/** @param {"es" | "en"} [locale] @returns {{ ms: number, label: string } | null} */
export function targetBudget(target, latency = { mode: "project" }, locale = "es") {
  if (latency?.mode === "off") return null;
  if (latency?.mode === "custom") return latency.p95Ms > 0 ? { ms: latency.p95Ms, label: tr(locale, `p95 < ${latency.p95Ms} ms (definido)`, `p95 < ${latency.p95Ms} ms (custom)`) } : null;
  const budget = budgetFor(latency?.rules ?? [], target.method ?? "GET", operationPathOf(target.path), target.path, locale);
  return budget ? { ms: budget.ms, label: budget.label } : null;
}

/**
 * The stages a test type walks, as rates over time. A stage goes linearly from `fromRps` to
 * `toRps`; a step is a stage whose two ends are equal.
 *
 * @param {string} type
 * @param {{ baseRps: number, peakRps: number, durationS: number }} options
 * @param {"es" | "en"} [locale] the language of the stage labels
 * @returns {{ label: string, durationS: number, fromRps: number, toRps: number, measured: boolean }[]}
 */
export function buildStages(type, { baseRps, peakRps, durationS }, locale = "es") {
  const base = Math.max(1, baseRps);
  const peak = Math.max(base, peakRps);
  const total = Math.max(5, durationS);
  if (type === "stress") {
    const steps = 5;
    const each = Math.max(2, Math.round(total / steps));
    return Array.from({ length: steps }, (_, index) => {
      const rate = Math.round(base + ((peak - base) * index) / (steps - 1));
      return { label: `${tr(locale, "Escalón", "Step")} ${index + 1} · ${rate} req/s`, durationS: each, fromRps: rate, toRps: rate, measured: true };
    });
  }
  if (type === "spike") {
    const before = Math.max(2, Math.round(total * 0.3));
    const jump = Math.max(2, Math.round(total * 0.2));
    const after = Math.max(2, total - before - jump);
    return [
      { label: `Base · ${base} req/s`, durationS: before, fromRps: base, toRps: base, measured: true },
      { label: `${tr(locale, "Pico", "Spike")} · ${peak} req/s`, durationS: jump, fromRps: peak, toRps: peak, measured: true },
      { label: `${tr(locale, "Recuperación", "Recovery")} · ${base} req/s`, durationS: after, fromRps: base, toRps: base, measured: true },
    ];
  }
  // A ramp is not measured against the targets: the first seconds of any run carry cold
  // connections and a cold cache, which no latency budget is meant to cover.
  const ramp = type === "soak" ? Math.min(5, Math.round(total * 0.05)) : Math.min(10, Math.max(1, Math.round(total * 0.2)));
  return [
    { label: `${tr(locale, "Rampa", "Ramp")} · 0 → ${base} req/s`, durationS: ramp, fromRps: 0, toRps: base, measured: false },
    { label: `${tr(locale, "Sostenido", "Sustained")} · ${base} req/s`, durationS: Math.max(1, total - ramp), fromRps: base, toRps: base, measured: true },
  ];
}

/** The rate a stage list asks for at `t` seconds, and which stage that is. */
export function rateAt(stages, t) {
  let start = 0;
  for (const [index, stage] of stages.entries()) {
    if (t < start + stage.durationS) {
      const progress = stage.durationS ? (t - start) / stage.durationS : 1;
      return { rps: stage.fromRps + (stage.toRps - stage.fromRps) * progress, stage: index };
    }
    start += stage.durationS;
  }
  return { rps: 0, stage: -1 };
}

export function totalDuration(stages) {
  return stages.reduce((total, stage) => total + stage.durationS, 0);
}

/** How many requests a stage list sends, give or take the rounding of the scheduler. */
export function expectedRequests(stages) {
  return Math.round(stages.reduce((total, stage) => total + ((stage.fromRps + stage.toRps) / 2) * stage.durationS, 0));
}

/**
 * A Zipf sampler over `size` items: item `k` (1-based) has weight `1 / k^alpha`. With
 * α ≈ 1.2, ~20 % of the items take ~80 % of the picks — how real traffic concentrates on a few
 * popular keys. Uniform would give a cache hit ratio near zero and always the same key would
 * give 100 %: both pass or fail for a reason that is not the API.
 *
 * @param {number} size
 * @param {number} [alpha]
 * @param {() => number} [random]
 */
export function zipfSampler(size, alpha = 1.2, random = Math.random) {
  if (size <= 1) return () => 0;
  const cdf = [];
  let sum = 0;
  for (let k = 1; k <= size; k += 1) { sum += 1 / k ** alpha; cdf.push(sum); }
  return () => {
    const point = random() * sum;
    let low = 0;
    let high = size - 1;
    while (low < high) { const middle = (low + high) >> 1; if (cdf[middle] < point) low = middle + 1; else high = middle; }
    return low;
  };
}

/** The templated path without its query, the shape `budgetFor` and the contract speak. */
export function operationPathOf(template) {
  return template.split("?")[0];
}

/**
 * Turns targets and data lists into a function that yields the next request. Weighted pick of
 * the target, then each placeholder from its list — the `zipf` keys by Zipf, the rest uniform.
 */
export function requestPicker(targets, data, { alpha = 1.2, random = Math.random, zipf = [] } = {}) {
  const totalWeight = targets.reduce((sum, target) => sum + Math.max(0, target.weight), 0) || 1;
  const lists = Object.fromEntries(Object.entries(data).map(([key, values]) => [key, values.filter(Boolean)]));
  const samplers = Object.fromEntries(Object.entries(lists).map(([key, values]) => [key, zipf.includes(key) ? zipfSampler(values.length, alpha, random) : () => Math.floor(random() * values.length)]));
  // A `_path` value is several segments (`11/reviews/9`): each segment is encoded, the slashes
  // between them are not.
  const encode = (name, value) => name.endsWith("_path") ? String(value).split("/").map(encodeURIComponent).join("/") : encodeURIComponent(value);
  return () => {
    let point = random() * totalWeight;
    let index = 0;
    for (; index < targets.length - 1; index += 1) { point -= Math.max(0, targets[index].weight); if (point < 0) break; }
    const target = targets[index];
    const path = target.path.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => {
      const values = lists[name];
      return values?.length ? encode(name, values[samplers[name]()]) : match;
    });
    return { index, path };
  };
}

/**
 * Rejects a plan the engine should never run, with a message meant for the panel.
 * @param {any} plan @param {"es" | "en"} [locale]
 */
export function validatePlan(plan, locale = "es") {
  const problems = [];
  let base;
  try { base = new URL(plan.baseUrl); } catch { problems.push(tr(locale, "La URL base no es válida.", "The base URL is not valid.")); }
  if (base && !["http:", "https:"].includes(base.protocol)) problems.push(tr(locale, "Solo se permiten URLs HTTP o HTTPS.", "Only HTTP or HTTPS URLs are allowed."));
  if (!Array.isArray(plan.targets) || plan.targets.length === 0) problems.push(tr(locale, "No hay ningún objetivo que ejecutar.", "There is no target to run."));
  if (plan.targets?.length > LOAD_LIMITS.maxTargets) problems.push(tr(locale, `Máximo ${LOAD_LIMITS.maxTargets} objetivos.`, `At most ${LOAD_LIMITS.maxTargets} targets.`));
  for (const target of plan.targets ?? []) {
    if (String(target.method).toUpperCase() !== "GET") problems.push(tr(locale, `${target.method} ${target.path}: las pruebas de carga solo envían GET.`, `${target.method} ${target.path}: load tests only send GET.`));
    if (!String(target.path).startsWith("/")) problems.push(tr(locale, `${target.path}: la ruta debe empezar por /.`, `${target.path}: the path must start with /.`));
  }
  if (!Array.isArray(plan.stages) || plan.stages.length === 0) problems.push(tr(locale, "El plan no tiene etapas.", "The plan has no stages."));
  for (const stage of plan.stages ?? []) {
    if (!(stage.durationS > 0)) problems.push(tr(locale, "Cada etapa necesita una duración positiva.", "Every stage needs a positive duration."));
    if (Math.max(stage.fromRps, stage.toRps) > LOAD_LIMITS.maxRps) problems.push(tr(locale, `Máximo ${LOAD_LIMITS.maxRps} req/s.`, `At most ${LOAD_LIMITS.maxRps} req/s.`));
  }
  if (totalDuration(plan.stages ?? []) > LOAD_LIMITS.maxDurationS) problems.push(tr(locale, `Máximo ${LOAD_LIMITS.maxDurationS / 60} minutos.`, `At most ${LOAD_LIMITS.maxDurationS / 60} minutes.`));
  return [...new Set(problems)];
}

/** Why a request did not count as a success. Each has a different owner. */
export const ERROR_KINDS = {
  rateLimited: "429 · límite de tasa (gateway)",
  client: "4xx · datos o credencial",
  server: "5xx · la API o el gateway falló",
  timeout: "Timeout",
  network: "Conexión caída",
  unexpected: "Otro status inesperado",
};
/** `ERROR_KINDS` in English. */
export const ERROR_KINDS_EN = {
  rateLimited: "429 · rate limit (gateway)",
  client: "4xx · data or credential",
  server: "5xx · the API or the gateway failed",
  timeout: "Timeout",
  network: "Connection dropped",
  unexpected: "Other unexpected status",
};
/** @param {"es" | "en"} [locale] @returns {Record<string, string>} */
export const errorKinds = (locale = "es") => locale === "en" ? ERROR_KINDS_EN : ERROR_KINDS;

/** The latency histogram's upper bounds, in ms. The last bucket is open. */
export const HISTOGRAM_BOUNDS = [10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000];

export function classify(outcome) {
  if (outcome.ok) return null;
  if (outcome.error === "timeout") return "timeout";
  if (!outcome.status) return "network";
  if (outcome.status === 429) return "rateLimited";
  if (outcome.status >= 500) return "server";
  if (outcome.status >= 400) return "client";
  return "unexpected";
}

function emptyBucket() {
  return { sent: 0, completed: 0, errors: 0, dropped: 0, bytes: 0, latencies: [], statuses: {}, kinds: {} };
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/** Latency statistics of a sample: the percentiles plus mean, spread and the extremes. */
export function latencyStats(latencies) {
  if (!latencies.length) return { min: 0, mean: 0, stddev: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, p999: 0, max: 0 };
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const value of latencies) { sum += value; if (value < min) min = value; if (value > max) max = value; }
  const mean = sum / latencies.length;
  let squares = 0;
  for (const value of latencies) squares += (value - mean) ** 2;
  const sorted = [...latencies].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
  return { min, mean: round1(mean), stddev: round1(Math.sqrt(squares / latencies.length)), p50: at(50), p75: at(75), p90: at(90), p95: at(95), p99: at(99), p999: at(99.9), max };
}

/** Apdex over a threshold T: satisfied ≤ T, tolerating ≤ 4T, the rest — errors included — frustrated. */
export function apdex(latencies, errors, threshold) {
  if (!threshold || !(latencies.length + errors)) return null;
  let satisfied = 0;
  let tolerating = 0;
  for (const value of latencies) { if (value <= threshold) satisfied += 1; else if (value <= threshold * 4) tolerating += 1; }
  return Math.round(((satisfied + tolerating / 2) / (latencies.length + errors)) * 1000) / 1000;
}

export function histogram(latencies) {
  const counts = new Array(HISTOGRAM_BOUNDS.length + 1).fill(0);
  for (const value of latencies) {
    const index = HISTOGRAM_BOUNDS.findIndex((bound) => value <= bound);
    counts[index === -1 ? HISTOGRAM_BOUNDS.length : index] += 1;
  }
  return counts.map((count, index) => ({ label: index === HISTOGRAM_BOUNDS.length ? `> ${HISTOGRAM_BOUNDS.at(-1)}` : `≤ ${HISTOGRAM_BOUNDS[index]}`, count }));
}

function summarizeBucket(bucket, seconds) {
  const errorRate = bucket.completed ? bucket.errors / bucket.completed : 0;
  return {
    sent: bucket.sent,
    completed: bucket.completed,
    errors: bucket.errors,
    dropped: bucket.dropped,
    errorRate,
    successRate: bucket.completed ? 1 - errorRate : 0,
    rps: seconds > 0 ? bucket.completed / seconds : 0,
    bytes: bucket.bytes,
    kbps: seconds > 0 ? round1(bucket.bytes / 1024 / seconds) : 0,
    ...latencyStats(bucket.latencies),
    statuses: bucket.statuses,
    kinds: bucket.kinds,
  };
}

function record(bucket, outcome) {
  bucket.completed += 1;
  const kind = classify(outcome);
  if (kind) { bucket.errors += 1; bucket.kinds[kind] = (bucket.kinds[kind] ?? 0) + 1; }
  if (outcome.latency != null) bucket.latencies.push(outcome.latency);
  bucket.bytes += outcome.bytes ?? 0;
  const key = outcome.status ? String(outcome.status) : outcome.error ?? "error";
  bucket.statuses[key] = (bucket.statuses[key] ?? 0) + 1;
}

/**
 * Runs a plan and reports a window per second through `onTick`.
 *
 * Everything the clock and the network do is injected, so the test drives it with a fake
 * clock and a fake fetch and the route drives it with the real ones.
 *
 * @param {{ baseUrl: string, headers?: Record<string, string>, targets: { label: string, method: string, path: string, weight: number, expectStatus?: number }[], data?: Record<string, string[]>, stages: ReturnType<typeof buildStages>, timeoutMs?: number, maxInFlight?: number, zipfAlpha?: number, locale?: "es" | "en" }} plan
 * @param {{ fetchImpl?: typeof fetch, now?: () => number, sleep?: (ms: number) => Promise<void>, random?: () => number, isAborted?: () => boolean, onTick?: (window: object) => void | Promise<void>, tickMs?: number }} [runtime]
 */
export async function runLoad(plan, runtime = {}) {
  const fetchImpl = runtime.fetchImpl ?? fetch;
  const now = runtime.now ?? (() => performance.now());
  const sleep = runtime.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const isAborted = runtime.isAborted ?? (() => false);
  const tickMs = runtime.tickMs ?? 20;
  const timeoutMs = Math.min(LOAD_LIMITS.timeoutMs, plan.timeoutMs ?? LOAD_LIMITS.timeoutMs);
  const maxInFlight = Math.min(LOAD_LIMITS.maxInFlight, plan.maxInFlight ?? 256);
  const base = plan.baseUrl.replace(/\/+$/, "");
  const pick = requestPicker(plan.targets, plan.data ?? {}, { alpha: plan.zipfAlpha ?? 1.2, random: runtime.random, zipf: plan.zipf ?? [] });
  const duration = totalDuration(plan.stages);

  const overall = emptyBucket();
  const perTarget = plan.targets.map(() => emptyBucket());
  const perStage = plan.stages.map(() => emptyBucket());
  const windows = [];
  // The raw latencies of each window, kept off the stream: spike and soak compare a p95 over a
  // stretch of the run, and a median of one-second p95s (20 samples each at 20 req/s) is mostly
  // the noise of whichever request was slowest in each second.
  const windowLatencies = [];
  let window = emptyBucket();
  let windowIndex = 0;
  let inFlight = 0;
  let peakInFlight = 0;
  let firstErrorS = null;
  let credit = 0;
  let aborted = false;
  const pending = new Set();

  const start = now();
  let last = start;

  const send = (stageIndex) => {
    const { index, path } = pick();
    const target = plan.targets[index];
    const expected = target.expectStatus ?? 200;
    overall.sent += 1; perTarget[index].sent += 1; perStage[stageIndex].sent += 1; window.sent += 1;
    inFlight += 1;
    if (inFlight > peakInFlight) peakInFlight = inFlight;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const sentAt = now();
    const job = (async () => {
      let outcome;
      try {
        const response = await fetchImpl(`${base}${path}`, { method: "GET", headers: { Accept: "application/json", ...(plan.headers ?? {}) }, signal: controller.signal });
        // The body is read in full: a latency that stops at the headers would flatter a slow
        // serializer, and an unread body keeps the connection out of the pool.
        const payload = await response.arrayBuffer();
        outcome = { ok: response.status === expected, status: response.status, latency: Math.round((now() - sentAt) * 10) / 10, bytes: payload?.byteLength ?? 0 };
      } catch (error) {
        outcome = { ok: false, status: 0, latency: null, error: controller.signal.aborted ? "timeout" : (error?.cause?.code ?? "network") };
      } finally {
        clearTimeout(timer);
        inFlight -= 1;
      }
      if (!outcome.ok && firstErrorS == null) firstErrorS = round1((now() - start) / 1000);
      for (const bucket of [overall, perTarget[index], perStage[stageIndex], window]) record(bucket, outcome);
    })();
    pending.add(job);
    job.finally(() => pending.delete(job));
  };

  while (true) {
    if (isAborted()) { aborted = true; break; }
    const t = now();
    const elapsed = (t - start) / 1000;
    if (elapsed >= duration) break;
    const { rps, stage } = rateAt(plan.stages, elapsed);
    credit += rps * ((t - last) / 1000);
    last = t;
    while (credit >= 1) {
      credit -= 1;
      if (inFlight >= maxInFlight) { overall.dropped += 1; perStage[stage].dropped += 1; window.dropped += 1; continue; }
      send(stage);
    }
    if (elapsed >= windowIndex + 1) {
      const summary = { t: windowIndex + 1, targetRps: Math.round(rps * 10) / 10, stage, inFlight, ...summarizeBucket(window, 1) };
      windows.push(summary);
      windowLatencies.push(window.latencies);
      await runtime.onTick?.({ type: "tick", window: summary });
      window = emptyBucket();
      windowIndex += 1;
    }
    await sleep(tickMs);
  }
  // What is still in flight finishes and counts: cutting it off would drop exactly the slowest
  // requests and make the tail look better than it was.
  await Promise.allSettled([...pending]);
  if (window.sent || window.completed) {
    // The drain window: nothing new is requested, only the stragglers land. It carries no
    // requested rate rather than a 0 that would draw the plan collapsing at the end.
    const summary = { t: windowIndex + 1, targetRps: null, drain: true, stage: plan.stages.length - 1, inFlight: 0, ...summarizeBucket(window, 1) };
    windows.push(summary);
    windowLatencies.push(window.latencies);
    await runtime.onTick?.({ type: "tick", window: summary });
  }
  const elapsedS = Math.max(0.001, (now() - start) / 1000);
  const latency = plan.latency ?? { mode: "project" };
  const locale = plan.locale === "en" ? "en" : "es";
  const budgets = plan.targets.map((target) => targetBudget(target, latency, locale));
  const tightest = budgets.filter(Boolean).map((budget) => budget.ms);
  const overallThreshold = tightest.length ? Math.max(...tightest) : null;
  const active = windows.filter((item) => item.completed > 0 && !item.drain);
  const report = {
    aborted,
    elapsedS: round1(elapsedS),
    latencyMode: latency,
    overall: {
      ...summarizeBucket(overall, elapsedS),
      apdex: apdex(overall.latencies, overall.errors, overallThreshold),
      apdexThresholdMs: overallThreshold,
      peakRps: active.length ? Math.max(...active.map((item) => item.rps)) : 0,
      minRps: active.length ? Math.min(...active.map((item) => item.rps)) : 0,
      peakInFlight,
      firstErrorS,
      requested: expectedRequests(plan.stages),
    },
    histogram: histogram(overall.latencies),
    targets: plan.targets.map((target, index) => {
      const budget = budgets[index];
      return { label: target.label, path: target.path, weight: target.weight, budgetMs: budget?.ms ?? null, budgetLabel: budget?.label ?? null, ...summarizeBucket(perTarget[index], elapsedS), apdex: apdex(perTarget[index].latencies, perTarget[index].errors, budget?.ms) };
    }),
    stages: plan.stages.map((stage, index) => ({ ...stage, ...summarizeBucket(perStage[index], stage.durationS) })),
    windows,
    phases: phaseLatencies(plan.stages, windows, windowLatencies),
  };
  return { ...report, verdict: evaluate(plan.type ?? "load", report, locale) };
}

/**
 * Pooled latencies of the stretches spike and soak are judged on. The drain window is left out:
 * it holds only the stragglers of the last second, the slowest requests of the run by
 * construction, and it used to count as "the end of the recovery".
 */
function phaseLatencies(stages, windows, windowLatencies) {
  const pooled = (indexes) => indexes.flatMap((index) => windowLatencies[index] ?? []);
  const stats = (values) => ({ samples: values.length, p50: percentile(values, 50), p95: percentile(values, 95) });
  const indexes = windows.map((window, index) => ({ window, index })).filter(({ window }) => !window.drain && window.completed > 0);
  const ofStage = (stage) => indexes.filter(({ window }) => window.stage === stage).map(({ index }) => index);
  const measured = indexes.filter(({ window }) => stages[window.stage]?.measured).map(({ index }) => index);
  const slice = Math.max(1, Math.floor(measured.length * 0.2));
  const recovery = ofStage(2);
  return {
    base: stats(pooled(ofStage(0))),
    peak: stats(pooled(ofStage(1))),
    recoveryTail: stats(pooled(recovery.slice(Math.floor(recovery.length / 2)))),
    first: stats(pooled(measured.slice(0, slice))),
    last: stats(pooled(measured.slice(-slice))),
    sliceS: slice,
  };
}

/** The tightest budget among the targets that carry one — the line a whole stage is held to. */
function stageBudget(report) {
  const budgets = report.targets.map((target) => target.budgetMs).filter((value) => value != null);
  return budgets.length ? Math.max(...budgets) : null;
}

function stageHolds(stage, budget, locale = "es") {
  const wanted = (stage.fromRps + stage.toRps) / 2;
  if (stage.completed === 0) return { pass: false, reason: tr(locale, "sin respuestas", "no responses") };
  if (stage.errorRate > ERROR_RATE_MAX) return { pass: false, reason: tr(locale, `errores ${(stage.errorRate * 100).toFixed(2)} %`, `errors ${(stage.errorRate * 100).toFixed(2)} %`) };
  if (budget != null && stage.p95 >= budget) return { pass: false, reason: `p95 ${stage.p95} ms ≥ ${budget} ms` };
  if (stage.dropped > 0 || stage.rps < wanted * THROUGHPUT_FLOOR) return { pass: false, reason: tr(locale, `entregó ${stage.rps.toFixed(1)} de ${wanted} req/s${stage.dropped ? ` · ${stage.dropped} descartadas por saturación` : ""}`, `delivered ${stage.rps.toFixed(1)} of ${wanted} req/s${stage.dropped ? ` · ${stage.dropped} dropped by saturation` : ""}`) };
  return { pass: true, reason: "" };
}

/**
 * The verdict, as the same `{ label, pass, detail }` assertions a functional case carries.
 *
 * Every type shares the error and latency checks over the measured stages. Then each adds the
 * one question it exists for: stress names its breaking point, spike its recovery, soak its
 * drift. A test that was aborted is reported as such and never as a pass. The labels and details
 * are in `locale` (Spanish by default): saved runs keep the language they were run in.
 */
export function evaluate(type, report, locale = "es") {
  const t = (es, en) => tr(locale, es, en);
  const checks = [];
  const measured = report.stages.filter((stage) => stage.measured);
  const measuredBucket = measured.reduce((sum, stage) => ({ completed: sum.completed + stage.completed, errors: sum.errors + stage.errors }), { completed: 0, errors: 0 });
  const errorRate = measuredBucket.completed ? measuredBucket.errors / measuredBucket.completed : 0;
  if (report.aborted) checks.push({ label: t("Prueba completa", "Complete test"), pass: false, detail: t(`Detenida a los ${report.elapsedS} s: no hay veredicto sobre una prueba incompleta.`, `Stopped at ${report.elapsedS} s: there is no verdict on an incomplete test.`) });
  if (report.overall.completed === 0) checks.push({ label: t("Respuestas", "Responses"), pass: false, detail: t("Ninguna solicitud obtuvo respuesta: revisa la URL, el token y la VPN.", "No request got a response: check the URL, the token and the VPN.") });

  if (type === "load" || type === "soak") {
    checks.push({ label: t("Tasa de error < 0,1 %", "Error rate < 0.1 %"), pass: errorRate <= ERROR_RATE_MAX, detail: `${measuredBucket.errors} ${t("de", "of")} ${measuredBucket.completed} (${(errorRate * 100).toFixed(3)} %) · ${statusDetail(report.overall.statuses, locale)}${kindDetail(report.overall.kinds, locale)}` });
    if (report.latencyMode?.mode === "off") checks.push({ label: t("Latencia (informativa)", "Latency (informative)"), pass: true, detail: `p50 ${report.overall.p50} ms · p95 ${report.overall.p95} ms · p99 ${report.overall.p99} ms — ${t("no decide el veredicto", "does not decide the verdict")}` });
    for (const target of report.targets) {
      if (target.budgetMs == null || target.completed === 0) continue;
      checks.push({ label: `${target.label} p95 < ${target.budgetMs} ms`, pass: target.p95 < target.budgetMs, detail: `${target.completed} ${t("muestras", "samples")} · p50 ${target.p50} ms · p95 ${target.p95} ms · p99 ${target.p99} ms` });
    }
  }

  if (type === "load" || type === "soak") {
    const hold = measured.at(-1);
    if (hold) {
      const wanted = hold.toRps;
      checks.push({ label: t(`Sostiene ${wanted} req/s`, `Sustains ${wanted} req/s`), pass: hold.dropped === 0 && hold.rps >= wanted * THROUGHPUT_FLOOR, detail: t(`entregó ${hold.rps.toFixed(1)} req/s (≥ ${Math.round(THROUGHPUT_FLOOR * 100)} %)${hold.dropped ? ` · ${hold.dropped} descartadas: el límite de concurrencia se alcanzó` : ""}`, `delivered ${hold.rps.toFixed(1)} req/s (≥ ${Math.round(THROUGHPUT_FLOOR * 100)} %)${hold.dropped ? ` · ${hold.dropped} dropped: the concurrency limit was reached` : ""}`) });
    }
  }

  if (type === "stress") {
    const budget = stageBudget(report);
    const verdicts = report.stages.map((stage) => ({ stage, ...stageHolds(stage, budget, locale) }));
    // The capacity is the last step *before* the first broken one: a step that holds after an
    // earlier one broke is a lucky window, not a capacity.
    const brokenIndex = verdicts.findIndex((item) => !item.pass);
    const broken = brokenIndex >= 0 ? verdicts[brokenIndex] : undefined;
    const lastHeld = (broken ? verdicts.slice(0, brokenIndex) : verdicts).at(-1);
    checks.push({ label: t("Capacidad sostenida", "Sustained capacity"), pass: Boolean(lastHeld), detail: lastHeld ? t(`${lastHeld.stage.toRps} req/s con p95 ${lastHeld.stage.p95} ms y ${(lastHeld.stage.errorRate * 100).toFixed(2)} % de errores`, `${lastHeld.stage.toRps} req/s with p95 ${lastHeld.stage.p95} ms and ${(lastHeld.stage.errorRate * 100).toFixed(2)} % errors`) : t(`Ni el primer escalón se sostuvo: ${verdicts[0]?.reason ?? "sin datos"}`, `Not even the first step held: ${verdicts[0]?.reason ?? "no data"}`) });
    // Informative, never red: finding the breaking point is the purpose of the test.
    checks.push({ label: t("Punto de quiebre", "Breaking point"), pass: true, detail: broken ? `${broken.stage.toRps} req/s — ${broken.reason}` : t(`No se alcanzó: sostuvo hasta ${report.stages.at(-1)?.toRps} req/s. Sube la tasa pico para encontrarlo.`, `Not reached: it held up to ${report.stages.at(-1)?.toRps} req/s. Raise the peak rate to find it.`) });
    // How it breaks: shedding load with a fast 503/429 is a controlled failure; a 500 or a
    // dropped connection is the service falling over.
    const uncontrolled = ["500", "network"].reduce((sum, key) => sum + (report.overall.statuses[key] ?? 0), 0);
    checks.push({ label: t("Falla de forma controlada", "Fails in a controlled way"), pass: report.overall.completed > 0 && uncontrolled === 0, detail: `${uncontrolled ? t(`${uncontrolled} respuestas 500 o conexiones caídas`, `${uncontrolled} 500 responses or dropped connections`) : t("Sin 500 ni conexiones caídas", "No 500s or dropped connections")} · ${statusDetail(report.overall.statuses, locale)}` });
  }

  if (type === "spike") {
    // The question is "does it survive the jump and come back", not "is the jump free": a peak
    // that the gateway sheds with 429/503 is the protection working. Errors and latency are
    // held to the targets on the base and the recovery; the peak only must not make the service
    // fall over (500s, timeouts, dropped connections).
    const [before, peak, after] = report.stages;
    const phases = report.phases;
    const calm = [before, after].filter(Boolean);
    const calmCompleted = calm.reduce((sum, stage) => sum + stage.completed, 0);
    const calmErrors = calm.reduce((sum, stage) => sum + stage.errors, 0);
    const calmRate = calmCompleted ? calmErrors / calmCompleted : 0;
    checks.push({ label: t("Errores fuera del pico < 0,1 %", "Errors outside the spike < 0.1 %"), pass: calmCompleted > 0 && calmRate <= ERROR_RATE_MAX, detail: t(`base y regreso: ${calmErrors} de ${calmCompleted} (${(calmRate * 100).toFixed(3)} %)`, `base and return: ${calmErrors} of ${calmCompleted} (${(calmRate * 100).toFixed(3)} %)`) });
    const budget = stageBudget(report);
    if (budget != null && phases) {
      const worst = Math.max(phases.base.p95, phases.recoveryTail.p95);
      checks.push({ label: t(`Latencia fuera del pico p95 < ${budget} ms`, `Latency outside the spike p95 < ${budget} ms`), pass: worst < budget, detail: t(`base ${phases.base.p95} ms · final del regreso ${phases.recoveryTail.p95} ms`, `base ${phases.base.p95} ms · end of the return ${phases.recoveryTail.p95} ms`) });
    }
    if (peak) {
      const kinds = peak.kinds ?? {};
      const shed = (kinds.rateLimited ?? 0) + (peak.statuses["503"] ?? 0);
      const fell = (kinds.server ?? 0) - (peak.statuses["503"] ?? 0) + (kinds.timeout ?? 0) + (kinds.network ?? 0);
      checks.push({ label: t("Sobrevive al pico", "Survives the spike"), pass: peak.completed > 0 && fell === 0, detail: t(
        `${peak.completed} respuestas a ${peak.toRps} req/s · p95 ${phases?.peak.p95 ?? peak.p95} ms · ${fell ? `${fell} fallas no controladas (5xx, timeouts o conexiones caídas)` : "sin fallas no controladas"}${shed ? ` · ${shed} rechazadas con 429/503 (protección del gateway, no cuenta como caída)` : ""}${peak.dropped ? ` · ${peak.dropped} descartadas por el límite de concurrencia` : ""}`,
        `${peak.completed} responses at ${peak.toRps} req/s · p95 ${phases?.peak.p95 ?? peak.p95} ms · ${fell ? `${fell} uncontrolled failures (5xx, timeouts or dropped connections)` : "no uncontrolled failures"}${shed ? ` · ${shed} rejected with 429/503 (gateway protection, not counted as a failure)` : ""}${peak.dropped ? ` · ${peak.dropped} dropped by the concurrency limit` : ""}`) });
    }
    const baseP95 = phases?.base.p95 ?? before?.p95 ?? 0;
    const tailP95 = phases?.recoveryTail.p95 ?? after?.p95 ?? 0;
    // ×1.5, with an absolute floor: across a gateway two calm stretches already differ by tens
    // of ms, and 1.5× of a 5 ms local p95 is a margin no real service can stay inside.
    const limit = Math.round(Math.max(baseP95 * 1.5, baseP95 + 50));
    checks.push({ label: t("Se recupera tras el pico", "Recovers after the spike"), pass: Boolean(after) && after.completed > 0 && tailP95 <= limit && after.errorRate <= ERROR_RATE_MAX, detail: t(
      `p95 base ${baseP95} ms · p95 en la segunda mitad del regreso ${tailP95} ms (límite ${limit} ms, ${phases?.recoveryTail.samples ?? 0} muestras) · errores del regreso ${((after?.errorRate ?? 0) * 100).toFixed(2)} %`,
      `base p95 ${baseP95} ms · p95 in the second half of the return ${tailP95} ms (limit ${limit} ms, ${phases?.recoveryTail.samples ?? 0} samples) · return errors ${((after?.errorRate ?? 0) * 100).toFixed(2)} %`) });
  }

  if (type === "soak") {
    const phases = report.phases;
    let first;
    let last;
    let detail = "";
    if (phases) {
      first = phases.first.p95; last = phases.last.p95;
      detail = t(` · primeros y últimos ${phases.sliceS} s, ${phases.first.samples} y ${phases.last.samples} muestras`, ` · first and last ${phases.sliceS} s, ${phases.first.samples} and ${phases.last.samples} samples`);
    } else {
      const windows = report.windows.filter((window) => window.completed > 0 && !window.drain && report.stages[window.stage]?.measured);
      const slice = Math.max(1, Math.floor(windows.length * 0.2));
      first = percentile(windows.slice(0, slice).map((window) => window.p95), 50);
      last = percentile(windows.slice(-slice).map((window) => window.p95), 50);
    }
    // ×1.3 with an absolute floor, for the same reason as the spike's recovery.
    const limit = Math.round(Math.max(first * 1.3, first + 50));
    const enough = phases ? phases.first.samples >= 20 && phases.last.samples >= 20 : true;
    checks.push({ label: t("Sin degradación en el tiempo", "No degradation over time"), pass: enough && last <= limit, detail: enough ? t(`p95 inicio ${first} ms → final ${last} ms (límite ${limit} ms)${detail}`, `p95 start ${first} ms → end ${last} ms (limit ${limit} ms)${detail}`) : t(`Muy pocas muestras para comparar inicio y final${detail}: alarga la prueba o sube la tasa.`, `Too few samples to compare start and end${detail}: make the test longer or raise the rate.`) });
  }
  return { pass: checks.length > 0 && checks.every((check) => check.pass), checks };
}

function kindDetail(kinds = {}, locale = "es") {
  const names = errorKinds(locale);
  const parts = Object.entries(kinds).filter(([, count]) => count > 0).map(([kind, count]) => `${names[kind] ?? kind}: ${count}`);
  return parts.length ? ` — ${parts.join(" · ")}` : "";
}

function statusDetail(statuses, locale = "es") {
  return Object.entries(statuses).sort(([, a], [, b]) => b - a).map(([status, count]) => `${status}×${count}`).join(" · ") || tr(locale, "sin respuestas", "no responses");
}

/**
 * One request per target before the load starts, with the first value of each data list.
 *
 * A target whose data does not exist in the environment answers 404 to every one of the
 * thousands of requests the test then sends, and the verdict reads "error rate 40 %" — true, and
 * about the data. The preflight names that target before anything is sent at volume.
 *
 * @param {{ baseUrl: string, headers?: Record<string, string>, targets: { label: string, path: string, weight: number, expectStatus?: number }[], data?: Record<string, string[]>, timeoutMs?: number, locale?: "es" | "en" }} plan
 */
export async function preflight(plan, { fetchImpl = fetch, now = () => performance.now() } = {}) {
  const t = (es, en) => tr(plan.locale, es, en);
  const base = plan.baseUrl.replace(/\/+$/, "");
  const data = plan.data ?? {};
  const results = [];
  for (const target of plan.targets) {
    if (!(target.weight > 0)) continue;
    const missing = placeholdersOf(target.path).filter((name) => !(data[name] ?? []).filter(Boolean).length);
    if (missing.length) { results.push({ label: target.label, path: target.path, ok: false, status: null, latency: null, problem: `${t("Sin datos para", "No data for")} ${missing.map((name) => `{${name}}`).join(", ")}` }); continue; }
    const path = requestPicker([target], data, { random: () => 0 })().path;
    const expected = target.expectStatus ?? 200;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(LOAD_LIMITS.timeoutMs, plan.timeoutMs ?? LOAD_LIMITS.timeoutMs));
    const sentAt = now();
    try {
      const response = await fetchImpl(`${base}${path}`, { method: "GET", headers: { Accept: "application/json", ...(plan.headers ?? {}) }, signal: controller.signal });
      await response.arrayBuffer();
      const ok = response.status === expected;
      results.push({ label: target.label, path, ok, status: response.status, latency: round1(now() - sentAt), problem: ok ? "" : response.status === 404 ? t("404: el recurso no existe en este entorno", "404: the resource does not exist in this environment") : response.status === 401 || response.status === 403 ? t(`${response.status}: revisa el token`, `${response.status}: check the token`) : t(`Responde ${response.status}, se espera ${expected}`, `Answers ${response.status}, expected ${expected}`) });
    } catch {
      results.push({ label: target.label, path, ok: false, status: null, latency: null, problem: controller.signal.aborted ? "Timeout" : t("Sin conexión", "No connection") });
    } finally {
      clearTimeout(timer);
    }
  }
  return results;
}

/**
 * The data lists of an environment, read from its own listings: the ids that exist there.
 * The defaults are the seed's, and against any other environment they make the by-id targets
 * a stream of 404s.
 *
 * @param {(path: string, operationPath: string) => Promise<{ status: number, body: unknown } | null>} getJson
 * @param {{ name: string, path: string, operationPath: string, needs?: string }[]} sources where each id is listed
 * @param {{ dataKey?: string, idFallbackKey?: string }} [envelope]
 */
export async function discoverLoadData(getJson, sources, { dataKey = "data", idFallbackKey = "id" } = {}) {
  /** @type {Record<string, string[]>} */
  const data = {};
  let failed = false;
  const read = async (path, operationPath, name) => {
    const response = await getJson(path, operationPath).catch(() => null);
    if (response?.status !== 200) return null;
    const payload = /** @type {Record<string, unknown>} */ (response.body);
    const rows = /** @type {Record<string, unknown>[]} */ ((dataKey ? payload?.[dataKey] : payload) ?? []);
    return [...new Set((Array.isArray(rows) ? rows : []).map((row) => row?.[name] ?? row?.[idFallbackKey]).filter((value) => value !== undefined && value !== null && value !== "").map(String))];
  };
  for (const source of sources.filter((item) => !item.needs)) {
    const values = await read(source.path.replace(/limit=\d+/, "limit=50"), source.operationPath, source.name);
    if (values === null) failed = true;
    else data[source.name] = values;
  }
  // A nested id only exists under its parent, so it is collected as the correlated path the
  // catalog uses: the parent's id, the segment between them, its own id (`7/items/3`).
  for (const source of sources.filter((item) => item.needs)) {
    const key = correlatedKey(source.name);
    const segment = source.operationPath.slice(source.operationPath.indexOf(`{${source.needs}}`) + source.needs.length + 2);
    data[key] = [];
    for (const parent of (data[source.needs] ?? []).slice(0, 10)) {
      if (data[key].length >= 20) break;
      const values = await read(source.path.replace(`{${source.needs}}`, encodeURIComponent(parent)).replace(/limit=\d+/, "limit=10"), source.operationPath, source.name);
      data[key].push(...(values ?? []).map((id) => `${parent}${segment}/${id}`));
    }
  }
  return { data, failed };
}

const STAGE_WORDS = [["Escalón", "Step"], ["Pico", "Spike"], ["Recuperación", "Recovery"], ["Rampa", "Ramp"], ["Sostenido", "Sustained"]];

/** A stage label saved in either language ("Escalón 3 · 60 req/s"), in `locale`. */
export function stageLabelIn(label, locale = "es") {
  for (const [es, en] of STAGE_WORDS) {
    const from = locale === "en" ? es : en;
    if (label.startsWith(`${from} `)) return `${locale === "en" ? en : es}${label.slice(from.length)}`;
  }
  return label;
}

/** A profile name saved in either language, in `locale`; a custom name stays as typed. */
export function mixLabelIn(mix, locale = "es", mixes = GENERIC_MIXES) {
  const known = mixes.find((item) => item.label === mix || item.en?.label === mix);
  return known ? localized(known, locale).label : mix;
}

/**
 * A saved report shown in `locale`: a run keeps the texts of the language it ran in, but its
 * verdict is a pure function of its numbers, so it is rebuilt in the active one. The rebuilt
 * verdict is used only when it agrees with the saved one (same result, same checks) — a report
 * saved by an older engine keeps its own words rather than a verdict it never had.
 */
export function localizeReport(type, report, locale = "es") {
  const stages = report.stages.map((stage) => ({ ...stage, label: stageLabelIn(stage.label, locale) }));
  const localizedReport = { ...report, stages };
  let verdict = report.verdict;
  try {
    const fresh = evaluate(type, localizedReport, locale);
    if (fresh.pass === verdict.pass && fresh.checks.length === verdict.checks.length && fresh.checks.every((check, index) => check.pass === verdict.checks[index].pass)) verdict = fresh;
  } catch { /* an old report without a field the engine reads now: keep its saved verdict */ }
  return { ...localizedReport, verdict };
}
