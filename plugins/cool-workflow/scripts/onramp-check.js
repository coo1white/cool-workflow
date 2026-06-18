#!/usr/bin/env node
"use strict";

// onramp-check — fail closed when a change batch violates the local development
// contract: behavior changes need smoke coverage, surface changes need docs, and
// source/app/script changes need an iteration-log row.

const path = require("node:path");
const { evaluateOnrampContract, resolveChangedFiles } = require("../dist/onramp.js");

const pluginRoot = path.resolve(__dirname, "..");

function argValue(name) {
  const eq = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const check = process.argv.includes("--check");
  const changedFrom = argValue("--changed-from");
  const changed = resolveChangedFiles({ cwd: pluginRoot, changedFrom, env: process.env });
  const contract = evaluateOnrampContract(changed.files, { cwd: pluginRoot });
  const report = {
    schemaVersion: 1,
    baseRef: changed.baseRef,
    ...contract
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (check && !contract.ok) {
    process.stderr.write("\nonramp contract failed:\n");
    for (const issue of contract.issues) {
      process.stderr.write(`  - ${issue.code}: ${issue.detail}\n`);
      process.stderr.write(`    fix: ${issue.fix}\n`);
      if (issue.files.length) process.stderr.write(`    files: ${issue.files.join(", ")}\n`);
    }
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`onramp-check: ${error && error.message ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
