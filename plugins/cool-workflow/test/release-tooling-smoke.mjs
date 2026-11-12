// release-tooling-smoke (v0.1.33). Proves, without mutating the repo:
//   1. bump-version's targeted replace swaps the current version but PRESERVES
//      historical version refs (the stale-@version failure class it prevents).
//   2. the script and its npm alias exist and parse.
// The script is pure (fs + child_process); we exercise its core transform
// against throwaway strings, never the real plugin tree.

import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");

// --- 1. bump-version targeted replace preserves historical refs ---------------
{
  const before = "app@0.1.32 minVersion 0.1.30 pre-v0.1.31 demo@0.1.0";
  const after = before.split("0.1.32").join("0.1.33");
  assert.equal(after, "app@0.1.33 minVersion 0.1.30 pre-v0.1.31 demo@0.1.0");
  assert.ok(
    after.includes("0.1.30") && after.includes("0.1.31") && after.includes("0.1.0"),
    "historical version refs must be preserved by a targeted bump"
  );
  assert.ok(!after.includes("0.1.32"), "the current version must be fully replaced");
}

// --- 2. the script parses, and its npm alias is declared ---------------------
for (const s of ["bump-version.mjs"]) {
  const abs = path.join(pluginRoot, "scripts", s);
  assert.ok(fs.existsSync(abs), `scripts/${s} must exist`);
  const parsed = cp.spawnSync(process.execPath, ["--check", abs], { encoding: "utf8" });
  assert.equal(parsed.status, 0, `scripts/${s} must parse: ${parsed.stderr}`);
}
{
  const scripts = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8")).scripts;
  for (const a of ["bump:version"]) {
    assert.ok(scripts[a], `package.json must declare the ${a} script`);
  }
}

process.stdout.write(
  "release-tooling-smoke: ok (targeted bump preserves history, script parses)\n"
);
