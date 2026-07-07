#!/usr/bin/env node
// macollab-eval-score-and-gate — eval-replay.ts's scoreComparison and
// buildGate: per-metric point scoring, verdict ship/hold, and the gate's
// anti-staleness checks (rejecting a comparison/score built from the
// WRONG snapshot/replay pairing).
//
// BYTE-COMPAT invariant 13 [load-bearing]: "Eval gate anti-staleness" —
// the gate refuses a comparison whose paths.baselinePath is not the
// suite's snapshot.json, and a score whose replayId/comparisonPath do
// not match.
//
// Evidence: SPEC/multi-agent.md section I ("scoreMultiAgentReplay",
// "gateMultiAgentEval" rows), invariant 13, thrown-string list.

const assert = require("node:assert/strict");
const { scoreComparison, buildGate, ALL_METRIC_SECTIONS } = require("../dist/core/multi-agent/eval-replay");

const NOW = "2026-07-03T00:00:00.000Z";

function passingComparison() {
  const sections = {};
  for (const spec of ALL_METRIC_SECTIONS) {
    const id = String(spec.section);
    sections[id] = { id, status: "pass", baselineRef: `/suite/snapshot.json#/normalized/${id}`, replayRef: `/suite/replay-run.json#/replay/${id}`, reason: `${spec.title} matches.` };
  }
  return {
    schemaVersion: 1,
    baselineId: "snapshot-1",
    replayId: "snapshot-1-replay",
    comparedAt: NOW,
    status: "pass",
    paths: { suiteDir: "/suite", baselinePath: "/suite/snapshot.json", replayPath: "/suite/replay-run.json", comparisonPath: "/suite/comparison.json", findingsPath: "/suite/findings.json" },
    sections,
    findings: [],
  };
}

// scoreComparison: all sections passing -> status pass, score === maxScore, one metric per ALL_METRIC_SECTIONS entry.
{
  const comparison = passingComparison();
  const score = scoreComparison(comparison, NOW, "/suite/score.json");
  assert.equal(score.status, "pass", "all-passing comparison scores as pass");
  assert.equal(score.metrics.length, 31, "exactly 31 metrics, one per ALL_METRIC_SECTIONS entry");
  assert.equal(score.maxScore, 31, "maxScore is 1 point per metric, 31 total");
  assert.equal(score.score, 31, "score equals maxScore when every metric passed");
}

// scoreComparison: one failing section -> that metric scores 0, status flips to fail, but maxScore is unchanged.
{
  const comparison = passingComparison();
  comparison.sections.roles = { id: "roles", status: "fail", baselineRef: "b", replayRef: "r", reason: "Role parity changed." };
  comparison.status = "fail";
  const score = scoreComparison(comparison, NOW, "/suite/score.json");
  assert.equal(score.status, "fail", "any failing metric flips overall status to fail");
  assert.equal(score.maxScore, 31, "maxScore stays 31 regardless of pass/fail mix");
  assert.equal(score.score, 30, "score drops by exactly 1 for the one failing metric");
  const roleMetric = score.metrics.find((m) => m.id === "role_parity");
  assert.equal(roleMetric.status, "fail", "the role_parity metric itself is marked fail");
  assert.equal(roleMetric.score, 0, "a failed metric scores 0 points");
  assert.equal(roleMetric.reason, "Role parity changed.", "metric reason is copied from the comparison section's reason");
}

// scoreComparison: a section entirely MISSING from comparison.sections (defensive gap) is treated as failed with a "missing" reason.
{
  const comparison = passingComparison();
  delete comparison.sections.roles;
  const score = scoreComparison(comparison, NOW, "/suite/score.json");
  const roleMetric = score.metrics.find((m) => m.id === "role_parity");
  assert.equal(roleMetric.status, "fail", "a missing section is treated as a failed metric, not silently skipped");
  assert.match(roleMetric.reason, /Role parity missing\./, "missing-section reason names the metric title with a 'missing.' suffix");
}

// buildGate: happy path — all required artifacts present, matching paths -> verdict ship, status pass.
{
  const comparison = passingComparison();
  const score = scoreComparison(comparison, NOW, "/suite/score.json");
  const gate = buildGate("/suite", "/suite/snapshot.json", "/suite/replay-run.json", "/suite/comparison.json", "/suite/score.json", "/suite/report.md", comparison, score, NOW, "suite-1");
  assert.equal(gate.status, "pass", "matching, all-passing artifacts -> gate status pass");
  assert.equal(gate.verdict, "ship", "matching, all-passing artifacts -> verdict ship");
  assert.equal(gate.nextAction, "Eval replay gate passed; include artifacts in release evidence.", "ship verdict uses the exact ship next-action string");
  assert.deepEqual(gate.requiredArtifacts, ["/suite/snapshot.json", "/suite/replay-run.json", "/suite/comparison.json", "/suite/score.json", "/suite/report.md"], "requiredArtifacts lists all five artifact paths in order");
}

// buildGate: any error-severity finding on the score -> verdict hold even if score.status happens to say pass
// (defensive: the gate re-checks findings itself, not just trusting score.status).
{
  const comparison = passingComparison();
  const score = scoreComparison(comparison, NOW, "/suite/score.json");
  score.status = "pass"; // force pass...
  score.findings = [{ id: "regression-roles", severity: "error", category: "roles", reason: "Role parity changed.", baselineRef: "b", replayRef: "r" }]; // ...but attach a real error finding anyway
  const gate = buildGate("/suite", "/suite/snapshot.json", "/suite/replay-run.json", "/suite/comparison.json", "/suite/score.json", "/suite/report.md", comparison, score, NOW, "suite-1");
  assert.equal(gate.verdict, "hold", "an error-severity finding forces hold even when score.status itself says pass");
  assert.equal(gate.nextAction, "Review regression findings, update replay rationale if the change is intentional, then rerun eval gate.", "hold verdict uses the exact hold next-action string");
}

// buildGate: warning-severity findings alone (no error severity) do NOT force a hold.
{
  const comparison = passingComparison();
  const score = scoreComparison(comparison, NOW, "/suite/score.json");
  score.findings = [{ id: "note-1", severity: "warning", category: "roles", reason: "cosmetic", baselineRef: "b", replayRef: "r" }];
  const gate = buildGate("/suite", "/suite/snapshot.json", "/suite/replay-run.json", "/suite/comparison.json", "/suite/score.json", "/suite/report.md", comparison, score, NOW, "suite-1");
  assert.equal(gate.verdict, "ship", "warning-only findings (no error severity) do not force a hold");
}

// ANTI-STALENESS: buildGate throws when comparison.paths.baselinePath does NOT match the suite's snapshotPath argument.
{
  const comparison = passingComparison();
  comparison.paths.baselinePath = "/suite/OLD-snapshot.json"; // stale — from a previous snapshot
  const score = scoreComparison(comparison, NOW, "/suite/score.json");
  assert.throws(
    () => buildGate("/suite", "/suite/snapshot.json", "/suite/replay-run.json", "/suite/comparison.json", "/suite/score.json", "/suite/report.md", comparison, score, NOW, "suite-1"),
    /Eval gate found stale comparison artifact for \/suite\/OLD-snapshot\.json; rerun eval compare \/suite\/snapshot\.json \/suite\/replay-run\.json/,
    "a comparison built against a different (stale) snapshot path throws the exact stale-comparison message"
  );
}

// ANTI-STALENESS: buildGate throws when score.replayId does not match comparison.replayId (score computed from a DIFFERENT comparison run).
{
  const comparison = passingComparison();
  const score = scoreComparison(comparison, NOW, "/suite/score.json");
  score.replayId = "some-other-replay-id";
  assert.throws(
    () => buildGate("/suite", "/suite/snapshot.json", "/suite/replay-run.json", "/suite/comparison.json", "/suite/score.json", "/suite/report.md", comparison, score, NOW, "suite-1"),
    /Eval gate found stale score artifact for some-other-replay-id; rerun eval score \/suite\/replay-run\.json/,
    "a score whose replayId does not match the comparison's replayId throws the exact stale-score message"
  );
}

// ANTI-STALENESS: buildGate throws when score.paths.comparisonPath does not match the comparisonPath argument (score built from a stale comparison.json).
{
  const comparison = passingComparison();
  const score = scoreComparison(comparison, NOW, "/suite/score.json");
  score.paths.comparisonPath = "/suite/OLD-comparison.json";
  assert.throws(
    () => buildGate("/suite", "/suite/snapshot.json", "/suite/replay-run.json", "/suite/comparison.json", "/suite/score.json", "/suite/report.md", comparison, score, NOW, "suite-1"),
    /Eval gate found stale score artifact/,
    "a score whose stored comparisonPath diverges from the comparisonPath argument throws the stale-score message too"
  );
}

process.stdout.write("macollab-eval-score-and-gate: ok\n");
