#!/usr/bin/env node
"use strict";

// dist-drift-check — fail closed if dist/ is not the exact output of building
// the current src/.
//
// Why this exists: dist/ is committed so the runtime is usable without a build
// step (see README "inspect the bundled runtime immediately"). That makes dist/
// a generated artifact living in source control, so it can silently drift from
// src/ when someone edits TypeScript and forgets to rebuild. CI rebuilds before
// testing, so the tests pass against a fresh build while the committed dist/
// stays stale — the drift is invisible. This is the same fail-closed drift
// discipline the vendor manifests already use (gen:manifests --check).
//
// Approach: snapshot dist/, rebuild, diff the snapshot against the rebuild. This
// is git-independent — it asks the only question that matters ("is the dist on
// disk the build of the src on disk?"), so it does NOT punish a consistent but
// uncommitted working tree the way a `git diff HEAD` would. Committed-vs-built
// drift is enforced separately by the porcelain step in ci.yml on a clean
// checkout. Portable: node + npm only.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const packageDir = path.resolve(__dirname, "..");
const distDir = path.join(packageDir, "dist");

function snapshot(dir) {
  const files = new Map();
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [rel, content] of snapshot(full)) files.set(path.join(entry.name, rel), content);
    } else {
      files.set(entry.name, fs.readFileSync(full, "utf8"));
    }
  }
  return files;
}

function fail(message, detail) {
  process.stderr.write(`dist drift check: ${message}\n`);
  if (detail) process.stderr.write(`${detail}\n`);
  process.exit(1);
}

// 1) Snapshot the dist/ that is on disk right now (i.e. what is committed).
const before = snapshot(distDir);

// 2) Rebuild from the current src/.
const build = spawnSync("npm", ["run", "build"], {
  cwd: packageDir,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (build.error) fail("build failed to start", build.error.message);
if (build.status !== 0) fail("build failed", `${build.stdout || ""}${build.stderr || ""}`);

// 3) Anything the build changed means the pre-build dist/ was stale.
const after = snapshot(distDir);
const drifted = [];
for (const [file, content] of after) {
  if (!before.has(file)) drifted.push(`added:    ${file}`);
  else if (before.get(file) !== content) drifted.push(`changed:  ${file}`);
}
for (const file of before.keys()) {
  if (!after.has(file)) drifted.push(`removed:  ${file}`);
}

if (drifted.length > 0) {
  fail(
    `dist/ is stale — ${drifted.length} file(s) differ from a fresh build of src/.`,
    ["Rebuild and commit the output:", "  npm run build && git add dist/", "", ...drifted.map((d) => `  ${d}`)].join("\n"),
  );
}

process.stdout.write("dist drift check: dist/ matches a fresh build of src/.\n");
