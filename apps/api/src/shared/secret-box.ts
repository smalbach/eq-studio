/**
 * Encryption of stored secrets: AES-256-GCM, a fresh 96-bit IV per value, and the row's id as
 * associated data — a ciphertext copied onto another row does not decrypt there.
 *
 * The key never lives in the database. Locally it is a file next to it, readable only by the
 * user (created on first use); in the cloud it comes from `EQ_SECRETS_KEY` (or a KMS that sets
 * it). Losing the key loses the secrets, by design: they are re-entered, not recovered.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Invalid } from "./errors.ts";

export type SecretKeySource = { type: "file"; path: string } | { type: "key"; key: string };

export class SecretBox {
  private constructor(private readonly key: Buffer) {}

  static from(source: SecretKeySource): SecretBox {
    if (source.type === "key") return new SecretBox(decodeKey(source.key));
    if (!existsSync(source.path)) {
      mkdirSync(dirname(source.path), { recursive: true });
      writeFileSync(source.path, randomBytes(32).toString("base64"), { mode: 0o600 });
    }
    // On Windows the mode is advisory; the file lives in the user's profile directory.
    try { chmodSync(source.path, 0o600); } catch { /* not supported here */ }
    return new SecretBox(decodeKey(readFileSync(source.path, "utf8").trim()));
  }

  encrypt(plain: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
  }

  decrypt(sealed: string, context: string): string {
    if (!sealed.startsWith("v1.")) throw new Invalid("Unknown secret format");
    const raw = Buffer.from(sealed.slice(3), "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }
}

function decodeKey(value: string) {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("The secrets key must be 32 bytes, base64-encoded (openssl rand -base64 32)");
  return key;
}

/** What a read may show of a secret. */
export const lastFour = (secret: string) => secret.length <= 8 ? "••••" : secret.slice(-4);
