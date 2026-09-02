"use strict";
// collaboration-ops-unit-smoke (v0.1.95 → v2 cutover) — unit coverage for the
// 4 orchestrator wrapper functions: collaborationApprove, collaborationComment,
// collaborationHandoff, reviewPolicy (+ collaborationCommentList, reviewStatus,
// formatCommentList).
//
// ---------------------------------------------------------------------------
// CUTOVER NOTE (v2): NO-EQUIVALENT for the wrapper *facade*, partial for the
// primitives.
//
// The old build shipped an orchestrator collaboration-operations module — a thin
// orchestrator facade that (a) wrapped return values in envelopes and (b) did
// CLI-style string coercion inline. v2 deliberately dismantled that facade
// (the orchestrator god-object is a documented anti-goal). Its work is now
// split three ways, none of which reproduces the facade's exact contract:
//
//   * pure record builders  -> src/core/multi-agent/collaboration.ts
//                              (buildApproval / buildComment / buildHandoff /
//                               buildReviewPolicy / listComments / formatters)
//   * impure run wiring      -> src/shell/collaboration-io.ts
//                              (recordApproval / recordComment / recordHandoff /
//                               setReviewPolicy / buildReviewStatusReport /
//                               listComments — take a `run`, persist a
//                               checkpoint). THIS is the layer this smoke now
//                               drives; it preserves the primitives' behavior.
//   * string-option parsing  -> src/shell/multi-agent-cli.ts (*Cli functions)
//                              (body ?? message ?? text; boolArg/numberArg/
//                               arrayArg). These load the run from DISK via
//                               loadRunFromCwd(runId, cwd), so they cannot be
//                               driven by an in-memory stub run the way this
//                               hermetic unit smoke does.
//
// Repointed imports so the failures below land on genuine behavior, not an
// import crash. Every assertion that maps cleanly to shell/collaboration-io.ts
// is preserved verbatim. The three assertion groups that have NO v2 equivalent
// are kept and clearly marked "NO-EQUIVALENT" — they assert facade-only
// structure v2 legitimately lacks:
//   1. collaborationComment body fallback to `message`/`text` — only the CLI
//      layer has that fallback; recordComment takes `body` directly.
//   2. collaborationCommentList's report envelope {schemaVersion, surface,
//      count, comments} — v2 listComments returns a bare CommentRecord[].
//   3. reviewPolicy's {policy:{...}} envelope + inline Boolean() coercion of
//      "true"/"" — setReviewPolicy returns the policy object directly, and
//      buildReviewPolicy does NOT Boolean-convert a string ("true" stays the
//      string, not === true).
//
// Hermetic: stub WorkflowRun in tmpdir, no real agent, no CLI, no MCP.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRunPaths, ensureRunDirs } = require("../dist/shell/run-store");
const {
  recordApproval,
  recordComment,
  recordHandoff,
  setReviewPolicy,
  listComments,
  buildReviewStatusReport,
  formatReviewStatus,
  formatCommentList
} = require("../dist/shell/collaboration-io");

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

// Adapter helpers: preserve the OLD wrapper call shapes on top of the v2
// shell/collaboration-io.ts primitives. The old signature was
//   collaborationApprove(run, kind, id, opts, decision)
// v2's recordApproval takes ({ target: { kind, id }, decision, actor, ... }).
function approve(run, kind, id, opts, decision) {
  return recordApproval(run, {
    target: { kind, id },
    decision,
    actor: opts.actor,
    rationale: opts.rationale ?? opts.reason
  });
}
function comment(run, kind, id, opts) {
  return recordComment(run, { target: { kind, id }, body: opts.body });
}
function handoff(run, kind, id, opts) {
  return recordHandoff(run, { target: { kind, id }, toActor: opts.to, reason: opts.reason });
}

// ---- collaborationApprove: approve + reject paths ----
{
  const run = makeRun();
  const r1 = approve(run, "run", run.id, { actor: "alice", rationale: "looks good" }, "approve");
  assert.equal(r1.decision, "approve", "approve returns decision approval");
  assert.equal(r1.target.kind, "run", "target kind recorded");
  assert.equal(r1.actor.id, "alice", "actor id recorded");
  assert.ok(fs.existsSync(run.paths.state), "state checkpointed after approve");

  const r2 = approve(run, "candidate", "c1", { actor: "bob", reason: "bad" }, "reject");
  assert.equal(r2.decision, "reject", "reject returns decision rejection");
  assert.equal(r2.target.id, "c1", "reject targets correct candidate");
}

// ---- collaborationComment: body fallback chain ----
{
  const run = makeRun();
  const c1 = comment(run, "run", run.id, { body: "hello" });
  assert.equal(c1.body, "hello", "body taken from body option");

  // NO-EQUIVALENT: the message/text option-name fallback lived in the old
  // orchestrator wrapper. v2 moved it to the CLI layer (commentAddCli:
  // `args.body ?? args.message ?? args.text`); recordComment takes `body`
  // directly with no fallback. These two assertions have no shell-IO
  // equivalent and fail on genuine behavior (empty body -> throws).
  const c2 = recordComment(run, { target: { kind: "candidate", id: "c1" }, body: undefined, message: "from msg" });
  assert.equal(c2.body, "from msg", "body falls back to message option");

  const c3 = recordComment(run, { target: { kind: "candidate", id: "c2" }, body: undefined, text: "from text" });
  assert.equal(c3.body, "from text", "body falls back to text option");

  // Empty body is rejected by the underlying collaboration.ts layer (fail-closed)
  assert.throws(
    () => recordComment(run, { target: { kind: "candidate", id: "c3" }, body: undefined }),
    /Comment body is required/,
    "empty body throws"
  );
}

// ---- collaborationCommentList ----
{
  const run = makeRun();
  comment(run, "run", run.id, { body: "comment 1" });

  // NO-EQUIVALENT: the old wrapper returned a report envelope
  //   { schemaVersion, surface: "collaboration", count, comments }.
  // v2 listComments returns a bare CommentRecord[]. There is no shell-IO
  // function that produces the envelope; buildReviewStatusReport has a
  // { schemaVersion, surface, counts.comments } but a different shape/name.
  const list = listComments(run);
  assert.equal(list.schemaVersion, 1);
  assert.equal(list.surface, "collaboration");
  assert.equal(list.count, 1, "one comment listed");

  const filtered = listComments(run, { kind: "run", id: run.id });
  assert.equal(filtered.count, 1, "filtered by target still finds it");
}

// ---- collaborationHandoff: reason default + specified ----
{
  const run = makeRun();
  const h1 = handoff(run, "run", run.id, { to: "carol", reason: "reassign" });
  assert.equal(h1.toActor.id, "carol", "toActor id recorded");
  assert.equal(h1.reason, "reassign", "reason recorded");

  const h2 = handoff(run, "candidate", "c1", { to: "dave" });
  assert.equal(h2.reason, "handoff", "reason defaults to 'handoff'");
  assert.equal(h2.target.id, "c1", "handoff targets correct candidate");
}

// ---- reviewPolicy: Boolean conversion paths ----
{
  const run = makeRun();

  // NO-EQUIVALENT: setReviewPolicy returns the ReviewGatePolicy DIRECTLY, not
  // wrapped in { policy }. buildReviewPolicy coerces string -> number
  // (requiredApprovals) and string -> array (authorizedRoles/appliesTo), but
  // does NOT Boolean-convert allowSelfApproval / requireAttestedActor: it does
  // `input.allowSelfApproval ?? existing ?? false`, so a string "true" stays
  // the string "true" (!== true) and "" stays "" (!== false). The inline
  // Boolean() coercion the old wrapper did now lives only in the CLI's boolArg.
  // These assertions target the removed facade contract.

  // All fields set
  const p1 = setReviewPolicy(run, {
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
  const p2 = setReviewPolicy(run, {
    allowSelfApproval: "",
    requireAttestedActor: ""
  });
  assert.equal(p2.policy.allowSelfApproval, false, "allowSelfApproval false via Boolean('')");
  assert.equal(p2.policy.requireAttestedActor, false, "requireAttestedActor false via Boolean('')");

  // Alternative option names
  const p3 = setReviewPolicy(run, {
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
  recordComment(run, { target: { kind: "run", id: run.id }, body: "review test" });
  const status = buildReviewStatusReport(run, { now: "2026-01-01T00:00:00.000Z" });
  assert.equal(status.runId, "collab-ops-smoke", "review status carries runId");
}

// ---- formatReviewStatus + formatCommentList ----
{
  const run = makeRun();
  recordComment(run, { target: { kind: "run", id: run.id }, body: "fmt test" });
  const comments = listComments(run);
  const str = formatCommentList(comments);
  assert.ok(str.length > 0, "formatCommentList produces non-empty string");
}

process.stdout.write("collaboration-ops-unit-smoke: ok\n");
