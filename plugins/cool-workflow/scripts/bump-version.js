#!/usr/bin/env node
"use strict";

// One-shot version bump across every STRUCTURED surface, then gate or auto-fix
// the CONTENT surfaces (docs, CHANGELOG, RELEASE, README) that must mention the
// new version for version-sync-check and dogfood-release to pass.
//
//   node scripts/bump-version.js <new-version>           # gate (fail if content missing)
//   node scripts/bump-version.js <new-version> --content # auto-append version placeholders
//   npm run bump:version -- 0.1.33
//   npm run bump:version -- 0.1.33 --content
//
// BSD discipline (v0.1.52 corrective action):
//  - MECHANISM: structured surfaces are deterministically bumped by this script.
//    Content surfaces are gated (fail-closed default) or auto-filled (--content).
//  - FAIL CLOSED: by default, any content surface missing the new version FAILS
//    the bump with a precise list of files to update. Tagging a release with
//    missing content surfaces is now blocked at the bump step.
//  - POLICY: --content auto-appends placeholders for convenience; the human
//    still edits the prose to describe the actual release.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");

const SEMVER = /^\d+\.\d+\.\d+$/;
const GATE = !process.argv.includes("--content");
const CONTENT = process.argv.includes("--content");

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

  // 5. canonical apps app.json (top-level version only; never minVersion).
  //    ONLY the canonical apps track the runtime version — workflow-app-sdk-demo
  //    is pinned (e.g. 0.1.0) and must NOT be bumped. This list mirrors the one
  //    version-sync-check.js asserts.
  const CANONICAL_APPS = [
    "architecture-review",
    "end-to-end-golden-path",
    "pr-review-fix-ci",
    "release-cut",
    "research-synthesis"
  ];
  for (const appId of CANONICAL_APPS) {
    const appJson = path.join(pluginRoot, "apps", appId, "app.json");
    if (fs.existsSync(appJson) && replaceFirstVersionField(appJson, next)) {
      note(`apps/${appId}/app.json`);
    }
  }

  // 5b. Scripts + test assertions that hard-code the CURRENT version as a
  //     current-version reference. A TARGETED `current -> next` replace is safe:
  //     it only swaps the exact old version string, leaving historical refs
  //     (minVersion, "pre-vX", fixed demo versions) untouched. This is the
  //     surface that caused the stale `@0.1.31` failure. Docs and CHANGELOG are
  //     intentionally excluded — their version labels are historical feature tags.
  const targeted = [
    "scripts/golden-path.js",
    "scripts/canonical-apps.js",
    "scripts/dogfood-release.js",
    "test/dogfood-release-smoke.js",
    "test/mcp-app-surface-smoke.js",
    "test/canonical-workflow-apps-smoke.js",
    "test/workflow-app-sdk-smoke.js",
    "test/operator-ux-smoke.js"
  ];
  // The version appears in THREE forms across scripts/tests: plain (`0.1.32`),
  // a regex literal (`0\.1\.32`, from `assert.match(report, /...@0\.1\.32/)`),
  // and a RegExp string (`0\\.1\\.32`, from `new RegExp(\`...@0\\.1\\.32\`)`).
  // A plain replace silently misses the escaped forms — the exact "escaped-dot"
  // surface that fails version:sync mid-release. Replace all three, most-escaped
  // first so the forms can never overlap.
  const esc1 = (v) => v.replace(/\./g, "\\.");
  const esc2 = (v) => v.replace(/\./g, "\\\\.");
  const forms = [[esc2(current), esc2(next)], [esc1(current), esc1(next)], [current, next]];
  for (const rel of targeted) {
    const abs = path.join(pluginRoot, rel);
    if (!fs.existsSync(abs)) continue;
    let text = fs.readFileSync(abs, "utf8");
    if (!forms.some(([from]) => text.includes(from))) continue;
    for (const [from, to] of forms) text = text.split(from).join(to);
    fs.writeFileSync(abs, text);
    note(rel);
  }

  process.stdout.write(`bump:version ${current} -> ${next}\n`);
  for (const rel of touched) process.stdout.write(`  updated  ${rel}\n`);

  // 6. Regenerate vendor manifests + rebuild dist so dist/version.js follows.
  for (const cmd of [["npm", "run", "gen:manifests"], ["npm", "run", "build"]]) {
    process.stdout.write(`  run      ${cmd.join(" ")}\n`);
    const r = spawnSync(cmd[0], cmd.slice(1), { cwd: pluginRoot, stdio: "pipe", encoding: "utf8" });
    if (r.status !== 0) fail(`${cmd.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
  }

  // 7. Content-surface gate or auto-fix (v0.1.52 corrective action).
  //    By default (--gate): run version-sync-check and FAIL if any content
  //    surface is missing the new version, listing exactly which files to update.
  //    With --content: auto-append version placeholders to all missing surfaces.
  const contentResult = handleContentSurfaces(current, next);
  if (!contentResult.ok) fail(contentResult.error);
}

// ---- Content-surface handling (v0.1.52) -----------------------------------

function contentSurfaceFiles(next) {
  // All files the version-sync-check script validates for VERSION or vX.Y.Z.
  // Keep in sync with scripts/version-sync-check.js.
  return [
    { path: "plugins/cool-workflow/README.md", needle: `v${next}`,          desc: "README version tag" },
    { path: "plugins/cool-workflow/docs/multi-agent-cli-mcp-surface.7.md",   needle: next, desc: "multi-agent CLI/MCP surface doc" },
    { path: "plugins/cool-workflow/docs/multi-agent-operator-ux.7.md",       needle: next, desc: "multi-agent operator UX doc" },
    { path: "plugins/cool-workflow/docs/multi-agent-eval-replay-harness.7.md", needle: next, desc: "multi-agent eval/replay doc" },
    { path: "plugins/cool-workflow/docs/state-explosion-management.7.md",    needle: next, desc: "state explosion doc" },
    { path: "plugins/cool-workflow/docs/evidence-adoption-reasoning-chain.7.md", needle: next, desc: "evidence reasoning doc" },
    { path: "plugins/cool-workflow/docs/cli-mcp-parity.7.md",                needle: next, desc: "CLI/MCP parity doc" },
    { path: "plugins/cool-workflow/docs/run-registry-control-plane.7.md",    needle: next, desc: "run registry doc" },
    { path: "plugins/cool-workflow/docs/execution-backends.7.md",            needle: next, desc: "execution backends doc" },
    { path: "plugins/cool-workflow/docs/web-desktop-workbench.7.md",         needle: next, desc: "workbench doc" },
    { path: "plugins/cool-workflow/docs/observability-cost-accounting.7.md", needle: next, desc: "observability doc" },
    { path: "plugins/cool-workflow/docs/team-collaboration.7.md",            needle: next, desc: "team collaboration doc" },
    { path: "plugins/cool-workflow/docs/release-tooling.7.md",               needle: next, desc: "release tooling doc" },
    { path: "plugins/cool-workflow/docs/real-execution-backends.7.md",       needle: next, desc: "real execution backends doc" },
    { path: "plugins/cool-workflow/docs/node-snapshot-diff-replay.7.md",     needle: next, desc: "node snapshot doc" },
    { path: "plugins/cool-workflow/docs/contract-migration-tooling.7.md",    needle: next, desc: "contract migration doc" },
    { path: "plugins/cool-workflow/docs/control-plane-scheduling.7.md",      needle: next, desc: "control-plane scheduling doc" },
    { path: "plugins/cool-workflow/docs/agent-delegation-drive.7.md",        needle: next, desc: "agent delegation doc" },
    { path: "plugins/cool-workflow/docs/run-retention-reclamation.7.md",     needle: next, desc: "run retention doc" },
    { path: "plugins/cool-workflow/docs/durable-state-and-locking.7.md",     needle: next, desc: "durable state doc" },
    { path: "plugins/cool-workflow/docs/release-and-migration.7.md",         needle: next, desc: "release & migration doc" },
  ];
}

function contentSurfaceFilesRoot(next) {
  return [
    { path: "CHANGELOG.md", needle: `## ${next}`, desc: "CHANGELOG section header" },
    { path: "RELEASE.md",   needle: next,          desc: "RELEASE version reference" },
  ];
}

function handleContentSurfaces(current, next) {
  const allFiles = [
    ...contentSurfaceFiles(next),
    ...contentSurfaceFilesRoot(next)
  ];

  const missing = [];
  for (const { path: rel, needle } of allFiles) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) { missing.push({ rel, reason: "file missing" }); continue; }
    const text = fs.readFileSync(abs, "utf8");
    if (!text.includes(needle)) missing.push({ rel, needle });
  }

  if (missing.length === 0) {
    process.stdout.write(`\nContent surfaces PASS — every file includes ${next}.\n`);
    return { ok: true };
  }

  if (CONTENT) {
    // Auto-append version placeholders to all missing files.
    process.stdout.write(`\nAuto-appending v${next} placeholders to ${missing.length} content surface(s):\n`);
    for (const { rel, needle } of missing) {
      const abs = path.join(repoRoot, rel);
      if (!fs.existsSync(abs)) { process.stdout.write(`  SKIP  ${rel} (missing)\n`); continue; }
      fs.appendFileSync(abs, `\n${needle}\n`);
      process.stdout.write(`  +     ${rel}\n`);
    }
    // Re-run version-sync-check to confirm all content surfaces now pass.
    const reSync = spawnSync("npm", ["run", "--silent", "version:sync"], {
      cwd: pluginRoot, stdio: "pipe", encoding: "utf8"
    });
    if (reSync.status !== 0) {
      return { ok: false, error: `version:sync still fails after auto-append:\n${reSync.stdout}\n${reSync.stderr}` };
    }
    process.stdout.write(`Content surfaces auto-filled. Edit prose in:\n`);
    for (const { rel } of missing) process.stdout.write(`  ${rel}\n`);
    return { ok: true };
  }

  // GATE mode (default): fail with precise missing-file list.
  const lines = [`\n${missing.length} content surface(s) missing version ${next}:`];
  for (const { rel, needle } of missing) {
    lines.push(`  ${rel}  — must contain "${needle}"`);
  }
  lines.push("");
  lines.push("Fix with:  npm run bump:version -- " + next + " --content  (auto-fill placeholders)");
  lines.push("   or edit each file manually to add the version reference.");
  return { ok: false, error: lines.join("\n") };
}

main();
