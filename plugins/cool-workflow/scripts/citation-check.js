#!/usr/bin/env node
"use strict";

// citation-check — fail closed when a live doc, or a comment/string in
// src/scripts/test, names a repo path that is not in the tree.
//
// Rules: (a) live docs — a bare `name.ts`/`name.js` (no dir) must match
// some file's basename under src/, scripts/, test/, or apps/; a full
// `dir/name.ext` path must exist at the plugin or repo root. (b)
// src/**/*.ts, scripts/**/*.js — every line, every repo-path-shaped token
// must exist; a `:line` suffix fails on its own (R1). (c) test/**/*.js —
// same as (b), but only on `//` lines; fixture strings are data.
// A repo-path token is the longest [A-Za-z0-9_./-] run ending in
// .ts/.js/.mjs/.json/.md whose first segment is src, scripts, test, apps,
// docs, project, v2, plugins, or .github — so `project/docs/<slug>.md`
// resolves but a bare `docs/<slug>.md` inside it does not. Kept as before:
// placeholders (`<>`, `*`), project/docs/**, and release-history.md.
// (e) src/**/*.ts, scripts/**/*.js, test/**/*.js — no line's comment or
// string text may carry one of the nine stale cut-over-audit marker
// phrases (see STALE_MARKER_PARTS below), case-insensitive and
// whole-phrase (so an everyday phrase sharing just its first word never
// false-matches).
//
// Test overrides (real files untouched, see test/citation-check-smoke.js):
//   CW_CITATION_DOCS  doc files to scan, comma-set, in place of the real set
//   CW_CITATION_ROOT  one root for both token resolution and the fake
//                     src/scripts/test/apps tree, in place of plugin+repo

const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");

const FIRST_SEGMENTS = new Set([
  "src", "scripts", "test", "apps", "docs", "project", "v2", "plugins", ".github"
]);

const DOC_PATH_RE =
  /`((?:src|dist|scripts|test|apps|skills|workflows|manifest|ui|docs|project|v2|plugins\/cool-workflow|\.github)\/[A-Za-z0-9_./-]*[A-Za-z0-9_-]\.(?:ts|js|mjs|json|md|txt|rb|yml|pub))`/g;
const DOC_BARE_RE = /`([A-Za-z0-9_-]+\.(?:ts|js))`/g;
// lookbehind, not a `\b`-anchored dir prefix, so this can't fire mid-run
// (project/docs/<slug>.md); extensions longest-first so package.json != .js.
const SRC_TOKEN_RE =
  /(?<![A-Za-z0-9_/.-])([A-Za-z0-9_.\/-]+\.(?:mjs|json|ts|js|md))(?![A-Za-z0-9_])(:[0-9]+)?/g;

// Rule (e): the nine stale cut-over-audit marker phrases, forbidden
// anywhere in src/scripts/test. Each is built by joining word parts, not
// spelled out whole — this file must define the ban list without tripping
// it. Whole-phrase and case-insensitive so a real English phrase sharing
// just a first word (e.g. one starting the same way as the third entry)
// never false-matches.
const STALE_MARKER_PARTS = [
  [["REAL", "GAP"], "-"],
  [["CUTOVER", "AUDIT"], " "],
  [["CUTOVER", "STATUS"], " "],
  [["CUTOVER", "NOTE"], " "],
  [["Phase", "B"], " "],
  [["left", "failing"], " "],
  [["leave", "it", "RED"], " "],
  [["do", "NOT", "weaken"], " "],
  [["not", "ported"], " "]
];
const STALE_MARKERS = STALE_MARKER_PARTS.map(([parts, sep]) => parts.join(sep));
const STALE_MARKER_RE = new RegExp(
  `\\b(?:${STALE_MARKERS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "gi"
);
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

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const full = path.join(dir, e.name);
    out = e.isDirectory() ? out.concat(walk(full)) : out.concat([full]);
  }
  return out;
}

// Rules (b)/(c): commentOnly restricts the scan to `//` lines (rule c).
function scanSourceFiles(files, roots, commentOnly) {
  const problems = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (commentOnly && !/^\s*\/\//.test(line)) return;
      SRC_TOKEN_RE.lastIndex = 0;
      let m;
      while ((m = SRC_TOKEN_RE.exec(line))) {
        const token = m[1];
        const lineSuffix = m[2] || "";
        if (!FIRST_SEGMENTS.has(token.split("/")[0])) continue;
        const resolves = roots.some((r) => fs.existsSync(path.join(r, token)));
        if (!resolves || lineSuffix) {
          const rel = path.relative(repoRoot, file);
          const reason = !resolves ? "dead path" : "has a :line suffix (R1)";
          problems.push(`${rel}:${i + 1}  \`${token}${lineSuffix}\`  — ${reason}`);
        }
      }
    });
  }
  return problems;
}

// Rule (e): scan every line of every file (comment or string, no
// restriction — unlike (b)/(c) this is not path-token-shaped) for a stale
// marker. This script itself must name the markers to define them, so it
// excludes its own file, the one legitimate exception.
function scanStaleMarkers(files) {
  const problems = [];
  for (const file of files) {
    if (path.basename(file) === path.basename(__filename)) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      STALE_MARKER_RE.lastIndex = 0;
      const m = STALE_MARKER_RE.exec(line);
      if (m) {
        const rel = path.relative(repoRoot, file);
        problems.push(`${rel}:${i + 1}  \`${m[0]}\`  — stale cut-over audit marker (rule e)`);
      }
    });
  }
  return problems;
}

function main() {
  const docs = process.env.CW_CITATION_DOCS
    ? process.env.CW_CITATION_DOCS.split(",").map((f) => f.trim()).filter(Boolean)
    : liveDocs();
  const roots = resolveRoots();
  const scanRoot = process.env.CW_CITATION_ROOT || pluginRoot;
  const tree = ["src", "scripts", "test", "apps"].map((d) => walk(path.join(scanRoot, d)));
  const basenames = new Set([].concat(...tree).map((f) => path.basename(f)));
  const srcFiles = tree[0].filter((f) => f.endsWith(".ts")).concat(tree[1].filter((f) => f.endsWith(".js")));
  const testFiles = tree[2].filter((f) => f.endsWith(".js"));

  let cited = 0;
  const dead = [];
  const docRules = [
    [DOC_PATH_RE, (t) => roots.some((r) => fs.existsSync(path.join(r, t))), ""],
    [DOC_BARE_RE, (t) => basenames.has(t), "  — no file with this name"]
  ];
  for (const doc of docs) {
    const lines = fs.readFileSync(doc, "utf8").split("\n");
    const rel = path.relative(repoRoot, doc);
    lines.forEach((line, i) => {
      for (const [re, ok, note] of docRules) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line))) {
          cited += 1;
          if (!ok(m[1])) dead.push(`${rel}:${i + 1}  \`${m[1]}\`${note}`);
        }
      }
    });
  }

  dead.push(...scanSourceFiles(srcFiles, roots, false));
  dead.push(...scanSourceFiles(testFiles, roots, true));
  dead.push(...scanStaleMarkers(srcFiles.concat(testFiles)));

  if (dead.length > 0) {
    process.stderr.write(
      `citation-check: ${dead.length} dead citation(s) — the named file is not in the tree,\n` +
        `or names one with a :line suffix. Point each at the file's true place\n` +
        `(or the module name, no line), or take the line out:\n`
    );
    for (const d of dead) process.stderr.write(`  ${d}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `citation-check: ${docs.length} docs (${cited} path citations), ` +
      `${srcFiles.length + testFiles.length} source files scanned, all resolve.\n`
  );
}

main();
