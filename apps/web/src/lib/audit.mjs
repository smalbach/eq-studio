/**
 * The audit log screen's pieces worth asserting on their own. No React here.
 */

/** The filter's groups: each is a prefix the API matches (`credential.` is every credential event). */
export const AUDIT_GROUPS = ["auth.", "member.", "api_token.", "credential.", "project.", "device."];

/**
 * The query string of one page of the log. Empty values are left out; dates go as the day
 * (`2026-10-16`), which the API reads as the whole day.
 *
 * @param {{ type?: string; from?: string; to?: string; cursor?: string | null; limit?: number }} filter
 * @returns {string}
 */
export function auditQuery(filter) {
  const params = new URLSearchParams();
  if (filter.type) params.set("type", filter.type);
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  if (filter.cursor) params.set("cursor", filter.cursor);
  params.set("limit", String(filter.limit ?? 50));
  return `?${params}`;
}

/**
 * The non-secret details of an event as one short line: `role: viewer → editor`, `kind: bearer`.
 *
 * @param {Record<string, unknown> | null | undefined} detail
 * @returns {string}
 */
export function auditDetail(detail) {
  if (!detail) return "";
  if ("from" in detail && "to" in detail) return `${detail.from} → ${detail.to}`;
  return Object.entries(detail).filter(([, value]) => value !== null && value !== undefined && value !== "").map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(" · ");
}

/**
 * The single-use token of a password reset link (`?restablecer=eqp_…`), or `null`.
 *
 * @param {string} search
 * @returns {string | null}
 */
export function resetTokenOf(search) {
  const token = new URLSearchParams(search).get("restablecer");
  return token && /^eqp_[A-Za-z0-9_-]{20,}$/.test(token) ? token : null;
}
