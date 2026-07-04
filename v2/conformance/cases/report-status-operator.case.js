#!/usr/bin/env node
"use strict";

// cw status / cw graph — the operator console surface. No-id advice text,
// --json summarizeRun shape, --summary short form, and the deterministic
// run graph (sorted nodes/edges, byte-clean of ANSI when piped).

const { run, gitRepo, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const emptyRepo = gitRepo({ "a.txt": "hello\n" });

  // --- no run id: fixed "No run selected" + next-action advice ---
  const noRun = run(["status"], { cwd: emptyRepo });
  assert.equal(noRun.status, 0);
  assert.equal(noRun.stderr, "");
  assert.match(noRun.stdout, /^No run selected\n/);
  assert.ok(noRun.stdout.includes("Next Action"));
  assert.ok(
    noRun.stdout.includes("plan <workflow-id> --repo"),
    "advice must name a real cw CLI command, not a made-up one"
  );

  // --- drive a tiny run to get a real id to inspect ---
  const repo = gitRepo({ "a.txt": "hello\n" });
  const drive = run(
    ["run", "end-to-end-golden-path", "--drive", "--question", "prove it", "--repo", repo, "--json"],
    { env: stubAgentEnv("a.txt:1") }
  );
  const payload = JSON.parse(drive.stdout);
  const runId = payload.runId;

  // --- cw status <id> --json: summarizeRun shape ---
  const stJson = run(["status", runId, "--json"], { cwd: repo });
  assert.equal(stJson.status, 0);
  assert.equal(stJson.stderr, "");
  assert.ok(!/\x1b\[/.test(stJson.stdout));
  const summary = JSON.parse(stJson.stdout);
  assert.equal(summary.runId, runId);
  assert.equal(summary.workflowId, "end-to-end-golden-path");

  // --- cw status <id> --summary: fixed short human form ---
  const stSummary = run(["status", runId, "--summary"], { cwd: repo });
  assert.equal(stSummary.status, 0);
  assert.equal(stSummary.stderr, "");
  assert.match(stSummary.stdout, new RegExp(`^Run: ${runId}\\n`));
  assert.match(stSummary.stdout, /\nWorkflow: end-to-end-golden-path \(end-to-end-golden-path@\d+\.\d+\.\d+\)\n/);
  assert.match(stSummary.stdout, /\nPhase: .* \| Stage: .* \| Blocked: (no|.+)\n/);
  assert.match(stSummary.stdout, /\nTasks: .*; total=1\n/);
  assert.match(stSummary.stdout, /\nNext Action\n/);
  assert.ok(stSummary.stdout.includes("(use --verbose for full worker/candidate/feedback/commit/trust panels)"));

  // --brief is the documented alias for --summary; same shape.
  const stBrief = run(["status", runId, "--brief"], { cwd: repo });
  assert.equal(stBrief.stdout, stSummary.stdout);

  // --- cw status <id> (full human) adds panels beyond the summary ---
  const stFull = run(["status", runId], { cwd: repo });
  assert.equal(stFull.status, 0);
  assert.equal(stFull.stderr, "");
  for (const panel of ["Workers", "Candidates", "Feedback", "Commits", "Trust Audit"]) {
    assert.ok(stFull.stdout.includes(panel), `full status must include the ${panel} panel`);
  }
  assert.ok(stFull.stdout.includes(`Report: ${payload.reportPath}`));

  // --- cw operator status <id> --json is a DIFFERENT, wider payload than
  // cw status --json (summarizeOperatorRun vs summarizeRun) — same runId
  // and workflowId, but its own extra panels (candidates, trust, etc).
  const opStatus = run(["operator", "status", runId, "--json"], { cwd: repo });
  assert.equal(opStatus.status, 0);
  assert.equal(opStatus.stderr, "");
  const opSummary = JSON.parse(opStatus.stdout);
  assert.equal(opSummary.runId, runId);
  assert.equal(opSummary.workflowId, "end-to-end-golden-path");
  for (const key of ["candidates", "feedback", "commits", "trust", "nextActions"]) {
    assert.ok(key in opSummary, `operator status must carry the ${key} panel`);
  }

  // --- cw graph <id> --json: deterministic sorted nodes/edges ---
  const graph = run(["graph", runId, "--json"], { cwd: repo });
  assert.equal(graph.status, 0);
  assert.equal(graph.stderr, "");
  const g = JSON.parse(graph.stdout);
  assert.equal(g.runId, runId);
  assert.ok(Array.isArray(g.nodes) && g.nodes.length > 0);
  assert.ok(Array.isArray(g.edges));
  // Nodes sort by kind then id — re-fetch and confirm stability.
  const graphAgain = JSON.parse(run(["graph", runId, "--json"], { cwd: repo }).stdout);
  assert.deepEqual(graphAgain.nodes, g.nodes, "graph node order must be deterministic across calls");
  assert.deepEqual(graphAgain.edges, g.edges, "graph edge order must be deterministic across calls");

  // --- cw graph <id> human form ---
  const graphHuman = run(["graph", runId], { cwd: repo });
  assert.equal(graphHuman.stderr, "");
  assert.match(graphHuman.stdout, new RegExp(`^Run Graph: ${runId}\\n`));
  assert.ok(graphHuman.stdout.includes("Nodes"));
  assert.ok(graphHuman.stdout.includes("Edges"));

  // --- an unknown run id fails the same way for status/report/graph:
  // "cw: File not found: ..." plus exit 1, never a made-up view.
  //
  // The trailing "  Try: cw ...\n" recovery-hint line is content-based
  // (cli.js recoveryHint scans the lowercased message for words like
  // "app"/"not found"/"run id"). It is normally absent for a plain file-not-found
  // path, but the harness's own random tmp dir name (cw-conf-XXXXXX) can
  // incidentally spell a trigger word (e.g. "...UApPOP..." contains "app"),
  // which then adds a "Try: cw app list" line. That is real old-build
  // behavior driven by path contents, not a run-id-shaped failure, so accept
  // either form here instead of asserting the hint line is always absent.
  const missing = run(["status", "no-such-run-id", "--json"], { cwd: repo });
  assert.equal(missing.status, 1);
  assert.match(
    missing.stderr,
    /^cw: File not found: .*no-such-run-id.*state\.json\n(  Try: cw [^\n]+\n)?$/
  );
  assert.equal(missing.stdout, "");
});
