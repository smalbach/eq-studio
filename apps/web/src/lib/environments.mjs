/**
 * Credential helpers for the environment panel: cleaning a pasted token, reading its expiry and
 * building a Basic header. The environments themselves are data of each project.
 *
 * No React here, so they are asserted without a browser.
 */

export { resolveTarget } from "@eq/runner-core";

/**
 * `Authorization: Basic …`. UTF-8 first: `btoa` alone throws
 * on any character outside Latin-1, and a password with an `ñ` is not exotic.
 */
export function basicAuthHeader(user, password) {
  if (!user) return "";
  const bytes = new TextEncoder().encode(`${user}:${password ?? ""}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

/** Strips what a paste usually drags along: the `Bearer ` prefix, quotes and the newline. */
export function cleanToken(value) {
  return String(value ?? "").trim().replace(/^["']|["']$/g, "").trim().replace(/^bearer\s+/i, "").trim();
}

function decodeSegment(segment) {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * @typedef {{ state: "empty" | "opaque" | "invalid" | "valid" | "expired", email?: string | null, issuer?: string | null, expiresAt?: number | null, minutesLeft?: number | null }} TokenInfo
 */

/**
 * What the panel says about a pasted token, read from its payload — never verified, the
 * signature is the issuer's business. An expired token and a missing permission are the same
 * 401 on the wire, so the expiry is shown before anything is sent.
 */
/**
 * @param {string} value
 * @param {number} [now]
 * @returns {TokenInfo}
 */
export function inspectToken(value, now = Date.now()) {
  const token = cleanToken(value);
  if (!token) return { state: "empty" };
  const parts = token.split(".");
  if (parts.length !== 3) return { state: "opaque" };
  let payload;
  try {
    payload = decodeSegment(parts[1]);
  } catch {
    return { state: "invalid" };
  }
  const exp = typeof payload.exp === "number" ? payload.exp * 1000 : null;
  const base = { email: typeof payload.email === "string" ? payload.email : null, issuer: typeof payload.iss === "string" ? payload.iss : null, expiresAt: exp };
  if (exp === null) return { state: "valid", ...base, minutesLeft: null };
  const minutesLeft = Math.floor((exp - now) / 60000);
  return { state: exp <= now ? "expired" : "valid", ...base, minutesLeft };
}
