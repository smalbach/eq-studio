import { Inject, Injectable } from "@nestjs/common";
import { HTTP_FETCH } from "../../../shared/tokens.ts";
import { Unreachable } from "../../../shared/errors.ts";

/** Reads a document from a URL. A port, so tests can serve one without a network. */
export interface SpecFetcher {
  fetch(url: string, headers?: Record<string, string>): Promise<string>;
}

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Over HTTP, with a hard timeout and a size cap, through the same outbound fetch as the runs: in
 * a hosted deployment it cannot reach private addresses either.
 */
@Injectable()
export class HttpSpecFetcher implements SpecFetcher {
  constructor(@Inject(HTTP_FETCH) private readonly fetchImpl: typeof fetch) {}

  async fetch(url: string, headers: Record<string, string> = {}) {
    let target: URL;
    try { target = new URL(url); } catch { throw new Unreachable(`Not a URL: ${url}`); }
    if (!["http:", "https:"].includes(target.protocol)) throw new Unreachable("Only http and https URLs can be imported");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetchImpl(target, { headers: { Accept: "application/json, application/yaml, text/yaml, */*", ...headers }, signal: controller.signal });
      const text = await response.text();
      if (!response.ok) throw new Unreachable(`${target.pathname} answered ${response.status}`);
      if (text.length > MAX_BYTES) throw new Unreachable("The document is larger than 5 MB");
      return text;
    } catch (error) {
      if (error instanceof Unreachable) throw error;
      throw new Unreachable(`Could not read ${target}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
