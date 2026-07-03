#!/usr/bin/env node
"use strict";

// report.md — the fixed section order and the exact `cw report` CLI
// surface (bare path on stdout, --json path shape). Uses the single-task
// end-to-end-golden-path app so the whole thing runs in a couple seconds
// (the 14-worker architecture-review is reserved for pipeline-*.case.js).

const fs = require("node:fs");
const { run, gitRepo, readJson, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const drive = run(
    ["run", "end-to-end-golden-path", "--drive", "--question", "prove it", "--repo", repo, "--json"],
    { env: stubAgentEnv("a.txt:1") }
  );
  assert.equal(drive.status, 0);
  const payload = JSON.parse(drive.stdout);
  const runId = payload.runId;

  // --- cw report <id> prints ONLY the path + newline ---
  const rep = run(["report", runId], { cwd: repo });
  assert.equal(rep.status, 0);
  assert.equal(rep.stderr, "");
  assert.equal(rep.stdout, payload.reportPath + "\n");

  // --- cw report <id> --json prints {"path": "..."} ---
  const repJson = run(["report", runId, "--json"], { cwd: repo });
  assert.equal(repJson.status, 0);
  assert.deepEqual(JSON.parse(repJson.stdout), { path: payload.reportPath });

  // --- report.md fixed section order ---
  const report = fs.readFileSync(payload.reportPath, "utf8");
  assert.match(report, /^# End-to-End Golden Path\n/);
  assert.match(report, /\n- Run: end-to-end-golden-path-\S+\n/);
  assert.match(report, /\n- Workflow: end-to-end-golden-path\n/);
  assert.match(report, /\n- Workflow App: end-to-end-golden-path@\d+\.\d+\.\d+\n/);
  assert.match(report, /\n- Workflow App Source: .*app\.json\n/);
  assert.match(report, /\n- Created: \d{4}-\d\d-\d\dT/);
  assert.match(report, /\n- Repository: /);
  assert.match(report, /\n- Question: prove it\n/);
  assert.match(report, /\n- Loop Stage: /);

  const sectionOrder = [
    "## Phase Status",
    "## State Commits",
    "## Error Feedback",
    "## Workers",
    "## State Size & Compaction",
    "## Multi-Agent Runtime",
    "## Blackboard / Coordinator",
    "## Sandbox Profiles",
    "## Trust Audit",
    "## Acceptance Rationale",
    "## Candidates",
    "## Pending Tasks",
    "## Results",
  ];
  let cursor = -1;
  for (const heading of sectionOrder) {
    const at = report.indexOf(heading);
    assert.ok(at >= 0, `missing section: ${heading}`);
    assert.ok(at > cursor, `section out of order: ${heading}`);
    cursor = at;
  }

  // Fixed empty-section lines for the sections that are empty on this run.
  assert.ok(report.includes("No feedback records.\n"));
  assert.ok(report.includes("No multi-agent runtime records yet.\n"));
  assert.ok(report.includes("No blackboard records yet.\n"));
  assert.ok(report.includes("No accepted candidate or verifier-gated commit rationale yet.\n"));
  assert.ok(report.includes("No candidates yet.\n"));
  assert.ok(report.includes("No pending tasks.\n"));

  // --- ## Results result-body shape: "### <taskId>" blank "Result: <path>"
  // blank <trimmed body> blank — this exact shape is what bundle verify
  // anchors on (see report-bundle-and-export.case.js).
  const resultsSection = report.slice(report.indexOf("## Results"));
  assert.match(resultsSection, /### golden:path\n\nResult: .*results[\\/]golden:path\.md\n\n/);
  assert.ok(resultsSection.includes("stub-agent: deterministic canned result"));

  // --- Phase Status table ---
  assert.match(report, /\| Phase \| Status \| Completed \| Total \|\n\| --- \| --- \| ---: \| ---: \|\n/);
  assert.match(report, /\| Golden Path \| completed \| 1 \| 1 \|/);

  // --- writeReport re-writes the whole file each call (a projection, not
  // a store): calling cw report again must not duplicate sections.
  run(["report", runId], { cwd: repo });
  const reportAgain = fs.readFileSync(payload.reportPath, "utf8");
  const occurrences = reportAgain.split("## Results").length - 1;
  assert.equal(occurrences, 1, "report.md must not accumulate duplicate sections on repeat writes");

  // --- state.json id matches the run id (sanity on the state file itself) ---
  const state = readJson(payload.statePath);
  assert.equal(state.id, runId);
});
