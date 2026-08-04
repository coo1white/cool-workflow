#!/usr/bin/env node
"use strict";

// gc-reclamation-state-lock-smoke — regression guard for the self-audit's
// "cw gc run persists state.json outside the state.json lock" P1 finding
// (examples/audits/self-audit-cool-workflow-v0.2.6.md).
//
// prepareFree() (reclamation-io.ts) mutates run.nodes then durably persists
// run.paths.state via persistRunDurable(). Every OTHER writer of state.json
// (saveCheckpoint, withRunStateLock) holds the state.json lock (withFileLock)
// across that write; prepareFree's persist did not, so its write could land
// invisibly inside another locked writer's critical section with no
// coordination at all — "last writer wins" with no signal.
//
// This test simulates a concurrent holder of the state.json lock (a fresh,
// non-stale lock file, as a live process would leave) and asserts that
// prepareFree's persist BLOCKS until that holder releases it, rather than
// writing straight through. Before the fix this completes near-instantly
// (no coordination); after the fix it waits for the lock, same idiom as the
// "fresh-contended" case in fs-atomic-file-lock.test.js.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const { prepareFree } = require(path.join(pluginRoot, "dist", "shell", "reclamation-io.js"));

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-gc-lock-"));
const runDir = path.join(workDir, "run");
fs.mkdirSync(runDir, { recursive: true });
const statePath = path.join(runDir, "state.json");
fs.writeFileSync(statePath, JSON.stringify({ id: "r1", nodes: [] }), "utf8");

// Minimal WorkflowRun/ReclamationTombstone shape — prepareFree only reads
// run.nodes / run.paths and tombstone.freed, nothing else.
const run = { id: "r1", nodes: [], paths: { runDir, state: statePath } };
const tombstone = { freed: [{ path: "scratch/w1", kind: "scratch", bytes: 0, sha256: "x" }] };

// Plant a FRESH (non-stale) lock, as a live concurrent writer would hold.
const lockPath = `${statePath}.lock`;
fs.writeFileSync(lockPath, `999999@${new Date().toISOString()}\n`);

// Release it from a separate process after a short delay — withFileLock's
// retry loop is synchronous, so an in-process timer cannot fire during it.
const releaseAfterMs = 200;
const releaser = cp.spawn(
  process.execPath,
  [
    "-e",
    'setTimeout(() => { try { require("fs").rmSync(process.argv[1], { force: true }); } catch {} }, Number(process.argv[2]));',
    lockPath,
    String(releaseAfterMs),
  ],
  { stdio: "ignore" }
);

const before = Date.now();
prepareFree(run, tombstone);
const elapsed = Date.now() - before;
releaser.kill();

assert.ok(
  elapsed >= releaseAfterMs,
  `prepareFree must wait for the state.json lock instead of writing straight through ` +
    `(waited ${elapsed}ms, expected >= ${releaseAfterMs}ms — a concurrent holder of the lock was simulated)`
);

const persisted = JSON.parse(fs.readFileSync(statePath, "utf8"));
assert.ok(persisted.updatedAt, "prepareFree's persist still writes updatedAt");
assert.ok(!fs.existsSync(lockPath), "the lock is released after prepareFree's critical section");

process.stdout.write("gc-reclamation-state-lock-smoke: ok\n");
