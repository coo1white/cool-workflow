"use strict";
// execution-backend-agent-smoke (v0.1.88). Proves the agent backend integrates
// through the full dispatch path: success-path completion via preparedAgentOutcome
// (deterministic, no real agent binary needed), canonical evidence shape,
// agent handle + reported model in provenance, commandlessDelegate behavior,
// fail-closed refusals when unconfigured, and probe readiness transitions.
//
// The agent backend is the v0.1.38 delegating driver — it spawns an EXTERNAL agent
// process argv-style (shell:false) and records the agent CHILD's command + exit +
// stdout digest as the canonical evidence triple. Existing tests cover the drive
// layer (agent-delegation-drive-smoke) and registry enumeration; this smoke proves
// `runBackend({ backendId: "agent" })` directly with a prepared outcome.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
// v2 split the old flat dist/execution-backend.js: the backend registry API
// (runBackend/probeBackend/getBackendDriver) moved to shell/execution-backend/registry,
// and sha256 moved to the pure core/hash module. sandbox-profile moved under shell/.
const { runBackend, probeBackend, getBackendDriver } = require(path.join(pluginRoot, "dist/shell/execution-backend/registry.js"));
const { sha256 } = require(path.join(pluginRoot, "dist/core/hash.js"));
const { showBundledSandboxProfile, sandboxContextForValidation } = require(path.join(pluginRoot, "dist/shell/sandbox-profile.js"));

const ctx = sandboxContextForValidation(pluginRoot);
const ro = showBundledSandboxProfile("readonly", ctx);
for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];

const base = { schemaVersion: 1, cwd: pluginRoot, sandboxPolicy: ro, label: "agent-smoke" };
const isRefused = (e) => e.status === "refused" && e.provenance.attestation.status === "refused" && !e.evidence.some((x) => x.startsWith("stdoutSha256:"));
const code = (e) => (e.evidence[0] || "").replace("refused:", "");

function main() {
  // ---- 0. Driver contract: delegateRun exposed, commandlessDelegate true --------
  {
    const driver = getBackendDriver("agent");
    assert.ok(driver, "agent driver exists in registry");
    assert.equal(typeof driver.delegateRun, "function", "agent driver exposes a delegate runner");
    assert.equal(driver.commandlessDelegate, true, "agent driver is commandless");
    assert.equal(typeof driver.probe, "function", "agent driver owns its probe");
    assert.equal(typeof driver.buildHandle, "function", "agent driver owns its handle builder");
  }

  // ---- 1. FAIL CLOSED: unconfigured agent --------------------------------------
  {
    const agentNoConfig = runBackend({ ...base, backendId: "agent", delegation: {} });
    assert.ok(isRefused(agentNoConfig) && code(agentNoConfig) === "delegation-target-missing", "agent w/o command or endpoint refuses");
  }

  // ---- 2. PROBE: unconfigured -> unverified ------------------------------------
  {
    const probe = probeBackend("agent");
    assert.equal(probe.readiness, "unverified", "agent probe is unverified when neither CW_AGENT_COMMAND nor CW_AGENT_ENDPOINT is set");
    assert.ok(probe.checks.some((c) => c.name === "agent-command" && !c.ok), "agent-command check is not ok when unset");
    assert.ok(probe.checks.some((c) => c.name === "agent-endpoint" && !c.ok), "agent-endpoint check is not ok when unset");
  }

  // ---- 3. PROBE: configured -> ready -------------------------------------------
  {
    process.env.CW_AGENT_COMMAND = "claude -p {{manifest}}";
    try {
      const probe = probeBackend("agent");
      assert.equal(probe.readiness, "ready", "agent probe is ready when CW_AGENT_COMMAND is set");
      assert.ok(probe.checks.some((c) => c.name === "agent-command" && c.ok), "agent-command check is ok when set");
    } finally {
      delete process.env.CW_AGENT_COMMAND;
    }
  }

  // ---- 4. SUCCESS PATH via preparedAgentOutcome (deterministic) -----------------
  {
    const preparedOutcome = {
      exitCode: 0,
      stdout: '{"model":"stub-agent-opus","usage":{"input_tokens":420,"output_tokens":70}}'
    };
    const agent = runBackend({
      ...base,
      backendId: "agent",
      delegation: { command: "stub-agent", args: ["{{result}}"], model: "opus" },
      preparedAgentOutcome: preparedOutcome
    });

    assert.equal(agent.status, "completed", "agent backend with prepared outcome completes");
    assert.equal(agent.provenance.backendId, "agent", "provenance records the agent backend id");
    assert.equal(agent.provenance.kind, "delegating", "agent is a delegating backend");
    assert.equal(agent.provenance.locality, "local", "agent locality is local");

    // canonical evidence shape: command, exitCode, stdoutSha256
    assert.deepEqual(
      agent.evidence.map((e) => e.split(":")[0]),
      ["command", "exitCode", "stdoutSha256"],
      "agent delegated evidence is the canonical shape, byte-stable vs node"
    );
    assert.ok(agent.evidence.includes("exitCode:0"), "the agent child's exit code is recorded");
    const expectedDigest = sha256(JSON.stringify(preparedOutcome.stdout));
    const stdoutEntry = agent.evidence.find((e) => e.startsWith("stdoutSha256:"));
    assert.equal(stdoutEntry, `stdoutSha256:${sha256(preparedOutcome.stdout)}`, "stdout digest is the agent child's real output");

    // the handle lives in provenance, NEVER in evidence
    assert.ok(agent.provenance.handle, "agent records a delegation handle in provenance");
    assert.equal(agent.provenance.handle.kind, "process", "handle kind is process");
    assert.ok(agent.provenance.handle.metadata, "handle carries metadata");
    assert.equal(agent.provenance.handle.metadata.mode, "command", "agent mode is command");
    assert.equal(agent.provenance.handle.metadata.command, "stub-agent", "handle records the binary");
    assert.equal(agent.provenance.handle.metadata.model, "opus", "handle records the operator-chosen model");
    assert.equal(agent.provenance.handle.metadata.reportedModel, "stub-agent-opus", "handle records the agent-reported model");
    assert.ok(agent.provenance.handle.metadata.reportedUsage, "handle records agent-reported usage");
    assert.equal(agent.provenance.handle.metadata.reportedUsage.input_tokens, 420, "usage input tokens recorded");
    assert.equal(agent.provenance.handle.metadata.reportedUsage.output_tokens, 70, "usage output tokens recorded");
    assert.ok(!agent.evidence.some((e) => e.startsWith("handle:") || e.startsWith("delegated:")), "handle/delegated are NOT in evidence (byte-stability)");

    // attestation is recorded
    assert.ok(agent.provenance.attestation, "agent records a sandbox attestation");
  }

  // ---- 5. FAIL CLOSED: agent returns non-zero exit -----------------------------
  {
    const agentFailed = runBackend({
      ...base,
      backendId: "agent",
      delegation: { command: "stub-agent", args: ["{{result}}"] },
      preparedAgentOutcome: { exitCode: 1, stdout: "error: something went wrong" }
    });
    assert.equal(agentFailed.status, "failed", "agent with exit code 1 reports failed");
    assert.ok(agentFailed.evidence.includes("exitCode:1"), "exit code 1 is recorded verbatim");
    assert.ok(agentFailed.evidence.includes(`stdoutSha256:${sha256("error: something went wrong")}`), "stdout digest recorded on failure too");
    assert.ok(agentFailed.provenance.handle, "handle is still recorded on failure");
  }

  // ---- 6. FAIL CLOSED: agent spawn error ---------------------------------------
  {
    const agentSpawnFailed = runBackend({
      ...base,
      backendId: "agent",
      delegation: { command: "stub-agent", args: ["{{result}}"] },
      preparedAgentOutcome: { spawnError: "ENOENT: stub-agent not on PATH", exitCode: null, stdout: "" }
    });
    assert.equal(agentSpawnFailed.status, "refused", "agent with spawn error is refused");
    assert.equal(code(agentSpawnFailed), "delegation-failed", "spawn error code is delegation-failed");
    assert.ok(agentSpawnFailed.evidence[0].startsWith("refused:"), "refusal recorded in evidence");
    assert.ok(!agentSpawnFailed.evidence.some((e) => e.startsWith("stdoutSha256:")), "no output digest on spawn failure");
  }

  // ---- 7. FAIL CLOSED: agent timed out / no exit code --------------------------
  {
    const agentTimedOut = runBackend({
      ...base,
      backendId: "agent",
      delegation: { command: "stub-agent", args: ["{{result}}"] },
      preparedAgentOutcome: { exitCode: null, stdout: "" }
    });
    assert.equal(agentTimedOut.status, "refused", "agent with null exit code is refused");
    assert.equal(code(agentTimedOut), "delegation-failed", "null exit code is delegation-failed (timed out or killed)");
  }

  // ---- 8. REAL SPAWN: a timeout is reported as a timeout, and SIGKILL ends
  // a child that ignores SIGTERM ---------------------------------------------
  // No preparedAgentOutcome: this takes the REAL spawnSync path (same harness
  // shape as agent-backend-user-env-smoke). The stub ignores SIGTERM, like a
  // wedged agent wrapper. Before the fix this case failed two ways: spawnSync
  // passed no killSignal, so the default SIGTERM never ended the child and
  // spawnSync sat blocked until the child's own 8s exit; and the ETIMEDOUT
  // spawn `error` was classified as "agent process failed to spawn", so the
  // "timed out or killed" branch was dead code for real timeouts.
  {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "cw-agent-timeout-"));
    try {
      const stub = path.join(work, "stubborn-agent.js");
      fs.writeFileSync(
        stub,
        ['process.on("SIGTERM", () => {});', "setInterval(() => {}, 1000);", "setTimeout(() => process.exit(0), 8000);"].join("\n"),
        "utf8"
      );
      const started = Date.now();
      const agentTimeout = runBackend({
        ...base,
        backendId: "agent",
        delegation: { command: process.execPath, args: [stub] },
        timeoutMs: 500
      });
      const elapsed = Date.now() - started;
      assert.equal(agentTimeout.status, "refused", "a timed-out agent is refused");
      assert.equal(code(agentTimeout), "delegation-failed", "timeout refusal code is delegation-failed");
      assert.match(
        agentTimeout.result.summary,
        /timed out after 500ms/,
        `a real timeout is reported as a timeout, not a spawn failure (got: ${agentTimeout.result.summary})`
      );
      assert.ok(!/failed to spawn/.test(agentTimeout.result.summary), "an ETIMEDOUT kill is not misreported as a spawn failure");
      assert.ok(
        elapsed < 5000,
        `SIGKILL ends a SIGTERM-ignoring child near its 500ms limit, not at the child's own 8s exit (took ${elapsed}ms)`
      );
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  process.stdout.write("execution-backend-agent-smoke: ok (fail-closed refusals + prepared-outcome success path + driver contract + probe readiness + real-spawn timeout)\n");
}

main();
