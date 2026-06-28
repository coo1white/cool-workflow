#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CANONICAL_APP_IDS, GOLDEN_PATH_APP_ID } = require("./canonical-apps-list.js");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "scripts/cw.js");
const node = process.execPath;

const canonicalApps = [
  {
    id: "architecture-review",
    args: (workspace) => [
      "--repo",
      workspace,
      "--question",
      "Is the canonical app architecture stable and evidence-backed?",
      "--invariant",
      "No duplicate workflow ids",
      "--focus",
      "Workflow App framework"
    ]
  },
  {
    id: "architecture-review-fast",
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
    args: (workspace) => [
      "--repo",
      workspace,
      "--branch",
      "feature/canonical-apps",
      "--base",
      "main",
      "--ci",
      "local",
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
      "0.1.30",
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
      "What evidence supports Canonical Workflow Apps as official userland?",
      "--source",
      "plugins/cool-workflow/docs/workflow-app-framework.7.md",
      "--scope",
      "Cool Workflow v0.1.96",
      "--freshness",
      "as of release preparation"
    ]
  }
];

function main() {
  // Fail-closed drift gate (audit M5): the per-app CLI smoke below must cover
  // exactly the DERIVED canonical set (apps/ minus metadata.example demos) less
  // the golden-path app, which scripts/golden-path.js owns. If a new canonical
  // app appears (or the demo marker flips) without smoke args here, this fails
  // instead of silently skipping it — there is no second hand-copied list.
  const expectedSmokeIds = CANONICAL_APP_IDS.filter((id) => id !== GOLDEN_PATH_APP_ID).sort();
  const actualSmokeIds = canonicalApps.map((app) => app.id).sort();
  assert.deepEqual(
    actualSmokeIds,
    expectedSmokeIds,
    `canonical-apps smoke set drifted from derived canonical list (apps/ minus example demos, minus ${GOLDEN_PATH_APP_ID}): ` +
      `expected ${JSON.stringify(expectedSmokeIds)}, got ${JSON.stringify(actualSmokeIds)}`
  );

  const appList = runJson(["app", "list"]);
  const workflowList = runJson(["list"]);
  assertUniqueIds(appList, "app list");
  assertUniqueIds(workflowList, "workflow list");

  const summaries = [];
  for (const app of canonicalApps) {
    const manifestPath = path.join(pluginRoot, "apps", app.id, "app.json");
    const summary = appList.find((entry) => entry.id === app.id);
    assert.ok(summary, `${app.id} must appear in app list`);
    assert.equal(summary.sourceKind, "app-directory");
    assert.equal(summary.legacy, false);
    assert.equal(summary.version, "0.1.96");

    const validation = runJson(["app", "validate", manifestPath]);
    assert.equal(validation.valid, true, `${app.id} manifest must validate`);

    const shown = runJson(["app", "show", app.id]);
    assert.equal(shown.app.id, app.id);
    assert.equal(shown.app.version, "0.1.96");
    assert.ok(shown.app.metadata.canonical, `${app.id} must be marked canonical`);
    assert.ok(shown.app.sandboxProfiles.length > 0, `${app.id} must declare sandbox profiles`);
    assertTaskIdsUnique(shown);
    assertUsesSandboxHints(shown);
    assertHasEvidenceGate(shown);

    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `cw-canonical-${app.id}-`));
    const plan = runJson(["plan", app.id, ...app.args(workspace)]);
    const state = JSON.parse(fs.readFileSync(plan.statePath, "utf8"));
    assert.equal(state.workflow.app.id, app.id);
    assert.equal(state.workflow.app.version, "0.1.96");
    assert.equal(state.workflow.app.metadata.canonical, true);
    assert.ok(state.tasks.some((task) => task.requiresEvidence), `${app.id} plan must include evidence gates`);
    assert.ok(state.tasks.every((task) => task.sandboxProfileId), `${app.id} plan must include sandbox hints`);

    summaries.push({
      id: app.id,
      version: shown.app.version,
      runId: plan.runId,
      taskCount: state.tasks.length,
      statePath: plan.statePath,
      reportPath: plan.reportPath
    });
  }

  process.stdout.write(`${JSON.stringify({ ok: true, canonicalApps: summaries }, null, 2)}\n`);
}

function runJson(args) {
  return JSON.parse(execFileSync(node, [cli, ...args], { cwd: pluginRoot, encoding: "utf8" }));
}

function assertUniqueIds(entries, label) {
  const seen = new Set();
  for (const entry of entries) {
    assert.ok(!seen.has(entry.id), `${label} contains duplicate id ${entry.id}`);
    seen.add(entry.id);
  }
}

function assertTaskIdsUnique(shown) {
  const seen = new Set();
  for (const phase of shown.workflow.phases) {
    for (const task of phase.tasks) {
      assert.ok(!seen.has(task.id), `${shown.app.id} contains duplicate task id ${task.id}`);
      seen.add(task.id);
    }
  }
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
    `${shown.app.id} needs an evidence gate in verify/synthesis/verdict/summary work`
  );
}

main();
