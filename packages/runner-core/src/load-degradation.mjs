/**
 * When does a service start to degrade, and how far is that from where it breaks.
 *
 * The verdict of a stress test names the first step that **broke** — over budget, errors, rate
 * not delivered. By then the damage is done; what an operator wants is the step where it
 * **started to bend**: latency climbing over its calm value, the tail stretching, requests
 * piling up in flight. This module reads the per-second windows and per-stage stats of a saved
 * report and answers that, for any type whose rate changes (stress steps, a spike, a ramp).
 *
 * Everything is relative to a **baseline**: the calm stretch at the start (the first step of a
 * stress test, the base of a spike, the first 20 % of a load or soak). "Degrading" is relative
 * to that baseline, with an absolute floor — 1.5× of a 3 ms local p95 is noise, not a signal.
 *
 * Plain `.mjs` and no React, like `load.mjs`, so `tests/load-degradation.test.mjs` runs it. It is
 * computed when a report is viewed, so its words follow the `locale` argument (Spanish by default).
 */
import { percentile } from "./budgets.mjs";
import { tr } from "./i18n.mjs";
import { ERROR_RATE_MAX, THROUGHPUT_FLOOR } from "./load.mjs";

/** p95 over baseline × this (and over baseline + the floor) is degrading. */
export const DEGRADE_FACTOR = 1.5;
export const DEGRADE_FLOOR_MS = 20;
/** p99 over p50 × this (and over p50 + the floor) is a long tail. */
export const TAIL_RATIO = 3;
export const TAIL_FLOOR_MS = 50;
/** In flight over baseline × this (and over the floor) is a queue building up. */
export const QUEUE_FACTOR = 3;
export const QUEUE_FLOOR = 5;
/** Above this error rate (or below this fraction of the rate delivered) a stage is broken. */
export const BROKEN_ERROR_RATE = 0.01;
export const BROKEN_EFFICIENCY = 0.8;

export const HEALTH = {
  healthy: { label: "Sano", rank: 0 },
  degrading: { label: "Degradándose", rank: 1 },
  saturated: { label: "Saturado", rank: 2 },
  broken: { label: "Roto", rank: 3 },
};
/** The words of each level per language; `HEALTH` keeps the Spanish ones. */
export const HEALTH_LABELS = {
  es: { healthy: "Sano", degrading: "Degradándose", saturated: "Saturado", broken: "Roto" },
  en: { healthy: "Healthy", degrading: "Degrading", saturated: "Saturated", broken: "Broken" },
};
/** @param {keyof typeof HEALTH} level @param {"es" | "en"} [locale] */
export const healthLabel = (level, locale = "es") => HEALTH_LABELS[locale === "en" ? "en" : "es"][level];

const median = (values) => values.length ? percentile(values, 50) : 0;
const round1 = (value) => Math.round(value * 10) / 10;

/**
 * The calm stretch every other measure is compared with.
 * @param {string} type
 * @param {any} report
 */
export function baselineOf(type, report) {
  const live = report.windows.filter((window) => !window.drain && window.completed > 0);
  const firstMeasured = report.stages.findIndex((stage) => stage.measured);
  let windows;
  if (type === "stress" || type === "spike") {
    // The first seconds of a run carry cold connections; drop them when the stage is long enough.
    const stage = live.filter((window) => window.stage === firstMeasured);
    windows = stage.length > 4 ? stage.slice(1) : stage;
  } else {
    const measured = live.filter((window) => report.stages[window.stage]?.measured);
    windows = measured.slice(0, Math.max(3, Math.floor(measured.length * 0.2)));
  }
  if (!windows.length) return null;
  return {
    p50: round1(median(windows.map((window) => window.p50))),
    p95: round1(median(windows.map((window) => window.p95))),
    rps: round1(median(windows.map((window) => window.rps))),
    inFlight: median(windows.map((window) => window.inFlight)),
    seconds: windows.length,
  };
}

/** The latency over which a window or a stage counts as degrading. */
export const latencyLimit = (baseline) => Math.round(Math.max(baseline.p95 * DEGRADE_FACTOR, baseline.p95 + DEGRADE_FLOOR_MS));

/**
 * One stage judged on four levels, worst first. `reasons` says why, in words, so the table never
 * relies on the colour of the pill.
 */
export function stageHealth(stage, baseline, budget, locale = "es") {
  const t = (es, en) => tr(locale, es, en);
  const requested = (stage.fromRps + stage.toRps) / 2;
  const efficiency = requested > 0 ? stage.rps / requested : 1;
  const factor = baseline?.p95 ? stage.p95 / baseline.p95 : 1;
  const tail = stage.p50 > 0 ? stage.p99 / stage.p50 : 1;
  const reasons = [];
  let health = "healthy";
  const raise = (level, reason) => { reasons.push(reason); if (HEALTH[level].rank > HEALTH[health].rank) health = level; };
  if (stage.completed === 0) raise("broken", t("sin respuestas", "no responses"));
  if (stage.errorRate > BROKEN_ERROR_RATE) raise("broken", t(`errores ${(stage.errorRate * 100).toFixed(2)} %`, `errors ${(stage.errorRate * 100).toFixed(2)} %`));
  else if (stage.errorRate > ERROR_RATE_MAX) raise("saturated", t(`errores ${(stage.errorRate * 100).toFixed(2)} %`, `errors ${(stage.errorRate * 100).toFixed(2)} %`));
  if (requested >= 1 && efficiency < BROKEN_EFFICIENCY) raise("broken", t(`entrega ${Math.round(efficiency * 100)} % de lo pedido`, `delivers ${Math.round(efficiency * 100)} % of the requested rate`));
  else if (requested >= 1 && efficiency < THROUGHPUT_FLOOR) raise("saturated", t(`entrega ${Math.round(efficiency * 100)} % de lo pedido`, `delivers ${Math.round(efficiency * 100)} % of the requested rate`));
  if (stage.dropped > 0) raise("saturated", t(`${stage.dropped} descartadas`, `${stage.dropped} dropped`));
  if (budget != null && stage.p95 >= budget) raise("saturated", t(`p95 ${stage.p95} ms ≥ límite ${budget} ms`, `p95 ${stage.p95} ms ≥ limit ${budget} ms`));
  if (baseline && stage.completed > 0 && stage.p95 > latencyLimit(baseline)) raise("degrading", t(`p95 ×${factor.toFixed(1)} sobre la base`, `p95 ×${factor.toFixed(1)} over the baseline`));
  if (stage.completed > 0 && tail > TAIL_RATIO && stage.p99 - stage.p50 > TAIL_FLOOR_MS) raise("degrading", t(`cola larga: p99 ×${tail.toFixed(1)} del p50`, `long tail: p99 ×${tail.toFixed(1)} the p50`));
  if (budget != null && stage.completed > 0 && stage.p95 >= budget * 0.8 && stage.p95 < budget) raise("degrading", t(`p95 al ${Math.round((stage.p95 / budget) * 100)} % del límite`, `p95 at ${Math.round((stage.p95 / budget) * 100)} % of the limit`));
  return { health, reasons, requested: round1(requested), efficiency, factor, tail };
}

/**
 * The first second each sign of degradation shows, held two seconds in a row so one slow second
 * is not an event (a drop is an event on its own: a request was refused).
 */
export function degradationSignals(report, baseline, budget, locale = "es") {
  const t = (es, en) => tr(locale, es, en);
  const windows = report.windows.filter((window) => !window.drain && window.targetRps != null);
  const limit = baseline ? latencyLimit(baseline) : null;
  const queue = baseline ? Math.max(QUEUE_FLOOR, baseline.inFlight * QUEUE_FACTOR) : null;
  const tests = [
    { key: "latency", label: t("La latencia empieza a subir", "Latency starts to climb"), test: (w) => limit != null && w.completed > 0 && w.p95 > limit, detail: (w) => `p95 ${w.p95} ms > ${limit} ms (${t("base", "baseline")} ${baseline?.p95} ms ×${DEGRADE_FACTOR})` },
    { key: "tail", label: t("La cola se alarga", "The tail stretches"), test: (w) => w.completed > 0 && w.p50 > 0 && w.p99 / w.p50 > TAIL_RATIO && w.p99 - w.p50 > TAIL_FLOOR_MS, detail: (w) => t(`p99 ${w.p99} ms frente a p50 ${w.p50} ms`, `p99 ${w.p99} ms against p50 ${w.p50} ms`) },
    { key: "queue", label: t("Se acumulan solicitudes en vuelo", "Requests pile up in flight"), test: (w) => queue != null && w.inFlight > queue, detail: (w) => t(`${w.inFlight} en vuelo (base ${baseline?.inFlight})`, `${w.inFlight} in flight (baseline ${baseline?.inFlight})`) },
    { key: "budget", label: t("p95 supera el límite", "p95 exceeds the limit"), test: (w) => budget != null && w.completed > 0 && w.p95 >= budget, detail: (w) => `p95 ${w.p95} ms ≥ ${budget} ms` },
    { key: "throughput", label: t("Deja de entregar la tasa pedida", "Stops delivering the requested rate"), test: (w) => w.targetRps >= 5 && w.rps < w.targetRps * THROUGHPUT_FLOOR, detail: (w) => t(`entregó ${w.rps} de ${w.targetRps} req/s`, `delivered ${w.rps} of ${w.targetRps} req/s`) },
    { key: "errors", label: t("Aparecen errores", "Errors appear"), test: (w) => w.completed > 0 && w.errorRate > ERROR_RATE_MAX, detail: (w) => t(`${w.errors} errores (${(w.errorRate * 100).toFixed(2)} %)`, `${w.errors} errors (${(w.errorRate * 100).toFixed(2)} %)`) },
    { key: "drops", label: t("Se descartan solicitudes", "Requests are dropped"), once: true, test: (w) => (w.dropped ?? 0) > 0, detail: (w) => t(`${w.dropped} descartadas: límite de concurrencia`, `${w.dropped} dropped: concurrency limit`) },
  ];
  const signals = [];
  for (const signal of tests) {
    const index = windows.findIndex((window, at) => signal.test(window) && (signal.once || (windows[at + 1] != null && signal.test(windows[at + 1]))));
    if (index === -1) continue;
    const window = windows[index];
    signals.push({ key: signal.key, label: signal.label, t: window.t, rps: window.targetRps, delivered: window.rps, stage: report.stages[window.stage]?.label ?? "", detail: signal.detail(window) });
  }
  // A stable sort: signals of the same second keep the order above, earliest symptom first.
  return signals.sort((a, b) => a.t - b.t);
}

/**
 * How long a spike takes to come back: seconds from the end of the peak until the p95 stays
 * under the degrading limit for three seconds in a row. Null when it never does.
 */
export function recoveryTime(report, baseline) {
  if (!baseline || report.stages.length < 3) return null;
  const after = report.windows.filter((window) => !window.drain && window.stage === 2);
  if (!after.length) return null;
  const limit = latencyLimit(baseline);
  const peak = report.windows.filter((window) => !window.drain && window.stage === 1 && window.completed > 0);
  const peakEnd = peak.at(-1)?.t ?? after[0].t - 1;
  const calm = (window) => window.completed > 0 && window.p95 <= limit && window.errorRate <= ERROR_RATE_MAX;
  const index = after.findIndex((_, at) => after.slice(at, at + 3).length === 3 && after.slice(at, at + 3).every(calm));
  return {
    seconds: index === -1 ? null : after[index].t - peakEnd,
    window: after.length,
    limit,
    peakP95: peak.length ? Math.max(...peak.map((window) => window.p95)) : null,
    peakFactor: peak.length && baseline.p95 ? round1(Math.max(...peak.map((window) => window.p95)) / baseline.p95) : null,
  };
}

/**
 * Everything at once: the baseline, each stage with its health, the per-second index of
 * degradation, the signals in order, and the capacity — the rate delivered by the last healthy
 * stage before the first one that is not.
 *
 * @param {string} type
 * @param {any} report
 * @param {number | null} budget
 * @param {"es" | "en"} [locale] the language of the reasons and signals
 */
export function degradationReport(type, report, budget, locale = "es") {
  const baseline = baselineOf(type, report);
  const stages = report.stages.map((stage) => ({ label: stage.label, measured: stage.measured, fromRps: stage.fromRps, toRps: stage.toRps, delivered: stage.rps, p50: stage.p50, p95: stage.p95, p99: stage.p99, errorRate: stage.errorRate, dropped: stage.dropped, completed: stage.completed, ...stageHealth(stage, baseline, budget, locale) }));
  const timeline = report.windows.filter((window) => !window.drain).map((window) => ({
    t: window.t,
    factor: baseline?.p95 && window.completed > 0 ? Math.round((window.p95 / baseline.p95) * 100) / 100 : null,
    // Capped at 100 %: a second that catches up on the previous one is "all delivered", not more.
    efficiency: window.targetRps ? Math.min(100, Math.round((window.rps / window.targetRps) * 1000) / 10) : null,
    inFlight: window.inFlight,
  }));
  const signals = degradationSignals(report, baseline, budget, locale);
  // Capacity, like the verdict of a stress test: the last stage before the first unhealthy one.
  // A stage that holds after an earlier one degraded is a lucky stretch, not capacity.
  const ordered = stages.filter((stage) => stage.measured);
  const firstBad = ordered.findIndex((stage) => stage.health !== "healthy");
  const healthy = (firstBad === -1 ? ordered : ordered.slice(0, firstBad)).at(-1) ?? null;
  const firstBroken = ordered.find((stage) => stage.health === "broken" || stage.health === "saturated") ?? null;
  const capacity = healthy ? { rps: round1(healthy.delivered), stage: healthy.label } : null;
  return {
    baseline,
    limit: baseline ? latencyLimit(baseline) : null,
    stages,
    timeline,
    signals,
    capacity,
    firstDegraded: firstBad === -1 ? null : ordered[firstBad],
    firstBroken,
    headroom: capacity && baseline?.rps ? round1(capacity.rps / baseline.rps) : null,
    recovery: type === "spike" ? recoveryTime(report, baseline) : null,
  };
}
