/**
 * Builds what the desktop app loads, in `dist/`:
 *
 *   dist/main.cjs         Electron's main process: the API and the engine in one CommonJS file
 *   dist/web/             the built web app the API serves
 *   dist/examples/        the bundled example projects
 *   dist/sql-wasm.wasm    SQLite for the local database
 *
 * The web app, the examples and SQLite come from the CLI's bundle (`apps/cli/dist`), built here
 * first, so both ship exactly the same files (`--reuse` skips that when it is already built).
 * `electron-builder` then packages `dist/`.
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OPTIONAL, stripDevHooks } from "../../cli/scripts/esbuild-shared.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repository = join(root, "..", "..");
const cliDist = join(repository, "apps", "cli", "dist");
const out = join(root, "dist");

if (!process.argv.includes("--reuse") || !existsSync(join(cliDist, "web", "index.html"))) {
  execFileSync(process.execPath, [join(repository, "apps", "cli", "scripts", "bundle.mjs")], { stdio: "inherit" });
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, "src", "main.ts")],
  outfile: join(out, "main.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: [...OPTIONAL, "electron"],
  tsconfig: join(repository, "apps", "api", "tsconfig.json"),
  // Same contract as the CLI bundle: the runtime finds its files next to the bundle.
  define: { "import.meta.url": "__eq_import_meta_url" },
  banner: { js: "const __EQ_BUNDLE_DIR__ = __dirname; const __eq_import_meta_url = require(\"node:url\").pathToFileURL(__filename).href;" },
  plugins: [stripDevHooks],
  legalComments: "none",
  logLevel: "warning",
});

for (const name of ["web", "examples", "sql-wasm.wasm"]) cpSync(join(cliDist, name), join(out, name), { recursive: true });
console.log(`Desktop bundle ready in ${out}`);
