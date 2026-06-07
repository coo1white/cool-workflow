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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-operator-ux-"));
const evidencePath = path.join(tmp, "operator-evidence.md");
fs.writeFileSync(evidencePath, "operator evidence\n", "utf8");
const evidenceLocator = `${evidencePath}:1`;

const plan = runJson(
  [
    "plan",
    "end-to-end-golden-path",
    "--repo",
    tmp,
    "--question",
    "Prove the v0.1.16 operator UX smoke path."
  ],
  pluginRoot
);

let status = runText(["status", plan.runId], tmp);
assert.match(status, new RegExp(`Run: ${plan.runId}`));
assert.match(status, /Workflow: end-to-end-golden-path \(end-to-end-golden-path@0\.1\.16\)/);
assert.match(status, /Loop Stage: interpret/);
assert.match(status, /Active Phase: Golden Path/);
assert.match(status, /Tasks: pending=1; total=1/);
assert.match(status, /Workers/);
assert.match(status, /Candidates/);
assert.match(status, /Feedback/);
assert.match(status, /Commits/);
assert.match(status, /Trust Audit/);
assert.match(status, /Next Action/);
assert.match(status, /node scripts\/cw\.js dispatch .* --limit 1/);

const statusJson = runJson(["status", plan.runId, "--json"], tmp);
assert.equal(statusJson.runId, plan.runId);
assert.equal(statusJson.workflowId, "end-to-end-golden-path");
assert.equal(statusJson.tasks.pending, 1);
assert.ok(Array.isArray(statusJson.commits));

const dispatch = runJson(["dispatch", plan.runId, "--limit", "1", "--sandbox", "readonly"], tmp);
const workerId = dispatch.tasks[0].workerId;
assert.ok(workerId);

status = runText(["status", plan.runId], tmp);
assert.match(status, /Loop Stage: act/);
assert.match(status, /node scripts\/cw\.js worker manifest/);
assert.match(status, new RegExp(workerId));

let workerSummary = runText(["worker", "summary", plan.runId], tmp);
assert.match(workerSummary, /Workers/);
assert.match(workerSummary, /running=1/);
assert.match(workerSummary, /sandbox=readonly=1/);
assert.match(workerSummary, /manifest=/);
assert.equal(runJson(["worker", "summary", plan.runId, "--json"], tmp).byStatus.running, 1);

const workerManifest = runJson(["worker", "manifest", plan.runId, workerId], tmp);
writeWorkerResult(workerManifest.resultPath, evidenceLocator);
runJson(["worker", "output", plan.runId, workerId, workerManifest.resultPath], tmp);

status = runText(["status", plan.runId], tmp);
assert.match(status, /node scripts\/cw\.js candidate register/);

const candidate = runJson(["candidate", "register", plan.runId, "--worker", workerId, "--id", "operator-candidate"], tmp);
assert.equal(candidate.status, "registered");
status = runText(["status", plan.runId], tmp);
assert.match(status, /node scripts\/cw\.js candidate score/);

const score = runJson(
  [
    "candidate",
    "score",
    plan.runId,
    "operator-candidate",
    "--criterion",
    "correctness=4",
    "--criterion",
    "evidence=4",
    "--criterion",
    "fit=2",
    "--maxTotal",
    "10",
    "--evidence",
    evidenceLocator
  ],
  tmp
);
assert.equal(score.verdict, "pass");
status = runText(["status", plan.runId], tmp);
assert.match(status, /node scripts\/cw\.js candidate rank/);
assert.match(status, /node scripts\/cw\.js candidate select/);

runJson(["candidate", "rank", plan.runId], tmp);
const selection = runJson(["candidate", "select", plan.runId, "operator-candidate", "--reason", "operator smoke selected"], tmp);
status = runText(["status", plan.runId], tmp);
assert.match(status, /ready for commit=operator-candidate/);
assert.match(status, /node scripts\/cw\.js commit .* --selection/);

runJson(["commit", plan.runId, "--selection", selection.id, "--reason", "operator smoke verifier-gated commit"], tmp);
status = runText(["status", plan.runId], tmp);
assert.match(status, /verifier-gated=1/);
assert.match(status, /node scripts\/cw\.js report .* --show/);

const graph = runText(["graph", plan.runId], tmp);
assert.match(graph, /Run Graph:/);
assert.match(graph, /phase/);
assert.match(graph, /task/);
assert.match(graph, /dispatch/);
assert.match(graph, /worker/);
assert.match(graph, /result/);
assert.match(graph, /verifier/);
assert.match(graph, /candidate/);
assert.match(graph, /selection/);
assert.match(graph, /commit/);
assert.match(graph, /Edges/);

const graphJson = runJson(["graph", plan.runId, "--json"], tmp);
assert.equal(graphJson.runId, plan.runId);
assert.ok(graphJson.nodes.some((node) => node.kind === "worker"));
assert.ok(graphJson.edges.length > 0);

const nodeGraph = runText(["node", "graph", plan.runId], tmp);
assert.match(nodeGraph, /Run Graph:/);
assert.ok(Array.isArray(runJson(["node", "graph", plan.runId, "--json"], tmp)));

const reportSummary = runText(["report", plan.runId, "--summary"], tmp);
assert.match(reportSummary, /Workers/);
assert.match(reportSummary, /Candidates/);
assert.match(reportSummary, /Commits/);
assert.match(reportSummary, /Feedback/);
assert.match(reportSummary, /Evidence/);
assert.match(reportSummary, /operator-evidence\.md:1/);

const reportShow = runText(["report", plan.runId, "--show"], tmp);
assert.match(reportShow, /Next Action/);
assert.match(reportShow, /Resource Commands/);

const candidateSummary = runText(["candidate", "summary", plan.runId], tmp);
assert.match(candidateSummary, /Candidates/);
assert.match(candidateSummary, /verified=1/);
assert.equal(runJson(["candidate", "summary", plan.runId, "--json"], tmp).readyForCommit.length, 0);

const feedbackSummary = runText(["feedback", "summary", plan.runId], tmp);
assert.match(feedbackSummary, /Feedback/);
assert.match(feedbackSummary, /total=0/);
assert.equal(runJson(["feedback", "summary", plan.runId, "--json"], tmp).total, 0);

const commitSummary = runText(["commit", "summary", plan.runId], tmp);
assert.match(commitSummary, /Commits/);
assert.match(commitSummary, /verifier-gated=1/);
assert.match(commitSummary, /checkpoints=/);
assert.equal(runJson(["commit", "summary", plan.runId, "--json"], tmp).verifierGated, 1);

process.stdout.write("operator-ux-smoke: ok\n");

function writeWorkerResult(resultPath, locator) {
  fs.writeFileSync(
    resultPath,
    [
      "# Operator Worker Result",
      "",
      "The worker result exists to exercise operator UX summaries.",
      "",
      "```cw:result",
      JSON.stringify({
        summary: "Operator UX worker result accepted with durable evidence.",
        findings: [],
        evidence: [locator]
      }),
      "```",
      ""
    ].join("\n"),
    "utf8"
  );
}

function runJson(args, cwd) {
  return JSON.parse(runText(args, cwd));
}

function runText(args, cwd) {
  return execFileSync(node, [cli, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}
