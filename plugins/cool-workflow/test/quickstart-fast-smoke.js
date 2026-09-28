#!/usr/bin/env node
"use strict";

// quickstart-fast-smoke — `cw -q "<question>" --fast` answers one focused
// question with the 6-worker architecture-review-fast app in place of the
// 14-worker default. The default stays byte-for-byte what it was: the same
// app, the same 14 workers, and no `fast` input on the run. `--fast` next to
// another named app is refused, never dropped. A terminal summary of a
// finished default review names the faster way; nothing else gains the line.
//
// Black box through scripts/cw.js, with a stub agent that writes a valid
// result at once.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cwBin = path.join(pluginRoot, "scripts", "cw.js");
const { formatQuickstartHuman } = require(path.join(pluginRoot, "dist", "shell", "pipeline-cli.js"));
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-quickstart-fast-")));

const agent = path.join(work, "agent.js");
fs.writeFileSync(
  agent,
  [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const body = '# R\\n\\n' + fence + 'cw:result\\n' + JSON.stringify({ summary: 'stub answer', findings: [], evidence: ['README.md:1'] }) + '\\n' + fence + '\\n';",
    "fs.writeFileSync(process.argv[3], body);",
    "process.stdout.write(JSON.stringify({ model: 'stub-fast' }));",
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

function runInputs(result) {
  return JSON.parse(fs.readFileSync(result.statePath, "utf8")).inputs;
}

try {
  // 1. --fast: the 6-worker app, to the end.
  {
    const dir = repo("fast");
    const r = json(cw(["-q", "How does routing work?", "--fast", "--json"], dir), "cw -q --fast");
    assert.equal(r.appId, "architecture-review-fast");
    assert.equal(r.workflowId, "architecture-review-fast");
    assert.equal(r.status, "complete");
    assert.equal(r.plannedWorkers, 6);
    assert.equal(r.completedWorkers, 6);
    assert.equal("fast" in runInputs(r), false, "--fast picks the app; it is not a plan input");
    assert.equal(runInputs(r).question, "How does routing work?");
    console.log("quickstart-fast: --fast runs the 6-worker app to the end OK");
  }

  // 2. The default is unchanged: architecture-review, 14 workers.
  {
    const dir = repo("default");
    const r = json(cw(["-q", "How does routing work?", "--json"], dir), "cw -q");
    assert.equal(r.appId, "architecture-review");
    assert.equal(r.plannedWorkers, 14);
    assert.equal(r.status, "complete");
    assert.equal("fast" in runInputs(r), false);

    // The terminal summary of a finished default review names --fast once;
    // --fast's own summary and a run that did not finish do not.
    const human = formatQuickstartHuman(r);
    assert.match(human, /\n  Faster for one question: add --fast \(6 workers in place of 14\)$/);
    assert.equal(human.split("--fast").length - 1, 1);
    assert.doesNotMatch(formatQuickstartHuman({ ...r, appId: "architecture-review-fast", plannedWorkers: 6 }), /--fast/);
    assert.doesNotMatch(formatQuickstartHuman({ ...r, status: "parked" }), /--fast/);
    console.log("quickstart-fast: default stays 14 workers; the summary names --fast OK");
  }

  // 3. --fast next to another named app is refused; next to its own app, fine.
  {
    const dir = repo("named");
    const refused = cw(["quickstart", "architecture-review", "--fast", "--question", "q", "--json"], dir);
    assert.notEqual(refused.status, 0, "--fast with another app fails closed");
    assert.match(refused.stderr, /--fast runs architecture-review-fast; it cannot be used with the app architecture-review\. Drop --fast or the app name\./);
    assert.equal(fs.existsSync(path.join(dir, ".cw", "runs")), false, "nothing was planned");

    const same = json(cw(["quickstart", "architecture-review-fast", "--fast", "--question", "q", "--json"], dir), "named fast app with --fast");
    assert.equal(same.appId, "architecture-review-fast");
    assert.equal(same.status, "complete");
    console.log("quickstart-fast: --fast with another app refused; with its own app OK");
  }

  // 4. The preflight and the help name the fast app.
  {
    const dir = repo("check");
    const check = json(cw(["-q", "How does routing work?", "--fast", "--check", "--json"], dir), "cw -q --fast --check");
    assert.equal(check.appId, "architecture-review-fast");
    assert.match(check.nextCommand, /^cw quickstart architecture-review-fast /);

    const help = cw(["help", "quickstart"], dir);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /\n      --fast                Answer one question with 6 workers in place of 14\.\n/);
    console.log("quickstart-fast: --check and help name the fast app OK");
  }

  console.log("quickstart-fast-smoke: ok");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
