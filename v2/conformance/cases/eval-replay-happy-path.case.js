#!/usr/bin/env node
"use strict";

// cw eval snapshot|replay|compare|score|gate|report -- the multi-agent
// eval/replay harness driven end to end over a completed stub-agent run
// (the pipeline-question-basic pattern). Pins: snapshot/replay/comparison/
// score/gate/report file shapes and paths, the 31-metric score/comparison
// section set, the exit-code contract (compare and score always exit 0 even
// on a "fail" verdict; only gate is fail-closed), and the "ship" verdict
// plus report.md fixed section layout on a real match.

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, readJson, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const repo = fs.realpathSync(gitRepo({ "a.txt": "hello\n" }));
  const done = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(done.status, 0, done.stderr);
  const donePayload = JSON.parse(done.stdout);
  const runId = donePayload.runId;
  assert.equal(donePayload.status, "complete");

  const suiteDir = path.join(repo, ".cw", "evals", `${runId}-snapshot`);
  const snapshotPath = path.join(suiteDir, "snapshot.json");
  const replayPath = path.join(suiteDir, "replay-run.json");

  // --- eval snapshot <run-id> ---
  const snap = run(["eval", "snapshot", runId, "--json"], { cwd: repo });
  assert.equal(snap.status, 0, snap.stderr);
  const snapPayload = JSON.parse(snap.stdout);
  assert.equal(snapPayload.schemaVersion, 1);
  assert.equal(snapPayload.kind, "multi-agent-replay-snapshot");
  assert.equal(snapPayload.id, `${runId}-snapshot`, "default snapshot id is <run-id>-snapshot");
  assert.equal(snapPayload.runId, runId);
  assert.ok(fs.existsSync(snapshotPath), "snapshot.json must exist on disk");
  assert.ok(fs.existsSync(path.join(suiteDir, "suite.json")), "suite.json must exist on disk");

  const suite = readJson(path.join(suiteDir, "suite.json"));
  assert.equal(suite.cases.length, 1, "suite starts with exactly one case");
  assert.equal(suite.cases[0].expectedVerdict, "pass");
  assert.equal(suite.cases[0].snapshotId, snapPayload.id);

  // --- eval replay <snapshot-path> ---
  const replay = run(["eval", "replay", snapshotPath, "--json"], { cwd: repo });
  assert.equal(replay.status, 0, replay.stderr);
  const replayPayload = JSON.parse(replay.stdout);
  assert.equal(replayPayload.schemaVersion, 1);
  assert.equal(replayPayload.kind, "multi-agent-replay-run");
  assert.equal(replayPayload.id, `${snapPayload.id}-replay`, "default replay id is <snapshot-id>-replay");
  assert.equal(replayPayload.status, "completed");
  assert.deepEqual(replayPayload.errors, []);
  assert.ok(fs.existsSync(replayPath), "replay-run.json must exist on disk");

  // --- eval compare <baseline> <replay> ---
  const compare = run(["eval", "compare", snapshotPath, replayPath, "--json"], { cwd: repo });
  assert.equal(compare.status, 0, compare.stderr, "compare exits 0 even though this is the compare step itself");
  const comparePayload = JSON.parse(compare.stdout);
  assert.equal(comparePayload.schemaVersion, 1);
  assert.equal(comparePayload.baselineId, snapPayload.id);
  assert.equal(comparePayload.replayId, replayPayload.id);
  assert.equal(comparePayload.status, "pass", "identical baseline/replay must compare equal");
  assert.deepEqual(comparePayload.findings, [], "no regression findings on a real match");
  assert.ok(fs.existsSync(path.join(suiteDir, "comparison.json")));
  assert.ok(fs.existsSync(path.join(suiteDir, "findings.json")));

  // 31 metric sections, exact set and order per the eval-replay harness spec.
  const METRIC_IDS = [
    "replay_completed", "graph_parity", "role_parity", "group_parity",
    "membership_parity", "fanout_parity", "fanin_parity", "dependency_parity",
    "failure_parity", "blackboard_record_parity", "evidence_adoption_parity",
    "trust_audit_parity", "role_policy_parity", "permission_decision_parity",
    "policy_violation_parity", "blackboard_provenance_parity", "judge_rationale_parity",
    "panel_decision_parity", "candidate_score_parity", "selection_parity",
    "verifier_commit_gate_parity", "report_parity",
    "summary_freshness", "compact_graph_parity", "blackboard_digest_parity",
    "critical_path_parity", "evidence_digest_parity", "expansion_ref_integrity",
    "reasoning_freshness", "reasoning_chain_parity", "reasoning_unexplained_parity",
  ];
  assert.equal(METRIC_IDS.length, 31, "sanity: this test's own metric-id list must total 31");

  // --- eval score <replay-run-path> ---
  const score = run(["eval", "score", replayPath, "--json"], { cwd: repo });
  assert.equal(score.status, 0, score.stderr, "score exits 0 even on a fail verdict, let alone pass");
  const scorePayload = JSON.parse(score.stdout);
  assert.equal(scorePayload.schemaVersion, 1);
  assert.equal(scorePayload.replayId, replayPayload.id);
  assert.equal(scorePayload.status, "pass");
  assert.equal(scorePayload.score, 31);
  assert.equal(scorePayload.maxScore, 31);
  assert.deepEqual(scorePayload.metrics.map((m) => m.id), METRIC_IDS, "all 31 sections in fixed order");
  for (const m of scorePayload.metrics) {
    assert.equal(m.status, "pass", `metric ${m.id} must pass on a real match`);
    assert.equal(m.score, m.maxScore);
  }
  assert.ok(fs.existsSync(path.join(suiteDir, "score.json")));

  // --- eval gate <suite-dir> --- (fail-closed: requires all 4 artifacts)
  const gate = run(["eval", "gate", suiteDir, "--json"], { cwd: repo });
  assert.equal(gate.status, 0, gate.stderr);
  const gatePayload = JSON.parse(gate.stdout);
  assert.equal(gatePayload.schemaVersion, 1);
  assert.equal(gatePayload.suiteId, snapPayload.id);
  assert.equal(gatePayload.status, "pass");
  assert.equal(gatePayload.verdict, "ship", "score passed and no error findings -> ship");
  assert.equal(gatePayload.score, 31);
  assert.deepEqual(gatePayload.findings, []);
  assert.ok(fs.existsSync(path.join(suiteDir, "gate.json")));

  // --- eval report <suite-dir> ---
  const report = run(["eval", "report", suiteDir], { cwd: repo });
  assert.equal(report.status, 0, report.stderr);
  const reportPath = path.join(suiteDir, "report.md");
  assert.ok(fs.existsSync(reportPath));
  const reportText = fs.readFileSync(reportPath, "utf8");
  assert.match(reportText, /^# Multi-Agent Eval Replay Report/);
  assert.match(reportText, /## Final Verdict\nPASS/);
  for (const heading of [
    "## Eval Suite", "## Replay Status", "## Graph Comparison", "## Evidence Comparison",
    "## Trust / Policy / Audit Comparison", "## Candidate Score Comparison",
    "## Selection / Commit Gate", "## Regression Findings", "## Next Action",
  ]) {
    assert.ok(reportText.includes(heading), `report.md must include section ${heading}`);
  }

  // Timestamps/paths in every artifact are scrubbed for determinism.
  const rawSnapshot = fs.readFileSync(snapshotPath, "utf8");
  assert.ok(rawSnapshot.includes("<tmp>"), "the run dir under TMPDIR must be scrubbed to <tmp> in normalized output");
});
