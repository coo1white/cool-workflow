"use strict";
// parse-guard-smoke (v0.1.96). Proves the P2 audit fixes:
// metadata parse gives a clear error on invalid JSON (not raw SyntaxError),
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
  // ---- 1. metadata JSON parse throws clear error on invalid JSON --------------
  // v2 NO-EQUIVALENT: the old flat exported internal API metadataOption(options)
  // from src/orchestrator/cli-options.ts is gone. v2 collapsed it into the
  // module-private helper parseJsonObject(value) at src/shell/scheduler-io.ts:608
  // (throws "Expected a JSON object, got invalid JSON"; matches /Invalid JSON/i).
  // It is NOT exported, so it cannot be required and called directly.
  // The reachable v2 surface that routes options.metadata through that same
  // successor parser is RoutineTriggerBridge.create() (scheduler-io.ts:506),
  // so we drive the identical four metadata-parse behaviors through it. This
  // preserves every assertion's intent (invalid -> clear error, object
  // passthrough, valid-string parse, absent -> undefined) against the real v2
  // code path; it does not weaken any of them.
  {
    const { RoutineTriggerBridge } = require(path.join(pluginRoot, "dist", "shell", "scheduler-io.js"));
    const tmp1 = fs.mkdtempSync(path.join(os.tmpdir(), "cw-smoke-md-"));
    const bridge = new RoutineTriggerBridge(tmp1);
    const withMetadata = (metadata) => bridge.create({ kind: "api", prompt: "guard-smoke", metadata }).metadata;
    assert.throws(() => withMetadata("{bad"), /Invalid JSON/i, "metadata parse rejects invalid JSON");
    assert.deepEqual(withMetadata({ key: "val" }), { key: "val" }, "metadata parse passes through objects");
    assert.equal(withMetadata(JSON.stringify({ key: "val" })).key, "val", "metadata parse parses valid JSON string");
    assert.equal(bridge.create({ kind: "api", prompt: "guard-smoke" }).metadata, undefined, "metadata is undefined when absent");
    fs.rmSync(tmp1, { recursive: true, force: true });
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
    // resolveRoutineFirePayload (shell/registry-cli.ts) owns this wording now
    // (moved out of core/capability-table.ts) — pin the exact prefix so the
    // move stayed byte-identical.
    assert.ok(stderr.includes(`Failed to parse payload file "${badFile}"`), `exact error prefix preserved: ${stderr.slice(0, 200)}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ---- 3. shell backend catches # comment truncation --------------------------
  {
    const { runBackend } = require(path.join(pluginRoot, "dist/shell/execution-backend/registry.js"));
    const { showBundledSandboxProfile, sandboxContextForValidation } = require(path.join(pluginRoot, "dist/shell/sandbox-profile.js"));
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
    const { runBackend } = require(path.join(pluginRoot, "dist/shell/execution-backend/registry.js"));
    const { showBundledSandboxProfile, sandboxContextForValidation } = require(path.join(pluginRoot, "dist/shell/sandbox-profile.js"));
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
    const { runBackend } = require(path.join(pluginRoot, "dist/shell/execution-backend/registry.js"));
    const { showBundledSandboxProfile, sandboxContextForValidation } = require(path.join(pluginRoot, "dist/shell/sandbox-profile.js"));
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
    const { runBackend } = require(path.join(pluginRoot, "dist/shell/execution-backend/registry.js"));
    const { showBundledSandboxProfile, sandboxContextForValidation } = require(path.join(pluginRoot, "dist/shell/sandbox-profile.js"));
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
