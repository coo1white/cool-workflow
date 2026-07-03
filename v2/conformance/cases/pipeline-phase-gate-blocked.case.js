#!/usr/bin/env node
"use strict";

// Phase-gate block on a multi-phase app: architecture-review-fast has Map
// (2 parallel tasks) -> Assess -> Verify -> Verdict. When one Map task
// parks and the other completes, the WHOLE Map phase never reaches
// "completed", so Assess/Verify/Verdict must never be dispatched — the
// phase gate stops the run, not just the one task.

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, caseMain, assert } = require("../lib");

// A selector agent: fails only for the task whose worker input path
// contains "map:operator-surface"; every other task succeeds with a
// minimal valid cw:result envelope.
const SELECTOR_SRC = `
const fs = require("node:fs");
const inputPath = process.argv[2];
const resultPath = process.argv[3];
if (inputPath.includes("map:operator-surface")) { process.exit(1); }
const body = "Stub finding.\\n\\n\`\`\`cw:result\\n" + JSON.stringify({ summary: "s", findings: [], evidence: ["a.txt:1"] }) + "\\n\`\`\`\\n";
fs.writeFileSync(resultPath, body, "utf8");
process.stdout.write(JSON.stringify({ model: "selector-agent" }) + "\\n");
`;

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const selectorPath = path.join(repo, ".selector-agent.js");
  fs.writeFileSync(selectorPath, SELECTOR_SRC, "utf8");
  const env = { CW_AGENT_COMMAND: `node ${selectorPath} {{input}} {{result}}` };

  const r = run(
    ["run", "architecture-review-fast", "--drive", "--concurrency", "1", "--question", "prove it", "--repo", repo, "--json"],
    { env }
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.status, "parked");
  assert.equal(payload.plannedWorkers, 6);
  assert.equal(payload.completedWorkers, 1, "the succeeding map task completed");
  assert.equal(payload.parkedWorkers, 1, "the failing map task parked");

  const acceptSteps = payload.steps.filter((s) => s.action === "accept");
  assert.equal(acceptSteps.length, 1);
  assert.equal(acceptSteps[0].taskId, "map:runtime-surface");

  // Continue driving: must block on the phase gate, must NOT touch Assess/
  // Verify/Verdict tasks and must NOT re-attempt the parked Map task.
  const cont = run(["run", "--drive", "--once", "--run", payload.runId, "--json"], { cwd: repo, env });
  assert.equal(cont.status, 0);
  const contPayload = JSON.parse(cont.stdout);
  assert.equal(contPayload.status, "blocked");
  assert.equal(contPayload.steps.length, 1);
  assert.equal(
    contPayload.steps[0].reason,
    "no eligible worker (a parked/failed worker blocks the phase gate)"
  );

  // On disk: only the two Map-phase workers were ever created.
  const runDir = path.dirname(payload.statePath);
  const workerDirs = fs.readdirSync(path.join(runDir, "workers")).filter((f) => f.startsWith("worker-"));
  assert.equal(workerDirs.length, 2);
  assert.ok(workerDirs.every((w) => w.includes("map:")), "no non-map worker was ever dispatched");
});
