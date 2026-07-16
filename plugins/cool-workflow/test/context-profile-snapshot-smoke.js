#!/usr/bin/env node
"use strict";

// context-profile-snapshot-smoke: architecture-review-fast writes the profile it
// ACTUALLY used to .cw/context/repo-source-profile.json on every run, so a worker
// inspecting that file sees the truth. Before this fix the wrapper wrote it only
// for the default external profile; a later run with a custom --profile-file left
// the previous run's file in place, and a worker read a stale profile that did not
// match the exported context (the false "silent omission" seen in the Path-A proof).

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const wrapper = path.join(pluginRoot, "scripts", "architecture-review-fast.js");
const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-ctx-profile-")));

function git(args) {
  const r = cp.spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed\n${r.stderr || r.stdout}`);
}
function preview(extra) {
  const r = cp.spawnSync(process.execPath, [wrapper, "--repo", repo, "--question", "q", "--preview", ...extra], { cwd: pluginRoot, encoding: "utf8", maxBuffer: 1024 * 1024 * 16 });
  assert.equal(r.status, 0, `wrapper preview failed\n${r.stderr}`);
  return JSON.parse(r.stdout);
}
function readSnapshot(contextPath) {
  const file = path.join(path.dirname(contextPath), "repo-source-profile.json");
  assert.ok(fs.existsSync(file), "repo-source-profile.json must exist next to the context");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

fs.mkdirSync(path.join(repo, "src"), { recursive: true });
fs.writeFileSync(path.join(repo, "README.md"), "# repo\n", "utf8");
fs.writeFileSync(path.join(repo, "src", "app.ts"), "export const x = 1;\n", "utf8");
fs.writeFileSync(path.join(repo, "src", "app.test.ts"), "test\n", "utf8");
git(["init"]);
git(["add", "-A"]);
git(["-c", "user.name=CW", "-c", "user.email=cw@example.invalid", "commit", "-m", "base"]);

// --- Run A: default external profile writes the default "repo" snapshot ---
const runA = preview([]);
assert.equal(runA.sourceContext.profile, "repo", "default run uses the 'repo' profile");
const snapA = readSnapshot(runA.sourceContext.path);
assert.deepEqual(Object.keys(snapA.profiles), ["repo"], "default run snapshots the 'repo' profile");
assert.ok(snapA.profiles.repo.include.includes("docs/**"), "default snapshot carries the default include set");

// --- Run B: a custom single-profile --profile-file must OVERWRITE the snapshot
//     with the profile it actually used, not leave Run A's stale 'repo' one ---
const custom = path.join(repo, "custom.json");
fs.writeFileSync(custom, JSON.stringify({
  schemaVersion: 1,
  profiles: { mine: { description: "custom", maxLines: 1000, include: ["src/**"], exclude: ["**/*.test.ts"] } }
}), "utf8");
const runB = preview(["--profile-file", custom]);
assert.equal(runB.sourceContext.profile, "mine", "custom run resolves the file's sole profile");

const snapB = readSnapshot(runB.sourceContext.path);
assert.deepEqual(Object.keys(snapB.profiles), ["mine"], "custom run snapshots the profile it USED, not the stale 'repo'");
assert.deepEqual(snapB.profiles.mine.include, ["src/**"], "the snapshot's include set matches the custom profile");
assert.deepEqual(snapB.profiles.mine.exclude, ["**/*.test.ts"], "the snapshot's exclude set matches the custom profile");
// The snapshot describes exactly what produced the context: src/app.ts present,
// src/app.test.ts excluded — so a worker comparing the two will not raise a false
// "omission" alarm.
assert.ok(!("repo" in snapB.profiles), "no stale 'repo' profile lingers after a custom run");

// --- Regression: a --profile without a --profile-file must NOT try to read a
//     (nonexistent) profile file. Before the fix the snapshot guard fired for
//     any non-default run and did readFileSync("") -> EISDIR crash. Now the
//     snapshot is only taken when a real --profile-file is supplied, so this
//     reaches the export and fails with the real downstream error instead. ---
{
  const r = cp.spawnSync(process.execPath, [wrapper, "--repo", repo, "--question", "q", "--profile", "nonexistent", "--preview"], { cwd: pluginRoot, encoding: "utf8", maxBuffer: 1024 * 1024 * 16 });
  assert.equal(r.status, 1, "an unknown --profile with no file still fails closed");
  assert.doesNotMatch(r.stderr, /EISDIR|cannot read --profile-file/, "a --profile-only run must not crash trying to read an empty profile-file path");
  assert.match(r.stderr, /unknown profile: nonexistent/, "it fails on the real downstream error, having skipped the snapshot");
}

// --- Regression: a failed (zero-record) custom run must NOT leave an orphan
//     snapshot. The snapshot is written only after the context is successfully
//     exported, so a fresh repo whose custom profile matches nothing writes none. ---
{
  const fresh = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-ctx-orphan-")));
  fs.writeFileSync(path.join(fresh, "README.md"), "# x\n", "utf8");
  const g = (a) => assert.equal(cp.spawnSync("git", a, { cwd: fresh, encoding: "utf8" }).status, 0, `git ${a[0]}`);
  g(["init"]); g(["add", "-A"]); g(["-c", "user.name=CW", "-c", "user.email=cw@example.invalid", "commit", "-m", "base"]);
  const empty = path.join(fresh, "empty.json");
  fs.writeFileSync(empty, JSON.stringify({ schemaVersion: 1, profiles: { none: { description: "matches nothing", maxLines: 100, include: ["nonexistent/**"], exclude: [] } } }), "utf8");
  const r = cp.spawnSync(process.execPath, [wrapper, "--repo", fresh, "--question", "q", "--profile-file", empty, "--preview"], { cwd: pluginRoot, encoding: "utf8", maxBuffer: 1024 * 1024 * 16 });
  assert.equal(r.status, 1, "a zero-record custom export fails closed");
  assert.ok(!fs.existsSync(path.join(fresh, ".cw", "context", "repo-source-profile.json")), "a failed export leaves no orphan snapshot");
  fs.rmSync(fresh, { recursive: true, force: true });
}

fs.rmSync(repo, { recursive: true, force: true });
process.stdout.write("context-profile-snapshot-smoke: ok\n");
