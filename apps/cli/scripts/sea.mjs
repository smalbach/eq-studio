/**
 * A single executable for this platform: Node's own binary with the bundle and every asset it
 * needs (the web app, the examples, SQLite's WebAssembly) embedded — Node Single Executable
 * Applications. Nothing to install on the target machine, not even Node.
 *
 *   node scripts/sea.mjs        → build/eq-<platform>-<arch>[.exe]
 *
 * A binary is built on the platform it is for (CI runs this on macOS, Windows and Linux): the
 * Node binary it starts from is the one running this script. On macOS it is signed ad hoc, which
 * is what Apple Silicon requires to run it at all; a distributed release would add a Developer ID
 * signature and notarization on top.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const build = join(root, "build");
const exe = process.platform === "win32" ? ".exe" : "";
const output = join(build, `eq-${process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform}-${process.arch}${exe}`);

if (!existsSync(join(dist, "eq.cjs")) || process.argv.includes("--rebuild")) execFileSync(process.execPath, [join(root, "scripts", "bundle.mjs")], { stdio: "inherit" });
rmSync(build, { recursive: true, force: true });
mkdirSync(build, { recursive: true });

/** Every file the runtime extracts, by its path under the extraction folder. */
const files = (directory) => readdirSync(directory).flatMap((name) => { const path = join(directory, name); return statSync(path).isDirectory() ? files(path) : [path]; });
const assets = Object.fromEntries([...files(join(dist, "web")), ...files(join(dist, "examples")), join(dist, "sql-wasm.wasm")].map((path) => [relative(dist, path).split("\\").join("/"), path]));
const manifest = join(build, "manifest.json");
writeFileSync(manifest, JSON.stringify(Object.keys(assets)));
const config = join(build, "sea-config.json");
const blob = join(build, "sea-prep.blob");
writeFileSync(config, JSON.stringify({ main: join(dist, "eq.cjs"), output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false, assets: { "manifest.json": manifest, ...assets } }, null, 2));

execFileSync(process.execPath, ["--experimental-sea-config", config], { stdio: "inherit" });
copyFileSync(process.execPath, output);
if (process.platform === "darwin") execFileSync("codesign", ["--remove-signature", output], { stdio: "inherit" });
const postject = join(root, "node_modules", "postject", "dist", "cli.js");
execFileSync(process.execPath, [postject, output, "NODE_SEA_BLOB", blob, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2", ...(process.platform === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : [])], { stdio: "inherit" });
if (process.platform === "darwin") execFileSync("codesign", ["--sign", "-", output], { stdio: "inherit" });
console.log(`Binary ready: ${output} (${(statSync(output).size / 1024 / 1024).toFixed(0)} MB)`);
