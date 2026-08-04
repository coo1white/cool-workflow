#!/usr/bin/env node
"use strict";

// purity-gate — fail closed if src/ crosses a layer boundary the rebuild
// docs claim is enforced, or if src/core/** reads an impure primitive
// (node:fs/child_process/net/http, process.env, process.cwd(), Date.now(),
// new Date(), Math.random()), beyond a committed, itemized baseline.
//
// Why this exists: plugins/cool-workflow/project/docs/rebuild/PLAN.md and AGENTS.md both describe core/
// as pure (no IO) and shell/ as the only impure layer, and say this is
// "enforced by a lint rule". No such lint exists anywhere in scripts/ or
// package.json — only `tsc --noEmit`, which does not check import
// direction. The one place the rule is already broken is the hub itself:
// core/capability-table.ts imports ~30 things from ../shell.
//
// This is a RATCHET, not a clean-slate rule (matching dist-drift-check.js's
// and version-sync-check.js's style: node + git only, no new dependency).
// scripts/purity-baseline.json lists every violation that exists TODAY.
// The gate fails on:
//   - a violation NOT in the baseline (a NEW break), and
//   - a baseline entry that no longer matches reality (STALE — either the
//     violation was fixed, in which case delete the entry, or the count
//     changed, in which case update it consciously).
// Fail-closed both directions, same as dist-drift-check.js's added/changed/
// removed three-way diff.
//
// Layers (by top-level directory under src/):
//   core/**   -> may only import core/** (+ node:path, node:crypto)
//   shell/**  -> may import core/** or shell/**
//   wiring/** -> may import core/**, shell/**, or wiring/** (not yet used;
//               reserved for the capability-table split)
//   cli/**    -> may import core/**, shell/**, or cli/** (never mcp/**)
//   mcp/**    -> may import core/**, shell/**, or mcp/** (never cli/**)
//
// Approach: a plain-text specifier scan (import/export-from/require), not a
// real TS parser — this codebase uses only those three forms, verified
// against every current violation this baseline lists.

const fs = require("node:fs");
const path = require("node:path");

const packageDir = path.resolve(__dirname, "..");
const srcDir = path.join(packageDir, "src");
const baselinePath = path.join(__dirname, "purity-baseline.json");

const CORE_ALLOWED_BUILTINS = new Set(["node:path", "node:crypto"]);
const IMPURE_PATTERNS = ["process.env", "process.cwd()", "Date.now()", "new Date()", "Math.random()"];

const ALLOWED_TARGET_LAYERS = {
  core: new Set(["core"]),
  shell: new Set(["core", "shell"]),
  wiring: new Set(["core", "shell", "wiring"]),
  cli: new Set(["core", "shell", "cli"]),
  mcp: new Set(["core", "shell", "mcp"]),
  other: new Set(["core", "shell", "wiring", "cli", "mcp", "other"]),
};

function layerOf(relPath) {
  if (relPath.startsWith("core/")) return "core";
  if (relPath.startsWith("shell/")) return "shell";
  if (relPath.startsWith("wiring/")) return "wiring";
  if (relPath.startsWith("cli/") || relPath === "cli") return "cli";
  if (relPath.startsWith("mcp/") || relPath === "mcp-server") return "mcp";
  return "other";
}

function listTsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

// This codebase's file-header comments routinely quote the EXACT patterns
// this gate looks for, in prose explaining why a file is pure (e.g. "never
// a top-level `require(\"node:fs\")`", "no fs, no process.env, no clock").
// A naive text scan reads those quotes as violations. Strip `//` and
// `/* */` comments before scanning (string/template literal contents are
// left untouched, so a real `from "..."` clause is never damaged); newlines
// are preserved so extractSpecifiers' `(?:^|\n)` anchor still lines up.
function stripComments(text) {
  let out = "";
  let mode = "code"; // "code" | "line" | "block" | quote character
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const c2 = text[i + 1];
    if (mode === "line") {
      if (c === "\n") { mode = "code"; out += c; }
      continue;
    }
    if (mode === "block") {
      if (c === "*" && c2 === "/") { mode = "code"; i++; continue; }
      if (c === "\n") out += c;
      continue;
    }
    if (mode === '"' || mode === "'" || mode === "`") {
      out += c;
      if (c === "\\") { out += c2 ?? ""; i++; continue; }
      if (c === mode) mode = "code";
      continue;
    }
    if (c === "/" && c2 === "/") { mode = "line"; i++; continue; }
    if (c === "/" && c2 === "*") { mode = "block"; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { mode = c; out += c; continue; }
    out += c;
  }
  return out;
}

// Every `from "spec"` (import or export-from, type or value — a type-only
// import still names a module, so it counts the same way a real dependency
// scan would) plus every `require("spec")` and every dynamic `import("spec")`.
// Non-greedy across `from` finds each import's own clause without needing a
// real parser. The dynamic-import form matters because a core/ file could
// otherwise smuggle in an impure or cross-layer module through
// `await import("node:fs")` — the one import shape the static and require
// scans did not see, so the ratchet was blind to it.
function extractSpecifiers(codeText) {
  const specs = [];
  const fromRe = /(?:^|\n)\s*(?:import|export)\s[\s\S]*?from\s+["']([^"']+)["']/g;
  let m;
  while ((m = fromRe.exec(codeText))) specs.push(m[1]);
  const requireRe = /require\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = requireRe.exec(codeText))) specs.push(m[1]);
  const dynamicImportRe = /import\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = dynamicImportRe.exec(codeText))) specs.push(m[1]);
  return specs;
}

function countOccurrences(text, needle) {
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function relSrcPath(absPath) {
  return path.relative(srcDir, absPath).split(path.sep).join("/");
}

function scan() {
  const layerViolations = {}; // relFile -> string[] (specs that cross a disallowed layer)
  const builtinViolations = {}; // relFile -> string[] (banned node builtins imported from core)
  const clockEnvCounts = {}; // relFile -> { pattern: count } (core only, count > 0)

  for (const absFile of listTsFiles(srcDir)) {
    const relFile = relSrcPath(absFile);
    const fileLayer = layerOf(relFile.replace(/\.ts$/, ""));
    const text = stripComments(fs.readFileSync(absFile, "utf8"));

    for (const spec of extractSpecifiers(text)) {
      if (spec.startsWith(".")) {
        const targetAbs = path.resolve(path.dirname(absFile), spec);
        const targetRel = relSrcPath(targetAbs);
        const targetLayer = layerOf(targetRel);
        if (!ALLOWED_TARGET_LAYERS[fileLayer].has(targetLayer)) {
          (layerViolations[relFile] = layerViolations[relFile] || []).push(spec);
        }
      } else if (spec.startsWith("node:")) {
        if (fileLayer === "core" && !CORE_ALLOWED_BUILTINS.has(spec)) {
          (builtinViolations[relFile] = builtinViolations[relFile] || []).push(spec);
        }
      }
      // Bare package specifiers (no "." or "node:" prefix): this package
      // has zero runtime dependencies, so there are none to check.
    }

    if (fileLayer === "core") {
      const counts = {};
      for (const pattern of IMPURE_PATTERNS) {
        const n = countOccurrences(text, pattern);
        if (n > 0) counts[pattern] = n;
      }
      if (Object.keys(counts).length > 0) clockEnvCounts[relFile] = counts;
    }
  }

  for (const bucket of [layerViolations, builtinViolations]) {
    for (const file of Object.keys(bucket)) bucket[file] = [...new Set(bucket[file])].sort();
  }
  return { layerViolations, builtinViolations, clockEnvCounts };
}

function sortedKeys(obj) {
  return Object.keys(obj).sort();
}

function diffListBuckets(actual, baseline, label, problems) {
  const files = new Set([...sortedKeys(actual), ...sortedKeys(baseline)]);
  for (const file of [...files].sort()) {
    const actualList = actual[file] || [];
    const baseList = baseline[file] || [];
    const actualSet = new Set(actualList);
    const baseSet = new Set(baseList);
    const added = actualList.filter((s) => !baseSet.has(s));
    const removed = baseList.filter((s) => !actualSet.has(s));
    for (const spec of added) problems.push(`NEW ${label}: ${file} imports ${spec} (not in purity-baseline.json)`);
    for (const spec of removed) problems.push(`STALE ${label} baseline entry: ${file} no longer imports ${spec} — delete it from purity-baseline.json`);
  }
}

function diffCountBuckets(actual, baseline, problems) {
  const files = new Set([...sortedKeys(actual), ...sortedKeys(baseline)]);
  for (const file of [...files].sort()) {
    const actualCounts = actual[file] || {};
    const baseCounts = baseline[file] || {};
    const patterns = new Set([...Object.keys(actualCounts), ...Object.keys(baseCounts)]);
    for (const pattern of [...patterns].sort()) {
      const a = actualCounts[pattern] || 0;
      const b = baseCounts[pattern] || 0;
      if (a !== b) {
        problems.push(`clock/env count drift: ${file} has ${a} occurrence(s) of "${pattern}", purity-baseline.json expects ${b} — update the baseline consciously (this catches new AND removed occurrences)`);
      }
    }
  }
}

function main() {
  if (!fs.existsSync(baselinePath)) {
    process.stderr.write(`purity gate: missing ${path.relative(packageDir, baselinePath)}\n`);
    process.exit(1);
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const actual = scan();

  const problems = [];
  diffListBuckets(actual.layerViolations, baseline.layerViolations || {}, "layer violation", problems);
  diffListBuckets(actual.builtinViolations, baseline.builtinViolations || {}, "core builtin violation", problems);
  diffCountBuckets(actual.clockEnvCounts, baseline.clockEnvCounts || {}, problems);

  if (problems.length > 0) {
    process.stderr.write(`purity gate: ${problems.length} problem(s)\n`);
    for (const p of problems) process.stderr.write(`  ${p}\n`);
    process.exit(1);
  }
  process.stdout.write("purity gate: src/ matches the committed baseline (no new core/shell layer breaks, no clock/env drift).\n");
}

// Run the gate only when invoked directly (node scripts/purity-gate.js). When
// required by a test, expose the internal helpers so the specifier scan can be
// unit-checked without shelling out or writing into the real src/ tree.
if (require.main === module) {
  main();
}

module.exports = { stripComments, extractSpecifiers, layerOf, scan };
