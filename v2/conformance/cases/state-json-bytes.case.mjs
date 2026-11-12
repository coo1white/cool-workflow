#!/usr/bin/env node

// Every JSON file CW writes must be JSON.stringify(value, null, 2) plus
// exactly one trailing "\n" -- no more, no less. This is checked across
// state.json, commits/*.json, every worker's manifest.json and
// telemetry.json, using one real stub-agent run so they exist for real.

import fs from "node:fs";
import path from "node:path";
import { run, gitRepo, readJson, caseMain, assert, stubAgentEnv } from "../lib.mjs";

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

  // commits/*.json
  const commitsDir = path.join(runDir, "commits");
  const commitFiles = fs.readdirSync(commitsDir).filter((f) => f.endsWith(".json"));
  assert.ok(commitFiles.length >= 1, "expected at least one commit file");
  for (const f of commitFiles) assertExactJsonBytes(path.join(commitsDir, f));

  // every worker's manifest.json
  const workersDir = path.join(runDir, "workers");
  const manifests = fs
    .readdirSync(workersDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(workersDir, d.name, "manifest.json"))
    .filter((f) => fs.existsSync(f));
  assert.ok(manifests.length >= 1, "expected at least one worker manifest.json");
  for (const f of manifests) assertExactJsonBytes(f);

  // telemetry.json, when the run wrote one
  const telemetry = path.join(runDir, "telemetry.json");
  if (fs.existsSync(telemetry)) assertExactJsonBytes(telemetry);

  // state.json carries the batch-5 schema (2); older state is refused
  const state = readJson(payload.statePath);
  assert.equal(state.schemaVersion, 2);
});
