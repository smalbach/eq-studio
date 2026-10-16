/**
 * The two languages the core writes its case names, step names and assertion labels in.
 * Spanish is the default.
 */
export const LOCALES = /** @type {const} */ (["es", "en"]);

/**
 * The text of the active language: `tr(locale, "Sin respuestas", "No responses")`.
 * @template T @param {"es" | "en" | undefined} locale @param {T} es @param {T} en @returns {T}
 */
export const tr = (locale, es, en) => locale === "en" ? en : es;

/**
 * A text given either once for both languages or as `{ es, en }`.
 * @param {"es" | "en" | undefined} locale
 * @param {string | { es: string, en: string } | undefined} text
 * @returns {string}
 */
export const localized = (locale, text) => text === undefined ? "" : typeof text === "string" ? text : tr(locale, text.es, text.en);
