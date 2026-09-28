#!/usr/bin/env node
"use strict";

// phase-overlap-smoke — proves the `overlapPrevious` phase option end to
// end through `cw -q`, black box.
//
// The default architecture-review app's Assess phase now carries
// `{ overlapPrevious: true }` and `maxConcurrentAgents: 12`: all 6 Map +
// 6 Assess workers dispatch together in ONE concurrent round instead of
// Map completing before Assess starts, and Verify (which reads
// previous-phase results) still sees every one of their 12 results. The
// architecture-review-fast app is untouched: no phase has the flag, and
// its Assess phase only starts once its Map phase has fully completed.
//
// Black box through scripts/cw.js, with a stub agent that writes a valid
// cw:result at once (same shape as test/quickstart-fast-smoke.js).

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cwBin = path.join(pluginRoot, "scripts", "cw.js");
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-phase-overlap-")));

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
  const inputPath = path.join(runDir, "workers", `worker-${taskId}-0001`, "input.md");
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

    // All 12 Map+Assess tasks were dispatched together: one single
    // concurrent-round commit covering all 12, not two separate rounds.
    const roundCommits = (s.commits || []).map((c) => c.reason).filter((reason) => reason && reason.startsWith("concurrent-round:"));
    assert.deepEqual(roundCommits, ["concurrent-round:12-tasks"], "Map and Assess dispatch as one 12-task concurrent round, not two");

    const mapTasks = s.tasks.filter((t) => t.phase === "Map");
    const assessTasks = s.tasks.filter((t) => t.phase === "Assess");
    assert.equal(mapTasks.length, 6);
    assert.equal(assessTasks.length, 6);
    const maxMapCompleted = Math.max(...mapTasks.map((t) => Date.parse(t.completedAt)));
    const minAssessDispatched = Math.min(...assessTasks.map((t) => Date.parse(t.dispatchedAt)));
    assert.ok(
      minAssessDispatched < maxMapCompleted,
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

  // 2. architecture-review-fast is untouched: no overlapPrevious anywhere,
  // and Assess only starts after Map has fully completed.
  {
    const dir = repo("fast");
    const r = json(cw(["-q", "How does routing work?", "--fast", "--json"], dir), "cw -q --fast");
    assert.equal(r.appId, "architecture-review-fast");
    assert.equal(r.status, "complete");
    assert.equal(r.plannedWorkers, 6);
    assert.equal(r.completedWorkers, 6);

    const s = state(r);
    for (const p of s.phases) assert.notEqual(p.overlapPrevious, true, `--fast phase ${p.id} carries no overlapPrevious`);

    const roundCommits = (s.commits || []).map((c) => c.reason).filter((reason) => reason && reason.startsWith("concurrent-round:"));
    assert.deepEqual(roundCommits, ["concurrent-round:2-tasks", "concurrent-round:2-tasks"], "Map and Assess dispatch as two separate 2-task rounds");

    const mapTasks = s.tasks.filter((t) => t.phase === "Map");
    const assessTasks = s.tasks.filter((t) => t.phase === "Assess");
    assert.equal(mapTasks.length, 2);
    assert.equal(assessTasks.length, 2);
    const maxMapCompleted = Math.max(...mapTasks.map((t) => Date.parse(t.completedAt)));
    const minAssessDispatched = Math.min(...assessTasks.map((t) => Date.parse(t.dispatchedAt)));
    assert.ok(minAssessDispatched > maxMapCompleted, "every --fast Assess task is dispatched only after every Map task has completed");

    console.log("phase-overlap: --fast keeps Map/Assess serial, no overlapPrevious OK");
  }

  console.log("phase-overlap-smoke: ok");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
