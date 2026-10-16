#!/usr/bin/env node
"use strict";

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
// 2. Commit time (the file goes away after accept): the drive gives back a
//    blocked step with the reason, writes report.md, and a second drive
//    adds no second feedback record; with the file back, the run commits.
//
// Black box: every step goes through scripts/cw.js, as a user would type it.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cwBin = path.join(pluginRoot, "scripts", "cw.js");
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-verdict-evidence-")));

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
  assert.equal(child.status, 0, `cw ${args.join(" ")} exits 0, the drive does not throw (stderr: ${child.stderr})`);
  return JSON.parse(child.stdout);
}

function state(dir, runId) {
  return JSON.parse(fs.readFileSync(path.join(dir, ".cw", "runs", runId, "state.json"), "utf8"));
}

function gateFeedback(s) {
  return (s.feedback || []).filter((f) => f.code === "commit-verifier-evidence-unresolvable");
}

try {
  // 1. Accept time: the bad citation is turned down, tried again, parked.
  {
    const dir = repo("accept");
    const parked = cw(["-q", "How does it work?", "--fast"], dir, "src/not-there.ts:3");
    assert.equal(parked.status, "parked", "the verdict worker parks, the drive does not throw");
    assert.equal(parked.completedWorkers, parked.plannedWorkers - 1, "every worker but the verdict completes");
    const park = parked.steps.filter((step) => step.status === "parked").pop();
    assert.equal(park.taskId, "verdict:fast-synthesis");
    assert.match(park.reason, /cites file evidence that does not resolve on disk: src\/not-there\.ts:3/, "the park names the reason");
    assert.match(park.reason, /\(attempt 3\/3\)$/);

    const s = state(dir, parked.runId);
    assert.ok(fs.existsSync(s.paths.report), "report.md is written");
    assert.equal((s.commits || []).filter((c) => c.reason.startsWith("agent-delegation-drive")).length, 0, "nothing unresolvable is committed");
    assert.equal(s.nodes.filter((n) => n.id.includes(":commit-gate-failed:")).length, 0, "the final commit gate never ran on the bad verdict");
    const task = s.tasks.find((t) => t.id === "verdict:fast-synthesis");
    const worker = s.workers.find((w) => w.id === task.workerId);
    const input = fs.readFileSync(worker.inputPath, "utf8");
    assert.match(input, /^Your last result was rejected: .*does not resolve on disk: src\/not-there\.ts:3\. Cite only files that are on disk/, "the next try is told why");
    assert.equal(worker.errors[worker.errors.length - 1].code, "agent-delegation-parked", "a resume can open it again");
    assert.ok(worker.errors.some((e) => e.code === "verdict-evidence-unresolvable"));

    const done = cw(["--resume", "--run", parked.runId], dir, "");
    assert.equal(done.status, "complete", "a resume after the agent is fixed completes");
    assert.deepEqual(done.reopenedWorkers, ["verdict:fast-synthesis"]);
    assert.ok(done.commitId, "the run commits");
    assert.equal(done.completedWorkers, done.plannedWorkers);
    console.log("verdict-evidence-gate: accept time — turned down, parked, resumed, committed OK");
  }

  // 2. Commit time: the cited file goes away after the verdict is accepted.
  {
    const dir = repo("commit");
    fs.writeFileSync(path.join(dir, "NOTES.md"), "notes\n", "utf8");
    const started = cw(["run", "architecture-review-fast", "--drive", "--once", "--question", "q", "--repo", dir], dir, "NOTES.md:1");
    const runId = started.runId;
    for (let i = 0; i < 20 && !state(dir, runId).tasks.every((t) => t.status === "completed"); i++) {
      cw(["run", "--drive", "--once", "--run", runId], dir, "NOTES.md:1");
    }
    assert.ok(state(dir, runId).tasks.every((t) => t.status === "completed"), "every worker is accepted");
    fs.rmSync(path.join(dir, "NOTES.md"));

    const blocked = cw(["run", "--drive", "--run", runId], dir, "NOTES.md:1");
    assert.equal(blocked.status, "blocked", "the drive stops blocked, it does not throw");
    const last = blocked.steps[blocked.steps.length - 1];
    assert.equal(last.action, "commit");
    assert.equal(last.status, "blocked");
    assert.match(last.reason, /does not resolve on disk: NOTES\.md:1/, "the step names the reason");
    let s = state(dir, runId);
    assert.ok(fs.existsSync(s.paths.report), "report.md is written");
    assert.equal(gateFeedback(s).length, 1, "one feedback record");

    const again = cw(["run", "--drive", "--run", runId], dir, "NOTES.md:1");
    assert.equal(again.status, "blocked");
    s = state(dir, runId);
    assert.equal(gateFeedback(s).length, 1, "a second drive adds no second feedback record");
    assert.equal(s.nodes.filter((n) => n.id.includes(":commit-gate-failed:")).length, 1, "and no second gate-failed node");

    fs.writeFileSync(path.join(dir, "NOTES.md"), "notes\n", "utf8");
    const done = cw(["run", "--drive", "--run", runId], dir, "NOTES.md:1");
    assert.equal(done.status, "complete", "with the file back, the run commits");
    assert.ok(done.commitId);
    console.log("verdict-evidence-gate: commit time — blocked with a reason, no duplicate feedback, then committed OK");
  }

  console.log("verdict-evidence-gate-smoke: ok");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
