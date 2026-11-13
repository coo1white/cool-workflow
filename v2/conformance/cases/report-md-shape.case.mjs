#!/usr/bin/env node

// report.md — the fixed section order and the exact `cw report` CLI
// surface (bare path on stdout, --json path shape). Uses the single-task
// architecture-review app (the one app left after batch 5) with a stub agent.

import fs from "node:fs";
import { run, gitRepo, readJson, caseMain, assert, stubAgentEnv } from "../lib.mjs";

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const drive = run(["-q", "prove it", "--repo", repo, "--json"], { env: stubAgentEnv("a.txt:1") });
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

  // --- with no run id, cw report takes the latest run ---
  const latest = run(["report"], { cwd: repo });
  assert.equal(latest.status, 0);
  assert.equal(latest.stdout, payload.reportPath + "\n");

  // --- report.md header ---
  const report = fs.readFileSync(payload.reportPath, "utf8");
  assert.match(report, /^# Architecture Review\n/);
  assert.match(report, /\n- Run: architecture-review-\S+\n/);
  assert.match(report, /\n- Workflow: architecture-review\n/);
  assert.match(report, /\n- Created: \d{4}-\d\d-\d\dT/);
  assert.match(report, /\n- Repository: /);
  assert.match(report, /\n- Question: prove it\n/);
  assert.match(report, /\n- Loop Stage: /);
  assert.ok(!/\n- Invariants:/.test(report), "no empty Invariants line");
  // One verifier-gated commit, its snapshot path shown from the run folder.
  assert.match(report, /\n- state-0001: agent-delegation-drive: all 14 workers accepted \[checkpoint; verifier-gated commit; verifier=verdict:synthesis, evidence=1\] \(commits\/state-0001\.json\)\n/);
  assert.ok(report.endsWith("\n"), "report.md ends with a newline");

  const sectionOrder = ["## Answer", "## Phase Status", "## Results", "## Pending Tasks", "## Telemetry", "## State Commits"];
  let cursor = -1;
  for (const heading of sectionOrder) {
    const at = report.indexOf(`\n${heading}\n`);
    assert.ok(at >= 0, `missing section: ${heading}`);
    assert.ok(at > cursor, `section out of order: ${heading}`);
    cursor = at;
  }
  // Sections of removed surfaces must stay gone.
  for (const gone of ["## Error Feedback", "## Workers", "## Sandbox Profiles", "## Trust Audit", "## State Size & Compaction", "## Multi-Agent Runtime", "## Candidates"]) {
    assert.ok(!report.includes(gone), `removed section must stay gone: ${gone}`);
  }
  assert.ok(report.includes("No pending tasks.\n"));

  // --- ## Results result-body shape: "### <taskId>" blank "Result: <path>"
  // blank <trimmed body> — the shape bundle verify anchors on.
  const resultsSection = report.slice(report.indexOf("## Results"));
  // The file name keeps ":" except on Windows, where ":" is not allowed in
  // a file name and becomes "_" (shell/fs-atomic.ts safeFileName).
  assert.match(resultsSection, /### verdict:synthesis\n\nResult: .*results[\\/]verdict[:_]synthesis\.md\n\n/);
  assert.ok(resultsSection.includes("stub-agent: deterministic canned result"));

  // --- Phase Status table ---
  assert.match(report, /\| Phase \| Status \| Completed \| Total \|\n\| --- \| --- \| ---: \| ---: \|\n/);
  assert.match(report, /\| Map \| completed \| 6 \| 6 \|/);
  assert.match(report, /\| Verdict \| completed \| 1 \| 1 \|/);

  // --- writing the report again re-writes the whole file: no duplicates.
  run(["report", runId], { cwd: repo });
  const reportAgain = fs.readFileSync(payload.reportPath, "utf8");
  assert.equal(reportAgain.split("\n## Results\n").length - 1, 1, "report.md must not accumulate duplicate sections on repeat writes");

  // --- state.json id matches the run id ---
  const state = readJson(payload.statePath);
  assert.equal(state.id, runId);
});
