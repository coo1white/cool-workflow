#!/usr/bin/env node
"use strict";

// The "readonly" sandbox profile boundary shows up byte-exact in a
// worker's own input.md (its only place a worker can see it) and in
// `cw sandbox show`. Both must agree: readPaths include the repo cwd and
// the worker's own dir, writePaths is empty, network mode is "none".

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, readJson, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  const show = run(["sandbox", "show", "readonly"], { cwd: repo });
  assert.equal(show.status, 0);
  const profile = JSON.parse(show.stdout);
  assert.equal(profile.id, "readonly");
  assert.equal(profile.title, "Readonly Workspace");
  assert.deepEqual(profile.writePaths, []);
  assert.equal(profile.network.mode, "none");
  assert.equal(profile.execute.mode, "any");
  assert.equal(profile.env.inherit, false);
  assert.deepEqual(profile.workerOutput, { result: true, artifacts: true, logs: true });
  assert.deepEqual(profile.enforcement.enforcedByCW, [
    "profile validation",
    "path normalization",
    "worker result acceptance against sandbox write policy",
    "durable ErrorFeedback for denied worker output",
  ]);
  assert.deepEqual(profile.enforcement.hostRequired, [
    "OS-level read isolation",
    "OS-level write isolation before result acceptance",
    "process execution restrictions",
    "network restrictions",
    "environment variable filtering",
  ]);

  // Now run the real single-worker app (readonly is its only declared
  // profile) and read the worker's own input.md.
  const r = run(["quickstart", "--app", "end-to-end-golden-path", "--question", "Prove it works"], {
    cwd: repo,
    env: stubAgentEnv("a.txt:1"),
  });
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.status, "complete");

  const runDir = path.dirname(payload.statePath);
  const workersDir = path.join(runDir, "workers");
  const workerId = fs.readdirSync(workersDir).find((f) => f.startsWith("worker-"));
  const workerDir = path.join(workersDir, workerId);
  const inputText = fs.readFileSync(path.join(workerDir, "input.md"), "utf8");

  assert.match(inputText, /^# Worker worker-golden:path-0001\n/);
  assert.match(inputText, /- Sandbox Profile: readonly\n/);
  assert.match(inputText, /## Boundary\n/);
  assert.ok(inputText.includes("- Write the final Markdown result to result.md.\n"));
  assert.ok(inputText.includes("- CW enforces result acceptance. The host is responsible for OS/process/network/environment sandbox enforcement.\n"));
  assert.ok(inputText.includes("- Do not mutate state.json, nodes/, feedback/, dispatches/, or commits/ directly.\n"));
  assert.match(inputText, /- Read paths: .*, .*worker-golden:path-0001\.\n/);
  assert.match(inputText, /- Write paths: .*result\.md, .*artifacts, .*logs\.\n/);

  // manifest.json's own sandbox block must be internally consistent with
  // the bundled "readonly" profile (same shape as `cw sandbox show`).
  const manifest = readJson(path.join(workerDir, "manifest.json"));
  assert.equal(manifest.sandboxProfileId, "readonly");
  assert.deepEqual(manifest.sandboxPolicy.writePaths, []);
  assert.equal(manifest.sandboxPolicy.network.mode, "none");
});
