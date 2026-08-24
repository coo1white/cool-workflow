#!/usr/bin/env node
"use strict";

// citation-check — fail closed when a LIVE doc points at a file that is not
// in the tree.
//
// Why: the man pages under docs/ are the contract, and they name source
// files in backticks (`src/core/version.ts` and the like). When the tree
// moves, those names go stale in silence — a 2026-08 sweep found 30+ dead
// ones. Every other drift in this repo has a gate; this is the gate for
// citation drift.
//
// What is checked: every backtick token in a live doc that looks like a
// repo path (starts with a known top dir, has a "/", ends with a code or
// doc file ending, no "*" or "<>" placeholders) must exist — at the plugin
// root or at the repo root.
//
// What is NOT checked, on purpose:
//   - docs/release-history.md — its old entries name old paths as history.
//   - project/docs/** — frozen records (SPEC, PLAN, audits); old paths in
//     them are the point.
//   - Tokens with placeholders (`docs/<slug>.7.md`) or globs — not names
//     of one file.
//
// Test override (used by test/citation-check-smoke.js so the real docs are
// never touched):
//   CW_CITATION_DOCS  comma-set of doc files to scan in place of the
//                     normal set
//   CW_CITATION_ROOT  one root dir to resolve against in place of the
//                     plugin/repo pair

const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");

const TOKEN_RE =
  /`((?:src|dist|scripts|test|apps|skills|workflows|manifest|ui|docs|project|v2|plugins\/cool-workflow|\.github)\/[A-Za-z0-9_./-]*[A-Za-z0-9_-]\.(?:ts|js|mjs|json|md|txt|rb|yml|pub))`/g;

function liveDocs() {
  const docsDir = path.join(pluginRoot, "docs");
  const files = [];
  for (const name of fs.readdirSync(docsDir)) {
    if (!name.endsWith(".md")) continue;
    if (name === "release-history.md") continue; // history keeps old names
    files.push(path.join(docsDir, name));
  }
  files.push(path.join(repoRoot, "AGENTS.md"));
  files.push(path.join(repoRoot, "README.md"));
  files.push(path.join(pluginRoot, "README.md"));
  return files.filter((f) => fs.existsSync(f));
}

function resolveRoots() {
  if (process.env.CW_CITATION_ROOT) return [process.env.CW_CITATION_ROOT];
  return [pluginRoot, repoRoot];
}

function main() {
  const docs = process.env.CW_CITATION_DOCS
    ? process.env.CW_CITATION_DOCS.split(",").map((f) => f.trim()).filter(Boolean)
    : liveDocs();
  const roots = resolveRoots();

  let cited = 0;
  const dead = [];
  for (const doc of docs) {
    const lines = fs.readFileSync(doc, "utf8").split("\n");
    lines.forEach((line, i) => {
      let m;
      TOKEN_RE.lastIndex = 0;
      while ((m = TOKEN_RE.exec(line))) {
        const token = m[1];
        cited += 1;
        const hit = roots.some((root) => fs.existsSync(path.join(root, token)));
        if (!hit) {
          const rel = path.relative(repoRoot, doc);
          dead.push(`${rel}:${i + 1}  \`${token}\``);
        }
      }
    });
  }

  if (dead.length > 0) {
    process.stderr.write(
      `citation-check: ${dead.length} dead citation(s) — the named file is not in the tree.\n` +
        `Point each at the file's true place, or take the line out:\n`
    );
    for (const d of dead) process.stderr.write(`  ${d}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `citation-check: ${docs.length} docs, ${cited} path citations, all resolve.\n`
  );
}

main();
