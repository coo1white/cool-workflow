#!/usr/bin/env node
// macollab-eval-report-lines — eval-replay.ts's buildReportLines: the
// fixed report.md section layout, byte-exact.
//
// Evidence: SPEC/multi-agent.md "report.md starts # Multi-Agent Eval
// Replay Report and has exactly these ## sections in order" list.

const assert = require("node:assert/strict");
const { buildReportLines, scoreComparison, ALL_METRIC_SECTIONS } = require("../dist/core/multi-agent/eval-replay");

const NOW = "2026-07-03T00:00:00.000Z";

function passingComparison() {
  const sections = {};
  for (const spec of ALL_METRIC_SECTIONS) {
    const id = String(spec.section);
    sections[id] = { id, status: "pass", baselineRef: "b", replayRef: "r", reason: `${spec.title} matches.` };
  }
  return { schemaVersion: 1, baselineId: "snapshot-1", replayId: "snapshot-1-replay", comparedAt: NOW, status: "pass", paths: { suiteDir: "/suite", baselinePath: "/suite/snapshot.json", replayPath: "/suite/replay-run.json", comparisonPath: "/suite/comparison.json", findingsPath: "/suite/findings.json" }, sections, findings: [] };
}

// Exact ## section headers, in exact order (this is the whole point of the byte-compat pin).
{
  const comparison = passingComparison();
  const score = scoreComparison(comparison, NOW, "/suite/score.json");
  const lines = buildReportLines("/suite", score);
  const headers = lines.filter((line) => line.startsWith("## "));
  assert.deepEqual(
    headers,
    [
      "## Eval Suite",
      "## Replay Status",
      "## Graph Comparison",
      "## Evidence Comparison",
      "## Trust / Policy / Audit Comparison",
      "## Candidate Score Comparison",
      "## Selection / Commit Gate",
      "## State Explosion Summaries",
      "## Evidence Adoption Reasoning Chain",
      "## Regression Findings",
      "## Final Verdict",
      "## Next Action",
    ],
    "report.md's ## sections appear in this exact order, with these exact titles"
  );
  assert.equal(lines[0], "# Multi-Agent Eval Replay Report", "report.md's very first line is the exact top-level title");
}

// PASS status -> "Final Verdict" body is exactly "PASS"; next-action body matches the ship phrasing.
{
  const comparison = passingComparison();
  const score = scoreComparison(comparison, NOW, "/suite/score.json");
  const lines = buildReportLines("/suite", score);
  const verdictIndex = lines.indexOf("## Final Verdict");
  assert.equal(lines[verdictIndex + 1], "PASS", "a passing score renders the literal PASS verdict body");
  const nextActionIndex = lines.indexOf("## Next Action");
  assert.equal(lines[nextActionIndex + 1], "Use this replay as release-gate evidence.", "a passing score's next-action body is the exact ship-oriented phrase");
}

// FAIL status -> "Final Verdict" body is exactly "FAIL"; next-action body matches the fix-it phrasing; Regression Findings lists them.
{
  const comparison = passingComparison();
  comparison.status = "fail";
  comparison.sections.roles = { id: "roles", status: "fail", baselineRef: "b", replayRef: "r", reason: "Role parity changed." };
  comparison.findings = [{ id: "regression-roles", severity: "error", category: "roles", reason: "Role parity changed between baseline and replay.", baselineRef: "b", replayRef: "r" }];
  const score = scoreComparison(comparison, NOW, "/suite/score.json");
  const lines = buildReportLines("/suite", score);
  const verdictIndex = lines.indexOf("## Final Verdict");
  assert.equal(lines[verdictIndex + 1], "FAIL", "a failing score renders the literal FAIL verdict body");
  const nextActionIndex = lines.indexOf("## Next Action");
  assert.equal(lines[nextActionIndex + 1], "Fix or explicitly classify the changed behavior before release.", "a failing score's next-action body is the exact fix-it phrase");
  const findingsIndex = lines.indexOf("## Regression Findings");
  assert.equal(lines[findingsIndex + 1], "- ERROR roles: Role parity changed between baseline and replay.", "a regression finding renders as '- <SEVERITY> <category>: <reason>'");
}

// No findings -> "Regression Findings" section body is the literal "- none" line.
{
  const comparison = passingComparison();
  const score = scoreComparison(comparison, NOW, "/suite/score.json");
  const lines = buildReportLines("/suite", score);
  const findingsIndex = lines.indexOf("## Regression Findings");
  assert.equal(lines[findingsIndex + 1], "- none", "no findings renders the literal '- none' body line");
}

// Metric lines use the exact "- <metric-id>: <status> - <reason>" template.
{
  const comparison = passingComparison();
  const score = scoreComparison(comparison, NOW, "/suite/score.json");
  const lines = buildReportLines("/suite", score);
  assert.ok(lines.includes("- replay_completed: pass - Replay completed matches."), "replay_completed metric line matches the exact template with its own title-based reason");
  assert.ok(lines.includes("- graph_parity: pass - Topology graph parity matches."), "graph_parity metric line matches the exact template");
}

// Suite/replay identity lines under "Eval Suite" and "Replay Status" carry the actual suiteDir/replayId/score values.
{
  const comparison = passingComparison();
  const score = scoreComparison(comparison, NOW, "/suite/score.json");
  const lines = buildReportLines("/my-suite-dir", score);
  assert.ok(lines.includes("- Suite: /my-suite-dir"), "Eval Suite section names the exact suiteDir argument passed in");
  assert.ok(lines.includes(`- Replay: ${score.replayId}`), "Eval Suite section names the score's replayId");
  assert.ok(lines.includes(`- Score: ${score.score}/${score.maxScore}`), "Replay Status section shows score/maxScore as '<n>/<n>'");
}

process.stdout.write("macollab-eval-report-lines: ok\n");
