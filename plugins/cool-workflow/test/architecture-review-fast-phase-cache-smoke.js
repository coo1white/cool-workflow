#!/usr/bin/env node
"use strict";

// architecture-review-fast-phase-cache-smoke: the Verify and Verdict phases are
// the two most expensive foreground phases (live ~146s + ~294s) and were the only
// fast-review phases NOT result-cached. This drives the FULL pipeline twice over an
// unchanged repo (a stub agent) and asserts that on the warm run every phase —
// including Verify and Verdict — is served from the result cache (no agent spawn),
// keyed by source digest + upstream result digests.

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const script = path.join(pluginRoot, "scripts", "architecture-review-fast.js");
const node = process.execPath;
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-arch-fast-phasecache-")));

function main() {
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "README.md"), "# app\n", "utf8");
  fs.writeFileSync(path.join(repo, "src", "app.js"), "module.exports = () => 'ok';\n", "utf8");
  git(repo, ["init"]);
  git(repo, ["add", "."]);
  git(repo, ["-c", "user.name=CW", "-c", "user.email=cw@example.invalid", "commit", "-m", "init"]);

  const profileFile = path.join(tmp, "profiles.json");
  fs.writeFileSync(profileFile, JSON.stringify({
    schemaVersion: 1,
    profiles: { smoke: { description: "phase-cache smoke", maxLines: 1000, include: ["README.md", "src/**"], exclude: [] } }
  }), "utf8");

  // Stub agent: always writes a cw:result with evidence (so requiresEvidence on
  // Verify/Verdict is satisfied) and is byte-identical across runs (so digests match).
  const stub = path.join(tmp, "stub.js");
  const countFile = path.join(tmp, "spawn-count.txt");
  fs.writeFileSync(stub, [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const result = process.argv[2];",
    "const count = process.argv[3];",
    "fs.appendFileSync(count, 'spawn\\n');",
    'fs.writeFileSync(result, "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n");',
    'process.stdout.write(JSON.stringify({ model: "stub/phasecache", usage: { input_tokens: 1, output_tokens: 1 } }));'
  ].join("\n"), "utf8");

  const agentCommand = `${node} ${stub} {{result}} ${countFile}`;
  const argv = [
    "--repo", repo,
    "--question", "Is this fast enough?",
    "--profile", "smoke",
    "--profile-file", profileFile,
    "--ref", "HEAD",
    "--agent-command", agentCommand,
    "--metrics"
  ];

  // Cold: full drive, every phase spawns the agent (no cache yet).
  const cold = runJson(argv);
  assert.equal(cold.fastReview.status, "complete", "cold run drives the full pipeline to completion");
  const coldByPhase = byPhase(cold);
  for (const phase of ["Map", "Assess", "Verify", "Verdict"]) {
    assert.ok(coldByPhase[phase], `cold run has a ${phase} task`);
    assert.ok(coldByPhase[phase].every((t) => t.agentSpawned && !t.resultCacheHit), `cold ${phase} spawns the agent (no cache)`);
  }

  // Warm: identical repo + digest -> every phase, INCLUDING Verify + Verdict, is a cache hit.
  const warm = runJson(argv);
  assert.equal(warm.fastReview.status, "complete", "warm run also completes");
  const warmByPhase = byPhase(warm);
  for (const phase of ["Map", "Assess", "Verify", "Verdict"]) {
    assert.ok(
      warmByPhase[phase].every((t) => t.resultCacheHit && !t.agentSpawned),
      `warm ${phase} is served from the result cache (no agent spawn)`
    );
  }
  // The whole point of this cycle: Verify + Verdict (previously uncached) now hit.
  assert.ok(warmByPhase.Verify.length >= 1 && warmByPhase.Verdict.length >= 1, "warm run exercises Verify + Verdict");
  assert.equal(
    warm.metrics.fastReview.taskMetrics.filter((t) => t.resultCacheHit).length,
    warm.metrics.fastReview.taskMetrics.length,
    "every warm task is a cache hit"
  );

  fs.rmSync(tmp, { recursive: true, force: true });
  process.stdout.write("architecture-review-fast-phase-cache-smoke: ok (Verify + Verdict now cache on warm re-run)\n");
}

function byPhase(result) {
  const groups = {};
  for (const task of result.metrics.fastReview.taskMetrics) {
    (groups[task.phase] ||= []).push(task);
  }
  return groups;
}

function runJson(args) {
  return JSON.parse(execFileSync(node, [script, ...args], { cwd: pluginRoot, encoding: "utf8", maxBuffer: 1024 * 1024 * 64 }));
}

function git(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

main();
