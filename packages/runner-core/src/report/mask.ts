/**
 * Secrets out of a report. A report is meant to be shared — attached to a CI run, uploaded to
 * code scanning, mailed — so it is masked as a whole before any renderer reads it:
 *
 * - members whose name says they hold a credential, with the same rule and the same mask the
 *   engine applies to request headers (`execute.ts`);
 * - query parameters of the same kind in any URL;
 * - `Bearer …` / `Basic …` values wherever they appear;
 * - and every value the run was given as a secret, verbatim, wherever it appears.
 */
export const MASK = "••••••••";
export const SECRET_NAME = /authorization|api[-_]?key|apikey|token|cookie|secret|password|passwd|credential/i;

const SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
const QUERY = /([?&]([^=&#\s]*)=)([^&#\s"']*)/g;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function maskText(text: string, secrets: string[] = []) {
  let masked = text.replace(SCHEME, `$1 ${MASK}`).replace(QUERY, (match, head: string, name: string) => SECRET_NAME.test(name) ? `${head}${MASK}` : match);
  // Longest first: a secret that contains another is masked whole.
  for (const secret of [...secrets].filter((value) => value && value.length >= 4).sort((a, b) => b.length - a.length)) masked = masked.replace(new RegExp(escapeRegExp(secret), "g"), MASK);
  return masked;
}

/** A deep copy of `value` with every secret masked. */
export function maskSecrets<T>(value: T, secrets: string[] = []): T {
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") return maskText(item, secrets);
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, SECRET_NAME.test(key) && child !== null && typeof child !== "object" ? MASK : walk(child)]));
    return item;
  };
  return walk(value) as T;
}
