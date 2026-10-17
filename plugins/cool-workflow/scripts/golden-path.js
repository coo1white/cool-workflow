#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "scripts/cw.js");
const node = process.execPath;
const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
const quiet = args.has("--quiet") || jsonOutput;
const cleanup = args.has("--cleanup");

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-e2e-golden-path-"));
  const evidencePath = path.join(tmp, "golden-evidence.md");
  fs.writeFileSync(
    evidencePath,
    [
      "# Golden Evidence",
      "The golden path evidence file proves the worker result and verifier-gated commit are backed by a stable file:line locator.",
      ""
    ].join("\n"),
    "utf8"
  );
  const evidenceLocator = `${evidencePath}:2`;

  try {
    const appValidation = runJson(["app", "validate", "end-to-end-golden-path"], pluginRoot);
    assert.equal(appValidation.valid, true);
    assert.equal(appValidation.summary.id, "end-to-end-golden-path");
    assert.equal(appValidation.summary.version, "0.3.1");

    const plan = runJson(
      [
        "plan",
        "end-to-end-golden-path",
        "--repo",
        tmp,
        "--question",
        "Prove the deterministic v0.3.1 end-to-end golden path."
      ],
      pluginRoot
    );
    assert.equal(plan.workflowId, "end-to-end-golden-path");
    assert.equal(plan.pendingTasks, 1);
    assert.ok(fs.existsSync(plan.statePath));

    let state = readJson(plan.statePath);
    assert.equal(state.workflow.app.id, "end-to-end-golden-path");
    assert.equal(state.workflow.app.version, "0.3.1");
    assert.equal(state.loopStage, "interpret");

    const dispatch = runJson(["dispatch", plan.runId, "--limit", "1", "--sandbox", "readonly"], tmp);
    assert.ok(dispatch.dispatchId);
    assert.equal(dispatch.tasks.length, 1);
    assert.equal(dispatch.sandboxProfileId, "readonly");
    assert.equal(dispatch.tasks[0].sandboxProfileId, "readonly");
    assert.ok(dispatch.tasks[0].workerId);
    assert.ok(dispatch.tasks[0].workerManifestPath);
    assert.ok(dispatch.tasks[0].workerResultPath);
    assert.ok(fs.existsSync(dispatch.manifestPath));

    const dispatchState = readJson(plan.statePath);
    const dispatchRecord = dispatchState.dispatches.find((entry) => entry.id === dispatch.dispatchId);
    assert.ok(dispatchRecord);
    assert.equal(dispatchRecord.sandboxProfileId, "readonly");
    assert.deepEqual(dispatchRecord.workerIds, [dispatch.tasks[0].workerId]);

    const workerId = dispatch.tasks[0].workerId;
    const workerManifest = runJson(["worker", "manifest", plan.runId, workerId], tmp);
    assert.equal(workerManifest.id, workerId);
    assert.equal(workerManifest.sandboxProfileId, "readonly");
    assert.equal(workerManifest.sandbox.profileId, "readonly");
    assert.equal(workerManifest.sandbox.policy.network.mode, "none");
    assert.ok(workerManifest.sandbox.policy.enforcement.enforcedByCW.length > 0);
    assert.ok(workerManifest.sandbox.policy.enforcement.hostRequired.length > 0);
    assert.equal(workerManifest.resultPath, dispatch.tasks[0].workerResultPath);

    const manifestFile = readJson(dispatch.tasks[0].workerManifestPath);
    assert.equal(manifestFile.id, workerId);
    assert.equal(manifestFile.sandboxPolicy.id, "readonly");

    writeWorkerResult(workerManifest.resultPath, evidenceLocator);
    assert.ok(fs.existsSync(workerManifest.resultPath));

    const workerSummary = runJson(["worker", "output", plan.runId, workerId, workerManifest.resultPath], tmp);
    assert.equal(workerSummary.tasks.completed, 1);
    assert.equal(workerSummary.workers.byStatus.verified, 1);
    assert.equal(workerSummary.loopStage, "observe");

    state = readJson(plan.statePath);
    const worker = state.workers.find((entry) => entry.id === workerId);
    assert.equal(worker.status, "verified");
    assert.equal(worker.sandboxProfileId, "readonly");
    assert.ok(worker.output.stateNodeId);
    assert.ok(worker.output.verifierNodeId);

    const task = state.tasks.find((entry) => entry.workerId === workerId);
    assert.equal(task.status, "completed");
    assert.equal(task.requiresEvidence, true);
    assert.equal(task.sandboxProfileId, "readonly");

    const resultNode = state.nodes.find((entry) => entry.id === task.resultNodeId);
    const verifierNode = state.nodes.find((entry) => entry.id === task.verifierNodeId);
    assert.equal(resultNode.kind, "result");
    assert.equal(resultNode.status, "completed");
    assert.ok(resultNode.evidence.some((entry) => entry.locator === evidenceLocator));
    assert.equal(verifierNode.kind, "verifier");
    assert.equal(verifierNode.status, "verified");
    assert.ok(verifierNode.evidence.some((entry) => entry.locator === evidenceLocator));

    const commitResult = runJson(
      [
        "commit",
        plan.runId,
        "--verifier",
        verifierNode.id,
        "--reason",
        "golden path verifier-gated commit"
      ],
      tmp
    );
    assert.equal(commitResult.runId, plan.runId);
    assert.equal(commitResult.commit.verifierGated, true);
    assert.equal(commitResult.commit.checkpoint, false);
    assert.equal(commitResult.commit.verifierNodeId, verifierNode.id);
    assert.ok(commitResult.commit.evidence.some((entry) => entry.locator === evidenceLocator));
    assert.ok(fs.existsSync(commitResult.commit.snapshotPath));

    const reportPath = runText(["report", plan.runId], tmp).trim();
    assert.equal(reportPath, plan.reportPath);
    assert.ok(fs.existsSync(reportPath));
    const report = fs.readFileSync(reportPath, "utf8");
    assert.match(report, /Workflow App: end-to-end-golden-path@0\.3\.1/);
    assert.match(report, /## Trust Audit/);
    assert.match(report, /verifier-gated commit/);
    assert.match(report, /golden path verifier-gated commit/);

    state = readJson(plan.statePath);
    const finalCommit = state.commits[state.commits.length - 1];
    assert.equal(finalCommit.id, commitResult.commit.id);
    assert.equal(finalCommit.verifierGated, true);
    assert.equal(finalCommit.checkpoint, false);
    assert.equal(finalCommit.verifierNodeId, verifierNode.id);
    assert.ok(finalCommit.evidence.some((entry) => entry.locator === evidenceLocator));
    assert.equal((state.feedback || []).length, 0);

    const summary = {
      ok: true,
      runId: plan.runId,
      workspace: tmp,
      statePath: plan.statePath,
      reportPath,
      workerId,
      verifierNodeId: verifierNode.id,
      commitId: finalCommit.id,
      evidence: [evidenceLocator, reportPath, finalCommit.snapshotPath]
    };
    if (jsonOutput) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else if (!quiet) {
      process.stdout.write(
        [
          "golden-path: ok",
          `run: ${summary.runId}`,
          `report: ${summary.reportPath}`,
          `commit: ${summary.commitId}`,
          ""
        ].join("\n")
      );
    }
    if (cleanup) fs.rmSync(tmp, { recursive: true, force: true });
    return summary;
  } catch (error) {
    if (cleanup) fs.rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
}

function writeWorkerResult(resultPath, evidenceLocator) {
  fs.writeFileSync(
    resultPath,
    [
      "# Golden Worker Result",
      "",
      "The isolated worker produced deterministic evidence for the end-to-end golden path.",
      "",
      "```cw:result",
      JSON.stringify({
        summary: "Golden path worker result accepted with durable evidence.",
        findings: [],
        evidence: [evidenceLocator]
      }),
      "```",
      ""
    ].join("\n"),
    "utf8"
  );
}

function runJson(commandArgs, cwd) {
  return JSON.parse(runText(commandArgs, cwd));
}

function runText(commandArgs, cwd) {
  try {
    return execFileSync(node, [cli, ...commandArgs], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const rendered = [
      `Command failed: node ${path.relative(pluginRoot, cli)} ${commandArgs.join(" ")}`,
      `cwd: ${cwd}`,
      error.stdout ? `stdout:\n${String(error.stdout)}` : "",
      error.stderr ? `stderr:\n${String(error.stderr)}` : ""
    ]
      .filter(Boolean)
      .join("\n");
    error.message = `${error.message}\n${rendered}`;
    throw error;
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

main();
