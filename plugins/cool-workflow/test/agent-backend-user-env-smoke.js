"use strict";
// agent-backend-user-env-smoke -- the agent backend forwards USER to a REAL
// spawned child, not just prepared/stubbed outcomes.
//
// Found live: `cw -q "..." -claude` parked every Map worker with a bare
// "claude exited 1" (before the agent-hop-diagnostics fix) that turned out to
// mean "Not logged in - Please run /login" once the real reason was
// surfaced. Root cause: under the readonly sandbox profile (env.inherit:false,
// expose:[]), buildChildEnv(policy) keeps only PATH+HOME; runAgentProcess then
// re-adds provider-key-shaped vars (CW_*/ANTHROPIC_*/...) but never USER.
// claude's headless OAuth/keychain credential lookup needs USER to succeed --
// confirmed by hand: `env -i PATH=$PATH HOME=$HOME claude -p ...` reproduces
// "Not logged in"; adding USER back (not LOGNAME) fixes it. Every existing
// execution-backend-agent-smoke.js case uses preparedAgentOutcome, which
// bypasses the real spawnSync path entirely -- none of them could have caught
// this. This smoke exercises the REAL spawn (a tiny node stub, no live agent
// binary) so it actually observes the child's env.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { runBackend } = require(path.join(pluginRoot, "dist/shell/execution-backend/registry.js"));
const { sha256 } = require(path.join(pluginRoot, "dist/core/hash.js"));
const { showBundledSandboxProfile, sandboxContextForValidation } = require(path.join(pluginRoot, "dist/shell/sandbox-profile.js"));

const ctx = sandboxContextForValidation(pluginRoot);
const ro = showBundledSandboxProfile("readonly", ctx);
for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];

function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cw-agent-user-env-"));
  const stub = path.join(work, "stub-agent.js");
  // Prints ONLY booleans (never the real value) so the test asserts presence,
  // not a specific username -- portable across dev machines and CI.
  fs.writeFileSync(
    stub,
    "process.stdout.write(JSON.stringify({ hasUser: typeof process.env.USER === 'string', hasAnthropicKey: typeof process.env.ANTHROPIC_API_KEY === 'string' }));\n",
    "utf8"
  );

  const priorUser = process.env.USER;
  process.env.USER = "cw-smoke-user";
  process.env.ANTHROPIC_API_KEY = "cw-smoke-key";
  try {
    const expectedStdout = JSON.stringify({ hasUser: true, hasAnthropicKey: true });
    const agent = runBackend({
      schemaVersion: 1,
      cwd: pluginRoot,
      sandboxPolicy: ro,
      label: "agent-user-env-smoke",
      backendId: "agent",
      delegation: { command: process.execPath, args: [stub] }
      // No preparedAgentOutcome: this takes the REAL spawnSync path in
      // runAgentProcess, so the stub observes the actual child env.
    });

    assert.equal(agent.status, "completed", `real spawn under the readonly profile completes (evidence: ${JSON.stringify(agent.evidence)})`);
    const stdoutEntry = agent.evidence.find((e) => e.startsWith("stdoutSha256:"));
    assert.equal(
      stdoutEntry,
      `stdoutSha256:${sha256(expectedStdout)}`,
      "the real spawned child saw BOTH USER (identity, for OS-level credential lookup) and the ANTHROPIC_* provider key under the readonly sandbox profile (env.inherit:false)"
    );
  } finally {
    if (priorUser === undefined) delete process.env.USER;
    else process.env.USER = priorUser;
    delete process.env.ANTHROPIC_API_KEY;
    fs.rmSync(work, { recursive: true, force: true });
  }

  process.stdout.write("agent-backend-user-env-smoke: ok (USER reaches a REAL spawned agent child under the readonly sandbox profile)\n");
}

main();
