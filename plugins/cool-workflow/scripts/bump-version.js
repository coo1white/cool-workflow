#!/usr/bin/env node
"use strict";

// One-shot version bump across every STRUCTURED surface, then report the
// remaining CONTENT surfaces (docs/tests) that still need the new version.
//
//   node scripts/bump-version.js <new-version>
//   npm run bump:version -- 0.1.33
//
// Why this exists: a release used to require hand-editing ~10 structured
// surfaces plus scattered doc/test assertions. Manual bumps are slow and
// error-prone (a missed surface fails version:sync mid-release). This script
// owns the mechanical, unambiguous surfaces deterministically. Prose/doc
// "what's new in vX" sections are feature content and are left to the feature
// work (see scripts/new-feature.js); this script lists exactly which remain.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");

const SEMVER = /^\d+\.\d+\.\d+$/;

function fail(msg) {
  process.stderr.write(`bump:version error: ${msg}\n`);
  process.exit(1);
}

function replaceFirstVersionField(absPath, next) {
  // Replace ONLY the first `"version": "x.y.z"` (the top-level / identity one);
  // preserves byte formatting and never touches nested minVersion fields.
  const text = fs.readFileSync(absPath, "utf8");
  const updated = text.replace(/"version":\s*"[^"]*"/, `"version": "${next}"`);
  if (updated === text) return false;
  fs.writeFileSync(absPath, updated);
  return true;
}

function setNestedVersion(absPath, next) {
  // For files where the first `"version"` is NOT the right one, parse + set.
  const json = JSON.parse(fs.readFileSync(absPath, "utf8"));
  json.identity.version = next;
  fs.writeFileSync(absPath, `${JSON.stringify(json, null, 2)}\n`);
}

function main() {
  const next = process.argv[2];
  if (!next) fail("usage: node scripts/bump-version.js <new-version>");
  if (!SEMVER.test(next)) fail(`"${next}" is not a x.y.z version`);

  const current = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8")).version;
  if (next === current) fail(`already at ${next}`);

  const touched = [];
  const note = (rel) => touched.push(rel);

  // 1. package.json (the single source of truth version:sync now reads from)
  if (replaceFirstVersionField(path.join(pluginRoot, "package.json"), next)) note("package.json");

  // 2. package-lock.json (gitignored install artifact; only if present)
  const lock = path.join(pluginRoot, "package-lock.json");
  if (fs.existsSync(lock) && replaceFirstVersionField(lock, next)) note("package-lock.json");

  // 3. src/version.ts runtime constant
  const versionTs = path.join(pluginRoot, "src", "version.ts");
  const vtsText = fs.readFileSync(versionTs, "utf8");
  const vtsNext = vtsText.replace(
    /(CURRENT_COOL_WORKFLOW_VERSION\s*=\s*)"[^"]*"/,
    `$1"${next}"`
  );
  if (vtsNext !== vtsText) {
    fs.writeFileSync(versionTs, vtsNext);
    note("src/version.ts");
  }

  // 4. manifest/plugin.manifest.json (identity.version) — gen:manifests then
  //    propagates to .claude-plugin / .codex-plugin / .agents / .mcp.json
  setNestedVersion(path.join(pluginRoot, "manifest", "plugin.manifest.json"), next);
  note("manifest/plugin.manifest.json");

  // 5. canonical apps app.json (top-level version only; never minVersion)
  const appsDir = path.join(pluginRoot, "apps");
  for (const appId of fs.readdirSync(appsDir)) {
    const appJson = path.join(appsDir, appId, "app.json");
    if (fs.existsSync(appJson) && replaceFirstVersionField(appJson, next)) {
      note(`apps/${appId}/app.json`);
    }
  }

  process.stdout.write(`bump:version ${current} -> ${next}\n`);
  for (const rel of touched) process.stdout.write(`  updated  ${rel}\n`);

  // 6. Regenerate vendor manifests + rebuild dist so dist/version.js follows.
  for (const cmd of [["npm", "run", "gen:manifests"], ["npm", "run", "build"]]) {
    process.stdout.write(`  run      ${cmd.join(" ")}\n`);
    const r = spawnSync(cmd[0], cmd.slice(1), { cwd: pluginRoot, stdio: "pipe", encoding: "utf8" });
    if (r.status !== 0) fail(`${cmd.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
  }

  // 7. Run version:sync and surface the REMAINING content surfaces (docs/tests
  //    that must mention the new version). These are feature content, not
  //    mechanical edits — fill them via scripts/new-feature.js + your feature.
  const sync = spawnSync("npm", ["run", "--silent", "version:sync"], {
    cwd: pluginRoot,
    stdio: "pipe",
    encoding: "utf8"
  });
  if (sync.status === 0) {
    process.stdout.write(`\nversion:sync PASS — every surface is at ${next}.\n`);
  } else {
    process.stdout.write(`\nStructured surfaces bumped. version:sync still reports CONTENT surfaces\n`);
    process.stdout.write(`that need the new version (add them with your feature / new-feature.js):\n\n`);
    const out = `${sync.stdout}\n${sync.stderr}`;
    for (const line of out.split("\n")) {
      if (/must (include|be)/.test(line)) process.stdout.write(`  - ${line.trim()}\n`);
    }
    process.stdout.write(`\n(Run \`npm run version:sync\` again once the feature doc/test land.)\n`);
  }
}

main();
