/**
 * UUIDv7: time-ordered, generated on whichever machine creates the row. Ids made offline on two
 * laptops never collide, and sorted they follow creation order — what sync (P7) needs.
 *
 * Monotonic within a process (RFC 9562 §6.2, method 1): ids made in the same millisecond carry
 * an increasing 12-bit counter instead of random bits there, so rows written together — the
 * environments of one imported file — sort in the order they were written.
 */
import { randomBytes } from "node:crypto";

let lastMs = 0;
let sequence = 0;

export function uuidv7(now = Date.now()): string {
  if (now <= lastMs) { sequence += 1; now = lastMs; if (sequence > 0xfff) { now = lastMs + 1; sequence = 0; } }
  else sequence = randomBytes(2).readUInt16BE(0) & 0x3ff;
  lastMs = now;
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = 0x70 | ((sequence >> 8) & 0x0f);
  bytes[7] = sequence & 0xff;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const isoNow = () => new Date().toISOString();
