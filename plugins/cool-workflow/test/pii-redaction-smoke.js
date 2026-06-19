#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const blocked = [`ni${"c"}k`, `luke${"b"}ai`].map((term) => term.toLowerCase());

const files = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
  .trim()
  .split(/\n/)
  .filter(Boolean);

const matches = [];
for (const file of files) {
  const absolute = path.join(repoRoot, file);
  if (!fs.existsSync(absolute)) continue;
  const text = fs.readFileSync(absolute, "utf8").toLowerCase();
  for (const term of blocked) {
    if (text.includes(term)) matches.push(`${file}: contains blocked personal marker`);
  }
}

assert.deepEqual(matches, []);
process.stdout.write(`pii-redaction-smoke: ok (${files.length} tracked files scanned)\n`);
