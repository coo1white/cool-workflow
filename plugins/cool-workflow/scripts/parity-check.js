#!/usr/bin/env node
"use strict";

// CLI <-> MCP parity gate. Two renderings of one data source must agree.
//
//   node scripts/parity-check.js            # print the parity report (JSON)
//   node scripts/parity-check.js --check    # fail (exit 1) on ANY drift
//
// FAIL CLOSED ON DRIFT (BSD discipline, same shape as gen-manifests --check):
//   1. STATIC parity — the declared capability registry must exactly match the
//      live MCP tool list (tools/list) and the CLI dispatch tokens parsed from
//      the built CLI dispatch surface. A tool or command on one surface but not
//      the other, or not declared in src/capability-registry.ts, is release-blocking.
//   2. PAYLOAD parity — for every capability declared `payloadIdentical`, the
//      `cw <cmd> --json` payload must equal the `cw_<tool>` MCP result on a real
//      bootstrap run (whitespace + generation-moment ISO timestamps aside).
//
// The registry (src/capability-registry.ts -> dist/capability-registry.js) is
// the single source of truth; this script never re-declares capabilities.

const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const pluginRoot = path.resolve(__dirname, "..");
const node = process.execPath;
const cli = path.join(pluginRoot, "dist", "cli.js");
const mcpServer = path.join(pluginRoot, "dist", "mcp-server.js");
const registry = require(path.join(pluginRoot, "dist", "capability-registry.js"));
const { formatHelp } = require(path.join(pluginRoot, "dist", "orchestrator.js"));
const { loadRunFromCwd, saveCheckpoint } = require(path.join(pluginRoot, "dist", "state.js"));
const { appendRunNode, createStateNode } = require(path.join(pluginRoot, "dist", "state-node.js"));

function capById(id) {
  const cap = registry.CAPABILITY_REGISTRY.find((entry) => entry.capability === id);
  assert.ok(cap, `probe references unknown capability ${id}`);
  return cap;
}

function jsonFlag(cap) {
  return cap.cli.jsonMode === "flag" ? ["--json"] : [];
}

function runCli(argv, cwd) {
  return JSON.parse(execFileSync(node, [cli, ...argv], { cwd, encoding: "utf8" }));
}

// ---- 1. static surface parity ---------------------------------------------
function liveMcpTools() {
  const result = execFileSync(node, [mcpServer], {
    cwd: pluginRoot,
    input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`,
    encoding: "utf8"
  });
  const line = result
    .trim()
    .split("\n")
    .find((entry) => entry.includes('"tools"'));
  assert.ok(line, "MCP server returned no tools/list result");
  return JSON.parse(line).result.tools.map((tool) => tool.name);
}

function cliDispatchTokens() {
  const source = cliDispatchSources().map((file) => fs.readFileSync(file, "utf8")).join("\n");
  return [...new Set([...source.matchAll(/case\s+"([^"]+)":/g)].map((match) => match[1]))];
}

function cliDispatchSources() {
  return [cli, path.join(pluginRoot, "dist", "cli", "command-surface.js")].filter((file) => fs.existsSync(file));
}

function cliHelpTokens() {
  const lines = formatHelp().split(/\r?\n/);
  const start = lines.indexOf("Commands:");
  if (start < 0) return [];
  const tokens = new Set();
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) break;
    const first = line.trim().split(/\s+/)[0];
    for (const token of first.split("|")) {
      const clean = token.replace(/[<[].*$/, "");
      if (clean) tokens.add(clean);
    }
  }
  return [...tokens].sort();
}

// ---- 2. payload identity ---------------------------------------------------
// Generation-moment ISO timestamps are presentation metadata, not capability
// data: the same field carries the wall-clock instant of the render. Neutralize
// them (and only them) before comparison so we assert canonical-payload identity.
function canonical(value) {
  return JSON.stringify(value).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<ts>");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAllLiteral(text, search, replacement) {
  return text.replace(new RegExp(escapeRegExp(search), "g"), replacement);
}

function canonicalScenario(value, context) {
  let text = canonical(value);
  for (const root of context.workspaceRoots || []) {
    text = replaceAllLiteral(text, root, "<workspace>");
  }
  for (const runId of context.runIds || []) {
    text = replaceAllLiteral(text, runId, "<runId>");
  }
  return text
    .replace(/"durationMs":\d+/g, '"durationMs":<ms>')
    .replace(/dispatch-\d{8}T\d{6}Z-\d{4}/g, "dispatch-<ts>-<seq>")
    .replace(/(architecture-review|end-to-end-golden-path)-\d{8}T\d{6}Z-[a-f0-9]+/g, "<runId>")
    .replace(/sha256:[a-f0-9]{32,64}/g, "sha256:<hash>")
    .replace(/[a-f0-9]{64}/g, "<hex64>");
}

function makeWorkspace(label) {
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cw-parity-${label}-`)));
  fs.writeFileSync(path.join(workspace, "README.md"), "# CLI/MCP parity fixture\n", "utf8");
  return workspace;
}

function bootstrapRun(workspace) {
  return runCli(["plan", "end-to-end-golden-path", "--question", "CLI/MCP scenario payload parity"], workspace);
}

function bootstrapTopologyRun(workspace) {
  return runCli(["plan", "architecture-review", "--repo", workspace, "--question", "CLI/MCP topology scenario parity"], workspace);
}

function writeParityResult(resultPath) {
  fs.writeFileSync(
    resultPath,
    [
      "# Result",
      "",
      "Deterministic parity result.",
      "",
      "```cw:result",
      '{ "summary": "parity result", "findings": [], "evidence": ["README.md:1"] }',
      "```",
      ""
    ].join("\n"),
    "utf8"
  );
}

function readmePath(workspace) {
  return path.join(workspace, "README.md");
}

function dispatchWorkerCli(workspace, runId) {
  const dispatch = runCli(["dispatch", runId, "--limit", "1"], workspace);
  const task = dispatch.tasks[0];
  assert.ok(task?.workerId, `${runId}: dispatch produced no worker id`);
  assert.ok(task.workerResultPath, `${runId}: dispatch produced no worker result path`);
  return {
    workerId: task.workerId,
    taskId: task.id,
    resultPath: task.workerResultPath
  };
}

async function dispatchWorkerMcp(mcp, workspace, runId) {
  const dispatch = await mcp.tool("cw_dispatch", { cwd: workspace, runId, limit: 1 });
  const task = dispatch.tasks[0];
  assert.ok(task?.workerId, `${runId}: MCP dispatch produced no worker id`);
  assert.ok(task.workerResultPath, `${runId}: MCP dispatch produced no worker result path`);
  return {
    workerId: task.workerId,
    taskId: task.id,
    resultPath: task.workerResultPath
  };
}

function workerOutputCli(workspace, runId, worker) {
  writeParityResult(worker.resultPath);
  runCli(["worker", "output", runId, worker.workerId, worker.resultPath], workspace);
  return worker;
}

async function workerOutputMcp(mcp, workspace, runId, worker) {
  writeParityResult(worker.resultPath);
  await mcp.tool("cw_worker_output", { cwd: workspace, runId, workerId: worker.workerId, resultPath: worker.resultPath });
  return worker;
}

function verifiedWorkerCli(workspace, runId) {
  return workerOutputCli(workspace, runId, dispatchWorkerCli(workspace, runId));
}

async function verifiedWorkerMcp(mcp, workspace, runId) {
  return workerOutputMcp(mcp, workspace, runId, await dispatchWorkerMcp(mcp, workspace, runId));
}

function registerCandidateCli(workspace, runId, worker, candidateId = "parity-candidate") {
  runCli(["candidate", "register", runId, "--id", candidateId, "--worker", worker.workerId, "--kind", "worker-output"], workspace);
  return { candidateId, worker };
}

async function registerCandidateMcp(mcp, workspace, runId, worker, candidateId = "parity-candidate") {
  await mcp.tool("cw_candidate_register", { cwd: workspace, runId, id: candidateId, worker: worker.workerId, kind: "worker-output" });
  return { candidateId, worker };
}

function scoreCandidateCli(workspace, runId, candidateId) {
  return runCli([
    "candidate",
    "score",
    runId,
    candidateId,
    "--criterion",
    "correctness=4",
    "--criterion",
    "evidence=4",
    "--criterion",
    "fit=2",
    "--max",
    "10",
    "--evidence",
    "README.md:1",
    "--notes",
    "parity score",
    "--scorer",
    "parity"
  ], workspace);
}

async function scoreCandidateMcp(mcp, workspace, runId, candidateId) {
  return mcp.tool("cw_candidate_score", {
    cwd: workspace,
    runId,
    candidateId,
    criterion: ["correctness=4", "evidence=4", "fit=2"],
    max: 10,
    evidence: ["README.md:1"],
    notes: "parity score",
    scorer: "parity"
  });
}

function failedWorkerFeedbackCli(workspace, runId) {
  const worker = dispatchWorkerCli(workspace, runId);
  const failed = runCli([
    "worker",
    "fail",
    runId,
    worker.workerId,
    "parity failure",
    "--code",
    "runtime-error",
    "--path",
    readmePath(workspace)
  ], workspace);
  const feedbackId = failed.feedbackIds?.[0];
  assert.ok(feedbackId, `${runId}: worker failure produced no feedback id`);
  return { worker, feedbackId };
}

async function failedWorkerFeedbackMcp(mcp, workspace, runId) {
  const worker = await dispatchWorkerMcp(mcp, workspace, runId);
  const failed = await mcp.tool("cw_worker_fail", {
    cwd: workspace,
    runId,
    workerId: worker.workerId,
    message: "parity failure",
    code: "runtime-error",
    path: readmePath(workspace)
  });
  const feedbackId = failed.feedbackIds?.[0];
  assert.ok(feedbackId, `${runId}: MCP worker failure produced no feedback id`);
  return { worker, feedbackId };
}

function seedFailedNode(workspace, runId) {
  const run = loadRunFromCwd(runId, workspace);
  const nodeId = `${run.id}:parity:failed-node`;
  if (!(run.nodes || []).some((node) => node.id === nodeId)) {
    appendRunNode(run, createStateNode({
      id: nodeId,
      kind: "error",
      status: "failed",
      loopStage: "adjust",
      errors: [{
        code: "runtime-error",
        message: "parity collect failure",
        at: "2020-01-01T00:00:00.000Z",
        path: readmePath(workspace),
        retryable: false
      }],
      metadata: { pipelineStage: "parity" }
    }));
    saveCheckpoint(run);
  }
  return nodeId;
}

function seedVerifiedNode(workspace, runId) {
  const run = loadRunFromCwd(runId, workspace);
  const nodeId = `${run.id}:parity:verified-node`;
  if (!(run.nodes || []).some((node) => node.id === nodeId)) {
    appendRunNode(run, createStateNode({
      id: nodeId,
      kind: "verifier",
      status: "verified",
      loopStage: "adjust",
      evidence: [{ id: "parity:verified", source: "test", locator: "README.md:1" }]
    }));
    saveCheckpoint(run);
  }
  return nodeId;
}

function sandboxProfileFile(workspace) {
  const profileFile = path.join(workspace, "parity-sandbox-profile.json");
  const profile = {
    schemaVersion: 1,
    id: "parity-readonly",
    title: "Parity Readonly",
    description: "Local sandbox profile fixture for CLI/MCP parity.",
    readPaths: ["$cwd"],
    writePaths: [],
    workerOutput: { result: true, artifacts: true, logs: true },
    execute: { mode: "none" },
    network: { mode: "none" },
    env: { inherit: false, expose: [] },
    hostInstructions: ["Used only by the parity check."]
  };
  fs.writeFileSync(profileFile, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  return profileFile;
}

function applyTopologyCli(workspace, runId) {
  return runCli([
    "topology",
    "apply",
    runId,
    "map-reduce",
    "--id",
    "parity-map",
    "--mapper-count",
    "2",
    "--task",
    "map:server-api",
    "--task",
    "map:web-client"
  ], workspace);
}

async function applyTopologyMcp(mcp, workspace, runId) {
  return mcp.tool("cw_topology_apply", {
    cwd: workspace,
    runId,
    topologyId: "map-reduce",
    id: "parity-map",
    mapperCount: 2,
    task: ["map:server-api", "map:web-client"]
  });
}

function refreshSummaryCli(workspace, runId) {
  return runCli(["summary", "refresh", runId, "--json"], workspace);
}

async function refreshSummaryMcp(mcp, workspace, runId) {
  return mcp.tool("cw_summary_refresh", { cwd: workspace, runId });
}

function scenarioWorkspacePair(capability) {
  const slug = capability.replace(/[^a-z0-9]+/gi, "-");
  return {
    cliWorkspace: makeWorkspace(`${slug}-cli`),
    mcpWorkspace: makeWorkspace(`${slug}-mcp`)
  };
}

const RUNLESS_SCENARIOS = new Set([
  "plan",
  "app.show",
  "app.validate",
  "app.package",
  "topology.show",
  "topology.validate",
  "sandbox.show",
  "sandbox.validate",
  "sandbox.choose",
  "sandbox.resolve"
]);

const TOPOLOGY_SCENARIOS = new Set(["topology.apply", "topology.summary", "topology.graph"]);

function prepareRegisteredCandidateCli(workspace, runId, candidateId = "parity-candidate") {
  return registerCandidateCli(workspace, runId, verifiedWorkerCli(workspace, runId), candidateId);
}

async function prepareRegisteredCandidateMcp(mcp, workspace, runId, candidateId = "parity-candidate") {
  return registerCandidateMcp(mcp, workspace, runId, await verifiedWorkerMcp(mcp, workspace, runId), candidateId);
}

function prepareScoredCandidateCli(workspace, runId, candidateId = "parity-candidate") {
  const candidate = prepareRegisteredCandidateCli(workspace, runId, candidateId);
  scoreCandidateCli(workspace, runId, candidate.candidateId);
  return candidate;
}

async function prepareScoredCandidateMcp(mcp, workspace, runId, candidateId = "parity-candidate") {
  const candidate = await prepareRegisteredCandidateMcp(mcp, workspace, runId, candidateId);
  await scoreCandidateMcp(mcp, workspace, runId, candidate.candidateId);
  return candidate;
}

function prepareScenarioCli(capability, workspace, runId) {
  switch (capability) {
    case "worker.list":
    case "worker.show":
    case "worker.manifest":
    case "worker.validate":
    case "worker.fail":
      return { worker: dispatchWorkerCli(workspace, runId) };
    case "worker.output": {
      const worker = dispatchWorkerCli(workspace, runId);
      writeParityResult(worker.resultPath);
      return { worker };
    }
    case "candidate.register":
      return { worker: verifiedWorkerCli(workspace, runId), candidateId: "parity-candidate" };
    case "candidate.list":
    case "candidate.show":
    case "candidate.score":
    case "candidate.reject":
      return prepareRegisteredCandidateCli(workspace, runId);
    case "candidate.rank":
    case "candidate.select":
      return prepareScoredCandidateCli(workspace, runId);
    case "feedback.collect":
      return { failedNodeId: seedFailedNode(workspace, runId) };
    case "feedback.list":
    case "feedback.show":
    case "feedback.task":
      return failedWorkerFeedbackCli(workspace, runId);
    case "feedback.resolve": {
      const feedback = failedWorkerFeedbackCli(workspace, runId);
      return { ...feedback, verifierNodeId: seedVerifiedNode(workspace, runId) };
    }
    default:
      return {};
  }
}

async function prepareScenarioMcp(capability, mcp, workspace, runId) {
  switch (capability) {
    case "worker.list":
    case "worker.show":
    case "worker.manifest":
    case "worker.validate":
    case "worker.fail":
      return { worker: await dispatchWorkerMcp(mcp, workspace, runId) };
    case "worker.output": {
      const worker = await dispatchWorkerMcp(mcp, workspace, runId);
      writeParityResult(worker.resultPath);
      return { worker };
    }
    case "candidate.register":
      return { worker: await verifiedWorkerMcp(mcp, workspace, runId), candidateId: "parity-candidate" };
    case "candidate.list":
    case "candidate.show":
    case "candidate.score":
    case "candidate.reject":
      return prepareRegisteredCandidateMcp(mcp, workspace, runId);
    case "candidate.rank":
    case "candidate.select":
      return prepareScoredCandidateMcp(mcp, workspace, runId);
    case "feedback.collect":
      return { failedNodeId: seedFailedNode(workspace, runId) };
    case "feedback.list":
    case "feedback.show":
    case "feedback.task":
      return failedWorkerFeedbackMcp(mcp, workspace, runId);
    case "feedback.resolve": {
      const feedback = await failedWorkerFeedbackMcp(mcp, workspace, runId);
      return { ...feedback, verifierNodeId: seedVerifiedNode(workspace, runId) };
    }
    default:
      return {};
  }
}

function runScenarioCli(capability, workspace, runId, context = {}) {
  switch (capability) {
    case "plan":
      return runCli(["plan", "end-to-end-golden-path", "--question", "CLI/MCP scenario payload parity"], workspace);
    case "app.show":
      return runCli(["app", "show", "end-to-end-golden-path"], workspace);
    case "app.validate":
      return runCli(["app", "validate", "end-to-end-golden-path"], workspace);
    case "app.package":
      return runCli(["app", "package", "end-to-end-golden-path"], workspace);
    case "topology.show":
      return runCli(["topology", "show", "map-reduce"], workspace);
    case "topology.validate":
      return runCli(["topology", "validate", "map-reduce"], workspace);
    case "topology.apply":
      return applyTopologyCli(workspace, runId);
    case "topology.summary":
      return runCli(["topology", "summary", runId, "--json"], workspace);
    case "topology.graph":
      return runCli(["topology", "graph", runId, "--json"], workspace);
    case "summary.refresh":
      return refreshSummaryCli(workspace, runId);
    case "summary.show":
      return runCli(["summary", "show", runId, "--json"], workspace);
    case "sandbox.show":
      return runCli(["sandbox", "show", "readonly"], workspace);
    case "sandbox.validate":
      return runCli(["sandbox", "validate", sandboxProfileFile(workspace)], workspace);
    case "sandbox.choose":
      return runCli(["sandbox", "choose", "readonly"], workspace);
    case "sandbox.resolve":
      return runCli(["sandbox", "resolve", "readonly"], workspace);
    case "approve":
      return runCli(["approve", "run", runId, runId, "--actor", "parity-operator", "--role", "reviewer", "--rationale", "scenario approval"], workspace);
    case "reject":
      return runCli(["reject", "run", runId, runId, "--actor", "parity-operator", "--role", "reviewer", "--reason", "scenario rejection"], workspace);
    case "comment.add":
      return runCli(["comment", "add", "run", runId, runId, "--body", "scenario comment", "--actor", "parity-operator", "--role", "reviewer"], workspace);
    case "handoff":
      return runCli(["handoff", "run", runId, runId, "--from", "parity-operator", "--to", "parity-peer", "--reason", "scenario handoff"], workspace);
    case "review.policy":
      return runCli([
        "review",
        "policy",
        runId,
        "--required-approvals",
        "2",
        "--authorized-roles",
        "reviewer,lead",
        "--applies-to",
        "commit,selection",
        "--allow-self-approval"
      ], workspace);
    case "worker.list":
      return runCli(["worker", "list", runId], workspace);
    case "worker.show":
      return runCli(["worker", "show", runId, context.worker.workerId], workspace);
    case "worker.manifest":
      return runCli(["worker", "manifest", runId, context.worker.workerId], workspace);
    case "worker.output":
      return runCli(["worker", "output", runId, context.worker.workerId, context.worker.resultPath], workspace);
    case "worker.fail":
      return runCli(["worker", "fail", runId, context.worker.workerId, "parity failure", "--code", "runtime-error", "--path", readmePath(workspace)], workspace);
    case "worker.validate":
      return runCli(["worker", "validate", runId, context.worker.workerId, context.worker.resultPath], workspace);
    case "candidate.list":
      return runCli(["candidate", "list", runId], workspace);
    case "candidate.show":
      return runCli(["candidate", "show", runId, context.candidateId], workspace);
    case "candidate.register":
      return runCli(["candidate", "register", runId, "--id", context.candidateId, "--worker", context.worker.workerId, "--kind", "worker-output"], workspace);
    case "candidate.score":
      return scoreCandidateCli(workspace, runId, context.candidateId);
    case "candidate.rank":
      return runCli(["candidate", "rank", runId], workspace);
    case "candidate.select":
      return runCli(["candidate", "select", runId, context.candidateId, "--reason", "parity selected", "--selectedBy", "parity"], workspace);
    case "candidate.reject":
      return runCli(["candidate", "reject", runId, context.candidateId, "--reason", "parity rejected"], workspace);
    case "feedback.list":
      return runCli(["feedback", "list", runId], workspace);
    case "feedback.show":
      return runCli(["feedback", "show", runId, context.feedbackId], workspace);
    case "feedback.collect":
      return runCli(["feedback", "collect", runId], workspace);
    case "feedback.task":
      return runCli(["feedback", "task", runId, context.feedbackId, "--verify", "npm test"], workspace);
    case "feedback.resolve":
      return runCli(["feedback", "resolve", runId, context.feedbackId, "--status", "resolved", "--node", context.verifierNodeId, "--message", "parity resolved"], workspace);
    default:
      throw new Error(`No CLI payload scenario for ${capability}`);
  }
}

async function runScenarioMcp(capability, mcp, workspace, runId, context = {}) {
  switch (capability) {
    case "plan":
      return mcp.tool("cw_plan", { cwd: workspace, workflowId: "end-to-end-golden-path", question: "CLI/MCP scenario payload parity" });
    case "app.show":
      return mcp.tool("cw_app_show", { cwd: workspace, appId: "end-to-end-golden-path" });
    case "app.validate":
      return mcp.tool("cw_app_validate", { cwd: workspace, appId: "end-to-end-golden-path" });
    case "app.package":
      return mcp.tool("cw_app_package", { cwd: workspace, appId: "end-to-end-golden-path" });
    case "topology.show":
      return mcp.tool("cw_topology_show", { cwd: workspace, topologyId: "map-reduce" });
    case "topology.validate":
      return mcp.tool("cw_topology_validate", { cwd: workspace, topologyId: "map-reduce" });
    case "topology.apply":
      return applyTopologyMcp(mcp, workspace, runId);
    case "topology.summary":
      return mcp.tool("cw_topology_summary", { cwd: workspace, runId });
    case "topology.graph":
      return mcp.tool("cw_topology_graph", { cwd: workspace, runId });
    case "summary.refresh":
      return refreshSummaryMcp(mcp, workspace, runId);
    case "summary.show":
      return mcp.tool("cw_summary_show", { cwd: workspace, runId });
    case "sandbox.show":
      return mcp.tool("cw_sandbox_show", { cwd: workspace, profileId: "readonly" });
    case "sandbox.validate":
      return mcp.tool("cw_sandbox_validate", { cwd: workspace, profileFile: sandboxProfileFile(workspace) });
    case "sandbox.choose":
      return mcp.tool("cw_sandbox_choose", { cwd: workspace, profileId: "readonly" });
    case "sandbox.resolve":
      return mcp.tool("cw_sandbox_resolve", { cwd: workspace, profileId: "readonly" });
    case "approve":
      return mcp.tool("cw_approve", { cwd: workspace, runId, targetKind: "run", targetId: runId, actor: "parity-operator", role: "reviewer", rationale: "scenario approval" });
    case "reject":
      return mcp.tool("cw_reject", { cwd: workspace, runId, targetKind: "run", targetId: runId, actor: "parity-operator", role: "reviewer", reason: "scenario rejection" });
    case "comment.add":
      return mcp.tool("cw_comment_add", { cwd: workspace, runId, targetKind: "run", targetId: runId, body: "scenario comment", actor: "parity-operator", role: "reviewer" });
    case "handoff":
      return mcp.tool("cw_handoff", { cwd: workspace, runId, targetKind: "run", targetId: runId, from: "parity-operator", to: "parity-peer", reason: "scenario handoff" });
    case "review.policy":
      return mcp.tool("cw_review_policy", {
        cwd: workspace,
        runId,
        requiredApprovals: 2,
        authorizedRoles: "reviewer,lead",
        appliesTo: "commit,selection",
        allowSelfApproval: true
      });
    case "worker.list":
      return mcp.tool("cw_worker_list", { cwd: workspace, runId });
    case "worker.show":
      return mcp.tool("cw_worker_show", { cwd: workspace, runId, workerId: context.worker.workerId });
    case "worker.manifest":
      return mcp.tool("cw_worker_manifest", { cwd: workspace, runId, workerId: context.worker.workerId });
    case "worker.output":
      return mcp.tool("cw_worker_output", { cwd: workspace, runId, workerId: context.worker.workerId, resultPath: context.worker.resultPath });
    case "worker.fail":
      return mcp.tool("cw_worker_fail", { cwd: workspace, runId, workerId: context.worker.workerId, message: "parity failure", code: "runtime-error", path: readmePath(workspace) });
    case "worker.validate":
      return mcp.tool("cw_worker_validate", { cwd: workspace, runId, workerId: context.worker.workerId, resultPath: context.worker.resultPath });
    case "candidate.list":
      return mcp.tool("cw_candidate_list", { cwd: workspace, runId });
    case "candidate.show":
      return mcp.tool("cw_candidate_show", { cwd: workspace, runId, candidateId: context.candidateId });
    case "candidate.register":
      return mcp.tool("cw_candidate_register", { cwd: workspace, runId, id: context.candidateId, worker: context.worker.workerId, kind: "worker-output" });
    case "candidate.score":
      return scoreCandidateMcp(mcp, workspace, runId, context.candidateId);
    case "candidate.rank":
      return mcp.tool("cw_candidate_rank", { cwd: workspace, runId });
    case "candidate.select":
      return mcp.tool("cw_candidate_select", { cwd: workspace, runId, candidateId: context.candidateId, reason: "parity selected", selectedBy: "parity" });
    case "candidate.reject":
      return mcp.tool("cw_candidate_reject", { cwd: workspace, runId, candidateId: context.candidateId, reason: "parity rejected" });
    case "feedback.list":
      return mcp.tool("cw_feedback_list", { cwd: workspace, runId });
    case "feedback.show":
      return mcp.tool("cw_feedback_show", { cwd: workspace, runId, feedbackId: context.feedbackId });
    case "feedback.collect":
      return mcp.tool("cw_feedback_collect", { cwd: workspace, runId });
    case "feedback.task":
      return mcp.tool("cw_feedback_task", { cwd: workspace, runId, feedbackId: context.feedbackId, verify: "npm test" });
    case "feedback.resolve":
      return mcp.tool("cw_feedback_resolve", { cwd: workspace, runId, feedbackId: context.feedbackId, status: "resolved", node: context.verifierNodeId, message: "parity resolved" });
    default:
      throw new Error(`No MCP payload scenario for ${capability}`);
  }
}

async function executeScenario(target, mcp) {
  const { cliWorkspace, mcpWorkspace } = scenarioWorkspacePair(target.capability);
  if (RUNLESS_SCENARIOS.has(target.capability)) {
    const cliOut = runScenarioCli(target.capability, cliWorkspace);
    const mcpOut = await runScenarioMcp(target.capability, mcp, mcpWorkspace);
    return {
      cliPayload: canonicalScenario(cliOut, {
        workspaceRoots: [cliWorkspace],
        runIds: cliOut.runId ? [cliOut.runId] : []
      }),
      mcpPayload: canonicalScenario(mcpOut, {
        workspaceRoots: [mcpWorkspace],
        runIds: mcpOut.runId ? [mcpOut.runId] : []
      })
    };
  }

  const cliPlan = TOPOLOGY_SCENARIOS.has(target.capability) ? bootstrapTopologyRun(cliWorkspace) : bootstrapRun(cliWorkspace);
  const mcpPlan = TOPOLOGY_SCENARIOS.has(target.capability) ? bootstrapTopologyRun(mcpWorkspace) : bootstrapRun(mcpWorkspace);
  if (target.capability === "topology.summary" || target.capability === "topology.graph") {
    applyTopologyCli(cliWorkspace, cliPlan.runId);
    await applyTopologyMcp(mcp, mcpWorkspace, mcpPlan.runId);
  }
  if (target.capability === "summary.show") {
    refreshSummaryCli(cliWorkspace, cliPlan.runId);
    await refreshSummaryMcp(mcp, mcpWorkspace, mcpPlan.runId);
  }
  const cliContext = prepareScenarioCli(target.capability, cliWorkspace, cliPlan.runId);
  const mcpContext = await prepareScenarioMcp(target.capability, mcp, mcpWorkspace, mcpPlan.runId);
  const cliOut = runScenarioCli(target.capability, cliWorkspace, cliPlan.runId, cliContext);
  const mcpOut = await runScenarioMcp(target.capability, mcp, mcpWorkspace, mcpPlan.runId, mcpContext);
  return {
    cliPayload: canonicalScenario(cliOut, {
      workspaceRoots: [cliWorkspace],
      runIds: [cliPlan.runId]
    }),
    mcpPayload: canonicalScenario(mcpOut, {
      workspaceRoots: [mcpWorkspace],
      runIds: [mcpPlan.runId]
    })
  };
}

function openMcp() {
  const server = spawn(node, [mcpServer], { cwd: pluginRoot, stdio: ["pipe", "pipe", "pipe"] });
  const lines = readline.createInterface({ input: server.stdout });
  const pending = new Map();
  let nextId = 1;
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const rpc = (method, params) => {
    const id = nextId++;
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const tool = (name, args) => rpc("tools/call", { name, arguments: args }).then((result) => JSON.parse(result.content[0].text));
  return { server, rpc, tool };
}

async function payloadParity() {
  // realpath so the CLI (which realpath-resolves its cwd) and the MCP server we
  // hand `cwd` to observe identical absolute paths — a workspace symlink would
  // otherwise masquerade as a payload divergence.
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-parity-")));
  const plan = JSON.parse(
    execFileSync(node, [cli, "plan", "architecture-review", "--repo", workspace, "--question", "v0.1.27 CLI<->MCP parity probe"], {
      cwd: workspace,
      encoding: "utf8"
    })
  );
  const runId = plan.runId;
  const mismatches = [];
  const checked = [];
  const probePlan = registry.payloadProbePlan();
  assert.deepEqual(probePlan.unclassified, [], "payload probe classification has unclassified capabilities");
  assert.deepEqual(probePlan.duplicateClassifications, [], "payload probe classification has duplicates");
  assert.deepEqual(probePlan.invalidClassifications, [], "payload probe classification names non-payload capabilities");
  const mcp = openMcp();
  try {
    await mcp.rpc("initialize", {});
    for (const target of registry.payloadProbeTargets()) {
      const cap = capById(target.capability);
      if (target.kind === "scenario") {
        const result = await executeScenario(target, mcp);
        checked.push(target.capability);
        if (result.cliPayload !== result.mcpPayload) mismatches.push(target.capability);
        continue;
      }
      // jsonMode is the single source for the CLI's --json policy; this probe only
      // appends --json for "flag" verbs and JSON.parse-es the result. The human
      // rendering and "default"-verb no-flag JSON are pinned to cap.cli.jsonMode by
      // the companion test/cli-jsonmode-parity-smoke.js, so cli.ts can't silently
      // re-encode that policy by hand and drift from this registry data.
      if (target.kind !== "global" && target.kind !== "run") throw new Error(`Unknown payload probe target kind: ${target.kind}`);
      const cliArgv = target.kind === "run"
        ? [...cap.cli.path, runId, ...jsonFlag(cap)]
        : [...cap.cli.path, ...jsonFlag(cap)];
      const cliOut = runCli(cliArgv, workspace);
      const mcpArgs = target.kind === "run" ? { cwd: workspace, runId } : { cwd: workspace };
      const mcpOut = await mcp.tool(cap.mcp.tool, mcpArgs);
      checked.push(target.capability);
      if (canonical(cliOut) !== canonical(mcpOut)) mismatches.push(target.capability);
    }
  } finally {
    mcp.server.kill();
  }
  return { runId, checked, mismatches };
}

async function main() {
  const check = process.argv.includes("--check");
  const tools = liveMcpTools();
  const tokens = cliDispatchTokens();
  const helpTokens = cliHelpTokens();
  const report = registry.buildParityReport({ mcpTools: tools, cliTokens: tokens, helpTokens });
  const payload = await payloadParity();

  const ok = report.ok && payload.mismatches.length === 0;
  const out = {
    ok,
    static: report,
    payload: {
      ok: payload.mismatches.length === 0,
      runId: payload.runId,
      checked: payload.checked.length,
      capabilities: payload.checked,
      mismatches: payload.mismatches
    }
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);

  if (check && !ok) {
    const lines = ["", "CLI <-> MCP parity drift detected (release-blocking):"];
    if (report.missingMcpTools.length) lines.push(`  - registry declares MCP tools absent from the server: ${report.missingMcpTools.join(", ")}`);
    if (report.undeclaredMcpTools.length) lines.push(`  - server exposes MCP tools not declared in the registry: ${report.undeclaredMcpTools.join(", ")}`);
    if (report.missingCliTokens.length) lines.push(`  - registry declares CLI tokens absent from dist/cli.js: ${report.missingCliTokens.join(", ")}`);
    if (report.undeclaredCliTokens.length) lines.push(`  - dist/cli.js dispatches tokens not declared in the registry: ${report.undeclaredCliTokens.join(", ")}`);
    if (report.helpMissingCliTokens.length) lines.push(`  - registry declares CLI commands absent from cw help: ${report.helpMissingCliTokens.join(", ")}`);
    if (report.helpUndeclaredCliTokens.length) lines.push(`  - cw help lists commands not declared in the registry: ${report.helpUndeclaredCliTokens.join(", ")}`);
    if (report.reasonlessExceptions.length) lines.push(`  - surface-specific / payload-divergent capabilities missing a recorded reason: ${report.reasonlessExceptions.join(", ")}`);
    if (report.payloadProbeUnclassified.length) lines.push(`  - payload-identical capabilities neither probed nor deferred: ${report.payloadProbeUnclassified.join(", ")}`);
    if (report.payloadProbeDuplicateClassifications.length) lines.push(`  - payload probe duplicate classifications: ${report.payloadProbeDuplicateClassifications.join(", ")}`);
    if (report.payloadProbeInvalidClassifications.length) lines.push(`  - payload probe classifications for invalid capabilities: ${report.payloadProbeInvalidClassifications.join(", ")}`);
    if (report.registryLint.length) lines.push(`  - registry lint: ${report.registryLint.join("; ")}`);
    if (payload.mismatches.length) lines.push(`  - cw --json != cw_<tool> payload for: ${payload.mismatches.join(", ")}`);
    lines.push("Reconcile src/capability-registry.ts, cli.ts, and mcp-server.ts so both surfaces render one data source.\n");
    process.stderr.write(lines.join("\n"));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`parity-check: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
