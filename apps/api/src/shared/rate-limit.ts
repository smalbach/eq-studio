/**
 * A sliding window per client address, in memory: enough to make guessing passwords slow on one
 * process. A deployment with several processes adds the same limit at its gateway. One per
 * application, so two applications in one process (the tests) do not share counts.
 */
import { Injectable } from "@nestjs/common";
import { TooManyRequests } from "./errors.ts";

@Injectable()
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  check(key: string, limit = 10, windowMs = 60_000) {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= limit) throw new TooManyRequests();
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) for (const [entry, times] of this.hits) if (!times.some((at) => now - at < windowMs)) this.hits.delete(entry);
  }
}
