#!/usr/bin/env node
"use strict";

// orphan-runs-gc-smoke — manage run directories a killed/interrupted process left
// behind BEFORE it ever wrote a state.json (`cw orphans list` / `cw orphans gc`).
// This is orthogonal to `cw gc plan/run` (src/run-registry/gc.ts): those tier runs
// that HAVE durable state; a directory with no state.json is invisible to that
// system entirely (see src/run-registry/orphans.ts). Hermetic: seeds a throwaway
// repo directly on disk (no agent, no network), then asserts list/gc find and
// reclaim only genuine orphans — never a known (state.json-bearing) run, never a
// run whose state.json failed to write cleanly (corrupt-but-present), and never
// anything outside the scanned repo's `.cw/runs/` (containment).

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const node = process.execPath;
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist", "orchestrator.js"));

const cleanups = [];
function freshRepo() {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-orphans-repo-")));
  cleanups.push(repo);
  return repo;
}
function run(args, repo) {
  return spawnSync(node, [cli, ...args], { cwd: repo, encoding: "utf8", env: { ...process.env, CW_HOME: repo } });
}
function runOk(args, repo) {
  const r = run(args, repo);
  assert.equal(r.status, 0, `cw ${args.join(" ")}: ${r.stderr}`);
  return r;
}

// Raw orphan directory: a run tree with NO state.json (mirrors what `ensureRunDirs`
// leaves behind when a process is killed before the first checkpoint).
function seedOrphan(repo, runId, { payloadBytes = 50, ageMinutes = 0 } = {}) {
  const dir = path.join(repo, ".cw", "runs", runId);
  fs.mkdirSync(dir, { recursive: true });
  const payload = path.join(dir, "artifacts", "scratch.txt");
  fs.mkdirSync(path.dirname(payload), { recursive: true });
  fs.writeFileSync(payload, "x".repeat(payloadBytes));
  if (ageMinutes > 0) {
    const past = new Date(Date.now() - ageMinutes * 60 * 1000);
    fs.utimesSync(payload, past, past);
    fs.utimesSync(path.dirname(payload), past, past);
    fs.utimesSync(dir, past, past);
  }
  return dir;
}

// A directory that HAS a state.json but it never parsed (a torn/partial write —
// distinct from "never attempted"). Must be left alone by both list and gc.
function seedCorrupt(repo, runId) {
  const dir = path.join(repo, ".cw", "runs", runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), "{not valid json");
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
  fs.utimesSync(dir, past, past);
  return dir;
}

// A REAL known run (via the in-process planner, same as run-registry-control-plane-smoke)
// so "never touch a known run" is proven against the actual state.json shape, not a stub.
function seedKnownRun(repo) {
  const runner = new CoolWorkflowRunner({ pluginRoot });
  const result = runner.plan("architecture-review", { question: "orphan-sweep control", repo, cwd: repo });
  return result;
}

// ===== 1. `orphans list` finds directories with no state.json; ignores a known run =====
{
  const repo = freshRepo();
  const known = seedKnownRun(repo);
  seedOrphan(repo, "orphan-fresh-aaaa");
  seedOrphan(repo, "orphan-fresh-bbbb");
  const r = runOk(["orphans", "list", "--scope", "repo", "--json"], repo);
  const p = JSON.parse(r.stdout);
  assert.equal(p.count, 2, "lists exactly the two orphan directories");
  const ids = p.entries.map((e) => e.runId).sort();
  assert.deepEqual(ids, ["orphan-fresh-aaaa", "orphan-fresh-bbbb"], "reports the orphan directory names");
  assert.ok(!ids.includes(known.id), "the known (state.json-bearing) run is never listed as an orphan");
  assert.ok(p.entries.every((e) => e.bytes > 0), "reports non-zero bytes per orphan");
  const human = run(["orphans", "list", "--scope", "repo"], repo);
  assert.match(human.stdout, /Orphan Runs/, "human list has a header");
  console.log("orphans: list finds orphan dirs and ignores known runs ok");
}

// ===== 2. `orphans gc --min-age-minutes N` reclaims only old-enough orphans =====
{
  const repo = freshRepo();
  seedOrphan(repo, "orphan-old", { ageMinutes: 120 });
  seedOrphan(repo, "orphan-new", { ageMinutes: 0 });
  const r = runOk(["orphans", "gc", "--scope", "repo", "--min-age-minutes", "60", "--json"], repo);
  const p = JSON.parse(r.stdout);
  assert.equal(p.removed.length, 1, "reclaims exactly the old orphan");
  assert.equal(p.removed[0].runId, "orphan-old");
  assert.equal(p.keptCount, 1, "keeps the fresh one");
  assert.ok(p.freedBytes > 0, "reports freed bytes");
  assert.ok(!fs.existsSync(path.join(repo, ".cw", "runs", "orphan-old")), "old orphan dir is gone");
  assert.ok(fs.existsSync(path.join(repo, ".cw", "runs", "orphan-new")), "fresh orphan dir remains");
  console.log("orphans: gc min-age reclaims only stale orphans ok");
}

// ===== 3. `orphans gc --all` reclaims every orphan regardless of age =====
{
  const repo = freshRepo();
  seedOrphan(repo, "orphan-just-created", { ageMinutes: 0 });
  const r = runOk(["orphans", "gc", "--scope", "repo", "--all", "--json"], repo);
  const p = JSON.parse(r.stdout);
  assert.equal(p.removed.length, 1, "--all reclaims a brand-new orphan too");
  assert.equal(p.minAgeMinutes, null, "--all reports no age gate");
  console.log("orphans: gc --all ignores age ok");
}

// ===== 4. a known run is NEVER reclaimed, even backdated, even under --all =====
{
  const repo = freshRepo();
  const known = seedKnownRun(repo);
  const past = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  fs.utimesSync(known.paths.runDir, past, past);
  const r = runOk(["orphans", "gc", "--scope", "repo", "--all", "--json"], repo);
  const p = JSON.parse(r.stdout);
  assert.equal(p.removed.length, 0, "a known run is not an orphan-gc candidate");
  assert.ok(fs.existsSync(known.paths.state), "the known run's state.json survives");
  console.log("orphans: gc never touches a known (state.json-bearing) run ok");
}

// ===== 5. a directory with a CORRUPT state.json is left alone (gc.ts's territory) =====
{
  const repo = freshRepo();
  const corrupt = seedCorrupt(repo, "torn-write");
  const listed = JSON.parse(runOk(["orphans", "list", "--scope", "repo", "--json"], repo).stdout);
  assert.equal(listed.count, 0, "a present-but-corrupt state.json is not an orphan candidate");
  const r = runOk(["orphans", "gc", "--scope", "repo", "--all", "--json"], repo);
  assert.equal(JSON.parse(r.stdout).removed.length, 0, "gc --all does not touch a corrupt-state run");
  assert.ok(fs.existsSync(corrupt), "the corrupt-state directory survives");
  console.log("orphans: a present-but-unparseable state.json is left alone ok");
}

// ===== 6. containment: gc never touches anything outside .cw/runs/ =====
{
  const repo = freshRepo();
  seedOrphan(repo, "orphan-x", { ageMinutes: 0 });
  const sentinel = path.join(repo, "DO-NOT-DELETE.txt");
  fs.writeFileSync(sentinel, "keep me");
  runOk(["orphans", "gc", "--scope", "repo", "--all", "--json"], repo);
  assert.ok(fs.existsSync(sentinel), "gc never touches a path outside .cw/runs/ (containment)");
  console.log("orphans: gc respects containment ok");
}

// ===== 7. empty repo: list says so clearly; gc is a clean no-op =====
{
  const repo = freshRepo();
  const list = runOk(["orphans", "list", "--scope", "repo"], repo);
  assert.match(list.stdout, /No orphan run/, "empty repo reads clearly");
  const gc = runOk(["orphans", "gc", "--scope", "repo", "--json"], repo);
  assert.equal(JSON.parse(gc.stdout).removed.length, 0, "gc on a repo with no runs dir is a clean no-op");
  console.log("orphans: empty-repo list + gc no-op ok");
}

// ===== 8. input validation fails closed (never a surprise delete) =====
{
  const repo = freshRepo();
  seedOrphan(repo, "orphan-keep", { ageMinutes: 120 });
  const neg = run(["orphans", "gc", "--scope", "repo", "--min-age-minutes=-5", "--json"], repo);
  assert.equal(neg.status, 1, "a negative --min-age-minutes is rejected");
  assert.match(neg.stderr, /non-negative/, "explains the constraint");
  const badNow = run(["orphans", "gc", "--scope", "repo", "--now", "not-a-date", "--json"], repo);
  assert.equal(badNow.status, 1, "an unparseable --now is rejected, not silently NaN'd");
  assert.match(badNow.stderr, /valid ISO date/, "explains the constraint");
  assert.ok(fs.existsSync(path.join(repo, ".cw", "runs", "orphan-keep")), "nothing was deleted on a validation error");
  console.log("orphans: gc input validation fails closed ok");
}

// ===== 9. no / unknown subcommand hits the handler's usage error =====
{
  const repo = freshRepo();
  for (const args of [["orphans"], ["orphans", "bogus"]]) {
    const r = run(args, repo);
    assert.equal(r.status, 1, `cw ${args.join(" ")} exits non-zero`);
    assert.match(r.stderr, /orphans list .* \| orphans gc/, "handler usage string surfaces");
  }
  console.log("orphans: unknown subcommand fails closed with usage ok");
}

// ===== 10. CLI --json and MCP payloads are byte-identical (both surfaces, one core) =====
// `--now` is pinned identically on both sides — ageMinutes is wall-clock-derived,
// so without a shared clock a minute-boundary race could flake the comparison.
{
  const repo = freshRepo();
  seedOrphan(repo, "orphan-parity", { ageMinutes: 0 });
  const now = new Date().toISOString();
  const cliOut = JSON.parse(runOk(["orphans", "list", "--scope", "repo", "--now", now, "--json"], repo).stdout);
  const { listOrphanRuns } = require(path.join(pluginRoot, "dist", "capability-core.js"));
  const { RunRegistry } = require(path.join(pluginRoot, "dist", "run-registry.js"));
  const mcpOut = listOrphanRuns(new RunRegistry(repo), { scope: "repo", now });
  assert.deepEqual(cliOut, mcpOut, "CLI --json and the MCP-bound core call return the identical payload");
  console.log("orphans: CLI/MCP payload identity ok");
}

for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
console.log("orphan-runs-gc-smoke: ok");
