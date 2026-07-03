#!/usr/bin/env node
"use strict";

// Every JSON file CW writes must be JSON.stringify(value, null, 2) plus
// exactly one trailing "\n" -- no more, no less. This is checked across
// state.json, nodes/*.json, commits/*.json, and a worker's worker.json,
// using one real stub-agent run so all four dirs exist for real.

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, readJson, caseMain, assert, stubAgentEnv } = require("../lib");

function assertExactJsonBytes(file) {
  const raw = fs.readFileSync(file, "utf8");
  const value = JSON.parse(raw);
  const expected = JSON.stringify(value, null, 2) + "\n";
  assert.equal(raw, expected, `${file} must be JSON.stringify(value, null, 2) + "\\n"`);
  // exactly one trailing newline: strip it once, the rest must have none
  assert.ok(raw.endsWith("\n"), `${file} must end with a newline`);
  assert.ok(!raw.endsWith("\n\n"), `${file} must not end with two newlines`);
}

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const r = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  const runDir = path.dirname(payload.statePath);

  // state.json itself
  assertExactJsonBytes(payload.statePath);

  // nodes/*.json -- at least a few, and every one found
  const nodesDir = path.join(runDir, "nodes");
  const nodeFiles = fs.readdirSync(nodesDir).filter((f) => f.endsWith(".json"));
  assert.ok(nodeFiles.length > 5, "expected several node files");
  for (const f of nodeFiles) assertExactJsonBytes(path.join(nodesDir, f));

  // commits/*.json
  const commitsDir = path.join(runDir, "commits");
  const commitFiles = fs.readdirSync(commitsDir).filter((f) => f.endsWith(".json"));
  assert.ok(commitFiles.length >= 1, "expected at least one commit file");
  for (const f of commitFiles) assertExactJsonBytes(path.join(commitsDir, f));

  // workers/index.json and one worker.json under a worker subdir
  const workersDir = path.join(runDir, "workers");
  assertExactJsonBytes(path.join(workersDir, "index.json"));
  const workerSubdirs = fs
    .readdirSync(workersDir, { withFileTypes: true })
    .filter((d) => d.isDirectory());
  assert.ok(workerSubdirs.length >= 1, "expected at least one worker dir");
  const workerJson = path.join(workersDir, workerSubdirs[0].name, "worker.json");
  assert.ok(fs.existsSync(workerJson), "worker.json must exist in a worker dir");
  assertExactJsonBytes(workerJson);

  // state.json parses back to the same schema-1 shape we expect
  const state = readJson(payload.statePath);
  assert.equal(state.schemaVersion, 1);
});
