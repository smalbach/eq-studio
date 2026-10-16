#!/usr/bin/env node
/**
 * The mock store from the command line (the server itself is in `store.mjs`):
 *
 *   node apps/mock-target/server.mjs --port 4010 [--auth] [--latency 20]
 *     [--tls-cert cert.pem --tls-key key.pem [--tls-ca ca.pem]]   HTTPS; with a CA, mutual TLS
 */
import { readFileSync } from "node:fs";
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
  const [cert, key, ca] = ["--tls-cert", "--tls-key", "--tls-ca"].map((name) => argValue(args, name)).map((file) => file && readFileSync(file, "utf8"));
  const tls = cert && key ? { cert, key, ...(ca ? { ca } : {}) } : undefined;
  const mock = createMockServer({ auth, latencyMs, tls });
  const { url } = await mock.listen(port, argValue(args, "--host") ?? "127.0.0.1");
  console.log(`Mock store listening on ${url} (auth ${auth ? "on" : "off"}${latencyMs ? `, +${latencyMs} ms` : ""}) · OpenAPI at ${url}/openapi.json`);
  const stop = () => mock.close().finally(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
