/**
 * `eq login`, `eq sync`, `eq logout`: this installation and a cloud workspace.
 *
 * They act on the local installation — the API `eq serve` keeps running, or, when none is,
 * one started in this process on the same data (never both at once: they would write the same
 * file).
 */
import { spawn } from "node:child_process";
import { CliError, client, EXIT, type Client } from "./client.ts";
import type { Flags } from "./commands.ts";
import { bold, dim, green, red } from "./report.ts";
import { startServer, type Server } from "./server.ts";

type Status = { linked: boolean; url: string | null; workspace: { id: string; name: string } | null; deviceName: string; pending: { userCode: string; verificationUri: string; expiresAt: string } | null; includeRuns: boolean; projects: string[] | null; secrets: boolean; lastSyncAt: string | null; lastError: string | null; openConflicts: number; pendingChanges: number; autoSyncSeconds: number };
type Result = { pulled: number; pushed: number; conflicts: number; rejected: { type: string; id: string; error: string }[]; durationMs: number };

const str = (flags: Flags, name: string) => typeof flags[name] === "string" ? flags[name] as string : undefined;
const log = (line: string) => process.stderr.write(`${line}\n`);

/** The local API: the running one, or one started here for this command. */
async function local(flags: Flags): Promise<{ api: Client; server?: Server }> {
  const explicit = str(flags, "api") ?? process.env.EQ_API_URL;
  const base = explicit ?? `http://127.0.0.1:${process.env.EQ_PORT ?? 4400}`;
  const health = await fetch(`${base}/health`).then((response) => response.ok ? response.json() as Promise<{ mode: string }> : null).catch(() => null);
  if (health?.mode === "local") return { api: client(base) };
  if (health) throw new CliError(`${base} is a cloud deployment: sync runs on a local installation, which syncs with it`, EXIT.usage);
  if (explicit) throw new CliError(`The Endpoint Quality API at ${base} is not reachable`, EXIT.error);
  const server = await startServer({ port: 0, host: "127.0.0.1", persistent: true, quiet: true });
  return { api: client(server.url), server };
}

async function withLocal<T>(flags: Flags, work: (api: Client) => Promise<T>) {
  const { api, server } = await local(flags);
  try { return await work(api); } finally { await server?.close(); }
}

function openBrowser(url: string) {
  const [command, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try { spawn(command, args, { stdio: "ignore", detached: true }).unref(); } catch { /* no desktop */ }
}

function summary(result: Result) {
  const parts = [`↓ ${result.pulled}`, `↑ ${result.pushed}`];
  if (result.conflicts) parts.push(red(`${result.conflicts} conflict${result.conflicts === 1 ? "" : "s"}`));
  if (result.rejected.length) parts.push(red(`${result.rejected.length} refused`));
  return `${parts.join(" · ")} ${dim(`(${result.durationMs} ms)`)}`;
}

/** 0 when everything went through; 1 when something waits for a person (a conflict, a refused change). */
function outcome(result: Result, status: Status) {
  for (const item of result.rejected) log(`  ${red("refused")} ${item.type} ${item.id}: ${item.error}`);
  if (status.openConflicts) log(`  ${status.openConflicts} open conflict${status.openConflicts === 1 ? "" : "s"}: resolve ${status.openConflicts === 1 ? "it" : "them"} in the app (Settings → Sync)`);
  return result.rejected.length || status.openConflicts ? EXIT.failed : EXIT.ok;
}

export async function login(url: string | undefined, flags: Flags) {
  if (!url) throw new CliError("Give the cloud's address: eq login https://eq.example.com", EXIT.usage);
  return withLocal(flags, async (api) => {
    const token = str(flags, "token") ?? process.env.EQ_SYNC_TOKEN;
    let status = await api.post<Status>("/v1/sync/link", { url, ...(token ? { token } : {}), ...(str(flags, "name") ? { deviceName: str(flags, "name") } : {}) });
    if (status.pending) {
      log(`Open ${bold(status.pending.verificationUri)} and confirm the code ${bold(status.pending.userCode)}.`);
      if (!flags["no-open"]) openBrowser(status.pending.verificationUri);
      log(dim("Waiting for the approval… (Ctrl+C to stop)"));
      while (status.pending && !status.linked) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        status = await api.post<Status>("/v1/sync/link/check");
      }
    }
    if (!status.linked) throw new CliError(status.lastError ?? "The device was not linked", EXIT.failed);
    log(`${green("✓")} linked to ${bold(status.workspace?.name ?? "")} at ${status.url} as ${status.deviceName}`);
    const result = await api.post<Result>("/v1/sync/run");
    log(`${green("✓")} first sync: ${summary(result)}`);
    return outcome(result, await api.get<Status>("/v1/sync"));
  });
}

export async function sync(flags: Flags) {
  return withLocal(flags, async (api) => {
    const changes: Record<string, unknown> = {};
    const runs = str(flags, "runs");
    if (runs) { if (runs !== "on" && runs !== "off") throw new CliError("--runs on|off", EXIT.usage); changes.includeRuns = runs === "on"; }
    const projects = str(flags, "projects");
    if (projects === "all") changes.projects = null;
    else if (projects) {
      // By slug or id, as everywhere else in the CLI; the link keeps ids, which never change.
      const known = await api.get<{ id: string; slug: string }[]>("/v1/projects");
      changes.projects = projects.split(",").map((item) => item.trim()).filter(Boolean).map((wanted) => {
        const found = known.find((item) => item.slug === wanted || item.id === wanted);
        if (!found) throw new CliError(`No project "${wanted}" here (there are: ${known.map((item) => item.slug).join(", ") || "none"})`, EXIT.usage);
        return found.id;
      });
    }
    const secrets = str(flags, "secrets");
    if (secrets === "off") changes.passphrase = null;
    else if (secrets === "on") {
      const passphrase = process.env.EQ_SYNC_PASSPHRASE;
      if (!passphrase) throw new CliError("Set the passphrase in EQ_SYNC_PASSPHRASE (never as an argument: it would stay in the shell history)", EXIT.usage);
      changes.passphrase = passphrase;
    } else if (secrets) throw new CliError("--secrets on|off", EXIT.usage);
    if (Object.keys(changes).length) await api.patch("/v1/sync", changes);

    let status = await api.get<Status>("/v1/sync");
    if (!status.linked) throw new CliError("This installation is not linked to a cloud workspace: eq login <url>", EXIT.usage);
    if (flags.status) {
      process.stdout.write([
        `${bold(status.workspace?.name ?? "")} at ${status.url} · ${status.deviceName}`,
        `last sync: ${status.lastSyncAt ?? "never"}${status.lastError ? ` · ${red(status.lastError)}` : ""}`,
        `pending here: ${status.pendingChanges} · open conflicts: ${status.openConflicts}`,
        `runs: ${status.includeRuns ? "on" : "off"} · projects: ${status.projects?.join(", ") ?? "all"} · secrets: ${status.secrets ? "end-to-end encrypted" : "stay here"}`,
        `automatic: ${status.autoSyncSeconds ? `every ${status.autoSyncSeconds} s while eq serve runs` : "off"}`,
      ].join("\n") + "\n");
      return EXIT.ok;
    }
    const result = await api.post<Result>("/v1/sync/run");
    status = await api.get<Status>("/v1/sync");
    log(`${green("✓")} ${summary(result)}`);
    return outcome(result, status);
  });
}

export async function logout(flags: Flags) {
  return withLocal(flags, async (api) => {
    await api.delete("/v1/sync/link");
    log(`${green("✓")} unlinked; the data stays on this device`);
    return EXIT.ok;
  });
}
