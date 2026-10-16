/**
 * Passwords, tokens and signed access tokens, with nothing but `node:crypto`.
 *
 * Passwords use scrypt — memory-hard like argon2id, and built into Node, so there is no native
 * module to compile on any platform. Tokens are random and stored as SHA-256 hashes: they are
 * long enough that a fast hash is the right tool, and a leaked table grants nothing. Access
 * tokens are short-lived HS256 JWTs.
 */
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function derive(password: string, salt: Buffer, length = 32) {
  return new Promise<Buffer>((resolve, reject) => scrypt(password.normalize("NFKC"), salt, length, SCRYPT, (error, key) => error ? reject(error) : resolve(key)));
}

/** `scrypt$N$r$p$salt$hash`: the parameters travel with the hash, so they can be raised later. */
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, , , , salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await derive(password, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

/** A fresh secret token: `<prefix>_<43 random characters>`. */
export const randomToken = (prefix: string) => `${prefix}_${randomBytes(32).toString("base64url")}`;
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export type AccessClaims = { sub: string; ws: string | null; iat: number; exp: number };

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

export function signAccessToken(claims: Omit<AccessClaims, "iat" | "exp">, secret: string, ttlSeconds: number, now = Date.now()) {
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ ...claims, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + ttlSeconds })}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

/** The claims of a valid, unexpired token signed with `secret`; `null` for anything else. */
export function verifyAccessToken(token: string, secret: string, now = Date.now()): AccessClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expected = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
  const signature = Buffer.from(parts[2], "base64url");
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { alg?: string };
    if (header.alg !== "HS256") return null;
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as AccessClaims;
    return typeof claims.sub === "string" && claims.exp * 1000 > now ? claims : null;
  } catch { return null; }
}
