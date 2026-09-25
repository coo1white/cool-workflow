#!/usr/bin/env node
"use strict";

// root-layout-smoke — holds the repo root to a known list, the way
// pixelcrosshair's layout tests hold its tree. Included in `npm test`.
//
// Every tracked top-level entry is named in ROOT_ENTRIES with the reason it
// is at the root, so a new root file is a choice made in a diff, not a
// leak. The smoke also checks the text style .editorconfig asks for: LF
// line ends, a final newline, and no tab indents in any tracked text file.
//
// 1. positive: the real tree passes both checks.
// 2. teeth: made-up entry lists and a throwaway tree are refused, one
//    finding per fault.

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..", "..");

const ROOT_ENTRIES = {
  ".agents": "Codex marketplace entry for plugins/cool-workflow",
  ".claude": "Claude Code project settings",
  ".claude-plugin": "Claude Code marketplace entry for plugins/cool-workflow",
  ".cw-release": "signed release verdicts, append-only",
  ".editorconfig": "one text style for every editor",
  ".gitattributes": "LF line ends, binary files, Linguist hints",
  ".github": "CI/CD workflows and issue/PR templates",
  ".gitignore": "untracked build and run output",
  "AGENTS.md": "the one agent memory file",
  "Formula": "Homebrew formula; a tap reads Formula/ at the repo root",
  "LICENSE": "license",
  "README.md": "the landing page",
  "REVIEW.md": "how a PR is reviewed",
  "plugins": "the package, at the path the marketplace entries name",
  "scripts": "repo-level tooling that does not ship (mirror-to-gitea.js)",
  "sdlc": "program plans, after the operator's ~/Developer/sdlc/ pattern",
  "v2": "conformance suite, kept outside the package it judges",
};

// Byte-exact paths: signed verdicts, the pinned CLI spec, test fixtures.
// Same list as the byte-exact section of .editorconfig (checked below);
// the style check never looks inside them.
const BYTE_EXACT = [".cw-release/", "plugins/cool-workflow/project/docs/rebuild/SPEC/", "plugins/cool-workflow/test/fixtures/"];

// Same list as the `binary` lines in .gitattributes.
const BINARY_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".tgz", ".gz", ".woff", ".woff2"]);

function checkRootEntries(entries, allowed) {
  const findings = [];
  const present = new Set(entries);
  for (const entry of [...present].sort()) {
    if (!Object.hasOwn(allowed, entry)) findings.push(`${entry}: not in ROOT_ENTRIES; name it there with a reason, or move it`);
  }
  for (const entry of Object.keys(allowed).sort()) {
    if (!present.has(entry)) findings.push(`${entry}: in ROOT_ENTRIES but not tracked; drop it from the list`);
  }
  return findings;
}

function checkTextStyle(root, files) {
  const findings = [];
  for (const file of files) {
    if (BINARY_EXT.has(path.extname(file).toLowerCase())) continue;
    if (BYTE_EXACT.some((prefix) => file.startsWith(prefix))) continue;
    const text = fs.readFileSync(path.join(root, file), "utf8");
    if (text.length === 0) continue;
    if (text.includes("\r")) findings.push(`${file}: CR line end (use LF)`);
    if (!text.endsWith("\n")) findings.push(`${file}: no final newline`);
    if (/^\t/m.test(text)) findings.push(`${file}: tab indent (use spaces)`);
  }
  return findings;
}

function trackedFiles(root) {
  return execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
}

// 1. The real tree.
const files = trackedFiles(repoRoot);
const rootEntries = [...new Set(files.map((file) => file.split("/")[0]))];
assert.deepEqual(checkRootEntries(rootEntries, ROOT_ENTRIES), [], "the real root must match ROOT_ENTRIES");
assert.deepEqual(checkTextStyle(repoRoot, files), [], "every tracked text file must keep the .editorconfig style");

const editorconfig = fs.readFileSync(path.join(repoRoot, ".editorconfig"), "utf8");
for (const prefix of BYTE_EXACT) {
  assert.ok(editorconfig.includes(`${prefix}**`), `.editorconfig must mark ${prefix} byte-exact`);
}

// 2. Teeth.
assert.deepEqual(checkRootEntries(["README.md", "notes.txt"], { "README.md": "x", LICENSE: "x" }), [
  "notes.txt: not in ROOT_ENTRIES; name it there with a reason, or move it",
  "LICENSE: in ROOT_ENTRIES but not tracked; drop it from the list",
]);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-root-layout-"));
try {
  const write = (name, body) => fs.writeFileSync(path.join(tmp, name), body);
  write("ok.js", "const a = 1;\n");
  write("empty.txt", "");
  write("logo.png", "\t\r no newline");
  write("crlf.js", "const a = 1;\r\n");
  write("nonl.md", "# title");
  write("tab.ts", "if (a) {\n\treturn;\n}\n");
  fs.mkdirSync(path.join(tmp, ".cw-release"));
  write(".cw-release/review-x.verdict", "APPROVED x");
  assert.deepEqual(checkTextStyle(tmp, ["ok.js", "empty.txt", "logo.png", "crlf.js", "nonl.md", "tab.ts", ".cw-release/review-x.verdict"]), [
    "crlf.js: CR line end (use LF)",
    "nonl.md: no final newline",
    "tab.ts: tab indent (use spaces)",
  ]);

  process.stdout.write("root-layout-smoke: ok\n");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
