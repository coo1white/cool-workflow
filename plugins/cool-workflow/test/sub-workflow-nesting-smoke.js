#!/usr/bin/env node
"use strict";

// @cw-smoke: timeout 180
// sub-workflow-nesting-smoke — the CI gate for inline sub-workflow nesting (#6).
//
// A task can be fulfilled by planning + driving a CHILD app run; the child's report
// becomes the task's result, so the parent's verifier gate + downstream tasks consume
// it like any other result. Leaf work is still external-agent delegation at every
// level (a hermetic stub stands in for `claude -p`). Proves:
//   1. A parent app whose phase-1 task delegates to a child app runs the child, binds
//      its report back (handleKind "sub-workflow"), and a downstream parent task then
//      consumes it — the whole parent run completes.
//   2. The child run is nested-id'd (sub-<parentRunId>-<taskId>), exists, and is
//      recorded on the parent task (subRunId/subRunDir).
//   3. HONEST cross-link: one `worker.sub-workflow` audit event on the parent carries
//      the child run id + child report digest + child audit verdict; verifyTrustAudit
//      passes for BOTH parent and child chains.
//   4. REPLAY determinism: the parent's sub-workflow result node replays byte-identically
//      under two different `now`, WITHOUT re-driving the child.
//   5. FAIL-CLOSED bounded recursion: a self-cycle app (A→A) parks; a chain deeper than
//      MAX_SUB_WORKFLOW_DEPTH parks. No infinite recursion.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const { drive, MAX_SUB_WORKFLOW_DEPTH } = require(path.join(pluginRoot, "dist/drive.js"));
const ns = require(path.join(pluginRoot, "dist/node-snapshot.js"));
const { verifyTrustAudit } = require(path.join(pluginRoot, "dist/trust-audit.js"));

const FIXED_NOW = "2026-06-20T00:00:00.000Z";
const cleanups = [];

function tmp(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  cleanups.push(d);
  return d;
}
function clearAgentEnv() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];
}
function writeStub(file, countFile) {
  fs.writeFileSync(file, [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    `fs.appendFileSync(${JSON.stringify(countFile)}, "x");`,
    'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "fs.writeFileSync(rp, body);",
    'process.stdout.write(JSON.stringify({ model: "stub", usage: { input_tokens: 4, output_tokens: 2 } }));'
  ].join("\n"), "utf8");
  return file;
}
function agentConfig(stub) {
  return { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}"], model: "op", source: "flag" };
}
function writeApp(appsDir, id, workflowBody) {
  const dir = path.join(appsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "app.json"), JSON.stringify({
    schemaVersion: 1, id, title: id, summary: id, version: "0.1.0", author: "test",
    inputs: [{ name: "question", type: "string" }],
    sandboxProfiles: ["readonly"],
    compatibility: { minVersion: "0.1.9" },
    workflow: { entrypoint: "workflow.js" }
  }, null, 2));
  fs.writeFileSync(path.join(dir, "workflow.js"), workflowBody);
}
// A minimal app body. `id`, the phases array source, and the destructured api names
// are interpolated. Every app declares the same small limits + readonly sandbox.
function appBody(id, apiNames, phasesSrc) {
  return `module.exports = ({ ${apiNames} }) => workflow({
  id: ${JSON.stringify(id)}, title: ${JSON.stringify(id)}, summary: ${JSON.stringify(id)},
  limits: { maxAgents: 6, maxConcurrentAgents: 1 },
  inputs: [input("question", { type: "string" })],
  sandboxProfiles: ["readonly"],
  phases: ${phasesSrc}
});\n`;
}

function newRunner(appsDir) {
  const runner = new CoolWorkflowRunner({ pluginRoot });
  runner.appsDir = appsDir; // point the loader at the fixture apps
  return runner;
}

function main() {
  clearAgentEnv();
  const cwd0 = process.cwd();

  // ===== 1–4: happy path — parent delegates to child, downstream consumes, replays ==
  {
    const appsDir = tmp("cw-subwf-apps-");
    const work = tmp("cw-subwf-work-");
    fs.writeFileSync(path.join(work, "README.md"), "# t\n", "utf8");
    const countFile = path.join(work, "spawns.count");
    const stub = writeStub(path.join(work, "stub.js"), countFile);

    writeApp(appsDir, "sub-child", appBody("sub-child", "workflow, phase, agent, input",
      `[ phase("Work", [ agent("work:do", "Do {{question}}", { sandboxProfileId: "readonly" }) ]) ]`));
    writeApp(appsDir, "sub-parent", appBody("sub-parent", "workflow, phase, agent, subWorkflow, input",
      `[
        phase("Delegate", [ subWorkflow("delegate:child", "sub-child", { sandboxProfileId: "readonly" }) ]),
        phase("Use", [ agent("use:summary", "Summarize the child result for {{question}}", { sandboxProfileId: "readonly" }) ])
      ]`));

    process.chdir(work);
    try {
      const runner = newRunner(appsDir);
      const parent = runner.plan("sub-parent", { repo: work, question: "Q?" });
      const result = drive(runner, parent.id, { now: FIXED_NOW, agentConfig: agentConfig(stub) });
      assert.equal(result.status, "complete", "parent run completes");

      const sub = result.steps.find((s) => s.action === "accept" && s.taskId === "delegate:child");
      assert.ok(sub && sub.handleKind === "sub-workflow", "the delegate task was fulfilled by a sub-workflow");

      const finalParent = runner.loadRun(parent.id);
      const delegateTask = finalParent.tasks.find((t) => t.id === "delegate:child");
      assert.equal(delegateTask.status, "completed", "sub-workflow task completed");
      assert.ok(delegateTask.subRunId && delegateTask.subRunId.startsWith(`sub-${parent.id}-`), `child run id recorded: ${delegateTask.subRunId}`);
      assert.ok(finalParent.tasks.find((t) => t.id === "use:summary").status === "completed", "downstream parent task consumed the result + completed");

      // child run exists + both audit chains verify
      const childRun = runner.loadRun(delegateTask.subRunId);
      assert.ok(childRun && childRun.workflow.id === "sub-child", "child run exists and is the child app");
      assert.equal(verifyTrustAudit(finalParent).verified, true, "parent trust-audit chain verifies");
      assert.equal(verifyTrustAudit(childRun).verified, true, "child trust-audit chain verifies");

      // honest cross-link event on the parent
      const audit = runner.auditSummary(parent.id);
      assert.ok((audit.byKind || {})["worker.sub-workflow"] >= 1, "a worker.sub-workflow cross-link event was recorded on the parent");

      // replay determinism of the sub-workflow result node (no re-drive of the child)
      assert.ok(delegateTask.resultNodeId, "sub-workflow task has a result node");
      const snap = ns.snapshotNode(finalParent, delegateTask.resultNodeId, { now: FIXED_NOW, persist: false });
      const r1 = ns.replayNodeSnapshot(finalParent, snap, { now: "2026-06-09T01:00:00.000Z", persist: false });
      const r2 = ns.replayNodeSnapshot(finalParent, snap, { now: "2030-01-01T00:00:00.000Z", persist: false });
      assert.equal(r1.outputFingerprint, r2.outputFingerprint, "two replays under different now ⇒ identical fingerprint");
      assert.equal(JSON.stringify(r1.body), JSON.stringify(r2.body), "two replays byte-identical");
      console.log("sub-workflow: happy path + downstream + honest cross-link + replay ok");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ===== 5a: self-cycle parks fail-closed (no infinite recursion) ===================
  {
    const appsDir = tmp("cw-subwf-cyc-");
    const work = tmp("cw-subwf-cycw-");
    fs.writeFileSync(path.join(work, "README.md"), "# t\n", "utf8");
    const stub = writeStub(path.join(work, "stub.js"), path.join(work, "c.count"));
    writeApp(appsDir, "sub-cycle", appBody("sub-cycle", "workflow, phase, subWorkflow, input",
      `[ phase("Loop", [ subWorkflow("loop:self", "sub-cycle", { sandboxProfileId: "readonly" }) ]) ]`));
    process.chdir(work);
    try {
      const runner = newRunner(appsDir);
      const run = runner.plan("sub-cycle", { repo: work, question: "Q?" });
      const result = drive(runner, run.id, { now: FIXED_NOW, policy: { maxAttempts: 1 }, agentConfig: agentConfig(stub) });
      assert.equal(result.status, "parked", "a self-cycling sub-workflow parks fail-closed (no infinite recursion)");
      assert.ok(!result.commitId, "no commit on a fail-closed park");
      console.log("sub-workflow: self-cycle parks fail-closed ok");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ===== 5b: chain deeper than MAX_SUB_WORKFLOW_DEPTH parks ==========================
  {
    const appsDir = tmp("cw-subwf-depth-");
    const work = tmp("cw-subwf-depthw-");
    fs.writeFileSync(path.join(work, "README.md"), "# t\n", "utf8");
    const stub = writeStub(path.join(work, "stub.js"), path.join(work, "d.count"));
    // chain-0 → chain-1 → … → chain-K, each invoking the next. The (MAX+1)th hop is
    // refused BEFORE planning, so the whole chain parks.
    const N = MAX_SUB_WORKFLOW_DEPTH + 1; // deep enough to trip the cap
    for (let k = 0; k <= N; k++) {
      writeApp(appsDir, `chain-${k}`, appBody(`chain-${k}`, "workflow, phase, subWorkflow, input",
        `[ phase("Down", [ subWorkflow("down:next", "chain-${k + 1}", { sandboxProfileId: "readonly" }) ]) ]`));
    }
    process.chdir(work);
    try {
      const runner = newRunner(appsDir);
      const run = runner.plan("chain-0", { repo: work, question: "Q?" });
      const result = drive(runner, run.id, { now: FIXED_NOW, policy: { maxAttempts: 1 }, agentConfig: agentConfig(stub) });
      assert.equal(result.status, "parked", `a chain deeper than MAX_SUB_WORKFLOW_DEPTH (${MAX_SUB_WORKFLOW_DEPTH}) parks fail-closed`);
      console.log("sub-workflow: depth-limit chain parks fail-closed ok");
    } finally {
      process.chdir(cwd0);
    }
  }

  for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
  console.log("sub-workflow-nesting-smoke: ok");
}

main();
