#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist/cli.js");
const node = process.execPath;

const canonicalApps = [
  {
    id: "architecture-review",
    args: (workspace) => [
      "--repo",
      workspace,
      "--question",
      "Does the app directory preserve architecture-review behavior?",
      "--invariant",
      "canonical app ids are unique",
      "--focus",
      "app discovery"
    ]
  },
  {
    id: "pr-review-fix-ci",
    args: (workspace) => [
      "--repo",
      workspace,
      "--pr",
      "123",
      "--branch",
      "feature/review",
      "--base",
      "main",
      "--ci",
      "local-check",
      "--mode",
      "review"
    ]
  },
  {
    id: "release-cut",
    args: (workspace) => [
      "--repo",
      workspace,
      "--version",
      "0.1.11",
      "--previousVersion",
      "0.1.10",
      "--releaseBranch",
      "main",
      "--dryRun",
      "true"
    ]
  },
  {
    id: "research-synthesis",
    args: (workspace) => [
      "--cwd",
      workspace,
      "--question",
      "What should the canonical app smoke test prove?",
      "--source",
      "plugins/cool-workflow/docs/canonical-workflow-apps.7.md",
      "--scope",
      "local deterministic test",
      "--freshness",
      "release test"
    ]
  }
];

const workflowList = run(["list"]);
assertUniqueIds(workflowList, "workflow list");
for (const app of canonicalApps) {
  assert.ok(workflowList.some((entry) => entry.id === app.id), `${app.id} must appear in cw.js list`);
}

const appList = run(["app", "list"]);
assertUniqueIds(appList, "app list");

for (const app of canonicalApps) {
  const summary = appList.find((entry) => entry.id === app.id);
  assert.ok(summary, `${app.id} must appear in cw.js app list`);
  assert.equal(summary.sourceKind, "app-directory");
  assert.equal(summary.legacy, false);
  assert.equal(summary.version, "0.1.11");
  assert.ok(summary.sandboxProfiles.length > 0);

  const validation = run(["app", "validate", path.join(pluginRoot, "apps", app.id, "app.json")]);
  assert.equal(validation.valid, true, `${app.id} must validate`);
  assert.equal(validation.summary.id, app.id);

  const shown = run(["app", "show", app.id]);
  assert.equal(shown.app.id, app.id);
  assert.equal(shown.app.version, "0.1.11");
  assert.equal(shown.app.compatibility.minVersion, "0.1.11");
  assert.equal(shown.app.metadata.canonical, true);
  assertTaskIdsUnique(shown);
  assertUsesSandboxHints(shown);
  assertHasEvidenceGate(shown);

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `cw-canonical-smoke-${app.id}-`));
  const plan = run(["plan", app.id, ...app.args(workspace)]);
  assert.equal(plan.workflowId, app.id);
  assert.ok(plan.pendingTasks > 0);

  const state = JSON.parse(fs.readFileSync(plan.statePath, "utf8"));
  assert.equal(state.workflow.id, app.id);
  assert.equal(state.workflow.app.id, app.id);
  assert.equal(state.workflow.app.version, "0.1.11");
  assert.equal(state.workflow.app.metadata.canonical, true);
  assert.equal(state.loopStage, "interpret");
  assertUniqueTaskIds(state.tasks, app.id);
  assert.ok(state.tasks.some((task) => task.requiresEvidence), `${app.id} plan needs evidence-required tasks`);
  assert.ok(state.tasks.every((task) => task.sandboxProfileId), `${app.id} plan needs sandbox profile hints`);

  const report = fs.readFileSync(plan.reportPath, "utf8");
  assert.match(report, new RegExp(`Workflow App: ${app.id}@0\\.1\\.11`));
}

const matrix = run(["app", "list"]);
assertUniqueIds(matrix, "post-plan app list");

process.stdout.write("canonical-workflow-apps-smoke: ok\n");

function run(args) {
  return JSON.parse(execFileSync(node, [cli, ...args], { cwd: pluginRoot, encoding: "utf8" }));
}

function assertUniqueIds(entries, label) {
  const seen = new Set();
  for (const entry of entries) {
    assert.ok(!seen.has(entry.id), `${label} contains duplicate id ${entry.id}`);
    seen.add(entry.id);
  }
}

function assertUniqueTaskIds(tasks, appId) {
  const seen = new Set();
  for (const task of tasks) {
    assert.ok(!seen.has(task.id), `${appId} duplicate planned task id ${task.id}`);
    seen.add(task.id);
  }
}

function assertTaskIdsUnique(shown) {
  const tasks = shown.workflow.phases.flatMap((phase) => phase.tasks);
  assertUniqueTaskIds(tasks, shown.app.id);
}

function assertUsesSandboxHints(shown) {
  for (const phase of shown.workflow.phases) {
    for (const task of phase.tasks) {
      assert.ok(task.sandboxProfileId, `${shown.app.id} task ${task.id} needs a sandboxProfileId`);
      assert.ok(
        shown.app.sandboxProfiles.includes(task.sandboxProfileId),
        `${shown.app.id} task ${task.id} uses undeclared sandbox profile ${task.sandboxProfileId}`
      );
    }
  }
}

function assertHasEvidenceGate(shown) {
  const gated = shown.workflow.phases.flatMap((phase) =>
    phase.tasks
      .filter((task) => task.requiresEvidence)
      .map((task) => ({ phase: phase.name, task: task.id }))
  );
  assert.ok(gated.length > 0, `${shown.app.id} needs at least one evidence-required task`);
  assert.ok(
    gated.some((entry) => /verify|synth|verdict|summary/i.test(`${entry.phase}:${entry.task}`)),
    `${shown.app.id} needs evidence-required verification, synthesis, verdict, or summary work`
  );
}
