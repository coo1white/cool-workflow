#!/usr/bin/env node
// resume-parked-smoke — a resume takes a parked run to the end.
//
// A worker whose agent hop fails past its retry budget parks the run. After
// the cause is fixed, `cw --resume --run <id>` runs that worker again, with a
// fresh budget, and the run completes with a PASS verdict. If the agent still
// fails, the worker parks again after the fresh budget, so a resume never
// loops. Nothing of the park is lost. Only the retry-budget park is reopened.
//
// Black box: every step goes through scripts/cw.js, as a user would type it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cwBin = path.join(pluginRoot, "scripts", "cw.js");
const work = tmpDir("cw-resume-parked-");

// One stub agent for every step. It fails (exit 1, no result.md) for a task
// named in the file FAIL (one id a line) until the file FIXED exists: "the
// cause is fixed". Files, not env: CW hands the agent child only a fixed set
// of env vars.
const agent = path.join(work, "agent.js");
const fixedFlag = path.join(work, "FIXED");
const failList = path.join(work, "FAIL");
fs.writeFileSync(
  agent,
  [
    'const fs = require("fs");',
    "const [input, result] = process.argv.slice(2);",
    "const text = fs.readFileSync(input, 'utf8');",
    `const failing = fs.existsSync(${JSON.stringify(failList)}) ? fs.readFileSync(${JSON.stringify(failList)}, 'utf8').split('\\n').filter(Boolean) : [];`,
    `if (!fs.existsSync(${JSON.stringify(fixedFlag)}) && failing.some((id) => text.includes(id))) { process.stderr.write('agent down'); process.exit(1); }`,
    "const fence = String.fromCharCode(96).repeat(3);",
    "const body = '# R\\n\\n' + fence + 'cw:result\\n' + JSON.stringify({ summary: 'stub answer', findings: [], evidence: ['README.md:1'] }) + '\\n' + fence + '\\n';",
    "fs.writeFileSync(result, body);",
    "process.stdout.write(JSON.stringify({ model: 'stub-resume-parked' }));",
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

function cw(args, cwd, failTasks) {
  fs.writeFileSync(failList, failTasks ? `${failTasks}\n` : "");
  const env = { ...process.env, CW_AGENT_COMMAND: `node ${agent} {{input}} {{result}}`, CW_NO_AUTO_AGENT: "1", CW_NO_OPEN: "1" };
  delete env.CW_AGENT_ENDPOINT;
  delete env.CW_AGENT_STREAM;
  const child = spawnSync(process.execPath, [cwBin, ...args, "--json"], { cwd, env, encoding: "utf8", timeout: 120000 });
  const out = JSON.parse(child.stdout);
  // A `cw -q` or `cw --resume` run that stops (blocked, parked) exits 2.
  const stopped = out.status === "blocked" || out.status === "parked";
  assert.equal(child.status, stopped ? 2 : 0, `cw ${args.join(" ")} exits ${stopped ? 2 : 0} (stderr: ${child.stderr})`);
  return out;
}

function state(dir, runId) {
  return JSON.parse(fs.readFileSync(path.join(dir, ".cw", "runs", runId, "state.json"), "utf8"));
}

function verdictLine(s) {
  return fs.readFileSync(s.paths.report, "utf8").split("\n").find((line) => line.startsWith("- Verdict"));
}

const FAILING = "map:server-api";

function attempts(result) {
  return result.steps.filter((step) => step.taskId === FAILING && (step.action === "fulfill" || step.action === "park")).map((step) => `${step.action}@${step.attempts}`);
}

try {
  // 1. Park, resume while still failing, then fix.
  {
    fs.rmSync(fixedFlag, { force: true });
    const dir = repo("park");
    const parked = cw(["-q", "how does it work"], dir, FAILING);
    assert.equal(parked.status, "parked");
    assert.equal(parked.parkedWorkers, 1);
    assert.deepEqual(attempts(parked), ["fulfill@1", "fulfill@2", "park@3"]);
    assert.equal(parked.reopenedWorkers, undefined, "a first drive reopens nothing");
    const runId = parked.runId;
    assert.equal(state(dir, runId).tasks.find((t) => t.id === "map:web-client").status, "completed", "the worker next to it passed");

    const again = cw(["--resume", "--run", runId], dir, FAILING);
    assert.equal(again.status, "parked", "an agent that still fails parks again");
    assert.deepEqual(again.reopenedWorkers, [FAILING]);
    assert.deepEqual(attempts(again), ["fulfill@1", "fulfill@2", "park@3"], "a resume gives a fresh budget of 3 tries, then stops");
    assert.match(again.hint, /^a worker failed and stopped after its retries\. What the agent said is in \.cw[\\/]runs[\\/]\S+[\\/]logs[\\/]agent-stderr\.log — fix the cause, then run: cw --resume --run (\S+)$/, "the hint names the agent's log");
    assert.ok(again.hint.endsWith(`cw --resume --run ${runId}`));

    fs.writeFileSync(fixedFlag, "fixed\n");
    const done = cw(["--resume", "--run", runId], dir, FAILING);
    assert.equal(done.status, "complete", "a resume takes the parked run to the end");
    assert.deepEqual(done.reopenedWorkers, [FAILING]);
    assert.equal(done.completedWorkers, done.plannedWorkers);
    assert.equal(done.parkedWorkers, 0);
    assert.ok(done.commitId, "the run commits");
    assert.equal(done.steps.filter((step) => step.action === "accept" && step.taskId === "map:web-client").length, 0, "a worker that passed is not run again");

    const s = state(dir, runId);
    assert.equal(verdictLine(s), "- Verdict: PASS", "the report verdict is PASS, not BLOCKED by the old park");
    const task = s.tasks.find((t) => t.id === FAILING);
    assert.equal(task.errors.filter((e) => e.code === "agent-delegation-parked").length, 2, "both parks stay on the record");
    assert.match(task.errors.find((e) => e.code === "agent-delegation-parked").message, /\(attempt 3\/3\)$/);
    assert.equal(s.commits.length, 1, "one final commit");

    // A resume of a run with nothing parked adds no key (POLA).
    const noop = cw(["--resume", "--run", runId], dir, "");
    assert.equal(noop.status, "complete");
    assert.equal("reopenedWorkers" in noop, false);
    console.log("resume-parked: park, fresh budget, fixed, PASS OK");
  }

  // 2. Only the retry-budget park is reopened: a task whose last error is
  //    anything else stays failed.
  {
    fs.rmSync(fixedFlag, { force: true });
    const dir = repo("other-stop");
    const parked = cw(["-q", "how does it work"], dir, FAILING);
    const file = path.join(dir, ".cw", "runs", parked.runId, "state.json");
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    s.tasks.find((t) => t.id === FAILING).errors.push({ code: "worker-boundary-violation", message: "wrote outside its folder", at: s.updatedAt });
    fs.writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`);

    fs.writeFileSync(fixedFlag, "fixed\n");
    const stays = cw(["--resume", "--run", parked.runId], dir, FAILING);
    assert.notEqual(stays.status, "complete");
    assert.equal(stays.parkedWorkers, 1);
    assert.equal("reopenedWorkers" in stays, false, "a non-park stop is never reopened");
    console.log("resume-parked: a non-park stop stays failed OK");
  }

  console.log("resume-parked-smoke: ok");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
