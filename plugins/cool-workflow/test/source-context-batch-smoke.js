#!/usr/bin/env node
"use strict";

// source-context-batch-smoke: small fixture for the batched blob reader used by
// scripts/source-context.js. It proves the mechanism keeps the JSONL contract for
// text files, empty files, excluded files, changed-from exports, cache hits, and
// cache tamper.

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const script = path.join(pluginRoot, "scripts", "source-context.js");
const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-source-context-batch-")));

function git(args) {
  const result = cp.spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function run(args) {
  const result = cp.spawnSync(process.execPath, [script, ...args], {
    cwd: pluginRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 16
  });
  assert.equal(result.status, 0, `${args.join(" ")} failed\nSTDERR:\n${result.stderr}`);
  assert.equal(result.stderr, "", "source-context success must be silent on stderr");
  return result.stdout.trim().split(/\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function runRaw(args) {
  return cp.spawnSync(process.execPath, [script, ...args], {
    cwd: pluginRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 16
  });
}

function sha(text) {
  return crypto.createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

fs.writeFileSync(path.join(repo, "a.txt"), "one\n", "utf8");
fs.writeFileSync(path.join(repo, "empty.txt"), "", "utf8");
fs.mkdirSync(path.join(repo, "docs"));
fs.writeFileSync(path.join(repo, "docs", "skip.txt"), "skip\n", "utf8");
git(["init"]);
git(["add", "."]);
git(["-c", "user.name=CW", "-c", "user.email=cw@example.invalid", "commit", "-m", "base"]);
const baseRef = git(["rev-parse", "HEAD"]);

fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n", "utf8");
fs.writeFileSync(path.join(repo, "new.txt"), "new\n", "utf8");
fs.writeFileSync(path.join(repo, "docs", "skip.txt"), "skip\nchanged\n", "utf8");
git(["add", "-A"]);
git(["-c", "user.name=CW", "-c", "user.email=cw@example.invalid", "commit", "-m", "change"]);

const profile = path.join(repo, "profiles.json");
fs.writeFileSync(
  profile,
  JSON.stringify({
    schemaVersion: 1,
    profiles: {
      smoke: {
        description: "Batch smoke profile.",
        maxLines: 20,
        include: ["a.txt", "empty.txt", "new.txt", "docs/skip.txt"],
        exclude: ["docs/**"]
      }
    }
  }, null, 2),
  "utf8"
);

const manifest = run(["manifest", "--profile", "smoke", "--profile-file", profile, "--repo-root", repo, "--ref", "HEAD"]);
const byPath = new Map(manifest.map((record) => [record.path, record]));
assert.equal(byPath.get("a.txt").sha256, sha("one\ntwo\n"), "text content digest is stable");
assert.equal(byPath.get("a.txt").lines, 2, "text line count is stable");
assert.equal(byPath.get("empty.txt").sha256, sha(""), "empty file digest is stable");
assert.equal(byPath.get("empty.txt").lines, 0, "empty file line count is zero");
assert.equal(byPath.get("docs/skip.txt").included, false, "excluded file is still listed in manifest");
assert.match(byPath.get("docs/skip.txt").reason, /^excluded:/);

const exported = run(["export", "--profile", "smoke", "--profile-file", profile, "--repo-root", repo, "--ref", "HEAD"]);
assert.deepEqual(exported.map((record) => record.path).sort(), ["a.txt", "empty.txt", "new.txt"], "export includes only included files");
assert.equal(exported.find((record) => record.path === "empty.txt").content, "", "empty file content is preserved");
assert.ok(!exported.some((record) => record.path.startsWith("docs/")), "excluded files are not exported");

const changed = run([
  "export",
  "--profile",
  "smoke",
  "--profile-file",
  profile,
  "--repo-root",
  repo,
  "--changed-from",
  baseRef,
  "--ref",
  "HEAD"
]);
assert.deepEqual(changed.map((record) => record.path).sort(), ["a.txt", "new.txt"], "changed export applies include/exclude");
assert.ok(changed.every((record) => record.changedFrom === baseRef), "changedFrom is recorded");

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-source-context-batch-cache-"));
const first = runRaw(["export", "--profile", "smoke", "--profile-file", profile, "--repo-root", repo, "--ref", "HEAD", "--cache-dir", cacheDir]);
assert.equal(first.status, 0, `cached export failed\n${first.stderr}`);
const second = runRaw(["export", "--profile", "smoke", "--profile-file", profile, "--repo-root", repo, "--ref", "HEAD", "--cache-dir", cacheDir]);
assert.equal(second.status, 0, `cache hit failed\n${second.stderr}`);
assert.equal(second.stdout, first.stdout, "cache hit preserves JSONL bytes");

const cacheFile = fs.readdirSync(cacheDir).find((file) => file.endsWith(".jsonl"));
assert.ok(cacheFile, "cache file exists");
const tampered = JSON.parse(first.stdout.trim().split(/\n/)[0]);
tampered.content = `${tampered.content}tamper\n`;
fs.writeFileSync(path.join(cacheDir, cacheFile), `${JSON.stringify(tampered)}\n`, "utf8");
const tamperHit = runRaw(["export", "--profile", "smoke", "--profile-file", profile, "--repo-root", repo, "--ref", "HEAD", "--cache-dir", cacheDir]);
assert.notEqual(tamperHit.status, 0, "tampered cache fails closed");
assert.match(tamperHit.stderr, /content digest mismatch/, "tamper refusal names digest mismatch");

fs.rmSync(repo, { recursive: true, force: true });
fs.rmSync(cacheDir, { recursive: true, force: true });
process.stdout.write("source-context-batch-smoke: ok\n");
