/**
 * `eq` — the Endpoint Quality command line.
 *
 *   eq serve                     the app and the API on http://127.0.0.1:4400
 *   eq run <project> --env <e>   a functional run; exit code 0/1 for CI
 *   eq run --file p.eq.json      the same, without any server running
 *   eq load …                    a load, stress, spike or soak test
 *   eq report <run|file>         a stored run as HTML, SARIF or JUnit
 *   eq mock                      the example API the Mock Store project runs against
 *   eq diff <old> <new>          what changed between two contracts; exit 1 if it breaks clients
 *   eq projects | export | import
 *   eq login <url> | sync | logout   this installation and a cloud workspace
 */
import { parseArgs } from "node:util";
import { CliError, EXIT } from "./client.ts";
import { diff, exportProject, importProject, load, mock, projects, report, run, serve, type Flags } from "./commands.ts";
import { red } from "./report.ts";
import { login, logout, sync } from "./sync.ts";
import { VERSION } from "./runtime.ts";

const HELP = `Endpoint Quality ${VERSION} — verify any HTTP API against its OpenAPI contract.

Usage
  eq serve [--port 4400] [--host 127.0.0.1] [--open]
      The web app and the API. Data in ~/.endpoint-quality (EQ_DATA_DIR to change it); port and
      host also from EQ_PORT (or PORT) and EQ_HOST. Local mode has no sign-in: keep it on the loopback.
      With EQ_MODE=cloud it reads the hosted configuration from the environment instead and
      listens on 0.0.0.0 (EQ_DATABASE_URL, EQ_SECRETS_KEY, EQ_JWT_SECRET, EQ_QUEUE_DRIVER… see
      the app's documentation, "Cloud deployment").

  eq run <project> --env <environment> [options]
  eq run -f <project.eq.json> [-e <environment>] [--base-url <url>] [options]
      A functional run. With --file the project is loaded into an API started for this run
      only: nothing has to be installed or running (CI). Otherwise it runs on the API at
      --api (EQ_API_URL, default http://127.0.0.1:4400); a hosted one needs --api-token
      (EQ_API_TOKEN, from Settings → API tokens) and, for a session token, --workspace
      (EQ_WORKSPACE).
        --read-only            only the GET operations
        --auth | --no-auth     run (or not) the 401/403 cases, whatever the environment says
        --endpoints a,b        only these operations
        --token T              primary bearer token            (or EQ_TOKEN)
        --read-token T         insufficient-permission token   (or EQ_READ_TOKEN)
        --api-key K            alternate API key               (or EQ_API_KEY; --api-key-header)
        --cookie NAME=VALUE    primary credential as a session cookie (or EQ_COOKIE)
        --hmac-key K           primary credential as an HMAC key (or EQ_HMAC_KEY; --hmac-key-id)
        --client-cert F --client-key F [--client-key-passphrase P] [--client-ca F]
                               mutual TLS: alone, or with --token/--cookie/--hmac-key
                               (passphrase also EQ_CLIENT_KEY_PASSPHRASE)
        --samples N --delay MS --locale en|es --scope "name"
        --junit report.xml     JUnit XML for the CI's test view
        --html report.html     one self-contained HTML page to share (secrets masked)
        --sarif report.sarif   SARIF 2.1.0 for code scanning (GitHub upload-sarif)
        --contract openapi.yaml  the contract file SARIF results point at (default --file)
        --json run.json        the full run as JSON
        --format text|json     what is printed (default text)
        -q, --quiet            no progress, only the result
        --fail-on-blocked      exit 1 when writes were blocked by the environment

  eq load <project> --env <environment> [--type load|stress|spike|soak] [--rps 10] [--peak 50]
          [--duration 30] [--mix <id>] [--p95 <ms>] [--no-latency] [--preflight stop|skip|ignore]
      A load test (also with --file and --base-url). Exit 1 when its verdict fails.
      --junit, --html, --sarif, --json, --format and --locale work as for eq run (one JUnit case
      and one SARIF result per criterion).

  eq report <run-id | run.json> [--format html|sarif|junit] [-o file] [--locale en|es]
      A stored run as a report: a run id from the API at --api, or a file written by --json
      (no server needed). Default html, to stdout without -o.

  eq mock [--port 4010]             the example API (a fictional store) for the Mock Store project:
                                    no auth on 4010, with auth on 4011 (Bearer admin-token)

  eq diff <old> <new> [--json] [--locale en|es]
      What changed between two OpenAPI 3 contracts (files or http(s) URLs, JSON or YAML),
      grouped by operation and marked breaking or not. Exit 1 when a change breaks clients of
      the old one — a CI step that stops a contract change before it ships. --json (or
      --format json) prints the changes and their counts as JSON.

  eq projects [--format json]       the projects of the API
  eq export <project> [-o file]     a project as a .eq.json file
  eq import <file> [--name N] [--base-url URL] [--env file.postman_environment.json]
      A new project from a .eq.json file, or from a contract: OpenAPI 3.0/3.1, Swagger 2.0
      (converted to OpenAPI 3) in JSON or YAML, or a Postman collection v2.x (an OpenAPI 3 is
      generated from its requests; schemas are inferred from its examples). The first environment
      gets the contract's base URL, --base-url, or the one --env resolves {{baseUrl}} to.

  eq login <cloud-url> [--name "Work laptop"] [--no-open] [--token eqt_…]
      Links this installation to a cloud workspace: it shows a code to approve in the browser
      (or takes an API token: --token or EQ_SYNC_TOKEN), then syncs for the first time.
  eq sync [--status] [--runs on|off] [--projects a,b|all] [--secrets on|off]
      Pull, then push. --secrets on reads the passphrase from EQ_SYNC_PASSPHRASE and from then
      on credentials travel encrypted end to end. Exit 1 when a conflict or a refused change
      waits for someone. While "eq serve" runs it also syncs every 5 minutes
      (EQ_SYNC_INTERVAL_SECONDS; 0 turns it off).
  eq logout                         unlinks (the data stays here; the device's token is revoked)

Exit codes: 0 passed · 1 cases failed (or breaking changes) · 2 wrong command, project or environment · 3 could not run.
`;

export async function main(argv: string[]): Promise<number> {
  // For `eq diff`, --json takes no file: it is what is printed.
  const args = argv.find((item) => !item.startsWith("-")) === "diff" ? argv.map((item) => item === "--json" ? "--format=json" : item) : argv;
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" },
      port: { type: "string" }, host: { type: "string" }, open: { type: "boolean" }, api: { type: "string" }, "api-token": { type: "string" }, workspace: { type: "string" },
      file: { type: "string", short: "f" }, env: { type: "string", short: "e" }, "base-url": { type: "string" },
      "read-only": { type: "boolean" }, auth: { type: "boolean" }, "no-auth": { type: "boolean" }, endpoints: { type: "string" },
      token: { type: "string" }, "read-token": { type: "string" }, "api-key": { type: "string" }, "api-key-header": { type: "string" },
      cookie: { type: "string" }, "hmac-key": { type: "string" }, "hmac-key-id": { type: "string" }, "client-cert": { type: "string" }, "client-key": { type: "string" }, "client-key-passphrase": { type: "string" }, "client-ca": { type: "string" },
      samples: { type: "string" }, delay: { type: "string" }, locale: { type: "string" }, scope: { type: "string" },
      junit: { type: "string" }, json: { type: "string" }, format: { type: "string" }, quiet: { type: "boolean", short: "q" }, "fail-on-blocked": { type: "boolean" },
      type: { type: "string" }, rps: { type: "string" }, peak: { type: "string" }, duration: { type: "string" }, mix: { type: "string" }, p95: { type: "string" }, "no-latency": { type: "boolean" }, preflight: { type: "string" },
      output: { type: "string", short: "o" }, html: { type: "string" }, sarif: { type: "string" }, contract: { type: "string" }, project: { type: "string" },
      name: { type: "string" }, "no-open": { type: "boolean" }, status: { type: "boolean" }, runs: { type: "string" }, projects: { type: "string" }, secrets: { type: "string" },
    },
  });
  const flags = values as Flags;
  const [command, argument, second] = positionals;
  if (values.version) { process.stdout.write(`${VERSION}\n`); return EXIT.ok; }
  if (values.help || !command || command === "help") { process.stdout.write(HELP); return command || values.help ? EXIT.ok : EXIT.usage; }
  switch (command) {
    case "serve": return serve(flags);
    case "run": return run(argument, flags);
    case "load": return load(argument, flags);
    case "diff": return diff(argument, second, flags);
    case "report": return report(argument, flags);
    case "projects": return projects(flags);
    case "mock": return mock(flags);
    case "export": return exportProject(argument, flags);
    case "import": return importProject(argument, flags);
    case "login": return login(argument, flags);
    case "sync": return sync(flags);
    case "logout": return logout(flags);
    default: throw new CliError(`Unknown command "${command}". eq --help lists them.`, EXIT.usage);
  }
}

/** Runs the CLI and exits with its code. Kept apart from `main` so tests call `main` directly. */
export async function cli(argv = process.argv.slice(2)) {
  try {
    process.exitCode = await main(argv);
  } catch (error) {
    const code = error instanceof CliError ? error.exitCode : error instanceof TypeError && "code" in error && String(error.code).startsWith("ERR_PARSE_ARGS") ? EXIT.usage : EXIT.error;
    process.stderr.write(`${red("error")} ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = code;
  }
}
