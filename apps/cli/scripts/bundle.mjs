/**
 * Builds the distributable package in `dist/`:
 *
 *   dist/eq.cjs           the CLI, the API and the engine in one CommonJS file (Node ≥ 22)
 *   dist/web/             the built web app the API serves
 *   dist/examples/        the bundled example projects
 *   dist/sql-wasm.wasm    SQLite for the local database
 *
 * CommonJS because a Node single executable (scripts/sea.mjs) only runs CommonJS. What is left
 * out of the bundle, and why, is in `esbuild-shared.mjs`.
 */
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { OPTIONAL, stripDevHooks } from "./esbuild-shared.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const repository = join(root, "..", "..");
const out = join(root, "dist");
const require = createRequire(join(repository, "apps", "api", "package.json"));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

if (!process.argv.includes("--skip-web")) execSync("pnpm --filter @eq/web build", { cwd: repository, stdio: "inherit" });

await build({
  entryPoints: [join(root, "src", "entry.ts")],
  outfile: join(out, "eq.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: OPTIONAL,
  tsconfig: join(repository, "apps", "api", "tsconfig.json"),
  // `import.meta.url` has no meaning in CommonJS; the runtime code reads the bundle's own folder.
  define: { "import.meta.url": "__eq_import_meta_url" },
  banner: { js: "#!/usr/bin/env node\nconst __EQ_BUNDLE_DIR__ = __dirname; const __eq_import_meta_url = require(\"node:url\").pathToFileURL(__filename).href;" },
  plugins: [stripDevHooks],
  legalComments: "none",
  logLevel: "warning",
  minify: false,
  sourcemap: false,
});

cpSync(join(repository, "apps", "web", "dist"), join(out, "web"), { recursive: true });
cpSync(join(repository, "examples"), join(out, "examples"), { recursive: true });
cpSync(join(dirname(require.resolve("sql.js")), "sql-wasm.wasm"), join(out, "sql-wasm.wasm"));
if (!existsSync(join(out, "web", "index.html"))) throw new Error("The web app was not built");
console.log(`Bundle ready in ${out}`);
