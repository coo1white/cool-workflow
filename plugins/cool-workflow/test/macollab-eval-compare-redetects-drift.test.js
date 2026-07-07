#!/usr/bin/env node
// macollab-eval-compare-redetects-drift — eval-replay.ts's
// compareNormalized: the 31-metric compare must genuinely RE-DERIVE the
// pass/fail per section rather than trivially reporting "pass" no matter
// the input. This test builds a baseline and a GENUINELY DIFFERENT replay
// input (not a copy) and confirms compare correctly flags exactly the
// sections that differ, while leaving identical sections passing — proof
// the comparison is a real structural diff, not a rubber stamp.
//
// BYTE-COMPAT / REBUILD RISK 5 [load-bearing]: "The replay must RE-DERIVE,
// never copy... copying snapshot.normalized into the replay makes the
// determinism gate false-green."
//
// Evidence: SPEC/multi-agent.md section I ("compareMultiAgentReplay" row),
// rebuild risk 5, invariant 13 (eval gate anti-staleness).

const assert = require("node:assert/strict");
const { compareNormalized, METRIC_SECTIONS, ALL_METRIC_SECTIONS } = require("../dist/core/multi-agent/eval-replay");

const NOW = "2026-07-03T00:00:00.000Z";

function baseNormalized() {
  const value = { workflow: { id: "w-1", title: "Baseline Workflow" } };
  for (const spec of METRIC_SECTIONS) {
    if (spec.section !== "workflow") value[spec.section] = [`${spec.section}-entry-1`];
  }
  return value;
}

function replayEnvelope(normalized, overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "multi-agent-replay-run",
    id: "snapshot-1-replay",
    snapshotId: "snapshot-1",
    baselineRunId: "run-1",
    replayedAt: NOW,
    status: "completed",
    isolatedWorkspace: "/tmp/replay",
    paths: { suiteDir: "/suite", replayDir: "/suite/replay", replayRunPath: "/suite/replay-run.json", snapshotPath: "/suite/snapshot.json" },
    replay: normalized,
    errors: [],
    ...overrides,
  };
}

// IDENTICAL baseline and replay -> every section passes, comparison status "pass", no findings.
{
  const baseline = baseNormalized();
  const replay = replayEnvelope(JSON.parse(JSON.stringify(baseline))); // deep-cloned, not the same reference, but structurally identical
  const comparison = compareNormalized("snapshot-1", "/suite/snapshot.json", baseline, replay, NOW, "/suite/comparison.json", "/suite/findings.json", "/suite");
  assert.equal(comparison.status, "pass", "structurally identical baseline/replay -> overall pass");
  assert.equal(comparison.findings.length, 0, "no findings when nothing diverges");
  for (const spec of ALL_METRIC_SECTIONS) {
    assert.equal(comparison.sections[String(spec.section)].status, "pass", `section ${spec.section} passes when baseline and replay match structurally`);
  }
}

// GENUINELY DIFFERENT replay in exactly ONE section (roles) -> compare must flag ONLY that section as failed,
// proving it re-derives per-section rather than an all-or-nothing check.
{
  const baseline = baseNormalized();
  const driftedReplay = JSON.parse(JSON.stringify(baseline));
  driftedReplay.roles = ["roles-entry-1", "roles-entry-EXTRA"]; // genuine structural difference
  const replay = replayEnvelope(driftedReplay);
  const comparison = compareNormalized("snapshot-1", "/suite/snapshot.json", baseline, replay, NOW, "/suite/comparison.json", "/suite/findings.json", "/suite");

  assert.equal(comparison.status, "fail", "a genuine one-section drift flips the overall comparison to fail");
  assert.equal(comparison.sections.roles.status, "fail", "the roles section itself is marked fail");
  assert.equal(comparison.sections.roles.reason, "Role parity changed.", "the fail reason names the section's own title, not a generic string");

  const otherSections = ALL_METRIC_SECTIONS.filter((spec) => spec.section !== "roles" && spec.section !== "workflow");
  for (const spec of otherSections) {
    assert.equal(comparison.sections[String(spec.section)].status, "pass", `section ${spec.section} must still pass — the drift is isolated to roles only, not a blanket failure`);
  }

  assert.equal(comparison.findings.length, 1, "exactly one finding is minted for the one genuinely drifted section");
  assert.deepEqual(
    { id: comparison.findings[0].id, severity: comparison.findings[0].severity, category: comparison.findings[0].category },
    { id: "regression-roles", severity: "error", category: "roles" },
    "the finding names the drifted section by id/category exactly"
  );
}

// Multiple genuinely different sections -> multiple independent findings, one per drifted section, and the
// UNCHANGED sections still pass — confirms compare walks all 31 sections independently, not short-circuiting.
{
  const baseline = baseNormalized();
  const driftedReplay = JSON.parse(JSON.stringify(baseline));
  driftedReplay.failures = ["a-new-failure-not-in-baseline"];
  driftedReplay.candidateScores = [];
  const replay = replayEnvelope(driftedReplay);
  const comparison = compareNormalized("snapshot-1", "/suite/snapshot.json", baseline, replay, NOW, "/suite/comparison.json", "/suite/findings.json", "/suite");

  assert.equal(comparison.sections.failures.status, "fail", "failures section flagged");
  assert.equal(comparison.sections.candidateScores.status, "fail", "candidateScores section flagged (emptied array differs from baseline's non-empty one)");
  assert.equal(comparison.sections.roles.status, "pass", "roles (untouched) still passes");
  assert.equal(comparison.sections.groups.status, "pass", "groups (untouched) still passes");
  assert.equal(comparison.findings.length, 2, "exactly two findings, one per genuinely drifted section");
}

// The special-cased replay_completed metric: baseline is SYNTHESIZED as always-completed/zero-errors —
// a replay with a non-empty errors array or non-"completed" status must fail THIS metric specifically,
// even when every other section still matches structurally.
{
  const baseline = baseNormalized();
  const cleanReplayNormalized = JSON.parse(JSON.stringify(baseline));
  const replay = replayEnvelope(cleanReplayNormalized, { status: "failed", errors: ["boom"] });
  const comparison = compareNormalized("snapshot-1", "/suite/snapshot.json", baseline, replay, NOW, "/suite/comparison.json", "/suite/findings.json", "/suite");
  assert.equal(comparison.sections.workflow.status, "fail", "replay_completed metric (keyed under 'workflow' section id) fails when replay status/errors diverge from the always-clean synthesized baseline");
  assert.equal(comparison.sections.roles.status, "pass", "an unrelated section (roles) still passes even though replay_completed failed");
}

// Re-derivation is not merely "same object reference passes, different fails" — construct baseline
// and replay from ENTIRELY SEPARATE literal objects with the same logical content and confirm they
// still compare equal (true structural equality, not reference/memoization based).
{
  const baseline = { workflow: { id: "w-1" }, roles: ["role-a", "role-b"], groups: [], memberships: [], fanouts: [], fanins: [], dependencyEdges: [], failures: [], blackboardRecords: [], messageProvenance: [], rolePolicies: [], permissionDecisions: [], blackboardWriteAudit: [], judgeRationales: [], panelDecisions: [], policyViolations: [], evidenceAdoption: [], candidateScores: [], selectedCandidates: [], verifierCommitGate: [], reportSections: [], topologyShape: [] };
  const separatelyConstructedReplayNormalized = { topologyShape: [], groups: [], memberships: [], fanouts: [], fanins: [], dependencyEdges: [], failures: [], blackboardRecords: [], messageProvenance: [], rolePolicies: [], permissionDecisions: [], blackboardWriteAudit: [], judgeRationales: [], panelDecisions: [], policyViolations: [], evidenceAdoption: [], candidateScores: [], selectedCandidates: [], verifierCommitGate: [], reportSections: [], roles: ["role-b", "role-a"].reverse(), workflow: { id: "w-1" } };
  const replay = replayEnvelope(separatelyConstructedReplayNormalized);
  const comparison = compareNormalized("snapshot-1", "/suite/snapshot.json", baseline, replay, NOW, "/suite/comparison.json", "/suite/findings.json", "/suite");
  assert.equal(comparison.sections.roles.status, "pass", "two independently-built objects with the same logical roles array (built via .reverse() to different array identity) compare equal via replayStableStringify, not reference equality");
}

process.stdout.write("macollab-eval-compare-redetects-drift: ok\n");
