"use strict";
// Team Collaboration smoke (v0.1.32). Proves, end to end:
//  1. Approvals/comments/handoffs are APPEND-ONLY and PROVENANCE-LINKED to a
//     durable target (each carries trust-audit event ids; the target artifact is
//     never edited in place; a correction is a NEW record via `supersedes`).
//  2. A review gate STACKS ON the verifier gate: it BLOCKS a verifier-passing
//     commit that lacks its required approvals, and PASSES once met — and it can
//     NEVER turn an unverified candidate into a committed one.
//  3. Self-approval / unauthorized-role / unattributed approvals FAIL CLOSED.
//  4. `unattributed` actors surface honestly (status "unattributed").
//  5. Review state is DETERMINISTIC over a fixed snapshot.
//  6. `cw <cmd> --json` === `cw_<cmd>` for review status and comment list.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const { commitState, CommitGateError } = require("../dist/commit");
const { registerCandidate, scoreCandidate, selectCandidate } = require("../dist/candidate-scoring");
const {
  setReviewPolicy,
  recordApproval,
  recordComment,
  recordHandoff,
  deriveReviewState,
  buildReviewStatusReport,
  deriveOwner
} = require("../dist/collaboration");
const { createRunPaths, ensureRunDirs, loadRunFromCwd, saveCheckpoint } = require("../dist/state");
const { appendRunNode, createStateNode } = require("../dist/state-node");

const CLI = path.join(__dirname, "../dist/cli.js");
const MCP = path.join(__dirname, "../dist/mcp-server.js");

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-team-collab-")));

// ---------------------------------------------------------------------------
// Build a run with a VERIFIED candidate + selection (the verifier mechanism the
// review gate stacks on). Mirrors the verifier-gated-commit scaffold.
// ---------------------------------------------------------------------------
function buildRun(runId) {
  const paths = createRunPaths(path.join(tmp, ".cw", "runs", runId));
  ensureRunDirs(paths);
  const resultPath = path.join(paths.runDir, "result.md");
  fs.writeFileSync(resultPath, "# result\nevidence\n", "utf8");
  const now = new Date().toISOString();
  const run = {
    schemaVersion: 1,
    id: runId,
    createdAt: now,
    updatedAt: now,
    cwd: tmp,
    workflow: { id: runId, title: "Collab Smoke", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 } },
    inputs: {},
    loopStage: "checkpoint",
    phases: [],
    tasks: [
      {
        id: "task-one",
        kind: "agent",
        phase: "Verify",
        status: "completed",
        requiresEvidence: true,
        prompt: "Verify one result.",
        taskPath: "",
        resultPath,
        loopStage: "observe",
        resultNodeId: `${runId}:result:task-one`,
        verifierNodeId: `${runId}:verifier:task-one`,
        workerId: "worker-one",
        sandboxProfileId: "readonly"
      }
    ],
    dispatches: [],
    commits: [],
    paths,
    nodes: [],
    contracts: [],
    feedback: [],
    workers: [
      {
        schemaVersion: 1,
        id: "worker-one",
        runId,
        taskId: "task-one",
        createdAt: now,
        updatedAt: now,
        status: "verified",
        workerDir: path.join(paths.workersDir, "worker-one"),
        inputPath: path.join(paths.workersDir, "worker-one", "input.md"),
        resultPath,
        artifactsDir: path.join(paths.workersDir, "worker-one", "artifacts"),
        logsDir: path.join(paths.workersDir, "worker-one", "logs"),
        allowedPaths: [resultPath],
        sandboxProfileId: "readonly",
        resultNodeId: `${runId}:result:task-one`,
        feedbackIds: [],
        errors: [],
        output: {
          workerId: "worker-one",
          taskId: "task-one",
          resultPath,
          recordedAt: now,
          stateNodeId: `${runId}:result:task-one`,
          verifierNodeId: `${runId}:verifier:task-one`
        }
      }
    ],
    candidates: [],
    candidateSelections: []
  };
  appendRunNode(
    run,
    createStateNode({
      id: `${runId}:result:task-one`,
      kind: "result",
      status: "completed",
      loopStage: "observe",
      artifacts: [{ id: "result", kind: "markdown", path: resultPath }],
      evidence: [{ id: "result:1", source: "cw:result", locator: "test/team-collaboration-smoke.js:1" }]
    })
  );
  appendRunNode(
    run,
    createStateNode({
      id: `${runId}:verifier:task-one`,
      kind: "verifier",
      status: "verified",
      loopStage: "adjust",
      artifacts: [{ id: "result", kind: "markdown", path: resultPath }],
      evidence: [{ id: "verify:1", source: "cw:result", locator: "test/team-collaboration-smoke.js:1" }]
    })
  );
  return run;
}

function addVerifiedCandidate(run, candidateId, selectedBy) {
  const candidate = registerCandidate(
    run,
    {
      id: candidateId,
      kind: "worker-output",
      workerId: "worker-one",
      taskId: "task-one",
      resultNodeId: `${run.id}:result:task-one`,
      verifierNodeId: `${run.id}:verifier:task-one`,
      resultPath: path.join(run.paths.runDir, "result.md")
    },
    { persist: false }
  );
  scoreCandidate(
    run,
    candidate.id,
    {
      id: `${candidateId}-score`,
      scorer: "smoke",
      criteria: { correctness: 4, evidence: 4, fit: 2 },
      maxTotal: 10,
      evidence: [{ id: "score:evidence", source: "test", locator: "test/team-collaboration-smoke.js:1" }]
    },
    { persist: false }
  );
  const selection = selectCandidate(run, candidate.id, { reason: "verified winner", selectedBy }, { persist: false });
  return { candidate, selection };
}

function gateErrorCodes(error) {
  const failures = (error.structured && [error.structured]) || [];
  const meta = error.feedbackId ? [] : [];
  return failures.map((f) => f.code).concat(meta);
}

// ===========================================================================
const run = buildRun("collab-smoke");
const { candidate, selection } = addVerifiedCandidate(run, "candidate-one", "builder-bob");
saveCheckpoint(run);

// Sanity: with NO review policy, the verifier-gated commit succeeds (default
// behavior unchanged / backward compatible).
const baselineRun = buildRun("collab-baseline");
const baseline = addVerifiedCandidate(baselineRun, "candidate-b", "builder-bob");
const baseCommit = commitState(baselineRun, { reason: "selected candidate", selectionId: baseline.selection.id, verifierGated: true, source: "cli" });
assert.equal(baseCommit.verifierGated, true, "no policy => verifier-gated commit still works");
assert.equal(baseCommit.review, undefined, "no policy => no review provenance stamped");

// ---- 1. POLICY AS DATA: require 1 approval from role "reviewer" on commits --
const policy = setReviewPolicy(
  run,
  { requiredApprovals: 1, authorizedRoles: ["reviewer"], allowSelfApproval: false, appliesTo: ["commit"] },
  { persist: false }
);
assert.equal(policy.requiredApprovals, 1);
assert.deepEqual(policy.authorizedRoles, ["reviewer"]);

// ---- 2. Review gate BLOCKS a verifier-passing commit lacking approvals -----
let blocked;
try {
  commitState(run, { reason: "selected candidate", selectionId: selection.id, verifierGated: true, source: "cli" });
  assert.fail("commit must be blocked by the review gate");
} catch (error) {
  assert.ok(error instanceof CommitGateError, "blocked with a CommitGateError");
  blocked = error;
}
assert.equal(blocked.structured.code, "review-gate-missing-approvals", "blocked specifically by the REVIEW gate");
// The verifier mechanism was satisfied: no verifier/candidate errors were raised.
const blockFeedback = run.feedback.find((f) => f.code === "review-gate-missing-approvals");
assert.ok(blockFeedback, "review-gate block recorded as feedback (append-only)");
assert.ok(
  !run.feedback.some((f) => /verifier|candidate-not-verified|candidate-unscored/.test(f.code)),
  "review gate did not bypass nor duplicate the verifier gate — verifier checks passed"
);

// review state is pending: required 1, recorded 0.
let state = deriveReviewState(run, { kind: "commit", id: "(pending)" }, { relatedTargets: [{ kind: "candidate", id: candidate.id }, { kind: "selection", id: selection.id }], selfActorIds: ["worker-one", "builder-bob"] });
assert.equal(state.status, "pending");
assert.equal(state.requiredApprovals, 1);
assert.equal(state.recordedApprovals, 0);

// ---- 3+4. unattributed actor surfaces honestly and does NOT count ----------
const unattributed = recordApproval(run, { target: { kind: "candidate", id: candidate.id }, decision: "approve" }, { persist: false });
assert.equal(unattributed.actor.kind, "unattributed", "absent identity => explicit unattributed actor, never fabricated");
assert.ok(unattributed.auditEventIds.length > 0, "approval is provenance-linked to a trust-audit event");
state = deriveReviewState(run, { kind: "commit", id: "(pending)" }, { policy, relatedTargets: [{ kind: "candidate", id: candidate.id }], selfActorIds: ["worker-one", "builder-bob"] });
assert.equal(state.status, "unattributed", "only-unattributed approvals => status unattributed (honest)");
assert.equal(state.recordedApprovals, 0, "unattributed approval does not count");

// ---- 5. self-approval and unauthorized-role FAIL CLOSED --------------------
recordApproval(run, { target: { kind: "candidate", id: candidate.id }, decision: "approve", actor: "builder-bob", role: "reviewer", attested: true }, { persist: false });
recordApproval(run, { target: { kind: "candidate", id: candidate.id }, decision: "approve", actor: "carol", role: "intern", attested: true }, { persist: false });
state = deriveReviewState(run, { kind: "commit", id: "(pending)" }, { policy, relatedTargets: [{ kind: "candidate", id: candidate.id }], selfActorIds: ["worker-one", "builder-bob"] });
assert.equal(state.recordedApprovals, 0, "self-approval and unauthorized-role do not count");
assert.equal(state.status, "blocked", "recorded approvals exist but none count => blocked");
assert.ok(state.disqualified.some((d) => d.reason === "self-approval"), "self-approval surfaced");
assert.ok(state.disqualified.some((d) => d.reason === "unauthorized-role"), "unauthorized-role surfaced");

// commit still blocked.
assert.throws(
  () => commitState(run, { reason: "selected candidate", selectionId: selection.id, verifierGated: true, source: "cli" }),
  /Review gate blocked/
);

// ---- 6. an attested, authorized approval => gate PASSES --------------------
const approval = recordApproval(
  run,
  { target: { kind: "candidate", id: candidate.id }, decision: "approve", actor: "dave", role: "reviewer", attested: true, rationale: "LGTM" },
  { persist: false }
);
assert.equal(approval.actor.attested, true, "host-attested approver");
state = deriveReviewState(run, { kind: "commit", id: "(pending)" }, { policy, relatedTargets: [{ kind: "candidate", id: candidate.id }, { kind: "selection", id: selection.id }], selfActorIds: ["worker-one", "builder-bob"] });
assert.equal(state.status, "approved");
assert.deepEqual(state.approvers, ["dave"]);

const goodCommit = commitState(run, { reason: "selected candidate", selectionId: selection.id, verifierGated: true, source: "cli" });
assert.equal(goodCommit.verifierGated, true, "commit is verifier-gated AND review-approved");
assert.ok(goodCommit.review, "the shipped commit records WHO approved it");
assert.equal(goodCommit.review.recordedApprovals, 1);
assert.deepEqual(goodCommit.review.approvers, ["dave"], "who approved the very commit that shipped is answerable");
assert.ok(goodCommit.review.approvalIds.includes(approval.id), "provenance link to the approval record");

// ---- APPEND-ONLY: a correction is a NEW record via supersedes --------------
const beforeLen = run.collaboration.approvals.length;
const correction = recordApproval(
  run,
  { target: { kind: "candidate", id: candidate.id }, decision: "reject", actor: "dave", role: "reviewer", attested: true, rationale: "changed my mind", supersedes: approval.id },
  { persist: false }
);
assert.equal(run.collaboration.approvals.length, beforeLen + 1, "correction appends a NEW record; the past is not mutated");
assert.equal(run.collaboration.approvals.find((r) => r.id === approval.id).rationale, "LGTM", "original approval record is unchanged");
// After the superseding REJECT, a fresh derivation blocks (fail closed).
state = deriveReviewState(run, { kind: "candidate", id: candidate.id }, { policy: setReviewPolicy(run, { appliesTo: ["candidate"] }, { persist: false }), selfActorIds: ["worker-one", "builder-bob"] });
assert.equal(state.status, "rejected", "a superseding authorized reject blocks (fail closed)");
assert.ok(state.approvals.every((r) => r.id !== approval.id), "the superseded approval no longer counts");
assert.ok(correction.auditEventIds.length > 0);

// ---- 7. comments + handoffs: append-only, provenance-linked ---------------
const comment = recordComment(run, { target: { kind: "candidate", id: candidate.id }, body: "needs a second look", actor: "erin", role: "reviewer" }, { persist: false });
assert.equal(comment.target.id, candidate.id, "comment attaches to a durable target");
assert.ok(comment.threadId, "comment is threaded");
assert.ok(comment.auditEventIds.length > 0, "comment is provenance-linked");

const handoff = recordHandoff(run, { target: { kind: "run", id: run.id }, fromActor: "dave", toActor: "frank", reason: "handing review to frank", actor: "dave", attested: true }, { persist: false });
assert.equal(handoff.fromActor.id, "dave");
assert.equal(handoff.toActor.id, "frank");
assert.ok(handoff.auditEventIds.length > 0, "handoff is an explicit, provenance-linked event");
assert.equal(deriveOwner(run).id, "frank", "current owner is DERIVED from the latest handoff (never an overwritten field)");

// ---- 8. VERIFIER IS NEVER BYPASSED: approval cannot commit an unverified ----
const uvRun = buildRun("collab-unverified");
// Register a candidate with NO verified verifier node (override status).
const uvCandidate = registerCandidate(
  uvRun,
  { id: "candidate-uv", kind: "worker-output", workerId: "worker-one", taskId: "task-one", resultNodeId: `${uvRun.id}:result:task-one` },
  { persist: false }
);
setReviewPolicy(uvRun, { requiredApprovals: 1, authorizedRoles: ["reviewer"], appliesTo: ["commit"] }, { persist: false });
recordApproval(uvRun, { target: { kind: "candidate", id: uvCandidate.id }, decision: "approve", actor: "dave", role: "reviewer", attested: true }, { persist: false });
assert.throws(
  () => commitState(uvRun, { reason: "approved but unverified", candidateId: uvCandidate.id, verifierGated: true, source: "cli" }),
  (err) => err instanceof CommitGateError && !/Review gate/.test(err.structured.message),
  "an approved-but-unverified candidate is still blocked by the VERIFIER gate — review never turns unverified into committed"
);

// ---- 9. DETERMINISM: a report over a fixed snapshot is byte-reproducible ----
saveCheckpoint(run);
const r1 = buildReviewStatusReport(run, { now: "2026-06-08T00:00:00.000Z" });
const r2 = buildReviewStatusReport(run, { now: "2026-06-08T00:00:00.000Z" });
assert.equal(JSON.stringify(r1), JSON.stringify(r2), "review status is deterministic over a fixed snapshot + injected now");

// ---- 10. cw <cmd> --json === cw_<cmd> (parity proven in the smoke too) ------
function cli(args) {
  return JSON.parse(execFileSync("node", [CLI, ...args], { cwd: tmp, encoding: "utf8" }));
}
function mcp(tool, args) {
  const input =
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) +
    "\n" +
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } }) +
    "\n";
  const out = spawnSync("node", [MCP], { cwd: tmp, input, encoding: "utf8" });
  const line = out.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((m) => m.id === 2);
  assert.ok(line, `MCP returned a result for ${tool}`);
  return JSON.parse(line.result.content[0].text);
}
const stripTs = (v) => JSON.stringify(v).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<ts>");

const cliReview = cli(["review", "status", "collab-smoke", "--json"]);
const mcpReview = mcp("cw_review_status", { cwd: tmp, runId: "collab-smoke" });
assert.equal(stripTs(cliReview), stripTs(mcpReview), "cw review status --json === cw_review_status");
assert.ok(cliReview.timeline.length >= 3, "timeline records approvals/comments/handoffs");

const cliComments = cli(["comment", "list", "collab-smoke", "--json"]);
const mcpComments = mcp("cw_comment_list", { cwd: tmp, runId: "collab-smoke" });
assert.equal(stripTs(cliComments), stripTs(mcpComments), "cw comment list --json === cw_comment_list");
assert.ok(cliComments.comments.some((c) => c.body === "needs a second look"), "comment surfaced via CLI");

// The persisted state round-trips (additive/optional, backward compatible).
const reloaded = loadRunFromCwd("collab-smoke", tmp);
assert.equal(reloaded.collaboration.approvals.length, run.collaboration.approvals.length, "collaboration state round-trips through state.json");
assert.ok(reloaded.commits.find((c) => c.id === goodCommit.id).review.approvers.includes("dave"), "shipped commit's approver persists");

// ---- 11. BARE-VERB ROUTING: each carved verb still reaches its real handler --
// After carving approve/reject/comment/handoff/review into
// src/cli/handlers/collaboration.ts, a bare invocation must FAIL CLOSED with the
// SAME error the in-handler throw site raises (byte-identical behavior). Each
// regex is reasoned from the real throw string in the source — never weakened.
function expectFail(args, re, why) {
  const out = spawnSync("node", [CLI, ...args], { cwd: tmp, encoding: "utf8" });
  assert.notEqual(out.status, 0, `${why}: bare \`cw ${args.join(" ")}\` must exit non-zero`);
  assert.match(out.stderr, re, `${why}: stderr must match ${re}`);
}
// approve/reject: first required() is on the run id positional → "Missing run id".
expectFail(["approve"], /Missing run id/, "approve no-args -> required(run id)");
expectFail(["reject"], /Missing run id/, "reject no-args -> required(run id)");
// comment with no subcommand falls past add/list to the Usage throw (NOT required).
expectFail(["comment"], /Usage: cw\.js comment add/, "comment no-subcommand -> Usage throw");
// handoff: first required() is on the target-kind positional → "Missing target kind".
expectFail(["handoff"], /Missing target kind/, "handoff no-args -> required(target kind)");
// review with no subcommand falls past status/policy to the Usage throw (NOT required).
expectFail(["review"], /Usage: cw\.js review status/, "review no-subcommand -> Usage throw");

process.stdout.write("team-collaboration-smoke: ok\n");
