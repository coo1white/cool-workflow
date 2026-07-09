#!/usr/bin/env node
"use strict";

// summary-show-no-checkpoint-write-smoke — perf cycle P2-1.
//
// `cw summary show <run-id>` is a plain read: `showStateExplosionSummary`
// only loads the persisted summary index and builds a report from it, it
// never mutates the run. Before this fix, `summaryShowCli` unconditionally
// called `saveCheckpoint(run)` anyway -- a full durable (fsync) rewrite of
// the whole state.json on EVERY show, for zero actual change (bumping only
// `run.updatedAt` as an incidental side effect of a command whose entire
// job is to look, not touch). Measured live: 20 calls averaged 32.7ms/call
// before this fix, 22.5ms/call after (the remaining time is the real
// summary-report computation, not a write this fix could remove).
//
// Proven deterministically: state.json's exact bytes AND mtime must be
// IDENTICAL before and after several `summary show` calls -- a hard,
// exact-match assertion, not a wall-clock budget (see this whole batch's
// running note on why: wall-clock assertions are flaky under this repo's
// concurrent test suite; an exact byte/mtime comparison has no such
// flakiness at all).
//
// `summary refresh` (the sibling command, which DOES recompute + durably
// persist the summary data and therefore still legitimately calls
// saveCheckpoint) is intentionally left untouched by this fix and is
// proven here to still rewrite state.json, to make sure this test would
// have caught reverting the fix (had `summary show` still called
// saveCheckpoint too, this file's own no-op sibling wouldn't tell them
// apart) and to document the one still-legitimate write next to the one
// removed.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");

function cw(args, cwd) {
  return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-summary-show-nowrite-")));
fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
const cwd0 = process.cwd();
try {
  process.chdir(work);
  const planOut = JSON.parse(cw(["plan", "end-to-end-golden-path", "--repo", work, "--question", "summary show no-write"], work));
  const runId = planOut.runId;
  const statePath = planOut.statePath;

  // Seed a real summary index first (summary show on a run with none yet is
  // a valid, separately-conformance-tested "no summaries" state; seeding one
  // here just makes this test exercise the common case).
  cw(["summary", "refresh", runId], work);

  const beforeBytes = fs.readFileSync(statePath, "utf8");
  const beforeMtimeMs = fs.statSync(statePath).mtimeMs;

  for (let i = 0; i < 5; i++) {
    const shown = JSON.parse(cw(["summary", "show", runId, "--json"], work));
    assert.equal(shown.schemaVersion, 1, "summary show must still return a real report");
  }

  const afterBytes = fs.readFileSync(statePath, "utf8");
  const afterMtimeMs = fs.statSync(statePath).mtimeMs;

  assert.equal(afterBytes, beforeBytes, "state.json's exact bytes must be unchanged after several `summary show` calls -- it must never durably rewrite the run for a plain read");
  assert.equal(afterMtimeMs, beforeMtimeMs, "state.json's mtime must be unchanged after several `summary show` calls -- proves no write syscall happened at all, not just an unchanged-content write");

  // The sibling command that legitimately still recomputes + persists must
  // still actually rewrite state.json -- this fix only removed a REDUNDANT
  // write, not the file lock/checkpoint machinery itself.
  cw(["summary", "refresh", runId], work);
  const afterRefreshMtimeMs = fs.statSync(statePath).mtimeMs;
  assert.ok(afterRefreshMtimeMs > afterMtimeMs, "summary refresh must still rewrite state.json (it legitimately recomputes summaries) -- only summary show's redundant write was removed");
} finally {
  process.chdir(cwd0);
  fs.rmSync(work, { recursive: true, force: true });
}

process.stdout.write("summary-show-no-checkpoint-write-smoke: ok\n");
