import { fileURLToPath } from "node:url";
import { createWriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import archiver from "archiver";
import pkg from "../package.json" with { type: "json" };

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, ".."); // scripts/ -> repo root
const targetDir = resolve(repoRoot, "dist/source");

const name = pkg.name.replace(/^@[^/]+\//, ""); // strip @scope/ if scoped
const targetFile = `${targetDir}/${name}-${pkg.version}-source.zip`;

// Ask git for the exact set of project files.
// - `ls-files` = tracked files, already honoring .gitignore at every level
// - `-z` = NUL-delimited, safe for filenames with spaces/newlines
// - cwd: repoRoot so this works no matter where the script is launched from
const files = execFileSync("git", ["ls-files", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean);

if (files.length === 0) {
  throw new Error("git ls-files returned nothing — not a git checkout, or no committed files.");
}

await mkdir(targetDir, { recursive: true });

await new Promise<void>((resolve_, reject) => {
  const output = createWriteStream(targetFile);
  const archive = archiver("zip", { zlib: { level: 9 } });

  // The file is only guaranteed complete on 'close'.
  output.on("close", () => resolve_());
  output.on("error", reject);
  archive.on("warning", reject);
  archive.on("error", reject);
  archive.pipe(output);

  // git paths are relative to repoRoot; give archiver the absolute source
  // path, but keep the archive entry name as the clean relative path.
  files.forEach((file) => archive.file(resolve(repoRoot, file), { name: file }));
  archive.finalize();
});

console.log(`Wrote ${targetFile} (${files.length} files).`);
