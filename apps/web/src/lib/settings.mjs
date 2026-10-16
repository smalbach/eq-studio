/**
 * What the dashboard remembers between reloads, in this browser's `localStorage`, in three tiers:
 *
 * - **configuration** — environment, base URL, order, selection, cases, delay, samples, view,
 *   load profile. Always saved: none of it is secret.
 * - **credentials** — the bearer, the API key, the insufficient-permission token and the Basic
 *   user. Saved while *Recordar tokens* is on (the default). They are usually short-lived, and an
 *   expired one is shown as expired when it comes back.
 * - **secrets** — passwords. Saved **only** with the second, explicit switch: they do not expire
 *   in an hour, and anything on this origin in this browser profile can read `localStorage`.
 *
 * The dashboard's settings are kept per project (`dashboard:<project id>`). No React here: what
 * is stripped from each tier is the part that can be wrong, and it is tested in
 * `tests/settings.test.mjs` without a browser. Every storage access is wrapped: a private window
 * or blocked site data simply means nothing is remembered.
 */

const PREFIX = "endpoint-quality:settings";

/** The storage key of a kind of settings: `dashboard`, `dashboard:<project>`, `load`. */
export const settingsKey = (kind) => `${PREFIX}:${kind}:v1`;

/** The fields of each saved object that belong to the credential and secret tiers. */
export const TIERS = {
  dashboard: { credentials: ["token", "apiKey", "readToken", "basicUser"], secrets: ["basicPass"] },
  load: { credentials: [], secrets: [] },
};

/** @param {string} kind */
const tiersOf = (kind) => TIERS[/** @type {"dashboard" | "load"} */ (kind.split(":")[0])] ?? { credentials: [], secrets: [] };

/** The fields an imported Postman environment can carry that are credentials. */
const IMPORTED_CREDENTIALS = ["token", "apiKey", "readToken"];

export const DEFAULT_REMEMBER = { credentials: true, secrets: false };

/**
 * A copy of `value` without what the switches say not to keep. Imported environments are
 * walked too: a Postman export can carry an `access_token`, and keeping it there would save the
 * credential the switch just said to forget.
 *
 * @param {string} kind
 * @param {Record<string, unknown>} value
 * @param {{ credentials: boolean, secrets: boolean }} remember
 */
export function redact(kind, value, remember) {
  const tiers = tiersOf(kind);
  const drop = new Set([...(remember.credentials ? [] : tiers.credentials), ...(remember.secrets ? [] : tiers.secrets)]);
  const copy = Object.fromEntries(Object.entries(value).filter(([key]) => !drop.has(key)));
  if (!remember.credentials && Array.isArray(copy.importedEnvironments)) {
    copy.importedEnvironments = copy.importedEnvironments.map((environment) => ({
      ...environment,
      fields: Object.fromEntries(Object.entries(environment.fields ?? {}).filter(([key]) => !IMPORTED_CREDENTIALS.includes(key))),
    }));
  }
  return copy;
}

/** The saved object, or `null` when there is none or it cannot be read. */
export function loadSettings(kind) {
  try {
    const raw = localStorage.getItem(settingsKey(kind));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSettings(kind, value, remember) {
  try {
    localStorage.setItem(settingsKey(kind), JSON.stringify(redact(kind, value, remember)));
    return true;
  } catch {
    return false;
  }
}

/** Forgets everything this module saved. The run histories have their own button. */
export function clearSettings() {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((key) => key?.startsWith(`${PREFIX}:`));
    for (const key of keys) localStorage.removeItem(/** @type {string} */ (key));
  } catch { /* nothing was remembered */ }
}

/**
 * Reads a saved value only if it has the expected type, so a key renamed or retyped between
 * versions falls back to the default instead of crashing the page with a string where an
 * array was expected.
 *
 * @template T
 * @param {Record<string, unknown> | null} saved
 * @param {string} key
 * @param {T} fallback
 * @returns {T}
 */
export function pick(saved, key, fallback) {
  const value = saved?.[key];
  if (value === undefined || value === null) return fallback;
  if (Array.isArray(fallback)) return /** @type {T} */ (Array.isArray(value) ? value : fallback);
  if (typeof fallback === "object" && fallback !== null) return /** @type {T} */ (typeof value === "object" && !Array.isArray(value) ? value : fallback);
  return /** @type {T} */ (typeof value === typeof fallback ? value : fallback);
}
