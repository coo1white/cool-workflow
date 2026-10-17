#!/usr/bin/env node
// legacy-multi-agent-state-smoke — a run state written by a CW that still had
// the multi-agent family (multi-agent runtime, blackboard, topologies,
// candidates and selections, the review gate) must still load and run after
// that family was taken out (slim-and-esm program, step 2, decision D1).
//
// It plans a real run, then writes into its state.json and run folder the
// records an older CW left behind: multiAgent runs/roles/groups/memberships/
// fanouts/fanins, a blackboard with topics and messages, a topology run,
// candidates and a candidate selection, a task's multiAgent attachment, a
// dispatch's multiAgent block, and an old commit with candidate/selection
// ids, an acceptance rationale and review provenance. Every kept command
// that reads a run must then work on it — state check, status, operator
// status, graph, report, workbench view, audit summary, run resume — and the
// run must still go forward (dispatch -> worker output -> verifier-gated
// commit). The old records stay in state.json as data, untouched.
//
// Consumer: test/run-all.mjs (auto-discovered smoke). Doc:
// docs/release-and-migration.7.md, "Removed Surfaces".

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const node = process.execPath;
const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-legacy-ma-state-")));
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-legacy-ma-home-")));
const env = { ...process.env, CW_HOME: path.join(home, ".cw"), XDG_STATE_HOME: path.join(home, ".state"), CW_NO_AUTO_AGENT: "1", NO_COLOR: "1" };
fs.writeFileSync(path.join(repo, "README.md"), "# legacy state fixture\n", "utf8");
const evidenceLocator = `${path.join(repo, "README.md")}:1`;

function run(args) {
  return execFileSync(node, [cli, ...args], { cwd: repo, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
}
function runJson(args) {
  return JSON.parse(run(args));
}

// ---- 1. A real run, then the legacy records an older CW wrote. ------------
const plan = runJson(["plan", "end-to-end-golden-path", "--repo", repo, "--question", "Load a legacy multi-agent state."]);
const runId = plan.runId;
const statePath = plan.statePath;
const runDir = path.dirname(statePath);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const taskId = state.tasks[0].id;
const at = "2026-09-01T00:00:00.000Z";

state.multiAgent = {
  schemaVersion: 1,
  runs: [{ schemaVersion: 1, id: "mar-0001", runId, title: "Legacy multi-agent run", objective: "old", status: "running", createdAt: at, updatedAt: at, lifecycle: [] }],
  roles: [{ schemaVersion: 1, id: "role-mapper", multiAgentRunId: "mar-0001", title: "Mapper", responsibilities: ["map"], requiredEvidence: [], createdAt: at, updatedAt: at }],
  groups: [{ schemaVersion: 1, id: "group-map", multiAgentRunId: "mar-0001", title: "Map", status: "running", roleIds: ["role-mapper"], taskIds: [taskId], createdAt: at, updatedAt: at, lifecycle: [] }],
  memberships: [{ schemaVersion: 1, id: "membership-0001", multiAgentRunId: "mar-0001", groupId: "group-map", roleId: "role-mapper", taskId, status: "assigned", evidenceRefs: [], createdAt: at, updatedAt: at, lifecycle: [] }],
  fanouts: [{ schemaVersion: 1, id: "fanout-0001", multiAgentRunId: "mar-0001", groupId: "group-map", roleIds: ["role-mapper"], taskIds: [taskId], dispatchIds: [], workerIds: [], membershipIds: ["membership-0001"], status: "running", createdAt: at, updatedAt: at }],
  fanins: [{ schemaVersion: 1, id: "fanin-0001", multiAgentRunId: "mar-0001", groupId: "group-map", fanoutId: "fanout-0001", status: "blocked", blockedReasons: ["legacy"], createdAt: at, updatedAt: at }],
};
state.blackboard = {
  schemaVersion: 1,
  id: "bb-0001",
  topics: [{ schemaVersion: 1, id: "topic-0001", blackboardId: "bb-0001", title: "Legacy topic", createdAt: at }],
  messages: [{ schemaVersion: 1, id: "msg-0001", topicId: "topic-0001", body: "LEGACY_BLACKBOARD_MESSAGE", createdAt: at }],
  contexts: [],
  artifacts: [],
  snapshots: [],
  decisions: [],
};
state.topologies = { schemaVersion: 1, runs: [{ schemaVersion: 1, id: "legacy-map-reduce", topologyId: "map-reduce", runId, multiAgentRunId: "mar-0001", createdAt: at }] };
state.candidates = [{ schemaVersion: 1, id: "candidate-legacy", runId, kind: "worker-output", status: "verified", taskId, scores: ["score-legacy"], evidence: [{ id: "legacy:1", source: "test", locator: evidenceLocator }], createdAt: at, updatedAt: at }];
state.candidateSelections = [{ schemaVersion: 1, id: "selection-legacy", runId, candidateId: "candidate-legacy", scoreId: "score-legacy", reason: "legacy pick", evidence: [], selectedAt: at, acceptanceRationale: { schemaVersion: 1, selectedCandidateId: "candidate-legacy", scoreId: "score-legacy", evidenceCount: 1, commitGateResult: "passed", auditEventIds: [] } }];
state.tasks[0].multiAgent = { runId: "mar-0001", groupId: "group-map", roleId: "role-mapper", membershipId: "membership-0001", fanoutId: "fanout-0001" };
state.commits.push({
  id: "state-legacy",
  createdAt: at,
  reason: "legacy candidate commit",
  loopStage: "checkpoint",
  statePath,
  reportPath: plan.reportPath,
  snapshotPath: path.join(runDir, "commits", "state-legacy.json"),
  verifierGated: false,
  checkpoint: true,
  candidateId: "candidate-legacy",
  selectionId: "selection-legacy",
  evidence: [],
  acceptanceRationale: { schemaVersion: 1, selectedCandidateId: "candidate-legacy", scoreId: "score-legacy", evidenceCount: 1, commitGateResult: "passed", auditEventIds: [] },
  review: { policyId: "legacy-review", approvals: [] },
  metadata: {},
});
fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
for (const dir of ["multi-agent", "blackboard", "candidates", "topologies"]) {
  fs.mkdirSync(path.join(runDir, dir), { recursive: true });
  fs.writeFileSync(path.join(runDir, dir, "index.json"), `${JSON.stringify({ schemaVersion: 1, legacy: dir })}\n`, "utf8");
}

// ---- 2. Every kept read command loads it. ---------------------------------
const check = runJson(["state", "check", runId]);
assert.notEqual(check.status, "unsupported", `a legacy multi-agent state must stay supported: ${JSON.stringify(check.errors)}`);
assert.deepEqual(check.errors || [], [], "a legacy multi-agent state must load with no errors");

const status = runJson(["status", runId, "--json"]);
assert.equal(status.runId, runId);
assert.equal(status.tasks.pending, 1);

const operator = runJson(["operator", "status", runId, "--json"]);
assert.equal(operator.runId, runId);
for (const gone of ["candidates", "multiAgent", "multiAgentOperator", "multiAgentTrust", "blackboard"]) {
  assert.ok(!(gone in operator), `operator status must not carry the removed ${gone} key`);
}
assert.ok(!operator.nextActions.some((action) => /cw (candidate|multi-agent|blackboard|topology)/.test(action.command)), "no next action may point at a removed verb");

const graph = runJson(["graph", runId, "--json"]);
assert.ok(graph.nodes.some((entry) => entry.kind === "task"));
assert.ok(!graph.nodes.some((entry) => /^(candidate|selection|multi-agent-run|agent-|blackboard|topology)/.test(entry.kind)), "the graph must not draw removed multi-agent records");

const reportPath = run(["report", runId]).trim();
const report = fs.readFileSync(reportPath, "utf8");
assert.match(report, /## Trust Audit/);
for (const gone of ["## State Size & Compaction", "## Multi-Agent Runtime", "## Blackboard / Coordinator", "## Acceptance Rationale", "## Candidates"]) {
  assert.ok(!report.includes(gone), `report.md must not carry the removed "${gone}" part`);
}
assert.ok(!report.includes("LEGACY_BLACKBOARD_MESSAGE"), "report.md must not re-surface old blackboard text");

const view = runJson(["workbench", "view", runId, "--json"]);
assert.equal(view.resolved, true);
assert.deepEqual(Object.keys(view.panels), ["graph", "worker", "metrics", "audit"]);
for (const [group, members] of Object.entries(view.panels)) {
  for (const [member, panel] of Object.entries(members)) {
    assert.equal(panel.status, "present", `workbench ${group}.${member} must load on a legacy state: ${panel.error || ""}`);
  }
}

const audit = runJson(["audit", "summary", runId]);
assert.equal(audit.runId, runId);

const resume = runJson(["run", "resume", runId, "--scope", "repo", "--json"]);
assert.equal(resume.runId, runId);
assert.ok(!resume.nextActions.some((action) => /multi-agent/.test(action.command)), "run resume must not point at the removed multi-agent step");

// ---- 3. The legacy run still goes forward. --------------------------------
const dispatch = runJson(["dispatch", runId, "--limit", "1"]);
assert.equal(dispatch.tasks.length, 1);
assert.ok(!("multiAgent" in dispatch), "a dispatch manifest carries no multiAgent block");
const workerId = dispatch.tasks[0].workerId;
const manifest = runJson(["worker", "manifest", runId, workerId]);
assert.ok(!("multiAgent" in manifest) && !("blackboard" in manifest), "a worker manifest carries no multi-agent or blackboard block");
fs.writeFileSync(
  manifest.resultPath,
  ["# Legacy result", "", "```cw:result", JSON.stringify({ summary: "legacy run result", findings: [], evidence: [evidenceLocator] }), "```", ""].join("\n"),
  "utf8"
);
runJson(["worker", "output", runId, workerId, manifest.resultPath]);
const afterOutput = JSON.parse(fs.readFileSync(statePath, "utf8"));
const verifierNodeId = afterOutput.tasks[0].verifierNodeId;
assert.ok(verifierNodeId, "the legacy run's task reached the verify stage");
const committed = runJson(["commit", runId, "--verifier", verifierNodeId, "--reason", "legacy run commit"]);
assert.equal(committed.commit.verifierGated, true);
assert.ok(!("candidateId" in committed.commit) && !("review" in committed.commit), "a new commit carries no candidate or review fields");

// Old flags fail closed: a gated commit that names only a candidate or a
// selection no longer resolves a verifier.
const oldFlag = spawnSync(node, [cli, "commit", runId, "--selection", "selection-legacy"], { cwd: repo, encoding: "utf8", env });
assert.notEqual(oldFlag.status, 0, "cw commit --selection alone must fail closed");
assert.match(oldFlag.stderr, /Verifier-gated commit requires --verifier/);

// ---- 4. The old records are kept as data, untouched. ----------------------
const final = JSON.parse(fs.readFileSync(statePath, "utf8"));
assert.equal(final.multiAgent.runs[0].id, "mar-0001", "multiAgent records are kept");
assert.equal(final.multiAgent.memberships[0].status, "assigned", "a legacy membership is not driven by the accept path any more");
assert.equal(final.blackboard.messages[0].body, "LEGACY_BLACKBOARD_MESSAGE", "blackboard records are kept");
assert.equal(final.topologies.runs[0].id, "legacy-map-reduce", "topology records are kept");
assert.equal(final.candidates[0].id, "candidate-legacy", "candidate records are kept");
assert.equal(final.candidateSelections[0].id, "selection-legacy", "selection records are kept");
assert.equal(final.commits.find((entry) => entry.id === "state-legacy").selectionId, "selection-legacy", "an old commit keeps its selection id");
assert.ok(fs.existsSync(path.join(runDir, "blackboard", "index.json")), "an old blackboard folder is left in place");

fs.rmSync(repo, { recursive: true, force: true });
fs.rmSync(home, { recursive: true, force: true });
process.stdout.write("legacy-multi-agent-state-smoke: ok\n");
