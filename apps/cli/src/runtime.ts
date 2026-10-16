/**
 * Where the CLI finds what it ships with — the built web app, the examples and sql.js's
 * WebAssembly — in each of the three ways it can run:
 *
 * - **from the repository** (`pnpm eq …`, through tsx): the workspace's own folders;
 * - **as the bundled package** (`npx endpoint-quality`, `dist/eq.cjs`): folders next to the bundle;
 * - **as a single executable** (Node SEA): the files are embedded in the binary and extracted
 *   once, per version, to `~/.endpoint-quality/runtime/<version>/`.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "0.1.0";
export const DATA_DIR = process.env.EQ_DATA_DIR ?? join(homedir(), ".endpoint-quality");

export type Resources = { webDir?: string; examplesDir?: string; wasm?: string; mode: "repository" | "bundle" | "binary" };

/** Set by the bundle's banner to the folder of `eq.cjs`. */
declare const __EQ_BUNDLE_DIR__: string | undefined;

function isSea() {
  try {
    const require = createRequire(join(process.cwd(), "noop.js"));
    return Boolean((require("node:sea") as { isSea(): boolean }).isSea());
  } catch { return false; }
}

/** Writes the binary's embedded files to disk once per version; later runs reuse them. */
function extractSeaAssets(): string {
  const target = join(DATA_DIR, "runtime", VERSION);
  const stamp = join(target, ".complete");
  if (existsSync(stamp)) return target;
  const require = createRequire(join(process.cwd(), "noop.js"));
  const sea = require("node:sea") as { getAsset(key: string): ArrayBuffer };
  const manifest = JSON.parse(new TextDecoder().decode(sea.getAsset("manifest.json"))) as string[];
  for (const key of manifest) {
    const file = join(target, ...key.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(sea.getAsset(key)));
  }
  writeFileSync(stamp, new Date().toISOString());
  return target;
}

export function resources(): Resources {
  if (isSea()) {
    const root = extractSeaAssets();
    return { mode: "binary", webDir: join(root, "web"), examplesDir: join(root, "examples"), wasm: join(root, "sql-wasm.wasm") };
  }
  if (typeof __EQ_BUNDLE_DIR__ === "string") {
    return { mode: "bundle", webDir: join(__EQ_BUNDLE_DIR__, "web"), examplesDir: join(__EQ_BUNDLE_DIR__, "examples"), wasm: join(__EQ_BUNDLE_DIR__, "sql-wasm.wasm") };
  }
  const repository = fileURLToPath(new URL("../../../", import.meta.url));
  return { mode: "repository", webDir: join(repository, "apps", "web", "dist"), examplesDir: join(repository, "examples") };
}
