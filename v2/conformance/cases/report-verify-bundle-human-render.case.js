#!/usr/bin/env node
"use strict";

// cw report verify-bundle's human render — a bare call used to be
// jsonMode:"default" (JSON-only, even on a TTY-less pipe a human reading
// stdout got a raw payload with no ✓/✗ summary). Now jsonMode:"flag":
// no flag prints formatReportVerifyBundle's human text (shell/
// report-cli.ts), `--json` still prints the exact same ReportBundleVerification
// payload as before (report-bundle.case.js/state-report-bundle.case.js pin
// that shape). Also pins the "Run not found: <id>" error `cw report
// <bad-id>` now gives instead of a raw internal state.json path.

const { run, gitRepo, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const drive = run(
    ["run", "end-to-end-golden-path", "--drive", "--question", "prove it", "--repo", repo, "--json"],
    { env: stubAgentEnv("a.txt:1") }
  );
  const payload = JSON.parse(drive.stdout);
  const runId = payload.runId;

  const bundle = run(["report", "bundle", runId], { cwd: repo });
  assert.equal(bundle.status, 0);
  const bundleResult = JSON.parse(bundle.stdout);

  // --- bare call: human text, not JSON ---
  const human = run(["report", "verify-bundle", bundleResult.archivePath], { cwd: repo });
  assert.equal(human.status, 0);
  assert.equal(human.stderr, "");
  assert.match(human.stdout, new RegExp(`^cw report verify-bundle ${bundleResult.archivePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n`));
  assert.match(human.stdout, /archive intact/);
  assert.match(human.stdout, /telemetry hash chain verifies/);
  assert.match(human.stdout, /trust-audit chain verifies/);
  assert.match(human.stdout, /report\.md matches every signed result/);
  assert.match(human.stdout, /^✓ bundle verifies$/m);
  assert.doesNotMatch(human.stdout, /"schemaVersion"/, "bare call must not print raw JSON");

  // --- --json: the exact machine payload, unaffected by the render change ---
  const json = run(["report", "verify-bundle", bundleResult.archivePath, "--json"], { cwd: repo });
  assert.equal(json.status, 0);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.archivePath, bundleResult.archivePath);

  // --- a missing archive path is not a thrown error — verifyReportBundle
  // catches it as a normal failed "archive-unreadable" check, so the bare
  // call still renders the human failure form (all ✗, a Failed checks
  // block, exit 1), never a raw file-path error ---
  const badArchive = require("node:path").join(repo, "does-not-exist.cwrun.json");
  const missingBundle = run(["report", "verify-bundle", badArchive], { cwd: repo });
  assert.equal(missingBundle.status, 1);
  assert.equal(missingBundle.stderr, "");
  assert.match(missingBundle.stdout, /^✗ bundle verification FAILED$/m);
  assert.match(missingBundle.stdout, /archive-unreadable/);

  // --- cw report <bad-run-id>: "Run not found: <id>", not a raw internal
  // state.json path (shell/run-store.ts's loadRunFromCwd) ---
  const badReport = run(["report", "no-such-run-id"], { cwd: repo });
  assert.equal(badReport.status, 1);
  assert.equal(badReport.stderr, "cw: Run not found: no-such-run-id\n  Try: cw run list\n");
  assert.equal(badReport.stdout, "");
});
