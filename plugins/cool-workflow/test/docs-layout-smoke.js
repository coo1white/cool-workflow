#!/usr/bin/env node
"use strict";

// docs-layout-smoke — holds the shape of project/docs/, the way
// pixelcrosshair's docs-layout test holds its docs tree. Included in
// `npm test`.
//
// Rules:
// - project/docs/README.md is the map: every tracked top-level entry has a
//   link there, and every link there resolves.
// - intent/ files are named YYYY-MM-DD-<slug>.md, or YYYY-MM-archive.md
//   for closed programs.
// - sdlc/ holds one folder per program, each with its plan.md.
//
// 1. positive: the real tree passes.
// 2. teeth: made-up trees with each kind of fault are refused, one finding
//    per fault.

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const docsDir = path.join(pluginRoot, "project", "docs");

const INTENT_NAME = /^(\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*|\d{4}-\d{2}-archive)\.md$/;

// files: tracked paths relative to project/docs/. exists: resolves a
// "../" link against the real disk.
function checkDocsLayout(files, readme, exists) {
  const findings = [];
  const entries = new Set(files.map((file) => (file.includes("/") ? `${file.split("/")[0]}/` : file)));
  const links = [...readme.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]);
  const linked = new Set(links.filter((link) => !link.startsWith("../")));

  for (const entry of [...entries].sort()) {
    if (entry !== "README.md" && !linked.has(entry)) findings.push(`${entry}: not listed in project/docs/README.md`);
  }
  for (const link of links) {
    const ok = link.startsWith("../") ? exists(link) : entries.has(link) || files.includes(link);
    if (!ok) findings.push(`README.md link ${link}: does not resolve`);
  }
  for (const file of files) {
    const parts = file.split("/");
    if (parts[0] === "intent" && (parts.length !== 2 || !INTENT_NAME.test(parts[1]))) {
      findings.push(`${file}: intent files are YYYY-MM-DD-<slug>.md or YYYY-MM-archive.md`);
    }
    if (parts[0] === "sdlc" && (parts.length !== 3 || parts[2] !== "plan.md")) {
      findings.push(`${file}: sdlc/ holds <program>/plan.md only`);
    }
  }
  const programs = new Set(files.filter((f) => f.startsWith("sdlc/")).map((f) => f.split("/")[1]));
  for (const program of [...programs].sort()) {
    if (!files.includes(`sdlc/${program}/plan.md`)) findings.push(`sdlc/${program}/: no plan.md`);
  }
  return findings;
}

// 1. The real tree.
const tracked = execFileSync("git", ["-C", docsDir, "ls-files", "--", "."], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const readme = fs.readFileSync(path.join(docsDir, "README.md"), "utf8");
const onDisk = (link) => fs.existsSync(path.resolve(docsDir, link));
assert.deepEqual(checkDocsLayout(tracked, readme, onDisk), [], "project/docs/ must match its README map");

// 2. Teeth.
const goodReadme = "[`intent/`](intent/) [`sdlc/`](sdlc/) [`BACKLOG.md`](BACKLOG.md) [man](../man/)";
const goodFiles = ["README.md", "BACKLOG.md", "intent/2026-09-25-a-b.md", "intent/2026-09-archive.md", "sdlc/p1/plan.md"];
const yes = () => true;
assert.deepEqual(checkDocsLayout(goodFiles, goodReadme, yes), [], "a clean tree has no findings");

assert.deepEqual(
  checkDocsLayout(
    [...goodFiles, "notes.md", "intent/Draft Notes.md", "sdlc/p2/spec.md"],
    `${goodReadme} [gone](gone.md)`,
    (link) => link !== "../man/"
  ),
  [
    "notes.md: not listed in project/docs/README.md",
    "README.md link ../man/: does not resolve",
    "README.md link gone.md: does not resolve",
    "intent/Draft Notes.md: intent files are YYYY-MM-DD-<slug>.md or YYYY-MM-archive.md",
    "sdlc/p2/spec.md: sdlc/ holds <program>/plan.md only",
    "sdlc/p2/: no plan.md",
  ]
);

process.stdout.write("docs-layout-smoke: ok\n");
