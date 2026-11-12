#!/usr/bin/env node
// agent-placeholders-smoke — 0.4.2 (operator's named yes): an agent
// command can name {{phase}}, {{taskId}}, {{workerId}} and {{priorResults}}.
// {{priorResults}} is the path of <workerDir>/prior-results.json, which lists
// the earlier phases' result files; it is written only for a command that names
// the placeholder. Drives the bundled architecture-review-fast app (Map x2,
// Assess x2, Verify, Verdict) with a stub agent that logs what it was given.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadWorkflowApp } from "../dist/shell/workflow-app-loader.js";
import { plan } from "../dist/shell/pipeline.js";
import { drive } from "../dist/shell/drive.js";

const NOW = "2026-11-04T00:00:00.000Z";
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-agent-placeholders-")));
fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
const log = path.join(work, "calls.jsonl");
const stub = path.join(work, "stub.js");
fs.writeFileSync(stub, [
  'const fs = require("fs");',
  "const [rp, logFile, phase, taskId, workerId, prior] = process.argv.slice(2);",
  "const fence = String.fromCharCode(96).repeat(3);",
  'const priorBody = prior && fs.existsSync(prior) ? JSON.parse(fs.readFileSync(prior, "utf8")) : null;',
  "fs.appendFileSync(logFile, JSON.stringify({ phase, taskId, workerId, prior, priorBody }) + '\\n');",
  'fs.writeFileSync(rp, "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n");',
  'process.stdout.write(JSON.stringify({ model: "stub", usage: { input_tokens: 1, output_tokens: 1 } }));'
].join("\n"), "utf8");

const cwd0 = process.cwd();
process.chdir(work);
try {
  // With all four placeholders.
  const run = plan(loadWorkflowApp("architecture-review-fast"), { repo: work, question: "placeholders?" });
  const config = { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}", log, "{{phase}}", "{{taskId}}", "{{workerId}}", "{{priorResults}}"], source: "flag" };
  const done = drive(run.id, work, { now: NOW, agentConfig: config });
  assert.equal(done.status, "complete", JSON.stringify(done.steps?.slice(-1)));
  const calls = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(calls.length, 6, "six workers, six calls");
  const byTask = new Map(calls.map((c) => [c.taskId, c]));
  const phaseOf = Object.fromEntries(run.tasks.map((t) => [t.id, t.phase]));
  for (const c of calls) {
    assert.ok(c.taskId in phaseOf, `{{taskId}} is a real task id: ${c.taskId}`);
    assert.equal(c.phase, phaseOf[c.taskId], "{{phase}} is the task's phase");
    assert.ok(c.workerId && !c.workerId.includes("{{"), "{{workerId}} is filled");
    assert.ok(fs.statSync(path.dirname(c.prior)).isDirectory() && path.basename(path.dirname(c.prior)) === c.workerId, "prior-results.json sits in the worker's own folder");
    assert.equal(c.priorBody.schemaVersion, 1);
    assert.equal(c.priorBody.taskId, c.taskId);
    assert.equal(c.priorBody.phase, c.phase);
  }
  const ids = (c) => c.priorBody.priorResults.map((p) => p.taskId);
  const mapIds = run.tasks.filter((t) => t.phase === "Map").map((t) => t.id).sort();
  for (const t of mapIds) assert.deepEqual(ids(byTask.get(t)), [], "the first phase has no prior results");
  const assessId = run.tasks.find((t) => t.phase === "Assess").id;
  assert.deepEqual(ids(byTask.get(assessId)), mapIds, "Assess sees the Map results");
  const verdict = calls.find((c) => c.phase === "Verdict");
  assert.equal(ids(verdict).length, 5, "Verdict sees all five earlier results");
  for (const p of verdict.priorBody.priorResults) {
    assert.ok(path.isAbsolute(p.resultPath) && fs.existsSync(p.resultPath), "each listed result file exists");
    assert.equal(p.phase, phaseOf[p.taskId]);
  }

  // Without {{priorResults}}: no prior-results.json is written anywhere.
  const plain = plan(loadWorkflowApp("architecture-review-fast"), { repo: work, question: "no placeholders?" });
  const log2 = path.join(work, "calls2.jsonl");
  const plainDone = drive(plain.id, work, { now: NOW, agentConfig: { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}", log2], source: "flag" } });
  assert.equal(plainDone.status, "complete");
  const workers = path.join(work, ".cw", "runs", plain.id, "workers");
  const found = fs.readdirSync(workers).filter((d) => fs.existsSync(path.join(workers, d, "prior-results.json")));
  assert.deepEqual(found, [], "a command without {{priorResults}} writes no prior-results.json");
} finally {
  process.chdir(cwd0);
  fs.rmSync(work, { recursive: true, force: true });
}
process.stdout.write("agent-placeholders-smoke: ok ({{phase}} {{taskId}} {{workerId}} {{priorResults}})\n");
