#!/usr/bin/env node
"use strict";

// drive-exhaustion-blocked-smoke — a non-once drive that reaches its internal
// max-iteration guard without terminal progress must fail closed as blocked,
// never report complete or seal a bundle.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const { drive } = require(path.join(pluginRoot, "dist/drive.js"));

const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-drive-exhaust-")));
fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");

try {
  const runner = new CoolWorkflowRunner({ pluginRoot }).withBaseDir(work);
  const plan = runner.plan("end-to-end-golden-path", { repo: work, question: "exhaustion guard" });
  const originalDispatch = runner.dispatch.bind(runner);
  try {
    runner.dispatch = () => ({ schemaVersion: 1, runId: plan.id, tasks: [] });
    const result = drive(runner, plan.id, {
      now: "2026-07-01T00:00:00.000Z",
      agentConfig: { schemaVersion: 1, command: process.execPath, args: ["-e", "process.exit(0)"], source: "flag" }
    });
    assert.equal(result.status, "blocked", "max-iteration exhaustion reports blocked");
    assert.equal(result.commitId, undefined, "exhausted drive does not commit");
    const last = result.steps[result.steps.length - 1];
    assert.equal(last.status, "blocked", "last step is an explicit blocked guard");
    assert.match(last.reason || "", /max iteration limit/, "blocked reason names the iteration guard");
  } finally {
    runner.dispatch = originalDispatch;
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

process.stdout.write("drive-exhaustion-blocked-smoke: ok\n");
