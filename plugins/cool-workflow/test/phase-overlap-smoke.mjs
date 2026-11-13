#!/usr/bin/env node
// phase-overlap-smoke — proves the `overlapPrevious` phase option end to
// end through `cw -q`, black box.
//
// The default architecture-review app's Assess phase now carries
// `{ overlapPrevious: true }` and `maxConcurrentAgents: 12`: all 6 Map +
// 6 Assess workers dispatch together in ONE concurrent round instead of
// Map completing before Assess starts, and Verify (which reads
// previous-phase results) still sees every one of their 12 results.
//
// Black box through scripts/cw.js, with a stub agent that writes a valid
// cw:result at once (same shape as test/quickstart-fast-smoke.mjs).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cwBin = path.join(pluginRoot, "scripts", "cw.js");
const work = tmpDir("cw-phase-overlap-");

const agent = path.join(work, "agent.js");
fs.writeFileSync(
  agent,
  [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const body = '# R\\n\\n' + fence + 'cw:result\\n' + JSON.stringify({ summary: 'stub answer', findings: [], evidence: ['README.md:1'] }) + '\\n' + fence + '\\n';",
    "fs.writeFileSync(process.argv[3], body);",
    "process.stdout.write(JSON.stringify({ model: 'stub-overlap' }));",
  ].join("\n"),
  "utf8"
);

function repo(name) {
  const dir = path.join(work, name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "README.md"), "# target\n", "utf8");
  spawnSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

function cw(args, cwd) {
  const env = { ...process.env, CW_AGENT_COMMAND: `node ${agent} {{input}} {{result}}`, CW_NO_AUTO_AGENT: "1", CW_NO_OPEN: "1" };
  delete env.CW_AGENT_ENDPOINT;
  delete env.CW_AGENT_STREAM;
  return spawnSync(process.execPath, [cwBin, ...args], { cwd, env, encoding: "utf8", timeout: 120000 });
}

function json(child, label) {
  assert.equal(child.status, 0, `${label} exits 0 (stderr: ${child.stderr})`);
  return JSON.parse(child.stdout);
}

function state(result) {
  return JSON.parse(fs.readFileSync(result.statePath, "utf8"));
}

function workerInput(result, taskId) {
  const runDir = path.dirname(result.statePath);
  // The folder is the task's workerId: worker-map:x-0001.
  const { workerId } = state(result).tasks.find((t) => t.id === taskId);
  const inputPath = path.join(runDir, "workers", workerId, "input.md");
  return fs.readFileSync(inputPath, "utf8");
}

try {
  // 1. Default architecture-review: overlapPrevious ships on Assess only,
  // and all 12 Map/Assess workers actually dispatch in one round.
  {
    const dir = repo("default");
    const r = json(cw(["-q", "How does routing work?", "--json"], dir), "cw -q");
    assert.equal(r.appId, "architecture-review");
    assert.equal(r.status, "complete");
    assert.equal(r.plannedWorkers, 14);
    assert.equal(r.completedWorkers, 14);

    const s = state(r);

    const overlapping = s.phases.filter((p) => p.overlapPrevious === true);
    assert.equal(overlapping.length, 1, "exactly one phase carries overlapPrevious");
    assert.equal(overlapping[0].id, "assess", "it is the Assess phase");
    for (const p of s.phases) {
      if (p.id !== "assess") assert.notEqual(p.overlapPrevious, true, `phase ${p.id} does not carry overlapPrevious`);
    }

    // All 12 Map+Assess tasks were dispatched together, in one round.
    assert.equal((s.commits || []).length, 1, "one state commit, when the run is done");

    const mapTasks = s.tasks.filter((t) => t.phase === "Map");
    const assessTasks = s.tasks.filter((t) => t.phase === "Assess");
    assert.equal(mapTasks.length, 6);
    assert.equal(assessTasks.length, 6);
    const maxMapCompleted = Math.max(...mapTasks.map((t) => Date.parse(t.completedAt)));
    const minAssessStarted = Math.min(...assessTasks.map((t) => Date.parse(t.startedAt)));
    assert.ok(
      minAssessStarted <= Math.min(...mapTasks.map((t) => Date.parse(t.completedAt))) && minAssessStarted < maxMapCompleted,
      "some Assess task was dispatched before every Map task had completed (real overlap, not just a shared commit label)"
    );

    // Verify's worker input embeds every one of the 12 Map/Assess results
    // (its resultCache.includeCompletedResults: "previous-phases").
    const verifyInput = workerInput(r, "verify:p0-p2-risks");
    for (const t of [...mapTasks, ...assessTasks]) {
      assert.match(verifyInput, new RegExp(`BEGIN PRIOR RESULT: ${t.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(`), `Verify's input includes ${t.id}'s prior result`);
    }

    console.log("phase-overlap: default architecture-review overlaps Map/Assess in one round OK");
  }

  console.log("phase-overlap-smoke: ok");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
