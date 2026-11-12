// parse-guard-smoke (v0.1.96). Proves the P2 audit fix: the shell backend
// guard catches # * ? ~ metacharacters. (The metadata and routine-fire parse
// checks went with the scheduling surface.)
//
// @cw-smoke: parse-guard-smoke

import assert from "node:assert/strict";
import path from "node:path";
import * as registryModule from "../dist/shell/execution-backend/registry.js";
import * as sandboxProfileModule from "../dist/shell/sandbox-profile.js";

const pluginRoot = path.resolve(import.meta.dirname, "..");



function main() {
  // ---- 3. shell backend catches # comment truncation --------------------------
  {
    const { runBackend } = registryModule;
    const { showBundledSandboxProfile, sandboxContextForValidation } = sandboxProfileModule;
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
    const { runBackend } = registryModule;
    const { showBundledSandboxProfile, sandboxContextForValidation } = sandboxProfileModule;
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
    const { runBackend } = registryModule;
    const { showBundledSandboxProfile, sandboxContextForValidation } = sandboxProfileModule;
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
    const { runBackend } = registryModule;
    const { showBundledSandboxProfile, sandboxContextForValidation } = sandboxProfileModule;
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
  process.stdout.write("PASS  parse-guard-smoke.mjs\n");
} catch (e) {
  process.stderr.write(`FAIL  parse-guard-smoke.mjs — ${String(e && e.message || e)}\n`);
  process.exit(1);
}
