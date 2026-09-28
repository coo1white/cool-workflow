#!/usr/bin/env node
"use strict";

// agent-stderr-reason-smoke — a failed agent's own words reach the person
// (D1 state 6 in docs/unix-principles.md §8).
//
// Any CW_AGENT_COMMAND that exits non-zero has the tail of its stderr kept
// at <workerDir>/logs/agent-stderr.log, on the concurrent (batch) path and
// the serial path alike, with secrets redacted, and never over a log the
// wrapper wrote itself. The recorded `reason` and the --json payload keep
// their bytes: the stderr text is in the log only. On a terminal, the
// parked summary shows `Why:` (the reason, then the log's last line) and
// ends with `Next: cw --resume --run <id>`.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cwBin = path.join(pluginRoot, "scripts", "cw.js");
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-agent-stderr-")));

function stub(name, lines) {
  const file = path.join(work, name);
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

const failing = stub("fail.js", [
  'process.stderr.write("first line\\nENOTFOUND api.example.test marker-5c1 token=abcdef1234567890\\n");',
  "process.exit(3);",
]);
const wrapperLike = stub("wrapper-like.js", [
  'const fs = require("fs"); const path = require("path");',
  'const dir = path.join(path.dirname(process.argv[3]), "logs");',
  "fs.mkdirSync(dir, { recursive: true });",
  'fs.writeFileSync(path.join(dir, "agent-stderr.log"), "written by the wrapper\\n");',
  'process.stderr.write("raw stderr that must not replace it\\n");',
  "process.exit(1);",
]);

function repo(name) {
  const dir = path.join(work, name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "README.md"), "# target\n", "utf8");
  spawnSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

function run(dir, agent, extra = []) {
  const env = { ...process.env, CW_AGENT_COMMAND: `node ${agent} {{input}} {{result}}`, CW_NO_AUTO_AGENT: "1", CW_NO_OPEN: "1" };
  for (const key of ["CW_AGENT_ENDPOINT", "CW_AGENT_STREAM", "CW_DRIVE_PROGRESS"]) delete env[key];
  const child = spawnSync(process.execPath, [cwBin, "-q", "How does routing work?", "--fast", "--json", ...extra], { cwd: dir, env, encoding: "utf8", timeout: 120000 });
  assert.equal(child.status, 0, `cw -q exits 0 (stderr: ${child.stderr})`);
  return { child, result: JSON.parse(child.stdout) };
}

function logs(result) {
  const workers = path.join(path.dirname(result.statePath), "workers");
  return fs.readdirSync(workers)
    .map((name) => path.join(workers, name, "logs", "agent-stderr.log"))
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.readFileSync(file, "utf8"));
}

try {
  // 1. Concurrent (batch) path: the default --fast Map round.
  {
    const { child, result } = run(repo("batch"), failing);
    assert.equal(result.status, "parked");
    const park = result.steps.filter((step) => step.status === "parked").pop();
    assert.match(park.reason, /^agent hop failed: map:[a-z-]+: failed \(exit 3\) \(attempt 3\/3\)$/, "the recorded reason keeps its bytes");
    assert.ok(!child.stdout.includes("marker-5c1"), "the --json payload does not carry the stderr text");
    const found = logs(result);
    assert.ok(found.length > 0, "a failed worker has logs/agent-stderr.log");
    assert.ok(found.every((text) => text.includes("ENOTFOUND api.example.test marker-5c1")), "the log keeps the agent's own words");
    assert.ok(found.every((text) => !text.includes("abcdef1234567890") && text.includes("[REDACTED]")), "a token in stderr is redacted");
    console.log("agent-stderr: concurrent path keeps the reason in the log OK");
  }

  // 2. Serial path: one worker at a time.
  {
    const { result } = run(repo("serial"), failing, ["--concurrency", "1"]);
    assert.equal(result.status, "parked");
    const found = logs(result);
    assert.ok(found.length > 0 && found.every((text) => text.includes("marker-5c1")), "the serial path keeps the log too");
    console.log("agent-stderr: serial path keeps the reason in the log OK");
  }

  // 3. A log the wrapper wrote is never replaced.
  {
    const { result } = run(repo("wrapper"), wrapperLike);
    const found = logs(result);
    assert.ok(found.length > 0 && found.every((text) => text === "written by the wrapper\n"), "the wrapper's own log wins");
    console.log("agent-stderr: the wrapper's own log is kept OK");
  }

  // 4. The terminal summary for a parked run: Why:, then one Next:.
  {
    const { formatQuickstartHuman } = require(path.join(pluginRoot, "dist", "shell", "pipeline-cli.js"));
    const { result } = run(repo("summary"), failing);
    const text = formatQuickstartHuman(result).replace(/\x1b\[[0-9;]*m/g, "");
    const lines = text.split("\n");
    assert.match(text, /\n {2}Why: agent hop failed: map:[a-z-]+: failed \(exit 3\) \(attempt 3\/3\)\n {7}ENOTFOUND api\.example\.test marker-5c1 toke\*\*\*\[REDACTED\]\n/, "Why: names the reason, then the agent's last line");
    assert.equal(lines[lines.length - 1], `  Next: cw --resume --run ${result.runId}`, "the last line is the one resume command");
    assert.ok(!text.includes("Try: cw report --show"), "one Next, not a second Try");
    console.log("agent-stderr: parked terminal summary shows Why and Next OK");
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log("agent-stderr-reason-smoke: ok");
