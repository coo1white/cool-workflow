#!/usr/bin/env node
"use strict";

// Track B: operator-set archive intake limits refuse excess input before any
// import write. With no limits, the archive path keeps its old result.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "dist", "cli.js");
const node = process.execPath;
const fresh = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `cw-intake-${name}-`));
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const manifest = (files) => sha256(Buffer.from(JSON.stringify(files.map((file) => ({ relativePath: file.relativePath, role: file.role, sha256: file.sha256, sizeBytes: file.sizeBytes })).sort((a, b) => a.relativePath.localeCompare(b.relativePath))), "utf8"));

const source = fresh("source");
const runId = JSON.parse(execFileSync(node, [cli, "plan", "architecture-review", "--repo", source, "--question", "intake limits"], { cwd: source, encoding: "utf8" })).runId;
const exported = JSON.parse(execFileSync(node, [cli, "run", "export", runId, "--json"], { cwd: source, encoding: "utf8" }));
const good = exported.path;
const archive = JSON.parse(fs.readFileSync(good, "utf8"));
const contentBytes = archive.files.reduce((sum, file) => sum + file.sizeBytes, 0);

function command(args, env) {
  return spawnSync(node, [cli, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}
function assertRefused(name, env, archivePath = good) {
  const target = fresh(`${name}-target`);
  const result = command(["run", "import", archivePath, "--target", target, "--json"], env);
  assert.notEqual(result.status, 0, `${name}: import fails`);
  assert.equal(result.stdout, "", `${name}: import keeps stdout empty`);
  assert.ok(!fs.existsSync(path.join(target, ".cw", "runs", runId)), `${name}: no run write`);
  const inspect = command(["run", "inspect-archive", archivePath, "--json"], env);
  assert.notEqual(inspect.status, 0, `${name}: inspect fails`);
  assert.ok(JSON.parse(inspect.stdout).checks.some((check) => (check.code || "").startsWith("archive-limit-")), `${name}: structured limit check`);
}

assertRefused("raw", { CW_MAX_RUN_ARCHIVE_BYTES: String(fs.statSync(good).size - 1) });
assertRefused("files", { CW_MAX_RUN_ARCHIVE_FILES: String(archive.files.length - 1) });
assertRefused("declared-content", { CW_MAX_RUN_ARCHIVE_CONTENT_BYTES: String(contentBytes - 1) });
assertRefused("bad-setting", { CW_MAX_RUN_ARCHIVE_FILES: "zero" });

const falseSize = JSON.parse(JSON.stringify(archive));
const row = falseSize.files.find((file) => file.sizeBytes > 0);
const extra = Buffer.concat([Buffer.from(row.contentBase64, "base64"), Buffer.from("more than declared", "utf8")]);
row.contentBase64 = extra.toString("base64");
row.sha256 = sha256(extra);
row.sizeBytes = 0;
falseSize.integrity.manifestSha256 = manifest(falseSize.files);
const falseSizePath = path.join(fresh("false-size"), "false-size.cwrun.json");
fs.writeFileSync(falseSizePath, JSON.stringify(falseSize));
assertRefused("decoded-content", { CW_MAX_RUN_ARCHIVE_CONTENT_BYTES: String(contentBytes) }, falseSizePath);

const boundary = command(["run", "inspect-archive", good, "--json"], {
  CW_MAX_RUN_ARCHIVE_BYTES: String(fs.statSync(good).size),
  CW_MAX_RUN_ARCHIVE_FILES: String(archive.files.length),
  CW_MAX_RUN_ARCHIVE_CONTENT_BYTES: String(contentBytes),
});
assert.equal(boundary.status, 0, "equal limits pass");
assert.equal(JSON.parse(boundary.stdout).ok, true, "equal limits preserve clean inspect");

process.stdout.write("run-archive-intake-limits-smoke: ok\n");
