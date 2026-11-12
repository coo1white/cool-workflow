#!/usr/bin/env node
// verdict-evidence-gate-smoke — a verdict that cites a file that is not on
// disk never makes a run that can not end.
//
// The final commit takes the verdict's evidence only when every file it
// names is on disk (CW_REQUIRE_RESOLVABLE_EVIDENCE, on by default). Before
// this fix, the accept step checked only the form of the evidence, so a
// verdict citing a missing file was accepted, then the final commit threw
// out of the drive: no report.md, and every resume threw again and added
// one more open feedback record.
//
// 1. Accept time: the verdict result is turned down with the reason put in
//    its next input, tried again, then parked; the drive does not throw,
//    report.md is written, and a resume after the agent is fixed completes.
// 2. Commit time: the accept check is the first gate, not the only one. A
//    parked verdict is marked accepted by hand in state.json; on resume the
//    final commit gate still refuses it: the drive gives back a blocked
//    commit step with the reason, writes report.md, a second resume commits
//    nothing, and with the file there the run commits.
// 3. Commit time, a line past the end of the file: the same, with the gate's
//    past-end reason.
//
// Black box: every step goes through scripts/cw.js, as a user would type it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cwBin = path.join(pluginRoot, "scripts", "cw.js");
const work = tmpDir("cw-verdict-evidence-");

// One stub agent. Every worker cites README.md:1 (on disk). The verdict
// worker (its result path names "verdict") cites the locator in the file
// CITE, when that file is there. Files, not env: CW hands the agent child
// only a fixed set of env vars.
const agent = path.join(work, "agent.js");
const citeFile = path.join(work, "CITE");
fs.writeFileSync(
  agent,
  [
    'const fs = require("fs");',
    "const [input, result] = process.argv.slice(2);",
    `const cite = fs.existsSync(${JSON.stringify(citeFile)}) ? fs.readFileSync(${JSON.stringify(citeFile)}, 'utf8').trim() : '';`,
    "const evidence = /verdict/.test(result) && cite ? [cite] : ['README.md:1'];",
    "const fence = String.fromCharCode(96).repeat(3);",
    "const body = '# R\\n\\n' + fence + 'cw:result\\n' + JSON.stringify({ summary: 'stub answer', findings: [], evidence }) + '\\n' + fence + '\\n';",
    "fs.writeFileSync(result, body);",
    "process.stdout.write(JSON.stringify({ model: 'stub-verdict-evidence' }));",
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

function cw(args, cwd, cite) {
  if (cite) fs.writeFileSync(citeFile, `${cite}\n`);
  else fs.rmSync(citeFile, { force: true });
  const env = { ...process.env, CW_AGENT_COMMAND: `node ${agent} {{input}} {{result}}`, CW_NO_AUTO_AGENT: "1", CW_NO_OPEN: "1" };
  for (const key of ["CW_AGENT_ENDPOINT", "CW_AGENT_STREAM", "CW_DRIVE_PROGRESS", "CW_REQUIRE_RESOLVABLE_EVIDENCE"]) delete env[key];
  const child = spawnSync(process.execPath, [cwBin, ...args, "--json"], { cwd, env, encoding: "utf8", timeout: 180000 });
  const out = JSON.parse(child.stdout);
  // A `cw -q` or `cw --resume` run that stops (blocked, parked) exits 2.
  const stopped = out.status === "blocked" || out.status === "parked";
  assert.equal(child.status, stopped ? 2 : 0, `cw ${args.join(" ")} exits ${stopped ? 2 : 0}, the drive does not throw (stderr: ${child.stderr})`);
  return out;
}

function state(dir, runId) {
  return JSON.parse(fs.readFileSync(path.join(dir, ".cw", "runs", runId, "state.json"), "utf8"));
}

/** Mark the parked verdict accepted by hand, as if the accept check missed it. */
function forceAccept(dir, runId, cite) {
  const file = path.join(dir, ".cw", "runs", runId, "state.json");
  const s = JSON.parse(fs.readFileSync(file, "utf8"));
  const task = s.tasks.find((t) => t.id === "verdict:synthesis");
  task.status = "completed";
  task.result = { summary: "stub answer", findings: [], evidence: [cite] };
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
}

function gateCommits(s) {
  return (s.commits || []).filter((c) => c.verifierGated).length;
}

try {
  // 1. Accept time: the bad citation is turned down, tried again, parked.
  {
    const dir = repo("accept");
    const parked = cw(["-q", "How does it work?"], dir, "src/not-there.ts:3");
    assert.equal(parked.status, "parked", "the verdict worker parks, the drive does not throw");
    assert.equal(parked.completedWorkers, parked.plannedWorkers - 1, "every worker but the verdict completes");
    const park = parked.steps.filter((step) => step.status === "parked").pop();
    assert.equal(park.taskId, "verdict:synthesis");
    assert.match(park.reason, /cites file evidence that does not resolve on disk: src\/not-there\.ts:3/, "the park names the reason");
    assert.equal(park.attempts, 3, "tried again before the park");

    const s = state(dir, parked.runId);
    assert.ok(fs.existsSync(s.paths.report), "report.md is written");
    assert.equal(gateCommits(s), 0, "nothing unresolvable is committed");
    const task = s.tasks.find((t) => t.id === "verdict:synthesis");
    const input = fs.readFileSync(path.join(s.paths.workersDir, task.workerId, "input.md"), "utf8");
    assert.match(input.split("## Previous Attempt")[1] || "", /does not resolve on disk: src\/not-there\.ts:3/, "the next try is told why");
    assert.equal(task.errors[task.errors.length - 1].code, "agent-delegation-parked", "a resume can open it again");

    const done = cw(["--resume", "--run", parked.runId], dir, "");
    assert.equal(done.status, "complete", "a resume after the agent is fixed completes");
    assert.deepEqual(done.steps.filter((step) => step.action === "accept").map((step) => step.taskId), ["verdict:synthesis"], "only the parked task runs again");
    assert.ok(done.commitId, "the run commits");
    assert.equal(done.completedWorkers, done.plannedWorkers);
    console.log("verdict-evidence-gate: accept time — turned down, parked, resumed, committed OK");
  }

  // 2. Commit time: the verdict cites a file that is not there.
  {
    const dir = repo("commit");
    const parked = cw(["-q", "q"], dir, "NOTES.md:1");
    assert.equal(parked.status, "parked");
    forceAccept(dir, parked.runId, "NOTES.md:1");
    const blocked = cw(["--resume", "--run", parked.runId], dir, "NOTES.md:1");
    assert.equal(blocked.status, "blocked", "the drive stops blocked, it does not throw");
    assert.equal(blocked.completedWorkers, blocked.plannedWorkers, "every worker is accepted");
    const last = blocked.steps[blocked.steps.length - 1];
    assert.equal(last.action, "commit");
    assert.equal(last.status, "blocked");
    assert.match(last.reason, /does not resolve on disk: NOTES\.md:1/, "the step names the reason");
    assert.ok(fs.existsSync(state(dir, blocked.runId).paths.report), "report.md is written");

    const again = cw(["--resume", "--run", blocked.runId], dir, "NOTES.md:1");
    assert.equal(again.status, "blocked");
    assert.equal(gateCommits(state(dir, blocked.runId)), 0, "a second drive commits nothing");

    fs.writeFileSync(path.join(dir, "NOTES.md"), "notes\n", "utf8");
    const done = cw(["--resume", "--run", blocked.runId], dir, "NOTES.md:1");
    assert.equal(done.status, "complete", "with the file there, the run commits");
    assert.ok(done.commitId);
    console.log("verdict-evidence-gate: commit time — blocked with a reason, then committed OK");
  }

  // 3. Commit time: the verdict cites a line past the end of its file.
  {
    const dir = repo("past-end");
    const notes = path.join(dir, "NOTES.md");
    fs.writeFileSync(notes, "one\n", "utf8");
    const parked = cw(["-q", "q"], dir, "NOTES.md:3");
    assert.equal(parked.status, "parked");
    forceAccept(dir, parked.runId, "NOTES.md:3");
    const blocked = cw(["--resume", "--run", parked.runId], dir, "NOTES.md:3");
    assert.equal(blocked.status, "blocked", "the drive stops blocked, it does not throw");
    const last = blocked.steps[blocked.steps.length - 1];
    assert.equal(last.action, "commit");
    assert.match(last.reason, /Verifier task \S+ cites a line past the end of its file: NOTES\.md:3 \(NOTES\.md has 1 lines\)/, "the step names the reason");
    assert.ok(fs.existsSync(state(dir, blocked.runId).paths.report), "report.md is written");

    fs.writeFileSync(notes, "one\ntwo\nthree\n", "utf8");
    const done = cw(["--resume", "--run", blocked.runId], dir, "NOTES.md:3");
    assert.equal(done.status, "complete", "with the line back, the run commits");
    assert.ok(done.commitId);
    console.log("verdict-evidence-gate: commit time — line past the end blocked with a reason, then committed OK");
  }

  console.log("verdict-evidence-gate-smoke: ok");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
