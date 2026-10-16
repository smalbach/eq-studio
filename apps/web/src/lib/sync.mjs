/**
 * Small pieces of the sync screens that are worth asserting on their own. No React here.
 */

/**
 * A conflicting value as it is shown side by side: text as it is, anything else as indented
 * JSON. `undefined` means the field was not there on that side.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function conflictValue(value) {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) ?? String(value);
}

/**
 * The device code of a `?device=` link, as people would type it: `BCDF-2345`. Anything that is
 * not a plausible code is `null`, so a mangled link does not reach the API.
 *
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function deviceCode(raw) {
  const compact = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length < 4 || compact.length > 16) return null;
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}
