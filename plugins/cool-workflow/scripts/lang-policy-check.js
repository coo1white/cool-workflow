#!/usr/bin/env node
"use strict";
// lang-policy-check.js — this project is written in JavaScript and
// TypeScript only (AGENTS.md hard rule, 2026-07-13). Every git-tracked file
// must be JS/TS, a recognized non-code file (docs, data, config, binary
// asset), or one of the explicit, path-scoped exceptions below — a real
// non-JS/TS file the project genuinely needs. Fail closed: an unrecognized
// extension/basename is a hard stop, forcing a deliberate choice (write it
// in JS/TS, or add a new exception here with a reason) instead of a silent
// pass. Mechanism only; the allowlists ARE the policy, kept as plain data
// in this one file — no separate config to drift from it.

const { execFileSync } = require("node:child_process");
const path = require("node:path");

const CODE_EXTENSIONS = new Set(["js", "mjs", "cjs", "ts", "tsx", "jsx"]);

// Real, needed files this project cannot write in JS/TS -- the exact same
// set already carved out of GitHub's Languages stats in .gitattributes, for
// the same reasons (see that file's comments). Scoped to an EXACT path,
// never a whole directory, so a new file dropped in the same folder does
// NOT silently inherit the exception.
const EXCEPT_PATHS = new Set([
  "Formula/cool-workflow.rb", // Homebrew formula must be Ruby
  "plugins/cool-workflow/ui/workbench/index.html", // served from disk by design
  "plugins/cool-workflow/ui/workbench/app.css" // served from disk by design
]);

// Not "code" at all -- docs, data, config, and binary assets. Fine
// anywhere in the tree; this policy is only about what the project is
// WRITTEN in, not about every file it ships or tracks.
const NON_CODE_EXTENSIONS = new Set([
  "md", "mdc", "txt", "json", "jsonl", "yml", "yaml", "toml",
  "verdict", "sig", "pub", "tape",
  "svg", "png", "jpg", "jpeg", "gif", "webp", "ico", "pdf",
  "woff", "woff2", "gz", "tgz", "zip", "lock"
]);
// Extensionless / dotfile basenames that are also not code.
const NON_CODE_BASENAMES = new Set([
  "LICENSE", ".gitignore", ".gitattributes", ".editorconfig", ".windsurfrules", ".npmrc", ".nvmrc"
]);

// `EXCEPT_PATHS` are written repo-root-relative, so tracked files must be
// resolved the same way regardless of the invocation cwd (this runs both as
// `npm run lang:check` from plugins/cool-workflow/ AND from release-check.js
// at various cwds) -- resolve the real top-level first, never trust the
// invocation cwd to already BE it.
function trackedFiles() {
  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  return execFileSync("git", ["-C", repoRoot, "ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function classify(file) {
  if (EXCEPT_PATHS.has(file)) return { ok: true };
  const base = path.basename(file);
  if (NON_CODE_BASENAMES.has(base)) return { ok: true };
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return { ok: false, ext: null };
  const ext = base.slice(dot + 1).toLowerCase();
  if (CODE_EXTENSIONS.has(ext) || NON_CODE_EXTENSIONS.has(ext)) return { ok: true };
  return { ok: false, ext };
}

const files = trackedFiles();
const violations = [];
for (const file of files) {
  const result = classify(file);
  if (!result.ok) violations.push({ file, ext: result.ext });
}

if (violations.length > 0) {
  process.stderr.write("lang-policy-check: this project is JavaScript/TypeScript only. Unrecognized file(s):\n");
  for (const v of violations) {
    process.stderr.write(`  - ${v.file}${v.ext ? ` (.${v.ext})` : " (no extension)"}\n`);
  }
  process.stderr.write("Write it in JavaScript/TypeScript, or add a scoped, reasoned exception to scripts/lang-policy-check.js.\n");
  process.exit(1);
}

process.stdout.write(`lang-policy-check: ${files.length} tracked files, all JS/TS or an allowed non-code/exception file.\n`);
