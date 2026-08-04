#!/usr/bin/env node
// macollab-eval-replay-fingerprint — closes the P1 "eval-replay staleness
// check is vacuously-true path-equality" finding
// (examples/audits/self-audit-cool-workflow-v0.2.6.md): comparison.paths.
// replayPath === replayPath was always true (replayPath is a fixed,
// deterministic path per suite), so a rerun of `eval replay` with
// genuinely different content at the SAME path was treated as still
// fresh. This pins replayContentFingerprint (identical content -> the
// same fingerprint; genuinely different content -> a different one) and
// buildGate's new content-freshness check.

const assert = require("node:assert/strict");
const { compareNormalized, buildGate, replayContentFingerprint, METRIC_SECTIONS } = require("../dist/core/multi-agent/eval-replay");

const NOW = "2026-08-04T00:00:00.000Z";

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

// --- replayContentFingerprint: identical content -> identical fingerprint,
// even across separately-constructed objects (not reference equality). ---
{
  const a = baseNormalized();
  const b = JSON.parse(JSON.stringify(a));
  assert.equal(replayContentFingerprint(a), replayContentFingerprint(b), "structurally identical replay content must fingerprint identically");
}

// --- genuinely different content -> a different fingerprint. ---
{
  const a = baseNormalized();
  const b = JSON.parse(JSON.stringify(a));
  b.failures = ["a-new-failure"];
  assert.notEqual(replayContentFingerprint(a), replayContentFingerprint(b), "genuinely different replay content must fingerprint differently");
}

// --- compareNormalized embeds the REPLAY's fingerprint on the comparison it
// builds (not the baseline's) -- this is what a caller persists and later
// re-checks against a fresh replay-run.json. ---
{
  const baseline = baseNormalized();
  const replayContent = JSON.parse(JSON.stringify(baseline));
  const replay = replayEnvelope(replayContent);
  const comparison = compareNormalized("snapshot-1", "/suite/snapshot.json", baseline, replay, NOW, "/suite/comparison.json", "/suite/findings.json", "/suite");
  assert.equal(comparison.replayFingerprint, replayContentFingerprint(replayContent), "comparison.replayFingerprint must match the replay content it was built from");
}

// --- buildGate: a comparison whose replayFingerprint no longer matches the
// CURRENT replay-run.json content is stale and must be refused, even when
// every path/id in the comparison/score still lines up (the exact bug: path
// equality alone let this through). ---
{
  const baseline = baseNormalized();
  const originalReplay = JSON.parse(JSON.stringify(baseline));
  const replay = replayEnvelope(originalReplay);
  const comparisonPath = "/suite/comparison.json";
  const scorePath = "/suite/score.json";
  const snapshotPath = "/suite/snapshot.json";
  const replayRunPath = "/suite/replay-run.json";
  const reportPath = "/suite/report.md";

  const comparison = compareNormalized("snapshot-1", snapshotPath, baseline, replay, NOW, comparisonPath, "/suite/findings.json", "/suite");
  const score = { schemaVersion: 1, replayId: comparison.replayId, scoredAt: NOW, status: "pass", score: 1, maxScore: 1, metrics: [], findings: [], paths: { suiteDir: "/suite", comparisonPath, scorePath } };

  // The gate passes when the current replay content is exactly what the
  // comparison was built from.
  const freshGate = buildGate("/suite", snapshotPath, replayRunPath, comparisonPath, scorePath, reportPath, comparison, score, NOW, "suite-1", replayContentFingerprint(originalReplay));
  assert.equal(freshGate.status, "pass", "gate must pass when the current replay content matches what the comparison was built from");

  // replay-run.json was overwritten with genuinely different content since
  // this comparison was built (a rerun of `eval replay` after the baseline
  // changed) -- the gate must refuse to ship on stale evidence, exactly the
  // scenario the audit found silently passing.
  const mutatedReplayContent = JSON.parse(JSON.stringify(originalReplay));
  mutatedReplayContent.failures = ["a-regression-that-appeared-after-this-comparison-was-built"];
  assert.throws(
    () => buildGate("/suite", snapshotPath, replayRunPath, comparisonPath, scorePath, reportPath, comparison, score, NOW, "suite-1", replayContentFingerprint(mutatedReplayContent)),
    /stale comparison artifact/,
    "buildGate must refuse a comparison whose replayFingerprint no longer matches the current replay-run.json content"
  );
}

process.stdout.write("macollab-eval-replay-fingerprint: ok\n");
