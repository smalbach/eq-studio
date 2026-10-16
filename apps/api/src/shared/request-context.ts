/**
 * What the code deep inside a request may want to know about it without every command carrying
 * it: the client's address (already resolved through `trust proxy`) and its user agent. Set once
 * per request by a middleware; read by the audit log.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = { ip: string | null; userAgent: string | null };

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = () => storage.getStore() ?? null;

export function requestContextMiddleware(request: { ip?: string; headers: Record<string, string | string[] | undefined> }, _response: unknown, next: () => void) {
  const agent = request.headers["user-agent"];
  storage.run({ ip: request.ip ?? null, userAgent: (Array.isArray(agent) ? agent[0] : agent)?.slice(0, 300) ?? null }, next);
}
