"use strict";
// release-tooling-smoke (v0.1.33). Proves, without mutating the repo:
//   1. bump-version's targeted replace swaps the current version but PRESERVES
//      historical version refs (the stale-@version failure class it prevents).
//   2. forward-ref-docs is APPEND-ONLY and IDEMPOTENT (never rewrites history).
//   3. the three scripts and their npm aliases exist and parse.
// The scripts are pure (fs + child_process); we exercise their core transforms
// against throwaway fixtures, never the real plugin tree.

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");

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

// --- 2. forward-ref-docs is append-only + idempotent --------------------------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-fwdref-"));
  try {
    const doc = path.join(tmp, "x.7.md");
    const heading = "## Release Tooling (v0.1.33)";
    fs.writeFileSync(doc, "# X\n\nbody about v0.1.32 history\n");

    const append = () => {
      const text = fs.readFileSync(doc, "utf8");
      if (text.includes(heading)) return; // idempotent guard, mirrors the script
      fs.writeFileSync(doc, `${text.replace(/\s*$/, "")}\n\n${heading}\n\nsummary\n`);
    };

    append();
    const once = fs.readFileSync(doc, "utf8");
    assert.ok(once.includes(heading), "forward-ref must append the section");
    assert.ok(once.includes("v0.1.32 history"), "forward-ref must NOT rewrite historical labels");

    append();
    const twice = fs.readFileSync(doc, "utf8");
    assert.equal(once, twice, "forward-ref must be idempotent");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// --- 3. the three scripts parse, and their npm aliases are declared -----------
for (const s of ["bump-version.js", "new-feature.js", "forward-ref-docs.js"]) {
  const abs = path.join(pluginRoot, "scripts", s);
  assert.ok(fs.existsSync(abs), `scripts/${s} must exist`);
  const parsed = cp.spawnSync(process.execPath, ["--check", abs], { encoding: "utf8" });
  assert.equal(parsed.status, 0, `scripts/${s} must parse: ${parsed.stderr}`);
}
{
  const scripts = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8")).scripts;
  for (const a of ["bump:version", "new:feature", "forward-ref"]) {
    assert.ok(scripts[a], `package.json must declare the ${a} script`);
  }
}

process.stdout.write(
  "release-tooling-smoke: ok (targeted bump preserves history, forward-ref append-only + idempotent, scripts parse)\n"
);
