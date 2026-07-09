#!/usr/bin/env node
"use strict";

// cw metrics show / summary — derived, honest metrics. Rates over zero
// samples are n/a (never 0%/100%), cost defaults to unpriced with no
// pricing policy, the snapshot file is written under metrics/, and
// --now only ever touches generatedAt (the payload is otherwise stable).

const path = require("node:path");
const { run, gitRepo, readJson, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const drive = run(
    ["run", "end-to-end-golden-path", "--drive", "--question", "prove it", "--repo", repo, "--json"],
    { env: stubAgentEnv("a.txt:1") }
  );
  const payload = JSON.parse(drive.stdout);
  const runId = payload.runId;

  // --- cw metrics show <id> --json ---
  const met = run(["metrics", "show", runId, "--json", "--now", "2026-01-01T00:00:00.000Z"], { cwd: repo });
  assert.equal(met.status, 0);
  assert.equal(met.stderr, "");
  assert.ok(!/\x1b\[/.test(met.stdout));
  const report = JSON.parse(met.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.surface, "metrics");
  assert.equal(report.runId, runId);
  assert.equal(report.generatedAt, "2026-01-01T00:00:00.000Z", "--now only injects generatedAt");
  assert.match(report.sourceFingerprint, /^sha256:[0-9a-f]{32}$/);
  // metrics show pins the returned freshness to "valid".
  assert.equal(report.freshness.status, "valid");
  assert.equal(report.freshness.persistedFingerprint, report.freshness.currentFingerprint);

  // One worker did the work: verifier-pass is 1/1 (100%), failure-rate is
  // 0/1 (0%, a real zero because there IS a sample), candidate-acceptance
  // has zero samples so it must be the honest n/a, not 0% or 100%.
  assert.equal(report.rates.verifierPass.state, "ok");
  assert.equal(report.rates.verifierPass.rate, 1);
  assert.equal(report.rates.failure.state, "ok");
  assert.equal(report.rates.failure.rate, 0);
  assert.equal(report.rates.candidateAcceptance.state, "n/a");
  assert.equal(report.rates.candidateAcceptance.count, null);
  assert.equal(report.rates.candidateAcceptance.rate, null);

  // No pricing policy was given: cost is unpriced, not a fabricated number.
  assert.equal(report.cost.state, "unpriced");
  assert.equal(report.cost.attestedUsd, null);
  assert.equal(report.cost.estimatedUsd, null);

  // The stub agent reports no usage tokens, but it IS an attested worker
  // unit (host-attested delegation), so usage units/coverage are non-zero
  // while token counts stay honestly at 0, never invented.
  assert.equal(report.usage.units, 1);
  assert.equal(report.usage.inputTokens, 0);
  assert.equal(report.usage.outputTokens, 0);
  assert.deepEqual(report.usage.models, ["stub-agent-1"]);

  // --- calling metrics show again must not touch state.json (only the
  // metrics/ snapshot), and must be stable across repeats given the same
  // --now.
  const state1 = readJson(payload.statePath);
  const met2 = run(["metrics", "show", runId, "--json", "--now", "2026-01-01T00:00:00.000Z"], { cwd: repo });
  const state2 = readJson(payload.statePath);
  assert.deepEqual(state1, state2, "metrics show must never touch state.json");
  assert.equal(met2.stdout, met.stdout, "metrics show is byte-stable given a fixed --now");

  // --- the persisted snapshot file exists under metrics/ ---
  const snapshotPath = path.join(path.dirname(payload.statePath), "metrics", "metrics-report.json");
  const snapshot = readJson(snapshotPath);
  assert.equal(snapshot.runId, runId);
  assert.equal(snapshot.freshness.status, "valid");

  // --- human text carries the fixed line labels ---
  const human = run(["metrics", "show", runId, "--now", "2026-01-01T00:00:00.000Z"], { cwd: repo });
  assert.equal(human.stderr, "");
  assert.match(human.stdout, new RegExp(`^metrics ${runId}  \\[valid\\]  app=end-to-end-golden-path\\n`));
  assert.match(human.stdout, /  failure-rate: {4}0\.0% \(0\/1\)\n/);
  assert.match(human.stdout, /  verifier-pass: {3}100\.0% \(1\/1\)\n/);
  assert.match(human.stdout, /  cand-acceptance: n\/a \(0 samples\)\n/);
  assert.match(human.stdout, /  cost: {2}state=unpriced\n/);
  assert.ok(human.stdout.includes(`next: cw metrics show ${runId} --json`));

  // --- cw metrics summary --scope repo: cross-run rollup over this repo ---
  const summary = run(["metrics", "summary", "--json", "--now", "2026-01-01T00:00:00.000Z"], { cwd: repo });
  assert.equal(summary.status, 0);
  assert.equal(summary.stderr, "");
  const summaryReport = JSON.parse(summary.stdout);
  assert.ok(summaryReport.runCount >= 1);
  assert.equal(summaryReport.scope, "repo", "default metrics summary scope is repo");
  assert.equal(typeof summaryReport.unreadableRuns, "number");
});
