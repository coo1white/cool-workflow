#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const mcpServer = path.join(pluginRoot, "dist", "mcp-server.js");
const node = process.execPath;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-ma-trust-policy-"));
const evidencePath = path.join(tmp, "trust-policy-evidence.md");
fs.writeFileSync(evidencePath, "trust policy evidence\n", "utf8");
const evidenceLocator = `${evidencePath}:1`;

(async () => {
  const plan = runJson(["plan", "architecture-review", "--repo", tmp, "--question", "Prove v0.1.22 multi-agent trust policy audit."]);
  assert.ok(fs.existsSync(plan.statePath));

  const hostRun = runJson([
    "multi-agent",
    "run",
    plan.runId,
    "--topology",
    "judge-panel",
    "--topology-run",
    "trust-panel",
    "--judge-count",
    "2",
    "--task",
    "map:server-api",
    "--task",
    "map:web-client"
  ]);
  assert.equal(hostRun.ids.topologyRunIds[0], "trust-panel");
  assert.ok(hostRun.paths.auditSummaryPath);

  const outsideTopic = runJson([
    "blackboard",
    "topic",
    "create",
    plan.runId,
    "--blackboard",
    "trust-panel-blackboard",
    "--id",
    "trust-panel-outside",
    "--title",
    "Outside Scope"
  ]);
  assert.equal(outsideTopic.id, "trust-panel-outside");

  const allowedMessage = runJson([
    "blackboard",
    "message",
    "post",
    plan.runId,
    "--topic",
    "trust-panel-judge-verdicts",
    "--blackboard",
    "trust-panel-blackboard",
    "--body",
    "Judge 1 rationale message with explicit evidence.",
    "--authorKind",
    "role",
    "--authorId",
    "trust-panel-judge-1",
    "--multi-agent-run",
    "trust-panel-ma",
    "--role",
    "trust-panel-judge-1",
    "--evidence",
    evidenceLocator,
    "--tag",
    "judge-rationale"
  ]);
  assert.equal(allowedMessage.author.kind, "role");
  assert.equal(allowedMessage.provenance.agentRoleId, "trust-panel-judge-1");
  assert.ok(allowedMessage.linkedAuditEventIds.length >= 3);

  const deniedWrite = runFail([
    "blackboard",
    "message",
    "post",
    plan.runId,
    "--topic",
    "trust-panel-outside",
    "--blackboard",
    "trust-panel-blackboard",
    "--body",
    "Judge 1 should not write outside its topology topics.",
    "--authorKind",
    "role",
    "--authorId",
    "trust-panel-judge-1",
    "--multi-agent-run",
    "trust-panel-ma",
    "--role",
    "trust-panel-judge-1",
    "--evidence",
    evidenceLocator
  ]);
  assert.match(deniedWrite.stderr, /outside policy|policy/);

  const firstDispatch = runJson(["multi-agent", "step", plan.runId, "--sandbox", "readonly"]);
  const firstWorkerId = firstDispatch.data.tasks[0].workerId;
  const firstManifest = runJson(["worker", "manifest", plan.runId, firstWorkerId]);
  assert.ok(firstManifest.multiAgent?.membershipId, "worker manifest keeps the dispatch membership attachment");
  const firstScope = JSON.parse(fs.readFileSync(firstManifest.scopePath, "utf8"));
  assert.equal(firstScope.multiAgent.membershipId, firstManifest.multiAgent.membershipId, "durable worker scope keeps the same membership attachment");
  writeWorkerResult(firstManifest.resultPath, "judge one");
  runJson(["worker", "output", plan.runId, firstWorkerId, firstManifest.resultPath]);

  const secondDispatch = runJson(["multi-agent", "step", plan.runId, "--sandbox", "readonly"]);
  const secondWorkerId = secondDispatch.data.tasks[0].workerId;
  const secondManifest = runJson(["worker", "manifest", plan.runId, secondWorkerId]);
  writeWorkerResult(secondManifest.resultPath, "judge two");
  runJson(["worker", "output", plan.runId, secondWorkerId, secondManifest.resultPath]);

  const fanin = runJson(["multi-agent", "step", plan.runId]);
  assert.equal(fanin.performed, "collected-fanin");
  assert.equal(fanin.data.status, "ready");
  const snapshot = runJson(["multi-agent", "step", plan.runId]);
  assert.equal(snapshot.performed, "created-blackboard-snapshot");
  const candidate = runJson(["multi-agent", "step", plan.runId, "--candidate", "trust-candidate"]);
  assert.equal(candidate.performed, "registered-candidate");

  const missingEvidence = runFail([
    "multi-agent",
    "score",
    plan.runId,
    "trust-candidate",
    "--role",
    "trust-panel-judge-1",
    "--criterion",
    "correctness=1"
  ]);
  assert.match(missingEvidence.stderr, /requires evidence/);

  const missingRationale = runFail([
    "multi-agent",
    "score",
    plan.runId,
    "trust-candidate",
    "--role",
    "trust-panel-judge-1",
    "--criterion",
    "correctness=1",
    "--evidence",
    evidenceLocator
  ]);
  assert.match(missingRationale.stderr, /requires rationale/);

  const score = runJson([
    "multi-agent",
    "score",
    plan.runId,
    "trust-candidate",
    "--role",
    "trust-panel-judge-1",
    "--multi-agent-run",
    "trust-panel-ma",
    "--criterion",
    "correctness=1",
    "--criterion",
    "evidence=1",
    "--evidence",
    evidenceLocator,
    "--rationale",
    "Judge 1 accepts the candidate because worker evidence and verifier evidence agree."
  ]);
  assert.equal(score.performed, "scored-candidate");

  const earlySelect = runFail([
    "multi-agent",
    "select",
    plan.runId,
    "trust-candidate",
    "--role",
    "trust-panel-panel-chair",
    "--multi-agent-run",
    "trust-panel-ma",
    "--score",
    score.data.id,
    "--reason",
    "missing selection evidence"
  ]);
  assert.match(earlySelect.stderr, /requires evidence refs|requires evidence/);

  const selection = runJson([
    "multi-agent",
    "select",
    plan.runId,
    "trust-candidate",
    "--role",
    "trust-panel-panel-chair",
    "--multi-agent-run",
    "trust-panel-ma",
    "--score",
    score.data.id,
    "--evidence",
    evidenceLocator,
    "--reason",
    "Panel chair selected the score-backed candidate with cited judge rationale."
  ]);
  assert.equal(selection.performed, "selected-candidate");
  assert.ok(selection.data.acceptanceRationale.auditEventIds.length >= 1);

  const commit = runJson(["commit", plan.runId, "--selection", selection.data.id, "--reason", "Trust policy smoke verifier-gated commit."]);
  assert.equal(commit.commit.verifierGated, true);

  const auditHuman = runText(["audit", "multi-agent", plan.runId]);
  for (const heading of [
    "Multi-Agent Trust",
    "Role Policies",
    "Permission Decisions",
    "Blackboard Write Audit",
    "Message Provenance",
    "Judge Rationales",
    "Policy Violations",
    "Next Action"
  ]) assert.match(auditHuman, new RegExp(heading));
  assert.match(auditHuman, /policy.violation/);

  const audit = runJson(["audit", "multi-agent", plan.runId, "--json"]);
  assert.ok(audit.rolePolicies.length >= 3);
  assert.ok(audit.permissionDecisions.some((event) => event.decision === "allowed"));
  assert.ok(audit.permissionDecisions.some((event) => event.decision === "denied"));
  assert.ok(audit.blackboardWrites.some((event) => event.blackboardMessageId === allowedMessage.id));
  assert.ok(audit.messageProvenance.some((event) => event.blackboardMessageId === allowedMessage.id));
  assert.ok(audit.judgeRationales.some((event) => event.decision === "accepted"));
  assert.ok(audit.panelDecisions.some((event) => event.decision === "accepted"));
  assert.ok(audit.policyViolations.length >= 1);

  const policyText = runText(["audit", "policy", plan.runId]);
  assert.match(policyText, /Role Policies/);
  assert.match(policyText, /Policy Violations/);
  const roleAudit = runJson(["audit", "role", plan.runId, "trust-panel-judge-1", "--json"]);
  assert.equal(roleAudit.roleId, "trust-panel-judge-1");
  assert.ok(roleAudit.rolePolicies.length >= 1);
  assert.ok(roleAudit.messageProvenance.length >= 1);
  const blackboardAudit = runJson(["audit", "blackboard", plan.runId, "--json"]);
  assert.ok(blackboardAudit.blackboardWrites.length >= 1);
  const judgeAudit = runJson(["audit", "judge", plan.runId, "--json"]);
  assert.ok(judgeAudit.judgeRationales.length >= 1);
  assert.ok(judgeAudit.panelDecisions.length >= 1);

  const provenance = runJson(["audit", "provenance", plan.runId, "--candidate", "trust-candidate"]);
  assert.ok(provenance.events.some((event) => event.kind === "candidate.selection"));
  assert.ok(provenance.events.some((event) => event.kind === "judge.rationale"));

  const report = runText(["report", plan.runId, "--show"]);
  assert.match(report, /Multi-Agent Trust/);
  assert.match(report, /Message Provenance/);
  assert.match(report, /Judge Rationales/);
  assert.match(report, /Policy Violations/);

  const mcp = await readMcp(plan.runId, "trust-panel-judge-1");
  for (const name of [
    "cw_audit_multi_agent",
    "cw_audit_policy",
    "cw_audit_role",
    "cw_audit_blackboard",
    "cw_audit_judge"
  ]) assert.ok(mcp.tools.has(name), `missing MCP tool ${name}`);
  assert.equal(mcp.multiAgent.policyViolations.length, audit.policyViolations.length);
  assert.equal(mcp.policy.rolePolicies.length, audit.rolePolicies.length);
  assert.equal(mcp.role.roleId, "trust-panel-judge-1");
  assert.equal(mcp.blackboard.messageProvenance.length, blackboardAudit.messageProvenance.length);
  assert.equal(mcp.judge.judgeRationales.length, judgeAudit.judgeRationales.length);

  process.stdout.write("multi-agent-trust-policy-audit-smoke: ok\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function writeWorkerResult(resultPath, label) {
  fs.writeFileSync(
    resultPath,
    [
      `# ${label}`,
      "",
      "Trust policy worker output.",
      "",
      "```cw:result",
      JSON.stringify({
        summary: `${label} completed with evidence.`,
        findings: [],
        evidence: [evidenceLocator]
      }),
      "```",
      ""
    ].join("\n"),
    "utf8"
  );
}

function runJson(args) {
  return JSON.parse(runText(args));
}

function runText(args) {
  return execFileSync(node, [cli, ...args], {
    cwd: tmp,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runFail(args) {
  const result = spawnSync(node, [cli, ...args], {
    cwd: tmp,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.notEqual(result.status, 0);
  return result;
}

function readMcp(runId, roleId) {
  const server = spawn(node, [mcpServer], {
    cwd: pluginRoot,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const lines = readline.createInterface({ input: server.stdout });
  const pending = new Map();
  let nextId = 1;
  lines.on("line", (line) => {
    const message = JSON.parse(line);
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
  const tool = (name, args) =>
    rpc("tools/call", { name, arguments: args }).then((result) => JSON.parse(result.content[0].text));
  return Promise.resolve()
    .then(() => rpc("initialize", {}))
    .then(() => rpc("tools/list", {}))
    .then((listed) => Promise.all([
      tool("cw_audit_multi_agent", { cwd: tmp, runId }),
      tool("cw_audit_policy", { cwd: tmp, runId }),
      tool("cw_audit_role", { cwd: tmp, runId, roleId }),
      tool("cw_audit_blackboard", { cwd: tmp, runId }),
      tool("cw_audit_judge", { cwd: tmp, runId })
    ]).then(([multiAgent, policy, role, blackboard, judge]) => ({
      tools: new Set(listed.tools.map((entry) => entry.name)),
      multiAgent,
      policy,
      role,
      blackboard,
      judge
    })))
    .finally(() => server.kill());
}
