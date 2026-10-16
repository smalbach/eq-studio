/**
 * Outbound requests for a hosted API: it runs requests to addresses users type, and without a
 * guard that is a door into the deployment's own network — the cloud metadata service at
 * 169.254.169.254, a database on 10.x, the API's own loopback.
 *
 * - The address is checked **when the connection opens**, on what DNS actually returned: a name
 *   that resolves to a public address when checked and to a private one when used (DNS
 *   rebinding) is refused at connect time.
 * - Literal IP hosts never reach DNS, so they are checked directly.
 * - Redirects are followed by hand, at most three, each hop checked again.
 * - A declared body over the size cap is refused before it is read.
 *
 * Local mode does not use this: reaching localhost and the VPN is what it is for.
 */
import { lookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { Unreachable } from "./errors.ts";

const blocked = new BlockList();
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32], ["64:ff9b::", 96]] as const) blocked.addSubnet(network, prefix, "ipv6");

/** Whether an address is one a hosted API must not reach. IPv4-mapped IPv6 is checked as IPv4. */
export function isBlockedAddress(address: string) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return blocked.check(mapped, "ipv4");
  const family = isIP(address);
  if (family === 0) return true;
  return blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

const refuse = (host: string) => new Unreachable(`${host} resolves to a private, loopback or link-local address, which this deployment does not reach (EQ_ALLOW_PRIVATE_TARGETS)`);

/** DNS resolution that fails for a blocked address: undici calls it for every connection. */
function guardedLookup(hostname: string, options: object, callback: (error: Error | null, address: string | LookupAddress[], family?: number) => void) {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, []);
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((entry) => isBlockedAddress(entry.address))) return callback(refuse(hostname), []);
    if ((options as { all?: boolean }).all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

const agent = new Agent({ connect: { lookup: guardedLookup as never, timeout: 10_000 }, headersTimeout: 30_000, bodyTimeout: 60_000 });

/** A connection that presents a client certificate (mutual TLS), or trusts a CA, behind the same guard. */
export function guardedTlsAgent(tls: { cert?: string; key?: string; passphrase?: string; ca?: string }) {
  return new Agent({ connect: { lookup: guardedLookup as never, timeout: 10_000, ...tls }, headersTimeout: 30_000, bodyTimeout: 60_000 });
}
const MAX_REDIRECTS = 3;
const MAX_BYTES = 20 * 1024 * 1024;

export async function guardedFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  let url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  let options = init;
  for (let hop = 0; ; hop += 1) {
    if (!["http:", "https:"].includes(url.protocol)) throw new Unreachable(`Only http and https: ${url.protocol}`);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && isBlockedAddress(host)) throw refuse(host);
    let response: Response;
    try {
      // A dispatcher in `init` is one of `guardedTlsAgent`: only the engine passes one.
      const dispatcher = (options as { dispatcher?: Agent }).dispatcher ?? agent;
      response = await undiciFetch(url, { ...(options as object), redirect: "manual", dispatcher } as never) as unknown as Response;
    } catch (error) {
      // undici reports a refused lookup as a generic "fetch failed"; the reason is its cause.
      let cause: unknown = error;
      while (cause && !(cause instanceof Unreachable)) cause = (cause as { cause?: unknown }).cause;
      throw cause ?? error;
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw new Unreachable(`More than ${MAX_REDIRECTS} redirects`);
      await response.arrayBuffer().catch(() => undefined);
      url = new URL(location, url);
      // A 303, and a 301/302 after a POST, become a GET without a body, as browsers do.
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && options.method && options.method !== "GET" && options.method !== "HEAD")) options = { ...options, method: "GET", body: undefined };
      continue;
    }
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) { await response.body?.cancel(); throw new Unreachable(`The response is larger than ${MAX_BYTES / 1024 / 1024} MB`); }
    return response;
  }
}
