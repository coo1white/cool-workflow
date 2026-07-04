#!/usr/bin/env node
"use strict";

// --incremental keys EVERY task into a content-addressed result cache
// under <repo>/.cw/cache/worker-results/<workflow>/<task>-<32hex>.md. A
// second, separate run over the SAME repo with the same inputs must reuse
// the cached bytes instead of spawning the agent again: the accept step's
// handleKind becomes "result-cache" and its reason is the fixed string
// "result cache hit". Without --incremental (and no per-task resultCache
// opt-in) the same repeat run spawns the agent again every time.

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, stubAgentEnv, caseMain, assert } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const env = stubAgentEnv("a.txt:1");

  // First --incremental run: a fresh (process) hop, cache file written.
  let r = run(
    ["run", "end-to-end-golden-path", "--drive", "--incremental", "--question", "prove it", "--repo", repo, "--json"],
    { env }
  );
  assert.equal(r.status, 0);
  let payload = JSON.parse(r.stdout);
  assert.equal(payload.status, "complete");
  let acceptStep = payload.steps.find((s) => s.action === "accept");
  assert.equal(acceptStep.handleKind, "process");

  const cacheRoot = path.join(repo, ".cw", "cache", "worker-results", "end-to-end-golden-path");
  assert.ok(fs.existsSync(cacheRoot), "cache dir must exist after the first incremental run");
  const cacheFiles = fs.readdirSync(cacheRoot);
  assert.equal(cacheFiles.length, 1);
  assert.match(cacheFiles[0], /^golden:path-[0-9a-f]{32}\.md$/);
  const cacheBytesFirst = fs.readFileSync(path.join(cacheRoot, cacheFiles[0]), "utf8");

  // Second --incremental run, same repo/inputs: the accept step must be a
  // cache hit, and it must NOT re-spawn the stub agent (no new dispatch,
  // no new worker beyond the one used to copy in the cached bytes).
  r = run(
    ["run", "end-to-end-golden-path", "--drive", "--incremental", "--question", "prove it", "--repo", repo, "--json"],
    { cwd: repo, env }
  );
  assert.equal(r.status, 0);
  payload = JSON.parse(r.stdout);
  assert.equal(payload.status, "complete");
  acceptStep = payload.steps.find((s) => s.action === "accept");
  assert.equal(acceptStep.handleKind, "result-cache");
  assert.equal(acceptStep.reason, "result cache hit");

  // The cache file is unchanged (byte-identical, deterministic stub).
  const cacheBytesSecond = fs.readFileSync(path.join(cacheRoot, cacheFiles[0]), "utf8");
  assert.equal(cacheBytesSecond, cacheBytesFirst);

  // A THIRD run over the same repo WITHOUT --incremental (and no per-task
  // resultCache opt-in on this app) must not hit the cache — the agent is
  // invoked fresh again.
  r = run(
    ["run", "end-to-end-golden-path", "--drive", "--question", "prove it", "--repo", repo, "--json"],
    { cwd: repo, env }
  );
  assert.equal(r.status, 0);
  payload = JSON.parse(r.stdout);
  assert.equal(payload.status, "complete");
  acceptStep = payload.steps.find((s) => s.action === "accept");
  assert.equal(acceptStep.handleKind, "process", "no opt-in resultCache => no default caching");
});
