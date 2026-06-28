"use strict";
// collaboration-ops-unit-smoke (v0.1.95) — unit coverage for the 4 uncovered
// orchestrator wrapper functions: collaborationApprove, collaborationComment,
// collaborationHandoff, reviewPolicy. These are thin wrappers around
// collaboration.ts primitives; this test proves they dispatch correctly and
// produce the expected side-effects (report written, state checkpointed).
//
// Hermetic: stub WorkflowRun in tmpdir, no real agent, no CLI, no MCP.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRunPaths, ensureRunDirs } = require("../dist/state");
const {
  collaborationApprove,
  collaborationComment,
  collaborationCommentList,
  collaborationHandoff,
  reviewPolicy
} = require("../dist/orchestrator/collaboration-operations");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-collab-ops-"));
const paths = createRunPaths(path.join(tmp, ".cw", "runs", "collab-ops-smoke"));
ensureRunDirs(paths);

function makeRun() {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: "collab-ops-smoke",
    createdAt: now,
    updatedAt: now,
    cwd: tmp,
    workflow: { id: "collab-ops-smoke", title: "Collab Ops", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 } },
    inputs: {},
    loopStage: "checkpoint",
    phases: [],
    tasks: [],
    dispatches: [],
    commits: [],
    paths,
    nodes: [],
    contracts: [],
    feedback: [],
    workers: [],
    candidates: [],
    candidateSelections: []
  };
}

// ---- collaborationApprove: approve + reject paths ----
{
  const run = makeRun();
  const r1 = collaborationApprove(run, "run", run.id, { actor: "alice", rationale: "looks good" }, "approve");
  assert.equal(r1.decision, "approve", "approve returns decision approval");
  assert.equal(r1.target.kind, "run", "target kind recorded");
  assert.equal(r1.actor.id, "alice", "actor id recorded");
  assert.ok(fs.existsSync(run.paths.state), "state checkpointed after approve");

  const r2 = collaborationApprove(run, "candidate", "c1", { actor: "bob", reason: "bad" }, "reject");
  assert.equal(r2.decision, "reject", "reject returns decision rejection");
  assert.equal(r2.target.id, "c1", "reject targets correct candidate");
}

// ---- collaborationComment: body fallback chain ----
{
  const run = makeRun();
  const c1 = collaborationComment(run, "run", run.id, { body: "hello" });
  assert.equal(c1.body, "hello", "body taken from body option");

  const c2 = collaborationComment(run, "candidate", "c1", { message: "from msg" });
  assert.equal(c2.body, "from msg", "body falls back to message option");

  const c3 = collaborationComment(run, "candidate", "c2", { text: "from text" });
  assert.equal(c3.body, "from text", "body falls back to text option");

  // Empty body is rejected by the underlying collaboration.ts layer (fail-closed)
  assert.throws(
    () => collaborationComment(run, "candidate", "c3", {}),
    /Comment body is required/,
    "empty body throws"
  );
}

// ---- collaborationCommentList ----
{
  const run = makeRun();
  collaborationComment(run, "run", run.id, { body: "comment 1" });

  const list = collaborationCommentList(run, {});
  assert.equal(list.schemaVersion, 1);
  assert.equal(list.surface, "collaboration");
  assert.equal(list.count, 1, "one comment listed");

  const filtered = collaborationCommentList(run, { targetKind: "run", targetId: run.id });
  assert.equal(filtered.count, 1, "filtered by target still finds it");
}

// ---- collaborationHandoff: reason default + specified ----
{
  const run = makeRun();
  const h1 = collaborationHandoff(run, "run", run.id, { to: "carol", reason: "reassign" });
  assert.equal(h1.toActor.id, "carol", "toActor id recorded");
  assert.equal(h1.reason, "reassign", "reason recorded");

  const h2 = collaborationHandoff(run, "candidate", "c1", { to: "dave" });
  assert.equal(h2.reason, "handoff", "reason defaults to 'handoff'");
  assert.equal(h2.target.id, "c1", "handoff targets correct candidate");
}

// ---- reviewPolicy: Boolean conversion paths ----
{
  const run = makeRun();

  // All fields set
  const p1 = reviewPolicy(run, {
    requiredApprovals: "2",
    authorizedRoles: "reviewer,lead",
    allowSelfApproval: "true",
    requireAttestedActor: "true",
    appliesTo: "commits"
  });
  assert.equal(p1.policy.requiredApprovals, 2, "requiredApprovals parsed to number");
  assert.deepEqual(p1.policy.authorizedRoles, ["reviewer", "lead"], "authorizedRoles parsed to array");
  assert.equal(p1.policy.allowSelfApproval, true, "allowSelfApproval Boolean-converted");
  assert.equal(p1.policy.requireAttestedActor, true, "requireAttestedActor Boolean-converted");

  // Falsy Boolean conversions: "" is falsy, any non-empty string is truthy
  const p2 = reviewPolicy(run, {
    allowSelfApproval: "",
    requireAttestedActor: ""
  });
  assert.equal(p2.policy.allowSelfApproval, false, "allowSelfApproval false via Boolean('')");
  assert.equal(p2.policy.requireAttestedActor, false, "requireAttestedActor false via Boolean('')");

  // Alternative option names
  const p3 = reviewPolicy(run, {
    required: "1",
    roles: "admin",
    "allow-self-approval": "true"
  });
  assert.equal(p3.policy.requiredApprovals, 1, "required option alias works");
  assert.deepEqual(p3.policy.authorizedRoles, ["admin"], "roles option alias works");
  assert.equal(p3.policy.allowSelfApproval, true, "allow-self-approval alias works");
}

// ---- reviewStatus ----
{
  const run = makeRun();
  collaborationComment(run, "run", run.id, { body: "review test" });
  const status = require("../dist/orchestrator/collaboration-operations").reviewStatus(run, { now: "2026-01-01T00:00:00.000Z" });
  assert.equal(status.runId, "collab-ops-smoke", "review status carries runId");
}

// ---- formatReviewStatus + formatCommentList ----
{
  const { formatReviewStatus, formatCommentList } = require("../dist/orchestrator/collaboration-operations");
  const run = makeRun();
  collaborationComment(run, "run", run.id, { body: "fmt test" });
  const report = collaborationCommentList(run, {});
  const str = formatCommentList(report.comments);
  assert.ok(str.length > 0, "formatCommentList produces non-empty string");
}

process.stdout.write("collaboration-ops-unit-smoke: ok\n");
