#!/usr/bin/env node
"use strict";

// growth-budget-check — fail closed when repo-wide tracked .md count, or
// comment-line count under plugins/cool-workflow/src, goes over the ceilings
// pinned in manifest/growth-budget.json. Both counts come from git's own
// tracked-file list, so a run is reproducible by hand.
//
// A comment line is one whose first non-space chars are `//` or `*`.
//
// Test override (used by test/growth-budget-check-smoke.js so the real repo
// is never touched):
//   CW_GROWTH_ROOT         git root to scan, in place of the real repo root
//   CW_GROWTH_SRC_PATH     src dir, repo-root-relative, in place of the real one
//   CW_GROWTH_BUDGET_FILE  budget json, in place of manifest/growth-budget.json

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const COMMENT_RE = /^\s*(\/\/|\*)/;

function trackedFiles(root) {
  return execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function countCommentLines(absPath) {
  const lines = fs.readFileSync(absPath, "utf8").split("\n");
  let n = 0;
  for (const line of lines) if (COMMENT_RE.test(line)) n += 1;
  return n;
}

function main() {
  const root = process.env.CW_GROWTH_ROOT || repoRoot;
  const srcPath = process.env.CW_GROWTH_SRC_PATH || "plugins/cool-workflow/src";
  const budgetFile =
    process.env.CW_GROWTH_BUDGET_FILE || path.join(pluginRoot, "manifest", "growth-budget.json");
  const budget = JSON.parse(fs.readFileSync(budgetFile, "utf8"));

  const files = trackedFiles(root);
  const mdCount = files.filter((f) => f.endsWith(".md")).length;
  const srcFiles = files.filter((f) => f === srcPath || f.startsWith(`${srcPath}/`));
  let commentLines = 0;
  for (const f of srcFiles) commentLines += countCommentLines(path.join(root, f));

  const overages = [];
  if (mdCount > budget.trackedMarkdownFiles.maxCount) {
    overages.push(`tracked .md files: ${mdCount} > ${budget.trackedMarkdownFiles.maxCount}`);
  }
  if (commentLines > budget.srcCommentLines.maxCount) {
    overages.push(`src comment lines: ${commentLines} > ${budget.srcCommentLines.maxCount}`);
  }

  if (overages.length > 0) {
    process.stderr.write(
      `growth-budget-check: over budget.\n` +
        overages.map((o) => `  ${o}\n`).join("") +
        `Decide by hand, do not just raise the cap: slimming something else\n` +
        `(delete a stale .md, cut a narrating comment) is always a valid way to\n` +
        `pay for growth, and is the first thing to try. If the growth is real,\n` +
        `raise the ceiling in manifest/growth-budget.json, but put the freshly\n` +
        `measured number in the commit message, not only the new cap.\n`
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `growth-budget-check: md=${mdCount}/${budget.trackedMarkdownFiles.maxCount}, ` +
      `src-comments=${commentLines}/${budget.srcCommentLines.maxCount}, within budget.\n`
  );
}

main();
