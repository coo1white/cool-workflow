#!/usr/bin/env node
// perf-review-followup-set-scans -- perf cycle P1-1's follow-up.
//
// An adversarial-review Workflow on 024b007 ("use Sets for phase/task
// membership instead of array scans") found the SAME array-scan-per-item
// bug pattern still present at 4 sibling sites this cycle's own checklist
// named but missed: buildCompactGraphFromView's bucket-collapse filter
// (core/state/state-explosion/graph.ts), deriveFailures'/readyCommitCommand's
// role/membership/worker/selection lookups (shell/multi-agent-operator-ux.ts),
// requireArtifactRefs/requireMessages (shell/coordinator-io.ts), and
// summarizeTopologies' fanin filter (shell/topology-io.ts). All 4 are fixed
// the same way (a Set built once, replacing a per-item `.includes()`/
// `.some()` scan).
//
// While designing THIS test, each of the 4 sites' actual perf shape turned
// out to need individual attention -- a single N/budget pair applied to all
// 4 did not honestly discriminate fixed from reverted code (verified: the
// first draft of this test passed even with all 4 fixes reverted). Each
// block below records what was actually measured and why its budget is set
// where it is; see the per-block comments.
//
// Chasing #1 and #2's honest budgets also surfaced 3 MORE real, independent
// O(N^2) bugs in the exact same call paths (not part of the original 4-site
// review, found only because a large-enough N was needed to test the
// reviewed fix): a bucket-building loop in buildCompactGraphFromView that
// rebuilt its accumulator array via spread on every item; 3 dedup helpers
// in multi-agent-operator-ux.ts (`unique`, `uniqueById`, `uniqueByFailure`)
// using `values.indexOf/findIndex(...) === index` (O(N) per item); and 3
// row-builders in trust-audit.ts (`workerRows`, `candidateRows`,
// `commitRows`) doing an `array.find()` per id instead of a Map lookup. All
// are fixed here too, in the same files, for the same reason: they were
// blocking an honest measurement of the reviewed fix itself.

const assert = require("node:assert/strict");
const { buildCompactGraphFromView } = require("../dist/core/state/state-explosion/graph");
const { summarizeMultiAgentOperator } = require("../dist/shell/multi-agent-operator-ux");
const { summarizeTopologies } = require("../dist/shell/topology-io");
const { postBlackboardMessage, addBlackboardArtifact, createBlackboardTopic } = require("../dist/shell/coordinator-io");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// ---------------------------------------------------------------------
// 1. buildCompactGraphFromView: one huge bucket (thousands of nodes of the
//    same collapsible kind) must still collapse correctly, and fast.
//    Measured live: at N=8000, the idSet-only fix (this cycle's reviewed
//    diff, without the bucket-building fix below) still took 72ms, and the
//    fully-reverted code took 393ms -- both trivially under any budget
//    loose enough to also pass a wall-clock-timing-under-load test. Fully
//    fixed (idSet + the bucket-building fix), N=8000..64000 scales near-
//    linearly (8.1ms..50ms). N=64000 with a 1000ms budget leaves the fixed
//    code a 20x margin while sitting far below where either bug alone
//    would land (idSet-only extrapolates to ~4.6s at N=64000; fully
//    reverted to ~25s).
// ---------------------------------------------------------------------
{
  const N = 64000;
  const BUDGET_MS = 1000;
  const nodes = Array.from({ length: N }, (_, i) => ({ id: `run-1:worker:w${i}`, kind: "worker", status: "completed", label: `w${i}` }));
  const full = { nodes, edges: [] };
  const start = process.hrtime.bigint();
  const record = buildCompactGraphFromView("run-1", full, "compact", { now: "2024-01-01T00:00:00.000Z" });
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  const summary = record.nodes.find((n) => n.kind === "summary");
  assert.ok(summary, "the whole bucket must still collapse into one synthetic summary node");
  assert.equal(summary.synthetic.collapsedNodeCount, N, "the fix must not change which/how many nodes collapse");
  assert.ok(elapsedMs < BUDGET_MS, `buildCompactGraphFromView at ${N} same-kind nodes took ${elapsedMs.toFixed(1)}ms, expected < ${BUDGET_MS}ms`);
}

// ---------------------------------------------------------------------
// 2. summarizeMultiAgentOperator (deriveFailures + deriveDependencies +
//    summarizeTrustAudit's worker/candidate/commit rows): many roles, each
//    with a membership, each with a worker. Measured live: BEFORE fixing
//    the 3 newly-found sibling bugs (unique/uniqueById/uniqueByFailure in
//    this file, workerRows/candidateRows/commitRows in trust-audit.ts),
//    N=16000 took 4578ms even with the reviewed deriveFailures fix already
//    applied -- those other O(N^2) sites dominated completely. With all of
//    them fixed, N=3000..64000 scales near-linearly (43ms..344ms). N=64000
//    with a 2000ms budget leaves the fixed code a ~6x margin while sitting
//    far below where the unfixed shape would land (the N=16000 measurement
//    alone was already 4578ms; N=64000 would be a great deal worse).
// ---------------------------------------------------------------------
{
  const N = 64000;
  const BUDGET_MS = 2000;
  const roles = [];
  const memberships = [];
  const workers = [];
  for (let i = 0; i < N; i++) {
    roles.push({ id: `role-${i}`, status: "active" });
    memberships.push({ id: `membership-${i}`, roleId: `role-${i}`, workerId: `worker-${i}`, status: "active" });
    workers.push({ id: `worker-${i}`, status: "completed" });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-perf-followup-ma-"));
  const runDir = path.join(dir, "run");
  fs.mkdirSync(runDir, { recursive: true });
  const run = {
    id: "run-1",
    paths: { runDir },
    multiAgent: { roles, memberships, workers, fanins: [] },
    workers,
    candidates: [],
    candidateSelections: [],
    commits: [],
    feedback: [],
    topologies: { runs: [] },
    blackboard: {},
  };
  const start = process.hrtime.bigint();
  const status = summarizeMultiAgentOperator(run);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(status.failures.length, 0, "no failures expected: every role has a membership, every membership has a completed (not failed) worker");
  assert.ok(elapsedMs < BUDGET_MS, `summarizeMultiAgentOperator at ${N} roles/memberships/workers took ${elapsedMs.toFixed(1)}ms, expected < ${BUDGET_MS}ms`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------
// 3. requireArtifactRefs/requireMessages (via postBlackboardMessage):
//    correctness only, deliberately with NO perf-time budget. The reviewed
//    fix rebuilds a Set from `state.artifacts`/`state.messages` once per
//    call, replacing a nested `.some()` scan per referenced id -- a real
//    asymptotic win only when a single call references MANY ids at once
//    (O(ids x N) -> O(N + ids)); for the common single-id case both shapes
//    are O(N) per call, so there is no complexity class to pin here.
//    Separately, and far larger: `persistBlackboardState` (called by
//    postBlackboardMessage) rewrites EVERY artifact/topic/context/snapshot/
//    decision record to its own file on every single call, regardless of
//    which ones changed -- measured live at 41 SECONDS for one call with
//    200,000 pre-existing artifacts. That bug swamps anything this specific
//    fix could show and is tracked as its own follow-up (persist-state
//    write fanout), not fixed here to keep this cycle's diff scoped to the
//    4 reviewed sites. A tight, honest time budget for THIS fix alone is
//    not achievable until that separate fix lands, so this block checks
//    correctness only: an existing artifact (single ref) is accepted, many
//    existing artifacts referenced in one call are all accepted, and a
//    genuinely unknown ref is still rejected.
// ---------------------------------------------------------------------
{
  const N = 500;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-perf-followup-"));
  const runDir = path.join(dir, "run");
  fs.mkdirSync(runDir, { recursive: true });
  const run = { id: "run-1", paths: { runDir } };
  const topic = createBlackboardTopic(run, { title: "perf-followup-topic" });
  const state = run.blackboard;
  for (let i = 0; i < N - 1; i++) state.artifacts.push({ id: `synthetic-artifact-${i}`, kind: "doc" });
  const realArtifact = addBlackboardArtifact(run, { topicId: topic.id, locator: "evidence.md:1", kind: "doc" });

  const message = postBlackboardMessage(run, { topicId: topic.id, actor: { kind: "operator", id: "tester" }, body: "referencing an existing artifact", artifactRefIds: [realArtifact.id] });
  assert.deepEqual(message.linkedArtifactRefIds, [realArtifact.id], "the real, existing artifact ref must be accepted unchanged");

  const manyIds = [realArtifact.id, ...Array.from({ length: 20 }, (_, i) => `synthetic-artifact-${i}`)];
  const manyRefMessage = postBlackboardMessage(run, { topicId: topic.id, actor: { kind: "operator", id: "tester" }, body: "referencing many existing artifacts", artifactRefIds: manyIds });
  assert.deepEqual([...manyRefMessage.linkedArtifactRefIds].sort(), [...manyIds].sort(), "every one of several existing artifact refs in a single call must be accepted unchanged");

  assert.throws(
    () => postBlackboardMessage(run, { topicId: topic.id, actor: { kind: "operator", id: "tester" }, body: "bad ref", artifactRefIds: ["does-not-exist"] }),
    /Unknown BlackboardArtifactRef id: does-not-exist/,
    "a genuinely unknown artifact ref must still be rejected"
  );

  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------
// 4. summarizeTopologies: the reviewed fix builds a Set from each record's
//    OWN groupIds/fanoutIds once, replacing a per-fanin `.includes()` scan
//    of those same (per-record) arrays. That fix's benefit scales with the
//    SIZE of each record's own groupIds/fanoutIds -- with the small (length
//    1-2) arrays a single topology run typically has, the win is real but
//    tiny; a discriminating test needs records with many group/fanout
//    members. Measured live at N=1500 records x M=200 groupIds/fanoutIds
//    each (all records sharing one N=1500-entry global fanins list): fixed
//    took 182ms, reverted (temporarily, to verify) took 7532ms -- a 41x
//    gap. N=1500/M=200 with a 1500ms budget leaves the fixed code a ~8x
//    margin while sitting far below the reverted shape's 7.5s.
// ---------------------------------------------------------------------
{
  const N = 1500;
  const M = 200;
  const BUDGET_MS = 1500;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-perf-followup-topo-"));
  const runDir = path.join(dir, "run");
  fs.mkdirSync(runDir, { recursive: true });
  const runs = [];
  const fanins = [];
  for (let i = 0; i < N; i++) {
    const groupIds = Array.from({ length: M }, (_, j) => `group-${i}-${j}`);
    const fanoutIds = Array.from({ length: M }, (_, j) => `fanout-${i}-${j}`);
    runs.push({ id: `topo-run-${i}`, topologyId: "map-reduce", status: "active", multiAgentRunId: "ma-1", blackboardId: "default", groupIds, fanoutIds, faninIds: [], missingEvidence: [] });
    fanins.push({ id: `fanin-${i}`, groupId: `group-${i}-${M - 1}`, fanoutId: `fanout-${i}-${M - 1}`, status: "ready", verifierReady: true, blockedReasons: [] });
  }
  const run = { id: "run-1", paths: { runDir }, topologies: { schemaVersion: 1, runs }, multiAgent: { fanins } };

  const start = process.hrtime.bigint();
  const summary = summarizeTopologies(run);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(summary.active.length, N, "every topology run record must still be summarized");
  assert.equal(summary.active[0].status, "ready", "the fix must not change the inferred ready/blocked status");
  assert.ok(elapsedMs < BUDGET_MS, `summarizeTopologies at ${N} run records x ${M} groupIds/fanoutIds each took ${elapsedMs.toFixed(1)}ms, expected < ${BUDGET_MS}ms`);

  fs.rmSync(dir, { recursive: true, force: true });
}

process.stdout.write("perf-review-followup-set-scans: ok\n");
