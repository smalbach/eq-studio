/**
 * The two languages of the dashboard, as plain data so the server, the Worker routes and the
 * `.mjs` engines share them. Spanish is the default.
 *
 * The choice lives in this browser's storage; `index.html` applies it before the first paint.
 */
export const LOCALES = /** @type {const} */ (["es", "en"]);
export const DEFAULT_LOCALE = "es";
export const LOCALE_KEY = "endpoint-quality:locale";

/** @param {unknown} value @returns {"es" | "en"} */
export const normalizeLocale = (value) => value === "en" ? "en" : "es";

/** The BCP 47 tag for dates and numbers. @param {"es" | "en"} locale */
export const intlLocale = (locale) => locale === "en" ? "en-US" : "es-CO";

/**
 * The text of the active language, for the engines that build sentences out of data:
 * `tr(locale, "Sin respuestas", "No responses")`.
 * @template T @param {"es" | "en" | undefined} locale @param {T} es @param {T} en @returns {T}
 */
export const tr = (locale, es, en) => locale === "en" ? en : es;
