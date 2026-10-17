#!/usr/bin/env node
// perf-review-followup-set-scans -- perf cycle P1-1's follow-up.
//
// An adversarial-review Workflow on 024b007 ("use Sets for phase/task
// membership instead of array scans") found the SAME array-scan-per-item
// bug pattern still present at sibling sites. Chasing honest budgets for
// those surfaced 3 more real, independent O(N^2) bugs in the same call
// paths: 3 row-builders in trust-audit.ts (`workerRows`, `candidateRows`,
// `commitRows`) doing an `array.find()` per id instead of a Map lookup.
//
// The other sites this file once timed (the state-explosion compact graph,
// the multi-agent operator view, the blackboard message/artifact checks and
// the topology summary) went with the multi-agent family (slim-and-esm
// step 2). The trust-audit row builders stay: summarizeTrustAudit reads
// every run's workers and commits, and still reads the candidates and
// selections an older CW left in state.json.

import assert from "node:assert/strict";
import { summarizeTrustAudit } from "../../dist/shell/trust-audit.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------
// summarizeTrustAudit's worker/candidate/commit rows at scale. Measured
// live (2026-10-16, this test alone): with the Map lookups, N=4000/16000/
// 32000/64000 took about 190/590/980/1410ms -- near-linear. The per-id
// `array.find()` shape is ~3 x N^2/2 string compares (about 6e9 at
// N=64000), far past the 8000ms budget, which still leaves the fixed code a
// ~5x margin for a loaded CI host.
// ---------------------------------------------------------------------
{
  const N = 64000;
  const BUDGET_MS = 8000;
  const workers = [];
  const candidates = [];
  const candidateSelections = [];
  const commits = [];
  for (let i = 0; i < N; i++) {
    workers.push({ id: `worker-${i}`, taskId: `task-${i}`, status: "completed", sandboxProfileId: "readonly" });
    candidates.push({ id: `candidate-${i}`, scores: [], evidence: [] });
    candidateSelections.push({ id: `selection-${i}`, candidateId: `candidate-${i}` });
    commits.push({ id: `state-${i}`, verifierGated: false, evidence: [] });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-perf-followup-trust-"));
  const runDir = path.join(dir, "run");
  fs.mkdirSync(runDir, { recursive: true });
  const run = {
    id: "run-1",
    paths: { runDir },
    workers,
    candidates,
    candidateSelections,
    commits,
    feedback: [],
  };
  const start = process.hrtime.bigint();
  const summary = summarizeTrustAudit(run, { persist: false });
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(summary.workers.length, N, "one row per worker");
  assert.equal(summary.commits.length, N, "one row per commit");
  assert.ok(elapsedMs < BUDGET_MS, `summarizeTrustAudit at ${N} workers/candidates/commits took ${elapsedMs.toFixed(1)}ms, expected < ${BUDGET_MS}ms`);
  fs.rmSync(dir, { recursive: true, force: true });
}
