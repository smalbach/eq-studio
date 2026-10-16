/**
 * How a credential authenticates a request, beyond a fixed header: a token minted and cached
 * until it expires, a session cookie captured from a login, a signature over each request, a
 * client certificate on the TLS connection.
 *
 * The result is an authenticated `fetch`: the executor sends cases through it as through any
 * other, and every request it sends — the case, its latency samples, the OpenAPI document —
 * carries the credential as it should be at that moment. Secrets arrive here in clear, already
 * decrypted by whoever stores them; nothing here persists them.
 */
import { createHash, createHmac } from "node:crypto";
import { resolveTarget } from "./execute.ts";

/** A client certificate for mutual TLS. Any kind may carry one, on top of its own headers. */
export type TlsMaterial = { cert: string; key: string; passphrase?: string; ca?: string };

export type HmacAlgorithm = "sha256" | "sha512";
export type HmacOptions = {
  algorithm?: HmacAlgorithm;
  /** The header the signature goes in. */
  header?: string;
  /** Who signs: sent in `keyIdHeader` when set. */
  keyId?: string;
  keyIdHeader?: string;
  timestampHeader?: string;
  /** What is signed; see `HMAC_PLACEHOLDERS`. Escapes `\n` are newlines. */
  template?: string;
  encoding?: "hex" | "base64";
};

export const HMAC_DEFAULTS = { algorithm: "sha256", header: "X-Signature", keyIdHeader: "X-Key-Id", timestampHeader: "X-Timestamp", template: "{method}\\n{path}\\n{timestamp}\\n{bodyHash}", encoding: "hex" } as const;
export const HMAC_PLACEHOLDERS = ["method", "path", "timestamp", "bodyHash", "keyId"] as const;

/** A login whose `Set-Cookie` becomes the session; `{{username}}` and `{{password}}` fill the body. */
export type CookieLogin = { method?: string; path: string; body?: string; contentType?: string };

export type ResolvedCredential = { tls?: TlsMaterial } & (
  | { kind: "bearer"; token: string }
  | { kind: "api_key"; header: string; key: string }
  | { kind: "basic"; username: string; password: string }
  | { kind: "oauth2_client_credentials"; tokenUrl: string; clientId: string; clientSecret: string; scope?: string }
  | { kind: "oauth2_authorization_code"; tokenUrl: string; clientId: string; clientSecret?: string; refreshToken: string; scope?: string }
  | { kind: "cookie"; name?: string; value?: string; login?: CookieLogin; username?: string; password?: string }
  | { kind: "hmac"; key: string; options?: HmacOptions }
  | { kind: "mtls" }
);

export type AuthOptions = {
  /** Where a cookie login's path is resolved. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** The connection a client certificate needs (an undici `Agent` built with `tls`): passed
   * as `dispatcher` on every request. Building it is the host's job — it owns the HTTP stack. */
  dispatcher?: unknown;
  /** An authorization server that rotates refresh tokens hands out a new one: keep it, or the
   * next run presents one that no longer works. */
  onRefreshToken?: (refreshToken: string) => void | Promise<void>;
  now?: () => number;
};

export type Authenticator = {
  /** `fetch` with the credential applied, refreshed once on a 401 when it can be. */
  fetch: typeof fetch;
  /** The credential's headers as of now, for what cannot sign each request (a load plan, a
   * report). Empty for HMAC: a signature belongs to one request. */
  headers(): Promise<Record<string, string>>;
};

/** Seconds of margin before a token's stated expiry: a token that expires in flight is a 401. */
const EXPIRY_SKEW_MS = 30_000;

type Token = { value: string; expiresAt: number };

function headerRecord(headers: RequestInit["headers"]): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...(headers as Record<string, string>) };
}

/** Drops a header whatever its case, so the credential's value replaces it instead of joining it. */
function withHeader(headers: Record<string, string>, name: string, value: string) {
  for (const key of Object.keys(headers)) if (key.toLowerCase() === name.toLowerCase()) delete headers[key];
  headers[name] = value;
}

function bodyBytes(body: RequestInit["body"]): Buffer {
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), "utf8");
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  return Buffer.from(String(body), "utf8");
}

/** The signature of one request, and the headers it travels in. */
export function hmacHeaders(key: string, options: HmacOptions, request: { method: string; url: URL; body?: RequestInit["body"] }, now = Date.now()): Record<string, string> {
  const settings: Required<Omit<HmacOptions, "keyId">> & HmacOptions = { ...HMAC_DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined && value !== "")) };
  const timestamp = String(Math.floor(now / 1000));
  const values: Record<(typeof HMAC_PLACEHOLDERS)[number], string> = {
    method: request.method.toUpperCase(),
    path: `${request.url.pathname}${request.url.search}`,
    timestamp,
    bodyHash: createHash(settings.algorithm).update(bodyBytes(request.body)).digest("hex"),
    keyId: settings.keyId ?? "",
  };
  const stringToSign = settings.template.replace(/\\n/g, "\n").replace(/\{(\w+)\}/g, (match, name: string) => name in values ? values[name as keyof typeof values] : match);
  const signature = createHmac(settings.algorithm, key).update(stringToSign, "utf8").digest(settings.encoding === "base64" ? "base64" : "hex");
  return {
    [settings.header]: signature,
    [settings.timestampHeader]: timestamp,
    ...(settings.keyId ? { [settings.keyIdHeader]: settings.keyId } : {}),
  };
}

/** A body template filled with the login's username and password, escaped for its content type. */
export function fillLoginBody(template: string, values: { username?: string; password?: string }, contentType: string) {
  const escape = contentType.includes("json") ? (value: string) => JSON.stringify(value).slice(1, -1) : contentType.includes("x-www-form-urlencoded") ? encodeURIComponent : (value: string) => value;
  return template.replace(/\{\{\s*(username|password)\s*\}\}/g, (_, name: "username" | "password") => escape(values[name] ?? ""));
}

/** `name=value` of every `Set-Cookie`, joined as a `Cookie` header. */
export function cookieHeaderOf(response: Response) {
  const list = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : (response.headers.get("set-cookie") ?? "").split(/,(?=\s*[^;,=\s]+=)/);
  return list.map((line) => line.split(";")[0].trim()).filter((pair) => pair.includes("=")).join("; ");
}

export function createAuthenticator(credential: ResolvedCredential, options: AuthOptions): Authenticator {
  const base = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const connection = options.dispatcher ? { dispatcher: options.dispatcher } : {};
  const send = (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => base(input, { ...init, ...connection } as RequestInit);

  let token: Token | null = null;
  let pending: Promise<Token> | null = null;
  let refreshToken = credential.kind === "oauth2_authorization_code" ? credential.refreshToken : "";
  let session: string | null = null;

  async function requestToken(): Promise<Token> {
    if (credential.kind !== "oauth2_client_credentials" && credential.kind !== "oauth2_authorization_code") throw new Error("Not an OAuth2 credential");
    const grant = credential.kind === "oauth2_client_credentials"
      ? { grant_type: "client_credentials", client_id: credential.clientId, client_secret: credential.clientSecret }
      : { grant_type: "refresh_token", refresh_token: refreshToken, client_id: credential.clientId, ...(credential.clientSecret ? { client_secret: credential.clientSecret } : {}) };
    const body = new URLSearchParams({ ...grant, ...(credential.scope ? { scope: credential.scope } : {}) });
    let response: Response;
    try {
      response = await send(credential.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body, signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      throw new Error(`The token endpoint did not answer: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    const payload = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number | string; refresh_token?: string; error?: string };
    if (!response.ok || !payload.access_token) throw new Error(`The token endpoint answered ${response.status}${payload.error ? ` (${payload.error})` : ""}`);
    if (credential.kind === "oauth2_authorization_code" && payload.refresh_token && payload.refresh_token !== refreshToken) {
      refreshToken = payload.refresh_token;
      await options.onRefreshToken?.(refreshToken);
    }
    const seconds = Number(payload.expires_in);
    return { value: payload.access_token, expiresAt: now() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 3_600_000) - EXPIRY_SKEW_MS };
  }

  /** The cached token while it is valid; one exchange at a time, however many cases ask. */
  async function accessToken(force = false) {
    if (!force && token && token.expiresAt > now()) return token.value;
    pending ??= requestToken().finally(() => { pending = null; });
    token = await pending;
    return token.value;
  }

  async function login(): Promise<string> {
    if (credential.kind !== "cookie" || !credential.login) throw new Error("Not a cookie login");
    const contentType = credential.login.contentType || "application/json";
    const method = (credential.login.method || "POST").toUpperCase();
    const target = resolveTarget(options.baseUrl, credential.login.path);
    const hasBody = !["GET", "HEAD"].includes(method) && credential.login.body !== undefined && credential.login.body !== "";
    let response: Response;
    try {
      response = await send(target, { method, redirect: "manual", headers: { Accept: "application/json", ...(hasBody ? { "Content-Type": contentType } : {}) }, body: hasBody ? fillLoginBody(credential.login.body ?? "", credential, contentType) : undefined, signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      throw new Error(`The login did not answer: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    await response.arrayBuffer().catch(() => undefined);
    const cookie = cookieHeaderOf(response);
    if (!cookie) throw new Error(`The login answered ${response.status} without a Set-Cookie`);
    return cookie;
  }

  async function cookieValue(force = false) {
    if (credential.kind !== "cookie") return "";
    if (!credential.login) return credential.value ? `${credential.name || "session"}=${credential.value}` : "";
    if (force || session === null) {
      pending ??= login().then((value) => ({ value, expiresAt: Infinity })).finally(() => { pending = null; });
      session = (await pending).value;
    }
    return session;
  }

  /** The headers of one request, signed when the kind signs. */
  async function headersFor(request: { method: string; url: URL; body?: RequestInit["body"] } | null, force = false): Promise<Record<string, string>> {
    switch (credential.kind) {
      case "bearer": return credential.token ? { Authorization: `Bearer ${credential.token}` } : {};
      case "api_key": return credential.key ? { [credential.header]: credential.key } : {};
      case "basic": return credential.username ? { Authorization: `Basic ${Buffer.from(`${credential.username}:${credential.password}`, "utf8").toString("base64")}` } : {};
      case "oauth2_client_credentials":
      case "oauth2_authorization_code": return { Authorization: `Bearer ${await accessToken(force)}` };
      case "cookie": { const value = await cookieValue(force); return value ? { Cookie: value } : {}; }
      case "hmac": return request ? hmacHeaders(credential.key, credential.options ?? {}, request, now()) : {};
      case "mtls": return {};
    }
  }

  /** Kinds whose credential can be renewed: a 401 is worth one more try with a fresh one. */
  const renewable = credential.kind === "oauth2_client_credentials" || credential.kind === "oauth2_authorization_code" || (credential.kind === "cookie" && Boolean(credential.login));

  const authenticated = (async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const attempt = async (force: boolean) => {
      const headers = headerRecord(init.headers);
      for (const [name, value] of Object.entries(await headersFor({ method, url, body: init.body }, force))) withHeader(headers, name, value);
      return send(input, { ...init, headers });
    };
    const response = await attempt(false);
    if (response.status !== 401 || !renewable) return response;
    await response.arrayBuffer().catch(() => undefined);
    return attempt(true);
  }) as typeof fetch;

  return { fetch: authenticated, headers: () => headersFor(null) };
}
