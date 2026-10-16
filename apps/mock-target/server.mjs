#!/usr/bin/env node
/**
 * The mock store from the command line (the server itself is in `store.mjs`):
 *
 *   node apps/mock-target/server.mjs --port 4010 [--auth] [--latency 20]
 */
import { pathToFileURL } from "node:url";
import { createMockServer } from "./store.mjs";

export * from "./store.mjs";

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const port = Number(argValue(args, "--port") ?? process.env.PORT ?? 4010);
  const latencyMs = Number(argValue(args, "--latency") ?? 0);
  const auth = args.includes("--auth");
  const mock = createMockServer({ auth, latencyMs });
  const { url } = await mock.listen(port, argValue(args, "--host") ?? "127.0.0.1");
  console.log(`Mock store listening on ${url} (auth ${auth ? "on" : "off"}${latencyMs ? `, +${latencyMs} ms` : ""}) · OpenAPI at ${url}/openapi.json`);
  const stop = () => mock.close().finally(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
