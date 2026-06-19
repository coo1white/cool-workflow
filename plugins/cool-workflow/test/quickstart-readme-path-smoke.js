#!/usr/bin/env node
"use strict";

// README/onramp path: check first (zero write), then produce a portable bundle,
// then verify that bundle offline. The completion leg uses the one-worker golden
// path app so the smoke proves the quickstart/bundle mechanism without adding
// another long architecture-review drive to the gate.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const KEYGEN = path.join(pluginRoot, "scripts/agents/cw-attest-keygen.js");

function tmpWorkspace(label) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cw-readme-${label}-`)));
  fs.writeFileSync(path.join(dir, "README.md"), "# target\n", "utf8");
  return dir;
}

function writeStub(file) {
  fs.writeFileSync(
    file,
    [
      'const fs = require("fs");',
      "const fence = String.fromCharCode(96).repeat(3);",
      "const result = process.argv[2];",
      'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "readme path", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
      "fs.writeFileSync(result, body);",
      'process.stdout.write(JSON.stringify({ model: "readme-path-fixture" }));'
    ].join("\n"),
    "utf8"
  );
  return file;
}

function runJson(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args, "--json"], {
    cwd: options.cwd || pluginRoot,
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) },
    maxBuffer: 1024 * 1024 * 32
  });
  assert.equal(result.status, options.status ?? 0, `${args.join(" ")} exits ${options.status ?? 0}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

const repo = tmpWorkspace("repo");
const caller = tmpWorkspace("caller");
const keyDir = tmpWorkspace("keys");
const stub = writeStub(path.join(repo, "fixture-agent.js"));
const keygen = spawnSync(process.execPath, [KEYGEN, "--out-dir", keyDir], { encoding: "utf8" });
assert.equal(keygen.status, 0, `keygen exits 0: ${keygen.stderr}`);
const pubKey = path.join(keyDir, "cw-attest.pub");
const agentCommand = `${process.execPath} ${stub} {{result}}`;

try {
  const check = runJson([
    "quickstart",
    "architecture-review",
    "--check",
    "--repo",
    repo,
    "--question",
    "What are the main risks?",
    "--agent-command",
    agentCommand,
    "--bundle",
    "--with-trust-key",
    pubKey
  ], { cwd: caller });
  assert.equal(check.mode, "check", "quickstart --check returns the preflight shape");
  assert.equal(check.ok, true, "README preflight is ready");
  assert.equal(check.appId, "architecture-review", "the README app id is checked");
  assert.equal(fs.existsSync(path.join(repo, ".cw")), false, "quickstart --check writes no repo .cw state");
  assert.match(check.nextCommand, /--bundle/, "the check next command keeps bundle intent");

  const bundled = runJson([
    "quickstart",
    "end-to-end-golden-path",
    "--repo",
    repo,
    "--question",
    "Prove the README bundle path",
    "--agent-command",
    agentCommand,
    "--bundle",
    "--with-trust-key",
    pubKey
  ], { cwd: caller });
  assert.equal(bundled.status, "complete", "quickstart completes the fixture app");
  assert.equal(bundled.bundle.ok, true, "quickstart --bundle produces a self-verified bundle");
  assert.ok(bundled.bundle.archivePath.startsWith(caller), "bundle output lands in the caller cwd");

  const verified = runJson(["report", "verify-bundle", bundled.bundle.archivePath], { cwd: caller });
  assert.equal(verified.ok, true, "the bundle verifies offline with only the archive");
} finally {
  for (const dir of [repo, caller, keyDir]) fs.rmSync(dir, { recursive: true, force: true });
}

process.stdout.write("quickstart-readme-path-smoke: ok (check zero-write, bundle, offline verify)\n");
