#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CANONICAL_APP_IDS } from "./canonical-apps-list.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");

// Deterministic source-of-record: validate the COMMIT being released (the blob
// at HEAD), NOT the mutable working tree. A working tree is a moving target —
// any concurrent editor, formatter, or stray process can write-then-revert a
// surface file, and a read that lands in that window makes a release gate
// false-RED on a clean tree (and, symmetrically, a gate that trusts an
// uncommitted edit could false-GREEN). Reading `git show HEAD:<path>` removes
// that entire failure class: the bytes are immutable for the life of the commit.
// CI checks out HEAD, so HEAD === the tree it is releasing.
//
// Fallback to the filesystem only when we cannot read from HEAD: not a git work
// tree, or the path is not tracked at HEAD.
// node + git only — no ripgrep (CI portability rule).
const insideGitWorkTree = (() => {
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: repoRoot, encoding: "utf8" });
  return r.status === 0 && (r.stdout || "").trim() === "true";
})();

function readReleaseSource(relativePath) {
  // relativePath is repoRoot-relative (the form every check below already uses).
  if (insideGitWorkTree) {
    const r = spawnSync("git", ["show", `HEAD:${relativePath}`], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 32
    });
    if (r.status === 0) return { text: r.stdout, exists: true, fromHead: true };
    // Not tracked at HEAD — fall through to the working tree.
  }
  const abs = path.join(repoRoot, relativePath);
  if (!fs.existsSync(abs)) return { text: null, exists: false, fromHead: false };
  return { text: fs.readFileSync(abs, "utf8"), exists: true, fromHead: false };
}

// Single source of truth: package.json. `scripts/bump-version.mjs` rewrites this
// (and every other surface); version:sync then asserts all surfaces equal it.
// Read it from the released commit so the asserted-against version is itself
// taken from HEAD, not a half-written working copy.
const VERSION = JSON.parse(readReleaseSource("plugins/cool-workflow/package.json").text).version;
// The man-page footer line: VERSION for a minor or major (X.Y.0), X.Y.0 for a
// patch. Patches ship automatically on green main and add no man-page lines;
// bump-version.mjs's contentNeedle() appends the same line.
const MAN_PAGE_LINE = (() => {
  const [major, minor, patch] = VERSION.split(".");
  return patch === "0" ? VERSION : `${major}.${minor}.0`;
})();
// Canonical app ids are DERIVED from apps/ (excluding metadata.example demos) by
// scripts/canonical-apps-list.mjs — the single source bump-version.mjs bumps.
// No hand-copied list to drift (audit M5).
const canonicalApps = CANONICAL_APP_IDS;

function main() {
  const checks = [];
  checkJson("plugins/cool-workflow/package.json", "version", VERSION, checks);
  // No lockfile check here: package-lock.json (npm) used to duplicate the
  // version in two spots and could go stale (0.1.97 through the v0.2.0/
  // v0.2.1 cuts) — bun.lock's workspace entry does not carry a version
  // field at all, so there is nothing to drift and nothing to check.
  checkJson("plugins/cool-workflow/.codex-plugin/plugin.json", "version", VERSION, checks);
  checkNestedJson("plugins/cool-workflow/manifest/plugin.manifest.json", ["identity", "version"], VERSION, checks);
  checkJson("plugins/cool-workflow/.claude-plugin/plugin.json", "version", VERSION, checks);
  checkJson("plugins/cool-workflow/.gemini-plugin/plugin.json", "version", VERSION, checks);
  checkJson("plugins/cool-workflow/.opencode-plugin/plugin.json", "version", VERSION, checks);
  checkIncludes("plugins/cool-workflow/src/core/version.ts", `CURRENT_COOL_WORKFLOW_VERSION = "${VERSION}"`, checks);
  checkIncludes("plugins/cool-workflow/src/core/state/types.ts", "RUN_STATE_SCHEMA_VERSION = 2", checks);

  for (const appId of canonicalApps) {
    checkJson(`plugins/cool-workflow/apps/${appId}/app.json`, "version", VERSION, checks);
  }

  checkIncludes("plugins/cool-workflow/dist/core/version.js", VERSION, checks);

  // The npm package README (plugins/cool-workflow/README.md) is GENERATED from the GitHub
  // README.md (scripts/sync-readme.mjs) and conveys the version via the live npm/release shields
  // badges — not a hand-maintained literal — exactly like the GitHub page. It is no longer
  // version-pinned here; readme:check guards that the two pages stay identical, and the surfaces
  // above (version.ts/dist/package.json/manifests/docs) still pin the release.
  checkIncludes("plugins/cool-workflow/docs/index.md", "release-and-migration.7.md", checks);
  checkIncludes("plugins/cool-workflow/docs/release-tooling.7.md", "Release Tooling", checks);
  checkIncludesOwnLine("plugins/cool-workflow/docs/release-tooling.7.md", MAN_PAGE_LINE, checks);
  checkIncludes("plugins/cool-workflow/docs/index.md", "release-tooling.7.md", checks);
  checkIncludes("plugins/cool-workflow/test/release-tooling-smoke.mjs", "release-tooling-smoke", checks);
  checkIncludes("plugins/cool-workflow/docs/agent-delegation-drive.7.md", "Agent Delegation Drive", checks);
  checkIncludesOwnLine("plugins/cool-workflow/docs/agent-delegation-drive.7.md", MAN_PAGE_LINE, checks);
  checkIncludes("plugins/cool-workflow/docs/index.md", "agent-delegation-drive.7.md", checks);
  checkIncludes("plugins/cool-workflow/docs/durable-state-and-locking.7.md", "Durable State & Locking", checks);
  checkIncludesOwnLine("plugins/cool-workflow/docs/durable-state-and-locking.7.md", MAN_PAGE_LINE, checks);
  checkIncludes("plugins/cool-workflow/docs/index.md", "durable-state-and-locking.7.md", checks);
  checkIncludes("plugins/cool-workflow/src/shell/fs-atomic.ts", "withFileLock", checks);
  checkIncludes("plugins/cool-workflow/src/shell/drive.ts", "export async function drive(", checks);
  checkIncludes("plugins/cool-workflow/dist/shell/drive.js", "export async function drive(", checks);
  checkIncludes("plugins/cool-workflow/docs/getting-started.md", "npm run release:check", checks);
  checkIncludesOwnLine("plugins/cool-workflow/docs/release-and-migration.7.md", MAN_PAGE_LINE, checks);
  // Homebrew formula (repo root): git-tag formula. Homebrew scans the version
  // from the tag, so the tag is the single version surface to gate (an explicit
  // `version` line would be redundant and brew audit rejects it). bump-version.mjs
  // moves this tag.
  checkIncludes("Formula/cool-workflow.rb", `tag: "v${VERSION}"`, checks);
  checkIncludes("plugins/cool-workflow/skills/cool-workflow/SKILL.md", "release:check", checks);

  process.stdout.write(
    `${JSON.stringify({ ok: true, version: VERSION, source: insideGitWorkTree ? "git:HEAD" : "working-tree", checks }, null, 2)}\n`
  );
}

function checkJson(relativePath, key, expected, checks) {
  const src = readReleaseSource(relativePath);
  assert.ok(src.exists, `${relativePath} must exist`);
  const value = JSON.parse(src.text)[key];
  assert.equal(value, expected, `${relativePath}.${key} must be ${expected}`);
  checks.push({ path: relativePath, key, value });
}

function checkNestedJson(relativePath, keyPath, expected, checks) {
  const src = readReleaseSource(relativePath);
  assert.ok(src.exists, `${relativePath} must exist`);
  let value = JSON.parse(src.text);
  for (const key of keyPath) value = value?.[key];
  assert.equal(value, expected, `${relativePath}.${keyPath.join(".")} must be ${expected}`);
  checks.push({ path: relativePath, key: keyPath.join("."), value });
}


function checkIncludes(relativePath, needle, checks) {
  const src = readReleaseSource(relativePath);
  assert.ok(src.exists, `${relativePath} must exist`);
  assert.ok(src.text.includes(needle), `${relativePath} must include ${needle}`);
  checks.push({ path: relativePath, includes: needle });
}

// A bare version number (e.g. "0.2.4") can appear anywhere in a doc's
// prose — an example command, a cross-reference — without the doc's own
// version-history footer (a blank-line-separated list, one release per
// line, appended by bump-version.mjs's --content step) actually having
// been updated. A plain substring check would silently pass on the
// coincidental prose match and never notice the real footer line is
// missing (found live: v0.2.4's bump left release-tooling.7.md's footer
// stuck at 0.2.3, masked by an unrelated "npm run release -- 0.2.4"
// example a few lines up). Require the needle on its own line instead.
function checkIncludesOwnLine(relativePath, needle, checks) {
  const src = readReleaseSource(relativePath);
  assert.ok(src.exists, `${relativePath} must exist`);
  const hasOwnLine = src.text.split("\n").some((line) => line.trim() === needle);
  assert.ok(hasOwnLine, `${relativePath} must include ${needle} as its own line (not just as a substring)`);
  checks.push({ path: relativePath, includesOwnLine: needle });
}

main();
