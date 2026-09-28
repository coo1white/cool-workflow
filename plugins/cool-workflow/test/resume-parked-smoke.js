#!/usr/bin/env node
"use strict";

// resume-parked-smoke — a resume takes a parked run to the end.
//
// A worker whose agent hop fails past its retry budget parks the run. After
// the cause is fixed, `cw --resume --run <id>` (and `cw run resume <id>
// --drive`) runs that worker again, with a fresh budget, on the same dispatch,
// and the run completes with a PASS verdict. Plain `cw run --drive --run <id>`
// does not: a parked run stays blocked there (the v2 conformance case
// pipeline-park-vs-block pins it). If the agent still fails, the worker parks
// again after the fresh budget, so a resume never loops. Nothing of the park
// is lost. Only the retry-budget park is reopened.
//
// Black box: every step goes through scripts/cw.js, as a user would type it.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cwBin = path.join(pluginRoot, "scripts", "cw.js");
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-resume-parked-")));

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
  assert.equal(child.status, 0, `cw ${args.join(" ")} exits 0 (stderr: ${child.stderr})`);
  return JSON.parse(child.stdout);
}

function state(dir, runId) {
  return JSON.parse(fs.readFileSync(path.join(dir, ".cw", "runs", runId, "state.json"), "utf8"));
}

function auditEvents(dir, runId, kind) {
  const file = path.join(dir, ".cw", "runs", runId, "audit", "events.jsonl");
  return fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line)).filter((event) => event.kind === kind);
}

function verdictLine(s) {
  return fs.readFileSync(s.paths.report, "utf8").split("\n").find((line) => line.startsWith("- Verdict"));
}

function attempts(result) {
  return result.steps.filter((step) => step.action === "fulfill" || step.action === "park").map((step) => `${step.action}@${step.attempts}`);
}

try {
  // 1. One task: park, stay blocked, resume while still failing, then fix.
  {
    fs.rmSync(fixedFlag, { force: true });
    const dir = repo("golden");
    const parked = cw(["run", "end-to-end-golden-path", "--drive", "--question", "prove it", "--repo", dir], dir, "golden:path");
    assert.equal(parked.status, "parked");
    assert.deepEqual(attempts(parked), ["fulfill@1", "fulfill@2", "park@3"]);
    assert.equal(parked.reopenedWorkers, undefined, "a plain drive reopens nothing");
    const runId = parked.runId;

    const blocked = cw(["run", "--drive", "--once", "--run", runId], dir, "golden:path");
    assert.equal(blocked.status, "blocked", "plain run --drive does not reopen a parked worker");
    assert.equal(blocked.parkedWorkers, 1);
    assert.equal(blocked.reopenedWorkers, undefined);

    const again = cw(["--resume", "--run", runId], dir, "golden:path");
    assert.equal(again.status, "parked", "an agent that still fails parks again");
    assert.deepEqual(again.reopenedWorkers, ["golden:path"]);
    assert.deepEqual(attempts(again), ["fulfill@1", "fulfill@2", "park@3"], "a resume gives a fresh budget of 3 tries, then stops");
    assert.equal(again.hint, `a worker parked past its retry budget — inspect: cw run show ${runId}; fix the cause, then: cw --resume --run ${runId}`);

    fs.writeFileSync(fixedFlag, "fixed\n");
    const done = cw(["run", "resume", runId, "--drive"], dir, "golden:path");
    assert.equal(done.drive.status, "complete", "run resume --drive takes the parked run to the end");
    assert.deepEqual(done.drive.reopenedWorkers, ["golden:path"]);
    assert.equal(done.drive.completedWorkers, 1);
    assert.equal(done.drive.parkedWorkers, 0);
    assert.ok(done.drive.commitId, "the run commits");

    const s = state(dir, runId);
    assert.equal(verdictLine(s), "- Verdict: PASS", "the report verdict is PASS, not BLOCKED by the old park");
    const task = s.tasks.find((t) => t.id === "golden:path");
    const parks = s.feedback.filter((f) => f.code === "agent-delegation-parked");
    assert.equal(parks.length, 2, "both parks keep their feedback");
    for (const f of parks) {
      assert.equal(f.status, "resolved");
      assert.equal(f.resolvedByNodeId, task.verifierNodeId, "resolved by the retried worker's verifier node");
    }
    assert.equal(s.nodes.filter((n) => n.kind === "error").length, 2, "both parks keep their failure node");
    assert.equal(s.commits.filter((c) => c.reason.startsWith("dispatch:")).length, 1, "the reopen runs the same dispatch again, it does not dispatch anew");
    const reopens = auditEvents(dir, runId, "worker.reopen");
    assert.equal(reopens.length, 2, "each reopen is its own audit event");
    assert.equal(reopens[0].metadata.priorAttempts, 3);
    assert.match(reopens[0].metadata.parkedReason, /\(attempt 3\/3\)$/);

    const verify = spawnSync(process.execPath, [cwBin, "audit", "verify", runId, "--json"], { cwd: dir, encoding: "utf8" });
    assert.deepEqual(JSON.parse(verify.stdout).failedChecks, [], "the audit chain still verifies");

    // A resume of a run with nothing parked adds no key (POLA).
    const noop = cw(["--resume", "--run", runId], dir, "");
    assert.equal(noop.status, "complete");
    assert.equal("reopenedWorkers" in noop, false);
    console.log("resume-parked: one task — park, blocked, fresh budget, fixed, PASS OK");
  }

  // 2. A worker that parks inside a parallel phase, next to one that passed.
  {
    fs.rmSync(fixedFlag, { force: true });
    const dir = repo("fast");
    const parked = cw(["run", "architecture-review-fast", "--drive", "--question", "how does it work", "--repo", dir], dir, "map:operator-surface");
    assert.equal(parked.status, "parked");
    assert.equal(parked.parkedWorkers, 1);
    const before = state(dir, parked.runId);
    assert.equal(before.tasks.find((t) => t.id === "map:runtime-surface").status, "completed");

    fs.writeFileSync(fixedFlag, "fixed\n");
    const done = cw(["--resume", "--run", parked.runId], dir, "map:operator-surface");
    assert.equal(done.status, "complete");
    assert.deepEqual(done.reopenedWorkers, ["map:operator-surface"]);
    assert.equal(done.completedWorkers, done.plannedWorkers);
    assert.equal(done.resumedFrom, parked.runId);
    assert.equal(done.appId, "architecture-review-fast", "a continued run names the app it was planned with, not the default review");
    const { formatQuickstartHuman } = require(path.join(pluginRoot, "dist", "shell", "pipeline-cli.js"));
    assert.ok(!formatQuickstartHuman(done).includes("add --fast"), "a continued --fast run is not told to add --fast");
    assert.equal(verdictLine(state(dir, parked.runId)), "- Verdict: PASS");
    console.log("resume-parked: parallel phase — the parked map worker finishes, the rest follow OK");
  }

  // 3. Only the retry-budget park is reopened: a worker whose last error is
  //    anything else (here a boundary violation) stays failed.
  {
    fs.rmSync(fixedFlag, { force: true });
    const dir = repo("boundary");
    const parked = cw(["run", "end-to-end-golden-path", "--drive", "--question", "prove it", "--repo", dir], dir, "golden:path");
    const file = path.join(dir, ".cw", "runs", parked.runId, "state.json");
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    s.workers[0].errors.push({ code: "worker-boundary-violation", message: "wrote outside its sandbox", at: s.updatedAt });
    fs.writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`);

    fs.writeFileSync(fixedFlag, "fixed\n");
    const stays = cw(["--resume", "--run", parked.runId], dir, "golden:path");
    assert.notEqual(stays.status, "complete");
    assert.equal(stays.parkedWorkers, 1);
    assert.equal("reopenedWorkers" in stays, false, "a boundary violation is never reopened");
    console.log("resume-parked: a non-park stop stays failed OK");
  }

  console.log("resume-parked-smoke: ok");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
