#!/usr/bin/env node
// result-intake-contract-smoke — two results CW took in before batch C of
// intent 2026-11-11 are now turned down at accept time, tried again with
// the reason at the top of input.md, then parked; a resume after the agent
// is fixed completes.
//
// 1. C1: a P0/P1/P2 finding with no grounded evidence of its own
//    (validateResultEnvelope was written but never called on intake).
// 2. C2: a verdict that cites a line past the end of a file that is on
//    disk (only the file's being there was checked).
//
// Black box: every step goes through scripts/cw.js, as a user would type it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cwBin = path.join(pluginRoot, "scripts", "cw.js");
const work = tmpDir("cw-result-intake-");

// One stub agent; the file MODE says what it gets wrong. Files, not env:
// CW hands the agent child only a fixed set of env vars.
const agent = path.join(work, "agent.js");
const modeFile = path.join(work, "MODE");
fs.writeFileSync(
  agent,
  [
    'const fs = require("fs");',
    "const [input, result] = process.argv.slice(2);",
    `const mode = fs.existsSync(${JSON.stringify(modeFile)}) ? fs.readFileSync(${JSON.stringify(modeFile)}, 'utf8').trim() : '';`,
    "const verdict = /verdict/.test(result);",
    "const findings = mode === 'ungrounded' ? [{ id: 'f1', severity: 'P1', title: 'a bad thing', evidence: ['somewhere in the code'] }] : [];",
    "const evidence = mode === 'past-end' && verdict ? ['README.md:1', 'README.md:7'] : ['README.md:1'];",
    "const fence = String.fromCharCode(96).repeat(3);",
    "const body = '# R\\n\\n' + fence + 'cw:result\\n' + JSON.stringify({ summary: 'stub answer', findings, evidence }) + '\\n' + fence + '\\n';",
    "fs.writeFileSync(result, body);",
    "process.stdout.write(JSON.stringify({ model: 'stub-result-intake' }));",
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

function cw(args, cwd, mode) {
  if (mode) fs.writeFileSync(modeFile, `${mode}\n`);
  else fs.rmSync(modeFile, { force: true });
  const env = { ...process.env, CW_AGENT_COMMAND: `node ${agent} {{input}} {{result}}`, CW_NO_AUTO_AGENT: "1", CW_NO_OPEN: "1" };
  for (const key of ["CW_AGENT_ENDPOINT", "CW_AGENT_STREAM", "CW_DRIVE_PROGRESS", "CW_REQUIRE_RESOLVABLE_EVIDENCE"]) delete env[key];
  const child = spawnSync(process.execPath, [cwBin, ...args, "--json"], { cwd, env, encoding: "utf8", timeout: 180000 });
  const out = JSON.parse(child.stdout);
  const stopped = out.status === "blocked" || out.status === "parked";
  assert.equal(child.status, stopped ? 2 : 0, `cw ${args.join(" ")} exits ${stopped ? 2 : 0} (stderr: ${child.stderr})`);
  return out;
}

function state(dir, runId) {
  return JSON.parse(fs.readFileSync(path.join(dir, ".cw", "runs", runId, "state.json"), "utf8"));
}

function parkedWorker(dir, out, reason, code, fix) {
  assert.equal(out.status, "parked", "the drive parks, it does not throw");
  const park = out.steps.filter((step) => step.status === "parked").pop();
  assert.match(park.reason, reason, "the park names the reason");
  assert.match(park.reason, /\(attempt 3\/3\)$/, "tried again before the park");
  const s = state(dir, out.runId);
  assert.ok(fs.existsSync(s.paths.report), "report.md is written");
  const task = s.tasks.find((t) => t.id === park.taskId);
  const worker = s.workers.find((w) => w.id === task.workerId);
  assert.ok(worker.errors.some((e) => e.code === code), `the worker failure is ${code}`);
  const input = fs.readFileSync(worker.inputPath, "utf8");
  assert.ok(input.startsWith("Your last result was rejected: "), "the next try is told why");
  assert.ok(input.split("\n")[0].endsWith(fix), `the fix is named: ${fix}`);
  return park;
}

try {
  // 1. C1: a P1 finding with only free text as evidence.
  {
    const dir = repo("ungrounded");
    const parked = cw(["-q", "How does it work?", "--fast"], dir, "ungrounded");
    const park = parkedWorker(dir, parked, /Task \S+ finding f1 severity P1 requires grounded evidence \(a path-like locator, URL, or namespace:value token\)/, "result-contract-violation", "Give each P0, P1 or P2 finding its own evidence: a path-like locator, URL, or namespace:value token.");
    const done = cw(["--resume", "--run", parked.runId], dir, "");
    assert.equal(done.status, "complete", "a resume after the agent is fixed completes");
    assert.ok(done.reopenedWorkers.includes(park.taskId), "the parked worker is opened again");
    assert.ok(done.commitId, "the run commits");
    console.log("result-intake-contract: ungrounded P1 finding — turned down, parked, resumed OK");
  }

  // 2. C2: the verdict cites README.md:7; README.md has 1 line.
  {
    const dir = repo("past-end");
    const parked = cw(["-q", "How does it work?", "--fast"], dir, "past-end");
    const park = parkedWorker(dir, parked, /Task verdict:fast-synthesis cites a line past the end of its file: README\.md:7 \(README\.md has 1 lines\)/, "verdict-evidence-past-end", "Cite only lines that are in the file.");
    assert.equal(park.taskId, "verdict:fast-synthesis");
    assert.equal(parked.completedWorkers, parked.plannedWorkers - 1, "every worker but the verdict completes");
    const done = cw(["--resume", "--run", parked.runId], dir, "");
    assert.equal(done.status, "complete");
    assert.ok(done.commitId, "the run commits");
    console.log("result-intake-contract: verdict line past the end — turned down, parked, resumed OK");
  }

  console.log("result-intake-contract-smoke: ok");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
