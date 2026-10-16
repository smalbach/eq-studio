/**
 * Joins the update metadata of the two macOS builds into the one `latest-mac.yml` the updater
 * reads.
 *
 * Each macOS job of the release workflow builds one architecture and writes its own
 * `latest-mac.yml`; the workflow renames them `latest-mac-<job>.yml` so they do not overwrite each
 * other. The updater picks its architecture from the `files` list, so the merged file carries the
 * entries of both, and the top-level `path` and `sha512` of the first.
 *
 *   node apps/desktop/scripts/merge-latest-mac.mjs <directory>
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const directory = process.argv[2] ?? ".";
const parts = readdirSync(directory).filter((name) => /^latest-mac-.+\.yml$/.test(name)).sort();
if (!parts.length) {
  console.log("No per-architecture latest-mac files to merge.");
  process.exit(0);
}

/** Splits the file into its `files:` entries and the rest of its top-level lines. */
function parse(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf("files:");
  let end = start + 1;
  while (end < lines.length && /^\s/.test(lines[end])) end++;
  return { head: lines.slice(0, start + 1), files: lines.slice(start + 1, end), tail: lines.slice(end) };
}

const parsed = parts.map((name) => parse(readFileSync(join(directory, name), "utf8")));
const [first] = parsed;
const merged = [...first.head, ...parsed.flatMap((part) => part.files), ...first.tail].join("\n");
writeFileSync(join(directory, "latest-mac.yml"), merged);
for (const name of parts) rmSync(join(directory, name));
console.log(`latest-mac.yml merged from ${parts.join(", ")}`);
