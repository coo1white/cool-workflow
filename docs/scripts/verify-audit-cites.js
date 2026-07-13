#!/usr/bin/env node
"use strict";
// verify-audit-cites.js — pre-publish cite checker for CW audits.
//
// Extracts every `file.ext:NNN` / `file.ext:NNN-MMM` locator from an audit markdown
// file and verifies, for each one, that:
//   1. the file EXISTS under the search root (default plugins/cool-workflow/src), and
//   2. the cited line number(s) are IN RANGE (<= the file's line count).
//
// It does NOT prove claim-correctness — that is the human reviewer's job (see
// docs/publishing-audits.md, "Cite-verification methodology"). This catches stale
// and fabricated locators before they reach a published report.
//
// Portable: node only (no rg, no grep), matching CW's CI portability rule.
//
// Usage:
//   node docs/scripts/verify-audit-cites.js <audit.md> [search-root]
// Exit: 0 = all cites resolve and are in range; 1 = one or more failed; 2 = bad usage.

const fs = require("node:fs");
const path = require("node:path");

const audit = process.argv[2] || "";
const root = process.argv[3] || "plugins/cool-workflow/src";

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

if (!audit || !isFile(audit)) {
  console.error("usage: node docs/scripts/verify-audit-cites.js <audit.md> [search-root]");
  process.exit(2);
}
if (!isDir(root)) {
  console.error(`search root not found: ${root}`);
  process.exit(2);
}

// Extract candidate locators: <name>.<ext>:<line>[-<line>]. Dedup, preserve nothing
// but the locator token (surrounding backticks/punctuation never match the pattern).
const text = fs.readFileSync(audit, "utf8");
const matches = text.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+:[0-9]+(-[0-9]+)?/g) || [];
const locators = [...new Set(matches)].sort();

if (locators.length === 0) {
  console.error(`no file:line locators found in ${audit}`);
  process.exit(2);
}

let ok = 0;
let fail = 0;
const fails = [];

// A locator file part may be cited relative to the search root (e.g. "verifier.ts:40")
// OR repo-relative (e.g. "plugins/cool-workflow/test/x.js"). Try both.
function resolveFile(filePart) {
  const candidates = [path.join(root, filePart), filePart];
  for (const c of candidates) {
    if (isFile(c)) return c;
  }
  return null;
}

for (const loc of locators) {
  const m = loc.match(/^(.+?):(\d+)(?:-(\d+))?$/);
  if (!m) continue;
  const [, filePart, startStr, endStr] = m;
  const file = resolveFile(filePart);
  if (!file) {
    fail++;
    fails.push(`MISSING FILE   ${loc}`);
    continue;
  }
  const lines = fs.readFileSync(file, "utf8").split(/\n/).length;
  const start = Number(startStr);
  const end = endStr ? Number(endStr) : start;
  if (start < 1 || end < start || end > lines) {
    fail++;
    fails.push(`LINE OUT OF RANGE ${loc} (file has ${lines} lines)`);
    continue;
  }
  ok++;
}

if (fail) {
  console.error(`\nFAILED cite checks (${fail}):`);
  for (const f of fails) console.error("  - " + f);
  console.error(`\n${ok} cite(s) resolved, ${fail} failed.`);
  console.error("NOTE: existence + line-range only; claim-correctness needs a human reviewer.");
  process.exit(1);
}

console.log(`All ${ok} file:line cite(s) resolved and are in range under ${root}.`);
console.log("NOTE: existence + line-range only; claim-correctness needs a human reviewer.");
