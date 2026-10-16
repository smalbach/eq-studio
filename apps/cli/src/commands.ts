/**
 * The commands. Each one returns the process exit code: 0 everything passed, 1 something failed,
 * 2 the command was wrong (a flag, a project, an environment), 3 it could not run at all.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { changesByOperation, describeChange, diffSpecs } from "@eq/runner-core";
import { parseSpec } from "@eq/api/spec";
import { contractFormatOf, postmanEnvironmentVariables, toOpenApi3 } from "@eq/runner-core";
import { CliError, client, EXIT, waitForRun, type Client, type Run } from "./client.ts";
import { bold, dim, green, junitReport, red, textReport, yellow } from "./report.ts";
import { startServer, type Server } from "./server.ts";
import { DATA_DIR, VERSION } from "./runtime.ts";

export type Flags = Record<string, string | boolean | undefined>;
const str = (flags: Flags, name: string) => typeof flags[name] === "string" ? flags[name] as string : undefined;
const num = (flags: Flags, name: string, fallback: number) => { const value = str(flags, name); if (value === undefined) return fallback; const parsed = Number(value); if (!Number.isFinite(parsed)) throw new CliError(`--${name} must be a number`, EXIT.usage); return parsed; };
const list = (flags: Flags, name: string) => str(flags, name)?.split(",").map((item) => item.trim()).filter(Boolean);
const log = (line: string) => process.stderr.write(`${line}\n`);

/** The API at --api (EQ_API_URL, default the local one), with --api-token / EQ_API_TOKEN. */
const remote = (flags: Flags) => client(str(flags, "api") ?? process.env.EQ_API_URL ?? "http://127.0.0.1:4400", { token: str(flags, "api-token") ?? process.env.EQ_API_TOKEN, workspace: str(flags, "workspace") ?? process.env.EQ_WORKSPACE });

export async function serve(flags: Flags) {
  const port = num(flags, "port", Number(process.env.EQ_PORT ?? 4400));
  const cloud = process.env.EQ_MODE === "cloud";
  const host = str(flags, "host") ?? process.env.EQ_HOST ?? (cloud ? "0.0.0.0" : "127.0.0.1");
  const server = await startServer({ port, host, persistent: true, autoSync: true });
  log(`${bold("Endpoint Quality")} ${VERSION} · ${green(server.url)} · ${cloud ? "cloud mode" : `data in ${DATA_DIR}`}`);
  // Local mode has no accounts and no SSRF guard: on another interface, anyone who can reach it is its owner.
  if (!cloud && !["127.0.0.1", "localhost", "::1"].includes(host)) log(red(`warning: listening on ${host} in local mode — no sign-in, and requests can reach this machine's network. Use EQ_MODE=cloud to share it.`));
  log(dim("Ctrl+C to stop."));
  if (flags.open) openBrowser(server.url);
  await new Promise<void>((resolve) => {
    const stop = () => { void server.close().finally(resolve); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return EXIT.ok;
}

function openBrowser(url: string) {
  const [command, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try { spawn(command, args, { stdio: "ignore", detached: true }).unref(); } catch { /* a server without a desktop */ }
}

/**
 * The project to run and the API that runs it: a project file (`--file`) is loaded into an API
 * started in this process — nothing to install or keep running in CI —, a project name goes to
 * the API at `--api` (default `EQ_API_URL` or the local one).
 */
async function target(project: string | undefined, flags: Flags): Promise<{ api: Client; project: string; server?: Server }> {
  const file = str(flags, "file");
  if (file) {
    let document: unknown;
    try { document = JSON.parse(readFileSync(file, "utf8")); } catch (error) { throw new CliError(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`, EXIT.usage); }
    const server = await startServer({ port: 0, host: "127.0.0.1", persistent: false, quiet: true });
    try {
      const api = client(server.url);
      const imported = await api.post<{ id: string }>("/v1/projects/import", { file: document });
      return { api, project: imported.id, server };
    } catch (error) { await server.close(); throw error; }
  }
  if (!project) throw new CliError("Name a project, or pass --file project.eq.json", EXIT.usage);
  return { api: remote(flags), project };
}

type EnvironmentView = { id: string; environmentId: string; name: string; baseUrl: string; authEnabled?: boolean };

/** The environment, with `--base-url` and the credential flags applied to it. */
async function environment(api: Client, project: string, flags: Flags): Promise<EnvironmentView> {
  const environments = await api.get<EnvironmentView[]>(`/v1/projects/${project}/environments`);
  const wanted = str(flags, "env");
  const found = wanted ? environments.find((item) => item.id === wanted || item.name === wanted) : environments[0];
  if (!found) throw new CliError(wanted ? `No environment "${wanted}" (there are: ${environments.map((item) => item.id).join(", ") || "none"})` : "The project has no environments: add one, or pass --base-url with --file", EXIT.usage);
  const baseUrl = str(flags, "base-url");
  if (baseUrl) await api.patch(`/v1/projects/${project}/environments/${found.environmentId}`, { baseUrl });
  // Secrets from flags or the environment, never from a file in the repository.
  const credentials: [string, string | undefined, Record<string, unknown>][] = [
    ["primary", str(flags, "token") ?? process.env.EQ_TOKEN, { kind: "bearer" }],
    ["insufficient", str(flags, "read-token") ?? process.env.EQ_READ_TOKEN, { kind: "bearer" }],
    ["alternate", str(flags, "api-key") ?? process.env.EQ_API_KEY, { kind: "api_key", ...(str(flags, "api-key-header") ? { headerName: str(flags, "api-key-header") } : {}) }],
  ];
  for (const [role, secret, rest] of credentials) if (secret) await api.put(`/v1/projects/${project}/environments/${found.environmentId}/credentials/${role}`, { ...rest, secret });
  return { ...found, baseUrl: baseUrl ?? found.baseUrl };
}

function progress(run: Run) {
  if (!process.stderr.isTTY) return;
  const { totals } = run;
  const line = run.kind === "functional" ? `${run.status} · ${totals.completed}/${totals.total} · ${totals.failed ? red(`${totals.failed} failed`) : `${totals.failed} failed`}` : `${run.status}…`;
  process.stderr.write(`\r\u001b[2K${dim(line)}`);
}

function outputs(run: Run, project: string, environmentName: string, flags: Flags) {
  const junit = str(flags, "junit");
  if (junit) writeFileSync(junit, junitReport(run, project, environmentName));
  const json = str(flags, "json");
  if (json) writeFileSync(json, `${JSON.stringify(run, null, 2)}\n`);
  if (process.stderr.isTTY) process.stderr.write("\r\u001b[2K");
  if (flags.quiet) return;
  if (str(flags, "format") === "json") process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
  else process.stdout.write(`${textReport(run, environmentName)}\n`);
}

function exitCodeOf(run: Run, flags: Flags) {
  if (["error", "interrupted", "cancelled"].includes(run.status)) return EXIT.error;
  if (run.status === "failed") return EXIT.failed;
  if (flags["fail-on-blocked"] && run.totals.blocked > 0) return EXIT.failed;
  return EXIT.ok;
}

export async function run(projectArgument: string | undefined, flags: Flags) {
  const { api, project, server } = await target(projectArgument, flags);
  try {
    const env = await environment(api, project, flags);
    const auth = flags.auth === true ? true : flags["no-auth"] === true ? false : undefined;
    const started = await api.post<{ id: string; total: number }>(`/v1/projects/${project}/runs`, {
      environment: env.environmentId, readOnly: Boolean(flags["read-only"]), ...(auth === undefined ? {} : { authEnabled: auth }),
      ...(list(flags, "endpoints") ? { endpointIds: list(flags, "endpoints") } : {}),
      samples: num(flags, "samples", 1), delayMs: num(flags, "delay", 0), locale: str(flags, "locale") === "es" ? "es" : "en",
      ...(str(flags, "scope") ? { scope: str(flags, "scope") } : {}),
    });
    log(dim(`Running ${started.total} cases against ${env.name} (${env.baseUrl})…`));
    const finished = await waitForRun(api, started.id, progress);
    const { slug } = await api.get<{ slug: string }>(`/v1/projects/${project}`);
    outputs(finished, slug, env.name, flags);
    return exitCodeOf(finished, flags);
  } finally {
    await server?.close();
  }
}

export async function load(projectArgument: string | undefined, flags: Flags) {
  const { api, project, server } = await target(projectArgument, flags);
  try {
    const env = await environment(api, project, flags);
    const type = str(flags, "type") ?? "load";
    if (!["load", "stress", "spike", "soak"].includes(type)) throw new CliError("--type is load, stress, spike or soak", EXIT.usage);
    const rps = num(flags, "rps", 10);
    const p95 = str(flags, "p95");
    const started = await api.post<{ id: string }>(`/v1/projects/${project}/load-runs`, {
      environment: env.environmentId, type, baseRps: rps, peakRps: num(flags, "peak", rps), durationS: num(flags, "duration", 30),
      ...(str(flags, "mix") ? { mixId: str(flags, "mix") } : {}),
      latency: p95 ? { mode: "custom", p95Ms: Number(p95) } : { mode: flags["no-latency"] ? "off" : "project" },
      onPreflightFailure: str(flags, "preflight") ?? "skip", locale: str(flags, "locale") === "es" ? "es" : "en",
    });
    log(dim(`${type} test against ${env.name} (${env.baseUrl})…`));
    const finished = await waitForRun(api, started.id, progress, 1000);
    outputs(finished, project, env.name, flags);
    return exitCodeOf(finished, flags);
  } finally {
    await server?.close();
  }
}

/**
 * The example API the Mock Store project runs against: a fictional store with its own OpenAPI
 * document, on the two ports the example's environments expect — without and with authentication.
 */
export async function mock(flags: Flags) {
  const { createMockServer } = await import("../../mock-target/store.mjs");
  const port = num(flags, "port", 4010);
  const host = str(flags, "host") ?? "127.0.0.1";
  const servers = [createMockServer(), createMockServer({ auth: true })];
  const [open, secured] = [await servers[0].listen(port, host), await servers[1].listen(port + 1, host)];
  log(`${bold("Mock Store")} · ${green(open.url)} (no auth) · ${green(secured.url)} (auth: Bearer admin-token, read-token for the 403s) · contract at /openapi.json`);
  log(dim("Ctrl+C to stop. Restarting it puts the data back as the example's seed."));
  await new Promise<void>((resolve) => {
    const stop = () => { void Promise.all(servers.map((server) => server.close())).finally(resolve); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return EXIT.ok;
}

export async function projects(flags: Flags) {
  const api = remote(flags);
  const rows = await api.get<{ slug: string; name: string; operationCount: number; contractVersion: string | null }[]>("/v1/projects");
  if (str(flags, "format") === "json") process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  else for (const row of rows) process.stdout.write(`${row.slug}\t${row.name}\t${row.operationCount} operations${row.contractVersion ? `\tv${row.contractVersion}` : ""}\n`);
  return EXIT.ok;
}

export async function exportProject(project: string | undefined, flags: Flags) {
  if (!project) throw new CliError("Name the project to export", EXIT.usage);
  const api = remote(flags);
  const file = await api.get(`/v1/projects/${project}/export`);
  const text = `${JSON.stringify(file, null, 2)}\n`;
  const output = str(flags, "output");
  if (output) { writeFileSync(output, text); log(`${green("✓")} ${output}`); } else process.stdout.write(text);
  return EXIT.ok;
}

/**
 * A new project from a file: a `.eq.json` as it is, or a contract — OpenAPI 3, Swagger 2.0 (JSON
 * or YAML) or a Postman collection — that the API converts and generates a configuration from.
 * A contract gets a first environment at the base URL it declares, `--base-url`, or the one a
 * Postman environment (`--env file.postman_environment.json`) gives the collection's `{{baseUrl}}`.
 */
export async function importProject(path: string | undefined, flags: Flags) {
  if (!path) throw new CliError("Give the file to import: a .eq.json, an OpenAPI 3 or Swagger 2.0 document (JSON or YAML), or a Postman collection", EXIT.usage);
  const api = remote(flags);
  const read = (file: string) => { try { return readFileSync(file, "utf8"); } catch (error) { throw new CliError(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`, EXIT.usage); } };
  const text = read(path);
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { /* YAML: the API reads it */ }
  if ((parsed as Record<string, unknown> | null)?.format === "endpoint-quality/project") {
    const created = await api.post<{ slug: string }>("/v1/projects/import", { file: parsed });
    log(`${green("✓")} imported as ${bold(created.slug)}`);
    return EXIT.ok;
  }
  const environmentFile = str(flags, "env");
  let environment: { name?: string; variables: Record<string, string> } | undefined;
  if (environmentFile) {
    let document: unknown;
    try { document = JSON.parse(read(environmentFile)); } catch (error) { if (error instanceof CliError) throw error; throw new CliError(`${environmentFile} is not JSON`, EXIT.usage); }
    if (!Array.isArray((document as { values?: unknown })?.values)) throw new CliError(`${environmentFile} is not a Postman environment: it has no "values"`, EXIT.usage);
    environment = { name: typeof (document as { name?: unknown }).name === "string" ? (document as { name: string }).name : undefined, variables: postmanEnvironmentVariables(document) };
  }
  const local = parsed && contractFormatOf(parsed) === "postman" && environment ? toOpenApi3(parsed, { variables: environment.variables }).baseUrl : undefined;
  const created = await api.post<{ id: string; slug: string; warnings: string[]; sourceFormat: string | null; baseUrl: string | null }>("/v1/projects", { name: str(flags, "name"), spec: { document: parsed ?? text } });
  const baseUrl = (str(flags, "base-url") ?? local ?? created.baseUrl)?.replace(/\/+$/, "");
  if (baseUrl) await api.post(`/v1/projects/${created.slug}/environments`, { name: environment?.name ?? baseUrl.replace(/^https?:\/\//, ""), baseUrl });
  const origin = created.sourceFormat === "swagger" ? " (converted from Swagger 2.0)" : created.sourceFormat === "postman" ? " (generated from a Postman collection: its schemas are inferred, review them)" : "";
  log(`${green("✓")} imported as ${bold(created.slug)}${origin}`);
  for (const warning of created.warnings.filter((item) => !/^(Converted from Swagger|Generated from a Postman)/.test(item))) log(dim(`  ${warning}`));
  log(baseUrl ? dim(`  environment: ${baseUrl}`) : dim("  no base URL: add an environment, or import again with --base-url"));
  return EXIT.ok;
}

/** A contract from a file or an http(s) URL, as JSON or YAML. */
async function readContract(source: string) {
  let text: string;
  if (/^https?:\/\//i.test(source)) {
    let response: Response;
    try { response = await fetch(source, { headers: { Accept: "application/json, application/yaml, text/yaml, */*" } }); } catch (error) { throw new CliError(`Cannot read ${source}: ${error instanceof Error ? error.message : String(error)}`, EXIT.error); }
    if (!response.ok) throw new CliError(`${source} answered ${response.status}`, EXIT.error);
    text = await response.text();
  } else {
    try { text = readFileSync(source, "utf8"); } catch (error) { throw new CliError(`Cannot read ${source}: ${error instanceof Error ? error.message : String(error)}`, EXIT.usage); }
  }
  try { return parseSpec(text).document; } catch (error) { throw new CliError(`${source}: ${error instanceof Error ? error.message : String(error)}`, EXIT.usage); }
}

/**
 * What changed from one contract to the next, grouped by operation. Exit 1 when a change breaks
 * clients of the old one, so a pipeline can stop a contract change before it is published.
 */
export async function diff(oldSource: string | undefined, newSource: string | undefined, flags: Flags) {
  if (!oldSource || !newSource) throw new CliError("Give the old and the new contract: eq diff <old> <new> (files or URLs)", EXIT.usage);
  const result = diffSpecs(await readContract(oldSource), await readContract(newSource));
  const locale = str(flags, "locale") === "es" ? "es" : "en";
  if (str(flags, "format") === "json") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (!flags.quiet) {
    const lines: string[] = [];
    for (const group of changesByOperation(result.changes)) {
      lines.push(bold(`${group.method} ${group.path}`) + (group.operationId ? dim(` (${group.operationId})`) : ""));
      for (const change of group.changes) lines.push(`  ${change.breaking ? red("✖ breaking") : yellow("· change  ")}  ${describeChange(change, locale)}`);
    }
    const { breaking, nonBreaking } = result.summary;
    lines.push(result.changes.length ? `${breaking ? red(`${breaking} breaking`) : green("0 breaking")} · ${nonBreaking} non-breaking` : green("No changes between the two contracts."));
    process.stdout.write(`${lines.join("\n")}\n`);
  }
  return result.summary.breaking ? EXIT.failed : EXIT.ok;
}
