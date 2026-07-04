#!/usr/bin/env node
"use strict";

// cw -q "..." with a deterministic stub agent runs the architecture-review app
// end to end: every worker accepted, run status complete, a report.md and
// state.json written under .cw/runs/<id>/.

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, readJson, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const r = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(r.status, 0);

  const payload = JSON.parse(r.stdout);
  assert.equal(payload.status, "complete");
  assert.equal(payload.parkedWorkers, 0);
  assert.equal(payload.completedWorkers, payload.plannedWorkers);
  assert.ok(payload.reportPath && fs.existsSync(payload.reportPath), "report.md must exist");
  assert.ok(payload.statePath && fs.existsSync(payload.statePath), "state.json must exist");

  const state = readJson(payload.statePath);
  assert.equal(state.id, payload.runId);

  const report = fs.readFileSync(payload.reportPath, "utf8");
  assert.match(report, /^# Architecture Review/);
  assert.match(report, /- Run: architecture-review-/);

  const commitsDir = path.join(path.dirname(payload.statePath), "commits");
  assert.ok(fs.existsSync(commitsDir), "commits/ dir must exist");
  const commitFiles = fs.readdirSync(commitsDir).filter((f) => f.endsWith(".json"));
  assert.ok(commitFiles.length >= 1, "at least one commit file");
  for (const f of commitFiles) {
    const raw = fs.readFileSync(path.join(commitsDir, f), "utf8");
    assert.ok(raw.endsWith("\n"), `${f} must end with a trailing newline`);
    assert.doesNotThrow(() => JSON.parse(raw), `${f} must be valid JSON`);
  }
});
