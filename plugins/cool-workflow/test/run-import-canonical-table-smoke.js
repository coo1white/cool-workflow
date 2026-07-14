#!/usr/bin/env node
"use strict";

// Track B security guard: an archive file table is untrusted input. Every
// entry has to be canonical and unique before import makes the run directory.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const node = process.execPath;

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function digestManifest(files) {
  const manifest = files
    .map((file) => ({ relativePath: file.relativePath, role: file.role, sha256: file.sha256, sizeBytes: file.sizeBytes }))
    .sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0);
  return sha256(Buffer.from(JSON.stringify(manifest), "utf8"));
}

function freshDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cw-canonical-${label}-`));
}

const source = freshDir("source");
const runId = JSON.parse(
  execFileSync(node, [cli, "plan", "architecture-review", "--repo", source, "--question", "canonical archive table"], {
    cwd: source,
    encoding: "utf8",
  })
).runId;
const exported = JSON.parse(execFileSync(node, [cli, "run", "export", runId, "--cwd", source, "--json"], { encoding: "utf8" }));
const clean = JSON.parse(fs.readFileSync(exported.path, "utf8"));
const first = clean.files.find((file) => file.sizeBytes > 0);
assert.ok(first, "fixture has one non-empty archive file");

function writeCase(label, mutate) {
  const archive = JSON.parse(JSON.stringify(clean));
  mutate(archive);
  archive.integrity.fileCount = archive.files.length;
  archive.integrity.manifestSha256 = digestManifest(archive.files);
  const file = path.join(freshDir(label), `${label}.cwrun.json`);
  fs.writeFileSync(file, JSON.stringify(archive), "utf8");
  return file;
}

function assertRefused(label, archive) {
  const inspect = spawnSync(node, [cli, "run", "inspect-archive", archive, "--json"], { encoding: "utf8" });
  assert.notEqual(inspect.status, 0, `${label}: inspect fails`);
  const inspected = JSON.parse(inspect.stdout);
  assert.equal(inspected.ok, false, `${label}: inspect says not ok`);
  assert.ok(inspected.checks.some((check) => check.code === "archive-malformed"), `${label}: inspect names malformed archive`);

  const target = freshDir(`${label}-target`);
  const imported = spawnSync(node, [cli, "run", "import", archive, "--target", target, "--json"], { encoding: "utf8" });
  assert.notEqual(imported.status, 0, `${label}: import fails`);
  assert.equal(imported.stdout, "", `${label}: import writes no stdout`);
  assert.ok(!fs.existsSync(path.join(target, ".cw", "runs", runId)), `${label}: import writes no run directory`);

  const restored = spawnSync(node, [cli, "run", "restore", archive, "--target", target, "--json"], { encoding: "utf8" });
  assert.notEqual(restored.status, 0, `${label}: restore fails`);
  const restoreResult = JSON.parse(restored.stdout);
  assert.equal(restoreResult.imported, null, `${label}: restore does not start import`);
  assert.ok(!fs.existsSync(path.join(target, ".cw", "runs", runId)), `${label}: restore writes no run directory`);
}

assertRefused("duplicate-path", writeCase("duplicate-path", (archive) => {
  const bytes = Buffer.from("a second, valid body\n", "utf8");
  archive.files.push({ ...first, contentBase64: bytes.toString("base64"), sha256: sha256(bytes), sizeBytes: bytes.length });
}));

assertRefused("reserved-path", writeCase("reserved-path", (archive) => {
  archive.files[0].relativePath = "state.json";
}));

assertRefused("unknown-role", writeCase("unknown-role", (archive) => {
  archive.files[0].role = "program";
}));

assertRefused("unsafe-size", writeCase("unsafe-size", (archive) => {
  archive.files[0].sizeBytes = Number.MAX_SAFE_INTEGER + 1;
}));

process.stdout.write("run-import-canonical-table-smoke: ok\n");
