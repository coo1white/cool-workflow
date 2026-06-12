#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const script = path.join(pluginRoot, "scripts", "architecture-review-fast.js");
const node = process.execPath;
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-arch-fast-auto-")));

function main() {
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "README.md"), "# app\n", "utf8");
  fs.writeFileSync(path.join(repo, "src", "app.js"), "module.exports = () => 'ok';\n", "utf8");
  git(repo, ["init"]);
  git(repo, ["add", "."]);
  git(repo, ["-c", "user.name=CW", "-c", "user.email=cw@example.invalid", "commit", "-m", "init"]);

  const profileFile = path.join(tmp, "profiles.json");
  fs.writeFileSync(
    profileFile,
    JSON.stringify({
      schemaVersion: 1,
      profiles: {
        smoke: {
          description: "Smoke profile for architecture-review-fast automation.",
          maxLines: 1000,
          include: ["README.md", "src/**"],
          exclude: []
        }
      }
    }, null, 2),
    "utf8"
  );

  const stub = path.join(tmp, "stub.js");
  const countFile = path.join(tmp, "spawn-count.txt");
  fs.writeFileSync(
    stub,
    [
      'const fs = require("fs");',
      "const fence = String.fromCharCode(96).repeat(3);",
      "const result = process.argv[2];",
      "const count = process.argv[3];",
      "fs.appendFileSync(count, 'spawn\\n');",
      'fs.writeFileSync(result, "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n");',
      'process.stdout.write(JSON.stringify({ model: "stub-agent/automation", usage: { input_tokens: 1, output_tokens: 1 } }));'
    ].join("\n"),
    "utf8"
  );

  const agentCommand = `${node} ${stub} {{result}} ${countFile}`;
  const baseline = runJson([
    "--repo", repo,
    "--question", "Is this architecture fast enough?",
    "--profile", "smoke",
    "--profile-file", profileFile,
    "--ref", "HEAD",
    "--preview"
  ]);
  assert.equal(baseline.metrics, undefined, "metrics are opt-in and absent by default");

  const first = runJson([
    "--repo", repo,
    "--question", "Is this architecture fast enough?",
    "--profile", "smoke",
    "--profile-file", profileFile,
    "--ref", "HEAD",
    "--agent-command", agentCommand,
    "--once",
    "--schedule-full",
    "--full-delay-minutes", "10",
    "--metrics"
  ]);

  assert.equal(first.appId, "architecture-review-fast");
  assert.ok(fs.existsSync(first.sourceContext.path), "launcher writes a source context file");
  assert.match(first.sourceContext.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.fastReview.appId, "architecture-review-fast");
  assert.equal(first.fastReview.status, "in-progress");
  assert.equal(first.fastReview.completedWorkers, 2, "launcher advances the parallel Map round");
  assert.equal(first.fullReviewSchedule.workflowId, "architecture-review");
  assert.equal(first.fullReviewSchedule.kind, "reminder");
  assert.equal(first.fullReviewSchedule.maxRuns, 1);
  assert.ok(first.metrics.totalElapsedMs >= 0, "metrics include total elapsed time");
  assert.ok(first.metrics.sourceContext.bytes > 0, "metrics include context byte size");
  assert.equal(first.metrics.fastReview.steps, 2);
  assert.equal(first.metrics.fastReview.agentSpawns, 2);
  assert.equal(first.metrics.fastReview.resultCacheHits, 0);
  assert.equal(first.metrics.fastReview.handleKinds.process, 2);
  assert.ok(first.metrics.fullReviewSchedule.elapsedMs >= 0, "metrics include schedule elapsed time");
  assert.equal(spawnLines(countFile), 2, "first run spawns two Map workers");

  const second = runJson([
    "--repo", repo,
    "--question", "Is this architecture fast enough?",
    "--profile", "smoke",
    "--profile-file", profileFile,
    "--ref", "HEAD",
    "--agent-command", agentCommand,
    "--once",
    "--metrics"
  ]);

  assert.equal(second.fastReview.completedWorkers, 2, "second run also completes the Map round");
  assert.ok(second.fastReview.steps.every((step) => step.handleKind === "result-cache"), "second run reuses cached Map results");
  assert.equal(second.metrics.fastReview.steps, 2);
  assert.equal(second.metrics.fastReview.agentSpawns, 0);
  assert.equal(second.metrics.fastReview.resultCacheHits, 2);
  assert.equal(second.metrics.fastReview.handleKinds["result-cache"], 2);
  assert.equal(spawnLines(countFile), 2, "result cache avoids spawning Map workers again");

  fs.rmSync(tmp, { recursive: true, force: true });
  process.stdout.write("architecture-review-fast-automation-smoke: ok (context export, fast once, result cache, full schedule)\n");
}

function runJson(args) {
  return JSON.parse(execFileSync(node, [script, ...args], { cwd: pluginRoot, encoding: "utf8", maxBuffer: 1024 * 1024 * 64 }));
}

function git(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function spawnLines(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split(/\n/).filter(Boolean).length : 0;
}

main();
