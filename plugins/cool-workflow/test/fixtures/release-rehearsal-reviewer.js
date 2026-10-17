#!/usr/bin/env node
"use strict";
// release-rehearsal-reviewer.js — the STUB reviewer for the CI release
// rehearsal. Consumer: the `release-rehearsal` job in .github/workflows/ci.yml,
// which runs `scripts/release-flow.mjs --check` with
//   CW_AGENT_COMMAND="node plugins/cool-workflow/test/fixtures/release-rehearsal-reviewer.js {{input}}"
// so the real reviewer spawn and verdict extraction run with no vendor CLI,
// no key, and no model call. It is never a real review: it approves whatever
// HEAD the input names. The real cut always uses the operator's configured
// agent; release-flow's signing step never runs in check mode.
//
// Fail closed on a broken input, so a release-flow change that ships the
// reviewer an empty or malformed prompt goes red here, not on a real cut:
//   - argv[2] must name a readable input file (repo-relative; cwd = repo root)
//   - it must carry the reviewer spec body and the "Required output" block
//   - it must name "- HEAD: <40-hex sha>"
// Output: "APPROVED <sha>" then one capability line, on stdout.

const fs = require("node:fs");

function die(msg) {
  process.stderr.write(`release-rehearsal-reviewer: ${msg}\n`);
  process.exit(1);
}

const inputPath = process.argv[2];
if (!inputPath) die("usage: release-rehearsal-reviewer.js <input-file>");
let text;
try {
  text = fs.readFileSync(inputPath, "utf8");
} catch (error) {
  die(`cannot read the reviewer input ${inputPath}: ${error.message}`);
}
if (!/## Required output/.test(text)) die("reviewer input has no \"## Required output\" block");
if (!/## Release candidate context/.test(text)) die("reviewer input has no release candidate context");
const before = text.split("\n---\n")[0].trim();
if (!before) die("reviewer input has an empty reviewer spec body");
const head = (text.match(/^- HEAD: ([0-9a-f]{40})$/m) || [])[1];
if (!head) die("reviewer input names no 40-hex HEAD");

process.stdout.write(`APPROVED ${head}\nCI release rehearsal: stub reviewer, not a real review.\n`);
