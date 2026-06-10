#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const pluginRoot = path.resolve(__dirname, "..");
const fixtureRoot = path.join(__dirname, "fixtures", "runs");
const cli = path.join(pluginRoot, "scripts", "cw.js");
const node = process.execPath;
const { migrateRunState } = require("../dist/state-migrations");

function main() {
  const fixtures = fs.readdirSync(fixtureRoot).sort();
  assert.deepEqual(fixtures, [
    "golden-path",
    "mcp-app-surface",
    "operator-ux",
    "pre-app-simple-run",
    "sandbox-profiles",
    "workflow-app-framework"
  ]);

  const results = fixtures.map((fixtureId) => verifyFixture(fixtureId));
  process.stdout.write(`${JSON.stringify({ ok: true, fixtures: results }, null, 2)}\n`);
}

function verifyFixture(fixtureId) {
  const fixtureStatePath = path.join(fixtureRoot, fixtureId, "state.json");
  const beforeHash = hashFile(fixtureStatePath);
  const fixtureState = JSON.parse(fs.readFileSync(fixtureStatePath, "utf8"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `cw-fixture-${fixtureId}-`));
  const runDir = path.join(tmp, ".cw", "runs", fixtureId);
  fs.mkdirSync(runDir, { recursive: true });
  const tempStatePath = path.join(runDir, "state.json");
  fs.copyFileSync(fixtureStatePath, tempStatePath);

  const direct = migrateRunState(fixtureState, { statePath: tempStatePath, dryRun: true });
  assert.notEqual(direct.report.status, "unsupported", `${fixtureId} must be supported`);
  assert.equal(direct.run.schemaVersion, 1);
  assert.equal(direct.run.id, fixtureId);
  assert.ok(direct.run.paths.report.endsWith("report.md"));
  assert.ok(Array.isArray(direct.run.nodes));
  assert.ok(Array.isArray(direct.run.feedback));
  assert.ok(Array.isArray(direct.run.workers));
  assert.ok(direct.run.paths.multiAgentDir.endsWith(path.join(".cw", "runs", fixtureId, "multi-agent")));
  assert.equal(direct.run.multiAgent.schemaVersion, 1);
  assert.deepEqual(direct.run.multiAgent.runs, []);
  assert.deepEqual(direct.run.multiAgent.roles, []);
  assert.deepEqual(direct.run.multiAgent.groups, []);
  assert.deepEqual(direct.run.multiAgent.memberships, []);
  assert.deepEqual(direct.run.multiAgent.fanouts, []);
  assert.deepEqual(direct.run.multiAgent.fanins, []);
  assert.ok(direct.run.paths.blackboardDir.endsWith(path.join(".cw", "runs", fixtureId, "blackboard")));
  assert.equal(direct.run.blackboard.schemaVersion, 1);
  assert.deepEqual(direct.run.blackboard.boards, []);
  assert.deepEqual(direct.run.blackboard.topics, []);
  assert.deepEqual(direct.run.blackboard.messages, []);
  assert.deepEqual(direct.run.blackboard.contexts, []);
  assert.deepEqual(direct.run.blackboard.artifacts, []);
  assert.deepEqual(direct.run.blackboard.snapshots, []);
  assert.deepEqual(direct.run.blackboard.decisions, []);
  if (fixtureState.userMetadata) assert.deepEqual(direct.run.userMetadata, fixtureState.userMetadata);
  if (fixtureState.mcpOpaqueMetadata) assert.deepEqual(direct.run.mcpOpaqueMetadata, fixtureState.mcpOpaqueMetadata);

  const check = runJson(["state", "check", fixtureId], tmp);
  assert.notEqual(check.status, "unsupported");
  assert.equal(check.dryRun, true);

  const status = execFileSync(node, [cli, "status", fixtureId], { cwd: tmp, encoding: "utf8" });
  assert.match(status, new RegExp(`Run: ${fixtureId}`));

  const graph = execFileSync(node, [cli, "graph", fixtureId], { cwd: tmp, encoding: "utf8" });
  assert.match(graph, /Run Graph:/);

  const reportPath = execFileSync(node, [cli, "report", fixtureId], { cwd: tmp, encoding: "utf8" }).trim();
  assert.ok(fs.existsSync(reportPath), `${fixtureId} report must be written to temp output`);
  assert.equal(hashFile(fixtureStatePath), beforeHash, `${fixtureId} fixture must not be mutated`);

  return {
    id: fixtureId,
    migrationStatus: direct.report.status,
    changedFields: direct.report.changes.length,
    reportPath
  };
}

function runJson(args, cwd) {
  return JSON.parse(execFileSync(node, [cli, ...args], { cwd, encoding: "utf8" }));
}

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

main();
