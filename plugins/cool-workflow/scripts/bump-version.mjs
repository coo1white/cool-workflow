#!/usr/bin/env node

// One-shot version bump across every STRUCTURED surface, then gate or auto-fix
// the CONTENT surfaces (the docs/*.7.md man pages) that must mention the
// new version for version-sync-check to pass.
//
//   node scripts/bump-version.mjs <new-version>           # gate (fail if content missing)
//   node scripts/bump-version.mjs <new-version> --content # auto-append version placeholders
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

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CANONICAL_APP_IDS } from "./canonical-apps-list.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
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

function replaceLockfileVersions(absPath, next) {
  // Move BOTH lockfile version fields with targeted string swaps, so the byte
  // formatting npm wrote is kept as it is: the top-level "version" (the first
  // one in the file) and the root-package entry `"": { "name": ..., "version": ... }`.
  // Dependency entries are not touched — the second swap is keyed on the
  // `"": {` root-package opening, which is present only once.
  const text = fs.readFileSync(absPath, "utf8");
  let updated = text.replace(/"version":\s*"[^"]*"/, `"version": "${next}"`);
  updated = updated.replace(
    /("":\s*\{\s*"name":\s*"[^"]*",\s*"version":\s*)"[^"]*"/,
    `$1"${next}"`
  );
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
  if (!next) fail("usage: node scripts/bump-version.mjs <new-version>");
  if (!SEMVER.test(next)) fail(`"${next}" is not a x.y.z version`);

  const current = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8")).version;
  if (next === current) {
    // Idempotent for the STRUCTURED surfaces: re-running the bump for the same
    // version skips the writes (exit 0) rather than hard-failing. Required by
    // `release-flow --cut --version X` when the bump was already landed in a
    // prior PR — cut should still be able to commit the verdict and tag
    // without re-bumping. But the CONTENT-surface gate must still run: the
    // v0.2.3 cut hit exactly this hole — package.json was already bumped, so
    // this early-exit skipped the content check entirely and `--content`
    // never filled the missing docs/RELEASE references. Same-version reruns
    // now gate (or fill) content exactly like a fresh bump does.
    process.stdout.write(`bump:version: structured surfaces already at ${next}\n`);
    const sameVersionContent = handleContentSurfaces(current, next);
    if (!sameVersionContent.ok) fail(sameVersionContent.error);
    process.exit(0);
  }

  const touched = [];
  const note = (rel) => touched.push(rel);

  // 1. package.json (the single source of truth version:sync now reads from)
  if (replaceFirstVersionField(path.join(pluginRoot, "package.json"), next)) note("package.json");

  // 2. package-lock.json (tracked; only if present). The lockfile keeps the
  //    version in TWO places: the top-level "version" and the root-package
  //    entry packages[""].version. The old code moved only the first one, so
  //    the root-package entry kept an old version till the next `npm install`
  //    (the v0.1.97 drift seen after the v0.2.0/v0.2.1 cuts). Move both here.
  const lock = path.join(pluginRoot, "package-lock.json");
  if (fs.existsSync(lock) && replaceLockfileVersions(lock, next)) note("package-lock.json");

  // 3. src/core/version.ts runtime constant (v2 moved it from the old flat
  //    version module into the core state layer)
  const versionTs = path.join(pluginRoot, "src", "core", "version.ts");
  const vtsText = fs.readFileSync(versionTs, "utf8");
  const vtsNext = vtsText.replace(
    /(CURRENT_COOL_WORKFLOW_VERSION\s*=\s*)"[^"]*"/,
    `$1"${next}"`
  );
  if (vtsNext !== vtsText) {
    fs.writeFileSync(versionTs, vtsNext);
    note("src/core/version.ts");
  }

  // 4. manifest/plugin.manifest.json (identity.version) — gen:manifests then
  //    propagates to .claude-plugin / .codex-plugin / .gemini-plugin / .opencode-plugin / .agents
  setNestedVersion(path.join(pluginRoot, "manifest", "plugin.manifest.json"), next);
  note("manifest/plugin.manifest.json");

  // 5. canonical apps app.json (top-level version only; never minVersion).
  //    ONLY the canonical apps track the runtime version — workflow-app-framework-demo
  //    is pinned (e.g. 0.1.0) and must NOT be bumped. The list is DERIVED from
  //    apps/ (excluding metadata.example demos) by scripts/canonical-apps-list.mjs,
  //    the single source version-sync-check.mjs asserts against — no hand-copy.
  for (const appId of CANONICAL_APP_IDS) {
    const appJson = path.join(pluginRoot, "apps", appId, "app.json");
    if (fs.existsSync(appJson) && replaceFirstVersionField(appJson, next)) {
      note(`apps/${appId}/app.json`);
    }
  }

  // 5c. Homebrew formula (repo root, not under pluginRoot). Structured surface:
  //     a git-tag formula with no sha256. Homebrew reads the version from the
  //     tag, so the ONLY literal that moves is `tag: "v<version>"` (an explicit
  //     `version` line would be redundant and brew audit rejects it). A targeted
  //     exact-string swap keeps the file byte-formatting intact;
  //     version-sync-check.mjs asserts the tag at HEAD, so it can never drift.
  const formula = path.join(repoRoot, "Formula", "cool-workflow.rb");
  if (fs.existsSync(formula)) {
    const text = fs.readFileSync(formula, "utf8");
    const updated = text.split(`tag: "v${current}"`).join(`tag: "v${next}"`);
    if (updated !== text) {
      fs.writeFileSync(formula, updated);
      note("Formula/cool-workflow.rb");
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

  // 7. Content-surface gate or auto-fix (v0.1.52 corrective action).
  //    By default (--gate): run version-sync-check and FAIL if any content
  //    surface is missing the new version, listing exactly which files to update.
  //    With --content: auto-append version placeholders to all missing surfaces.
  const contentResult = handleContentSurfaces(current, next);
  if (!contentResult.ok) fail(contentResult.error);
}

// ---- Content-surface handling (v0.1.52) -----------------------------------

// The man-page footer line a release needs: the version itself for a minor
// or major (X.Y.0), and that same X.Y.0 line for a patch. Patches ship
// automatically on green main (release-auto-patch.mjs) and add no man-page
// lines; version-sync-check.mjs asks for the same line (manPageVersionLine).
function contentNeedle(next) {
  const [major, minor, patch] = next.split(".");
  return patch === "0" ? next : `${major}.${minor}.0`;
}

function contentSurfaceFiles(next) {
  const line = contentNeedle(next);
  // All files the version-sync-check script validates for VERSION or vX.Y.Z.
  // Keep in sync with scripts/version-sync-check.mjs.
  return [
    // The npm package README (plugins/cool-workflow/README.md) is GENERATED from the GitHub
    // README.md by scripts/sync-readme.mjs and shows the version via the live npm/release shields
    // badges, not a hand-maintained literal — so it is NOT a version-bump surface. After a bump,
    // `npm run sync:readme` keeps it byte-identical to the GitHub README (guarded by readme:check).
    { path: "plugins/cool-workflow/docs/release-tooling.7.md",               needle: line, desc: "release tooling doc" },
    { path: "plugins/cool-workflow/docs/agent-delegation-drive.7.md",        needle: line, desc: "agent delegation doc" },
    { path: "plugins/cool-workflow/docs/durable-state-and-locking.7.md",     needle: line, desc: "durable state doc" },
    { path: "plugins/cool-workflow/docs/release-and-migration.7.md",         needle: line, desc: "release & migration doc" },
  ];
}

function handleContentSurfaces(current, next) {
  const allFiles = contentSurfaceFiles(next);

  const missing = [];
  for (const { path: rel, needle } of allFiles) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) { missing.push({ rel, needle, reason: "file missing" }); continue; }
    const text = fs.readFileSync(abs, "utf8");
    // Own-line match, not a plain substring: every entry here is a line this
    // function itself appends (`\n${needle}\n`) when missing, and a bare
    // version number can otherwise coincidentally already appear in the
    // doc's unrelated prose (an example command, a cross-reference) without
    // the real version-history line actually being present. See
    // version-sync-check.mjs's checkIncludesOwnLine for the matching CI-side
    // gate (found live: v0.2.4's bump masked a real missing footer line in
    // release-tooling.7.md this way).
    const hasOwnLine = text.split("\n").some((line) => line.trim() === needle);
    if (!hasOwnLine) missing.push({ rel, needle });
  }

  if (missing.length === 0) {
    process.stdout.write(`\nContent surfaces PASS — every file includes ${contentNeedle(next)}.\n`);
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
  const lines = [`\n${missing.length} content surface(s) missing version ${contentNeedle(next)}:`];
  for (const { rel, needle } of missing) {
    lines.push(`  ${rel}  — must contain "${needle}"`);
  }
  lines.push("");
  lines.push("Fix with:  npm run bump:version -- " + next + " --content  (auto-fill placeholders)");
  lines.push("   or edit each file manually to add the version reference.");
  return { ok: false, error: lines.join("\n") };
}

main();
