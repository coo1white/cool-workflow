"use strict";
// parse-guard-smoke (v0.1.96). Proves the P2 audit fixes:
// metadataOption gives a clear error on invalid JSON (not raw SyntaxError),
// routine fire gives a clear error on bad payload files,
// and the shell backend guard catches # * ? ~ metacharacters.
//
// @cw-smoke: parse-guard-smoke

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync, execFileSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const cw = path.join(pluginRoot, "dist", "cli.js");



function main() {
  // ---- 1. metadataOption throws clear error on invalid JSON -------------------
  {
    const { metadataOption } = require(path.join(pluginRoot, "dist", "orchestrator", "cli-options.js"));
    assert.throws(() => metadataOption({ metadata: "{bad" }), /Invalid JSON/i, "metadataOption rejects invalid JSON");
    assert.deepEqual(metadataOption({ metadata: { key: "val" } }), { key: "val" }, "metadataOption passes through objects");
    assert.equal(metadataOption({ metadata: JSON.stringify({ key: "val" }) }).key, "val", "metadataOption parses valid JSON string");
    assert.equal(metadataOption({}), undefined, "metadataOption returns undefined when absent");
  }

  // ---- 2. routine fire handles bad payload file with clear error --------------
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-smoke-"));
    const badFile = path.join(tmp, "bad.json");
    fs.writeFileSync(badFile, "{not valid", "utf8");
    const child = spawnSync(process.execPath, [cw, "routine", "fire", "api", badFile], { encoding: "utf8", cwd: tmp, env: { ...process.env, CW_NO_AUTO_AGENT: "1" } });
    assert.ok(child.status !== 0, "routine fire with bad file exits non-zero");
    const stderr = String(child.stderr || "");
    assert.ok(stderr.includes("parse") || stderr.includes("Parse") || stderr.includes("JSON") || stderr.includes("payload"), `payload error is clear: ${stderr.slice(0, 200)}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ---- 3. shell backend catches # comment truncation --------------------------
  {
    const { runBackend } = require(path.join(pluginRoot, "dist/execution-backend.js"));
    const { showBundledSandboxProfile, sandboxContextForValidation } = require(path.join(pluginRoot, "dist/sandbox-profile.js"));
    const ctx = sandboxContextForValidation(pluginRoot);
    const policy = showBundledSandboxProfile("readonly", ctx);
    const tryShell = () => runBackend({
      schemaVersion: 1,
      cwd: pluginRoot,
      backendId: "shell",
      sandboxPolicy: policy,
      label: "guard-smoke",
      command: "echo",
      args: ["hello #; echo injected"],
      timeoutMs: 5000
    });
    assert.throws(tryShell, /shell control/i, "shell backend rejects # comment char");
  }

  // ---- 4. shell backend catches * glob expansion ------------------------------
  {
    const { runBackend } = require(path.join(pluginRoot, "dist/execution-backend.js"));
    const { showBundledSandboxProfile, sandboxContextForValidation } = require(path.join(pluginRoot, "dist/sandbox-profile.js"));
    const ctx = sandboxContextForValidation(pluginRoot);
    const policy = showBundledSandboxProfile("readonly", ctx);
    const tryShell = () => runBackend({
      schemaVersion: 1,
      cwd: pluginRoot,
      backendId: "shell",
      sandboxPolicy: policy,
      label: "guard-smoke",
      command: "ls",
      args: ["/tmp/*"],
      timeoutMs: 5000
    });
    assert.throws(tryShell, /shell control/i, "shell backend rejects * glob char");
  }

  // ---- 5. shell backend catches ~ home expansion ------------------------------
  {
    const { runBackend } = require(path.join(pluginRoot, "dist/execution-backend.js"));
    const { showBundledSandboxProfile, sandboxContextForValidation } = require(path.join(pluginRoot, "dist/sandbox-profile.js"));
    const ctx = sandboxContextForValidation(pluginRoot);
    const policy = showBundledSandboxProfile("readonly", ctx);
    const tryShell = () => runBackend({
      schemaVersion: 1,
      cwd: pluginRoot,
      backendId: "shell",
      sandboxPolicy: policy,
      label: "guard-smoke",
      command: "cat",
      args: ["~/.ssh/config"],
      timeoutMs: 5000
    });
    assert.throws(tryShell, /shell control/i, "shell backend rejects ~ home char");
  }

  // ---- 7. node backend still accepts safe args (no regression) ----------------
  {
    const { runBackend } = require(path.join(pluginRoot, "dist/execution-backend.js"));
    const { showBundledSandboxProfile, sandboxContextForValidation } = require(path.join(pluginRoot, "dist/sandbox-profile.js"));
    const ctx = sandboxContextForValidation(pluginRoot);
    const policy = showBundledSandboxProfile("readonly", ctx);
    const result = runBackend({
      schemaVersion: 1,
      cwd: pluginRoot,
      backendId: "node",
      sandboxPolicy: policy,
      label: "guard-smoke",
      command: process.execPath,
      args: ["-e", "console.log('safe')"],
      timeoutMs: 5000
    });
    assert.ok(result.evidence.some((e) => e.includes("stdoutSha256:")), "node backend accepts safe args");
  }
}

try {
  main();
  process.stdout.write("PASS  parse-guard-smoke.js\n");
} catch (e) {
  process.stderr.write(`FAIL  parse-guard-smoke.js — ${String(e && e.message || e)}\n`);
  process.exit(1);
}
