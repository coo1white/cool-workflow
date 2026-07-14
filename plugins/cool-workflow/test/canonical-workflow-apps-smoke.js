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
    minVersion: "0.1.30",
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
    id: "architecture-review-fast",
    minVersion: "0.1.79",
    args: (workspace) => [
      "--repo",
      workspace,
      "--question",
      "Can a user get a fast architecture answer?",
      "--invariant",
      "Full architecture-review remains available",
      "--focus",
      "Runtime speed",
      "--sourceContext",
      "",
      "--sourceContextDigest",
      ""
    ]
  },
  {
    id: "pr-review-fix-ci",
    minVersion: "0.1.30",
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
    minVersion: "0.1.30",
    args: (workspace) => [
      "--repo",
      workspace,
      "--version",
      "0.1.30",
      "--previousVersion",
      "0.1.11",
      "--releaseBranch",
      "main",
      "--dryRun",
      "true"
    ]
  },
  {
    id: "research-synthesis",
    minVersion: "0.1.30",
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
  assert.ok(workflowList.some((entry) => entry.id === app.id), `${app.id} must appear in cw list`);
}

const appList = run(["app", "list"]);
assertUniqueIds(appList, "app list");

for (const app of canonicalApps) {
  const summary = appList.find((entry) => entry.id === app.id);
  assert.ok(summary, `${app.id} must appear in cw app list`);
  assert.equal(summary.sourceKind, "app-directory");
  assert.equal(summary.legacy, false);
  assert.equal(summary.version, "0.2.6");
  assert.ok(summary.sandboxProfiles.length > 0);

  const validation = run(["app", "validate", path.join(pluginRoot, "apps", app.id, "app.json")]);
  assert.equal(validation.valid, true, `${app.id} must validate`);
  assert.equal(validation.summary.id, app.id);

  const shown = run(["app", "show", app.id]);
  assert.equal(shown.app.id, app.id);
  assert.equal(shown.app.version, "0.2.6");
  assert.equal(shown.app.compatibility.minVersion, app.minVersion);
  assert.equal(shown.app.metadata.canonical, true);
  assertTaskIdsUnique(shown);
  assertUsesSandboxHints(shown);
  assertHasEvidenceGate(shown);

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `cw-canonical-smoke-${app.id}-`));
  const plan = run(["plan", app.id, ...app.args(workspace)]);
  assert.equal(plan.workflowId, app.id);
  // CUTOVER AUDIT — REAL-GAP (v2): the `cw plan` CLI payload dropped the
  // `pendingTasks` field the old build's canonical plan summary emitted.
  // Old builder: src/capability-core.ts planSummary() returned
  // { runId, workflowId, statePath, reportPath, pendingTasks }.
  // v2 builder: src/shell/pipeline-cli.ts:74 emits
  // { schemaVersion, runId, workflowId, statePath, reportPath, taskCount }
  // — `pendingTasks` is gone, so this reads `undefined > 0` -> false.
  // This is NOT an import repoint (the smoke only shells out to dist/cli.js);
  // it is missing v2 output. Assertion left intact per audit rules (Phase B fixes v2).
  assert.ok(plan.pendingTasks > 0);

  const state = JSON.parse(fs.readFileSync(plan.statePath, "utf8"));
  assert.equal(state.workflow.id, app.id);
  assert.equal(state.workflow.app.id, app.id);
  assert.equal(state.workflow.app.version, "0.2.6");
  // CUTOVER AUDIT — REAL-GAP (v2): the persisted run.workflow.app block dropped
  // `metadata` (and `compatibility`). Old builder src/workflow-app-framework.ts
  // workflowAppRunMetadata() carried `metadata: record.app.metadata` (holds
  // canonical:true) into state; v2 builder src/core/workflow-apps/app-schema.ts:826
  // omits it, so state.workflow.app.metadata is undefined and reading .canonical
  // throws. Assertion left intact per audit rules (Phase B fixes v2).
  assert.equal(state.workflow.app.metadata.canonical, true);
  assert.equal(state.loopStage, "interpret");
  assertUniqueTaskIds(state.tasks, app.id);
  assert.ok(state.tasks.some((task) => task.requiresEvidence), `${app.id} plan needs evidence-required tasks`);
  assert.ok(state.tasks.every((task) => task.sandboxProfileId), `${app.id} plan needs sandbox profile hints`);

  const report = fs.readFileSync(plan.reportPath, "utf8");
  assert.match(report, new RegExp(`Workflow App: ${app.id}@0\\.2\\.6`));
}

const matrix = run(["app", "list"]);
assertUniqueIds(matrix, "post-plan app list");

// initApp end-to-end (the riskiest callback wiring: resolveFromBase + validateApp
// are passed into app-operations as callbacks). Scaffold a fresh app into a tmp
// dir, assert the returned shape + on-disk manifest, then validate it.
{
  const initDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-app-init-smoke-"));
  const initId = "smoke-init-app";
  const created = run(["app", "init", initId, "--directory", initDir]);
  assert.equal(created.id, initId, "initApp must echo the slugified id");
  assert.equal(created.manifestPath, path.join(initDir, "app.json"), "initApp manifestPath");
  assert.equal(created.entrypointPath, path.join(initDir, "workflow.js"), "initApp entrypointPath");
  assert.ok(fs.existsSync(created.manifestPath), "initApp must write the manifest to disk");
  assert.ok(fs.existsSync(created.entrypointPath), "initApp must write the entrypoint to disk");

  // Scaffolded into an os.tmpdir() location outside CW's trusted app roots —
  // a standalone `validate` call afterward is a fresh process with no memory
  // of who wrote it, so it needs the same explicit opt-in an external app
  // would (architecture-review P1 fix; see workflow-app-loader.ts).
  const initValidation = run(["app", "validate", created.manifestPath], { CW_ALLOW_EXTERNAL_APP_CODE: "1" });
  assert.equal(initValidation.valid, true, "scaffolded app must validate");
  assert.equal(initValidation.summary.id, initId, "validated scaffold id");
}

process.stdout.write("canonical-workflow-apps-smoke: ok\n");

function run(args, env) {
  const options = { cwd: pluginRoot, encoding: "utf8" };
  if (env) options.env = { ...process.env, ...env };
  return JSON.parse(execFileSync(node, [cli, ...args], options));
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
