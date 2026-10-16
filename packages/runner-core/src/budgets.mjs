/**
 * Latency budgets as data, and the assertion they produce.
 *
 * A project declares its budgets as an ordered list of rules (`BudgetRule` in `types.ts`); the
 * first rule that matches an operation decides its budget. **A budget that does not exist is not
 * a budget that passes**: an operation no rule covers — or covered by a rule with `ms: null` —
 * gets no latency assertion at all, rather than a green tick that asserts nothing.
 */
import { localized, tr } from "./i18n.mjs";

/** @typedef {import("./types.ts").BudgetRule} BudgetRule */
/** @typedef {import("./types.ts").Budget} Budget */

/**
 * A path glob as a regular expression: `*` is one segment, `**` any number of them.
 * @param {string} glob
 */
function globToRegExp(glob) {
  const source = glob.split("**").map((part) => part.split("*").map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*");
  return new RegExp(`^${source}$`);
}

/**
 * The first rule that matches the operation, or `undefined`.
 * @param {BudgetRule[]} rules
 * @param {string} method
 * @param {string} operationPath
 * @param {string} requestPath
 */
export function matchBudgetRule(rules, method, operationPath, requestPath = "") {
  const upper = method.toUpperCase();
  return rules.find((rule) =>
    (!rule.methods || rule.methods.includes(/** @type {any} */ (upper))) &&
    (!rule.path || globToRegExp(rule.path).test(operationPath)) &&
    (!rule.query || new RegExp(rule.query).test(requestPath)));
}

/**
 * The budget for one operation, or `null` when the project sets none.
 *
 * @param {BudgetRule[]} rules
 * @param {string} method
 * @param {string} operationPath the templated path, e.g. `/v1/orders/{order_id}`
 * @param {string} [requestPath] the resolved path with its query string
 * @param {"es" | "en"} [locale] the language of the label
 * @returns {Budget | null}
 */
export function budgetFor(rules, method, operationPath, requestPath = "", locale = "es") {
  const rule = matchBudgetRule(rules, method, operationPath, requestPath);
  if (!rule || rule.ms === null || rule.ms === undefined) return null;
  return { ms: rule.ms, label: rule.label ? localized(locale, rule.label) : `${method.toUpperCase()} < ${rule.ms} ms`, source: rule.source ?? tr(locale, "proyecto", "project") };
}

/**
 * The p-th percentile of a sample, nearest-rank.
 *
 * Nearest-rank and not interpolated on purpose: with the 10-to-30 samples a run takes,
 * interpolating invents a value between two measurements and reads as more precision than the
 * sample carries. `percentile([a], 95)` is `a`.
 *
 * @param {number[]} values
 * @param {number} p
 */
export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/**
 * The latency assertion, or `null` when the operation has no budget.
 *
 * **One sample is not a p95** and the label says so: with a single measurement the claim is
 * about that request, not about a distribution.
 *
 * @param {Budget | null} budget
 * @param {number[]} samples milliseconds, one per request
 * @param {{ enforce?: boolean, locale?: "es" | "en" }} [options] `enforce: false` reports the budget without letting it decide the case
 * @returns {{ label: string, pass: boolean, detail: string, informative?: boolean } | null}
 */
export function latencyAssertion(budget, samples, { enforce = true, locale = /** @type {"es" | "en"} */ ("es") } = {}) {
  if (!budget || samples.length === 0) return null;
  const p95 = percentile(samples, 95);
  const measured = samples.length === 1 ? samples[0] : p95;
  const how = samples.length === 1
    ? tr(locale, `1 muestra: ${measured} ms (una medición no es un p95)`, `1 sample: ${measured} ms (one measurement is not a p95)`)
    : tr(locale, `${samples.length} muestras · p50 ${percentile(samples, 50)} ms · p95 ${p95} ms`, `${samples.length} samples · p50 ${percentile(samples, 50)} ms · p95 ${p95} ms`);
  const pass = measured < budget.ms;
  // A budget is a property of the service. Measured from far away — across a VPN, a gateway or
  // another region — the round trip alone can exceed it, and every case would be red for a
  // reason that says nothing about the endpoint. The number is still shown, marked
  // informative, and never decides the case.
  if (!enforce) return { label: tr(locale, `${budget.label} (informativo)`, `${budget.label} (informative)`), pass, informative: true, detail: tr(locale, `${how} · objetivo ${budget.ms} ms (${budget.source}) · no se exige: medido a través de red y gateway, no en el servicio`, `${how} · target ${budget.ms} ms (${budget.source}) · not enforced: measured across network and gateway, not at the service`) };
  return { label: budget.label, pass, detail: tr(locale, `${how} · objetivo ${budget.ms} ms (${budget.source})`, `${how} · target ${budget.ms} ms (${budget.source})`) };
}
