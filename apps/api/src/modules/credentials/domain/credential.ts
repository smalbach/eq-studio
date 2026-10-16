/**
 * The rules of a stored credential, wherever it is written from — the form, the CLI, a sync:
 * what each kind needs, how its secrets are kept and shown, and how it becomes the engine's
 * `ResolvedCredential` for a run.
 */
import { createPrivateKey, X509Certificate } from "node:crypto";
import { HMAC_PLACEHOLDERS, type ResolvedCredential } from "@eq/runner-core";
import type { CredentialKind, CredentialOptions, CredentialRow, CredentialSecretName } from "../../../database/entities.ts";
import { Invalid } from "../../../shared/errors.ts";
import { lastFour, type SecretBox } from "../../../shared/secret-box.ts";

export const CREDENTIAL_KINDS = ["bearer", "api_key", "basic", "oauth2_client_credentials", "oauth2_authorization_code", "cookie", "hmac", "mtls"] as const satisfies readonly CredentialKind[];
export const SECRET_NAMES = ["refreshToken", "tlsKey", "tlsPassphrase"] as const satisfies readonly CredentialSecretName[];

export type ExtraSecrets = Partial<Record<CredentialSecretName, string>>;

/** A PEM block is shown by what it is, never by its last characters (they are the footer). */
export const hintOf = (name: CredentialSecretName, value: string) => name === "refreshToken" ? lastFour(value) : "••••";

export function openExtras(row: Pick<CredentialRow, "id" | "extraSecrets">, box: SecretBox): ExtraSecrets {
  if (!row.extraSecrets) return {};
  return JSON.parse(box.decrypt(row.extraSecrets, `${row.id}:extra`)) as ExtraSecrets;
}

/** Seals the extra secrets into the row, with their hints; none left clears both. */
export function sealExtras(row: CredentialRow, extras: ExtraSecrets, box: SecretBox) {
  const present = Object.fromEntries(Object.entries(extras).filter(([, value]) => value)) as ExtraSecrets;
  const names = Object.keys(present) as CredentialSecretName[];
  row.extraSecrets = names.length ? box.encrypt(JSON.stringify(present), `${row.id}:extra`) : null;
  row.secretHints = names.length ? Object.fromEntries(names.map((name) => [name, hintOf(name, present[name]!)])) : null;
}

/** Whether a certificate and its private key are a pair, and the key opens with its passphrase. */
function checkTls(cert: string, key: string, passphrase: string | undefined, ca: string | undefined) {
  let certificate: X509Certificate;
  try { certificate = new X509Certificate(cert); } catch { throw new Invalid("The client certificate is not a PEM certificate"); }
  let privateKey;
  try { privateKey = createPrivateKey({ key, format: "pem", ...(passphrase ? { passphrase } : {}) }); } catch { throw new Invalid(passphrase ? "The private key does not open with that passphrase, or is not a PEM key" : "The private key is not a PEM key, or it needs a passphrase"); }
  if (!certificate.checkPrivateKey(privateKey)) throw new Invalid("The private key does not belong to the client certificate");
  if (ca) { try { new X509Certificate(ca); } catch { throw new Invalid("The CA bundle is not a PEM certificate"); } }
}

/** What a kind requires, checked on the row as it will be stored. */
export function validateCredential(row: CredentialRow, extras: ExtraSecrets, secret: string | null) {
  const options = row.options ?? {};
  switch (row.kind) {
    case "basic":
      if (!row.username) throw new Invalid("A Basic credential needs a username");
      break;
    case "oauth2_client_credentials":
      if (!row.tokenUrl || !row.clientId) throw new Invalid("An OAuth2 client-credentials credential needs tokenUrl and clientId");
      if (!secret) throw new Invalid("The credential needs a secret");
      break;
    case "oauth2_authorization_code":
      if (!row.tokenUrl || !row.clientId) throw new Invalid("An OAuth2 authorization-code credential needs tokenUrl and clientId");
      if (!extras.refreshToken) throw new Invalid("An OAuth2 authorization-code credential needs a refresh token");
      break;
    case "cookie":
      if (options.login) { if (!options.login.path) throw new Invalid("A cookie login needs the path it posts to"); }
      else if (!options.cookieName || !secret) throw new Invalid("A cookie credential needs a cookie name and value, or a login request");
      break;
    case "hmac": {
      if (!secret) throw new Invalid("An HMAC credential needs its key");
      const unknown = [...(options.hmac?.template ?? "").matchAll(/\{(\w+)\}/g)].map((match) => match[1]).filter((name) => !(HMAC_PLACEHOLDERS as readonly string[]).includes(name));
      if (unknown.length) throw new Invalid(`The string to sign uses unknown placeholders: ${unknown.join(", ")} (known: ${HMAC_PLACEHOLDERS.join(", ")})`);
      break;
    }
    case "mtls":
      if (!options.tls?.cert || !extras.tlsKey) throw new Invalid("A mutual-TLS credential needs a client certificate and its private key");
      break;
    default:
      if (!secret) throw new Invalid("The credential needs a secret");
  }
  if (options.tls?.cert && !extras.tlsKey) throw new Invalid("A client certificate needs its private key");
  if (extras.tlsKey && !options.tls?.cert) throw new Invalid("A private key needs its client certificate");
  if (options.tls?.cert && extras.tlsKey) checkTls(options.tls.cert, extras.tlsKey, extras.tlsPassphrase, options.tls.ca);
}

/** The credential in clear, as the engine takes it: only for the run that uses it. */
export function resolveCredential(row: CredentialRow, secret: string, extras: ExtraSecrets, apiKeyHeader: string): ResolvedCredential {
  const options: CredentialOptions = row.options ?? {};
  const tls = options.tls?.cert && extras.tlsKey ? { tls: { cert: options.tls.cert, key: extras.tlsKey, ...(extras.tlsPassphrase ? { passphrase: extras.tlsPassphrase } : {}), ...(options.tls.ca ? { ca: options.tls.ca } : {}) } } : {};
  const scope = row.scope ? { scope: row.scope } : {};
  switch (row.kind) {
    case "bearer": return { kind: "bearer", token: secret, ...tls };
    case "api_key": return { kind: "api_key", header: row.headerName ?? apiKeyHeader, key: secret, ...tls };
    case "basic": return { kind: "basic", username: row.username ?? "", password: secret, ...tls };
    case "oauth2_client_credentials": return { kind: "oauth2_client_credentials", tokenUrl: row.tokenUrl ?? "", clientId: row.clientId ?? "", clientSecret: secret, ...scope, ...tls };
    case "oauth2_authorization_code": return { kind: "oauth2_authorization_code", tokenUrl: row.tokenUrl ?? "", clientId: row.clientId ?? "", ...(secret ? { clientSecret: secret } : {}), refreshToken: extras.refreshToken ?? "", ...scope, ...tls };
    case "cookie": return options.login
      ? { kind: "cookie", login: options.login, ...(row.username ? { username: row.username } : {}), password: secret, ...tls }
      : { kind: "cookie", name: options.cookieName, value: secret, ...tls };
    case "hmac": return { kind: "hmac", key: secret, options: options.hmac ?? {}, ...tls };
    case "mtls": return { kind: "mtls", ...tls };
  }
}

/** What a read returns of a credential: everything but its secrets, of which a hint at most. */
export function credentialView({ role, kind, headerName, username, tokenUrl, clientId, scope, lastFour: four, options, secretHints, rev, updatedAt }: CredentialRow) {
  return { role, kind, headerName, username, tokenUrl, clientId, scope, options: options ?? null, lastFour: four, hasSecret: Boolean(four), secretHints: secretHints ?? {}, rev, updatedAt };
}
