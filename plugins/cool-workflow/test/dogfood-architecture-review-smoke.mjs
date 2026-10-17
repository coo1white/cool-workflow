#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");

// v0.1.85: the architecture-review agent-delegation dogfood, --smoke half (CI-
// verifiable; the live full-drive against a real repo is the maintainer bar, OUT
// of CI). A hermetic STUB agent drives the real app to a committed audited report.
const summary = JSON.parse(
  execFileSync(process.execPath, [path.join(pluginRoot, "scripts/dogfood-architecture-review.mjs"), "--smoke", "--json"], {
    cwd: pluginRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 30
  })
);

try {
  assert.equal(summary.ok, true, "architecture-review --smoke drive ok");
  assert.equal(summary.mode, "smoke");
  assert.ok(fs.existsSync(summary.reportPath), "audited report exists");
  assert.ok(fs.existsSync(summary.auditSummaryPath), "audit summary exists");
  assert.equal(summary.verdictAccepted, true, "the Verdict node was accepted");
  assert.ok(summary.agentDelegationEvents >= 1, "audit.byKind['worker.agent-delegation'] >= 1");
  assert.equal(summary.completedWorkers, summary.plannedWorkers, "every planned worker driven (zero hand-written result.md)");
} finally {
  if (summary.workspace) fs.rmSync(summary.workspace, { recursive: true, force: true });
}

process.stdout.write("dogfood-architecture-review-smoke: ok\n");
