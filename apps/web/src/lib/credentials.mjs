/**
 * A credential's form, as the guides and the workbench keep it, and the body of the `PUT` that
 * saves it. No React here, so what each kind requires and which secrets are sent, kept or
 * cleared is asserted without a browser (`test/credentials.test.mjs`).
 *
 * Secrets (`secret`, `refreshToken`, `tlsKey`, `tlsPassphrase`) are write-only: the API never
 * returns them, only a hint. Left empty they are left out of the body, which keeps the stored
 * one; the form cannot tell "unchanged" from "cleared" in an empty password field, and keeping
 * is the only safe reading of it.
 */

import { cleanToken } from "./environments.mjs";

/** @typedef {"bearer" | "api_key" | "basic" | "oauth2_client_credentials" | "oauth2_authorization_code" | "cookie" | "hmac" | "mtls"} CredentialKind */

export const CREDENTIAL_KINDS = /** @type {CredentialKind[]} */ (["bearer", "api_key", "basic", "oauth2_client_credentials", "oauth2_authorization_code", "cookie", "hmac", "mtls"]);
/** The fields a guide must never keep in its resumable draft (it lives in `localStorage`). */
export const SECRET_FIELDS = /** @type {const} */ (["secret", "refreshToken", "tlsKey", "tlsPassphrase"]);
/** What the engine fills in a string to sign; anything else in braces is a typo. */
export const HMAC_PLACEHOLDERS = ["method", "path", "timestamp", "bodyHash", "keyId"];
export const HMAC_DEFAULT_TEMPLATE = "{method}\\n{path}\\n{timestamp}\\n{bodyHash}";
export const LOGIN_BODY_TEMPLATE = '{"username":"{{username}}","password":"{{password}}"}';

export const EMPTY_CREDENTIAL = {
  kind: /** @type {CredentialKind} */ ("bearer"), secret: "", headerName: "", username: "", tokenUrl: "", clientId: "", scope: "", refreshToken: "",
  cookieMode: /** @type {"session" | "login"} */ ("session"), cookieName: "", loginMethod: /** @type {"GET" | "POST" | "PUT" | "PATCH"} */ ("POST"), loginPath: "", loginBody: "", loginContentType: "",
  hmacAlgorithm: /** @type {"sha256" | "sha512"} */ ("sha256"), hmacHeader: "", hmacKeyId: "", hmacKeyIdHeader: "", hmacTimestampHeader: "", hmacTemplate: "", hmacEncoding: /** @type {"hex" | "base64"} */ ("hex"),
  tlsCert: "", tlsKey: "", tlsPassphrase: "", tlsCa: "",
};
/** @typedef {typeof EMPTY_CREDENTIAL} CredentialForm */
/** @typedef {{ hasSecret?: boolean; secretHints?: { refreshToken?: string; tlsKey?: string; tlsPassphrase?: string } | null }} StoredSecrets */

/**
 * The form of a saved credential: every field but its secrets, which stay empty and keep the
 * stored ones unless something is typed.
 * @param {{ kind: CredentialKind; headerName?: string | null; username?: string | null; tokenUrl?: string | null; clientId?: string | null; scope?: string | null; options?: any } | null | undefined} view
 * @param {CredentialKind} [fallback]
 * @returns {CredentialForm}
 */
export function formOf(view, fallback = "bearer") {
  if (!view) return { ...EMPTY_CREDENTIAL, kind: fallback };
  const options = view.options ?? {};
  const login = options.login, hmac = options.hmac ?? {}, tls = options.tls ?? {};
  return {
    ...EMPTY_CREDENTIAL, kind: view.kind, headerName: view.headerName ?? "", username: view.username ?? "", tokenUrl: view.tokenUrl ?? "", clientId: view.clientId ?? "", scope: view.scope ?? "",
    cookieMode: login ? "login" : "session", cookieName: options.cookieName ?? "", loginMethod: login?.method ?? "POST", loginPath: login?.path ?? "", loginBody: login?.body ?? "", loginContentType: login?.contentType ?? "",
    hmacAlgorithm: hmac.algorithm ?? "sha256", hmacHeader: hmac.header ?? "", hmacKeyId: hmac.keyId ?? "", hmacKeyIdHeader: hmac.keyIdHeader ?? "", hmacTimestampHeader: hmac.timestampHeader ?? "", hmacTemplate: hmac.template ?? "", hmacEncoding: hmac.encoding ?? "hex",
    tlsCert: tls.cert ?? "", tlsCa: tls.ca ?? "",
  };
}

/** Whether anything was typed: a guide's credential step may be skipped while nothing is. */
export function credentialTyped(/** @type {CredentialForm} */ form) {
  return Object.entries(form).some(([name, value]) => typeof value === "string" && value.trim() !== "" && value !== /** @type {Record<string, unknown>} */ (EMPTY_CREDENTIAL)[name] && name !== "kind" && name !== "cookieMode");
}

/** The placeholders of a string to sign that the engine does not know. */
export function unknownPlaceholders(/** @type {string} */ template) {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).filter((name) => !HMAC_PLACEHOLDERS.includes(name));
}

const isUrl = (/** @type {string} */ value) => /^https?:\/\/\S+$/.test(value);
/** Only the options that differ from nothing: the engine's defaults apply to the rest. */
const compact = (/** @type {Record<string, string | undefined>} */ value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item));

/**
 * The body of `PUT …/credentials/:role`, or `null` while something the kind requires is
 * missing. `stored` is the credential as listed (or nothing, when the form must carry every
 * secret itself, as a guide does): a secret it already holds counts as present.
 * @param {CredentialForm} form
 * @param {StoredSecrets | null} [stored]
 */
export function credentialPayload(form, stored = null) {
  const value = /** @type {Record<string, string>} */ (Object.fromEntries(Object.entries(form).map(([name, item]) => [name, typeof item === "string" && !SECRET_FIELDS.includes(/** @type {any} */ (name)) ? item.trim() : item])));
  const hints = stored?.secretHints ?? {};
  const has = { secret: Boolean(value.secret.trim() || stored?.hasSecret), refreshToken: Boolean(value.refreshToken.trim() || hints.refreshToken), tlsKey: Boolean(value.tlsKey.trim() || hints.tlsKey) };
  const kind = form.kind;
  const cookieLogin = kind === "cookie" && form.cookieMode === "login";
  const required = {
    bearer: has.secret, api_key: has.secret, basic: Boolean(value.username) && has.secret,
    oauth2_client_credentials: isUrl(value.tokenUrl) && Boolean(value.clientId) && has.secret,
    oauth2_authorization_code: isUrl(value.tokenUrl) && Boolean(value.clientId) && has.refreshToken,
    cookie: cookieLogin ? Boolean(value.loginPath) : Boolean(value.cookieName) && has.secret,
    hmac: has.secret && !unknownPlaceholders(value.hmacTemplate).length,
    mtls: Boolean(value.tlsCert) && has.tlsKey,
  }[kind];
  // Any kind may add a client certificate, and then it needs its key.
  if (!required || (value.tlsCert && !has.tlsKey)) return null;

  const tls = value.tlsCert ? { tls: { cert: value.tlsCert, ...(value.tlsCa ? { ca: value.tlsCa } : {}) } } : {};
  const options = {
    ...(kind === "cookie" ? cookieLogin ? { login: compact({ method: value.loginMethod, path: value.loginPath, body: value.loginBody, contentType: value.loginContentType }) } : { cookieName: value.cookieName } : {}),
    ...(kind === "hmac" ? { hmac: compact({ algorithm: value.hmacAlgorithm, header: value.hmacHeader, keyId: value.hmacKeyId, keyIdHeader: value.hmacKeyIdHeader, timestampHeader: value.hmacTimestampHeader, template: value.hmacTemplate, encoding: value.hmacEncoding }) } : {}),
    ...tls,
  };
  const oauth = kind === "oauth2_client_credentials" || kind === "oauth2_authorization_code";
  const secret = kind === "bearer" ? cleanToken(form.secret) : form.secret.trim();
  return {
    kind,
    // The fields of other kinds are cleared, so switching kind leaves nothing behind.
    headerName: kind === "api_key" ? value.headerName || null : null,
    username: kind === "basic" || cookieLogin ? value.username || null : null,
    tokenUrl: oauth ? value.tokenUrl : null, clientId: oauth ? value.clientId : null, scope: oauth ? value.scope || null : null,
    options: Object.keys(options).length ? options : null,
    ...(secret && kind !== "mtls" ? { secret } : {}),
    // A refresh token only means something to its kind; elsewhere a stale one is cleared.
    ...(kind !== "oauth2_authorization_code" ? { refreshToken: null } : form.refreshToken.trim() ? { refreshToken: form.refreshToken.trim() } : {}),
    // Without a certificate its key and passphrase go too (the API refuses a key alone). A new
    // key replaces the passphrase as well: the old one would not open it.
    ...(!value.tlsCert ? { tlsKey: null, tlsPassphrase: null } : form.tlsKey.trim() ? { tlsKey: form.tlsKey.trim(), tlsPassphrase: form.tlsPassphrase || null } : form.tlsPassphrase ? { tlsPassphrase: form.tlsPassphrase } : {}),
  };
}
