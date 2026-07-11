"use strict";
// agent-backend-sandbox-deny-smoke -- env.deny is the final word for a REAL
// spawned agent child, not just a filter buildChildEnv applies before
// buildAgentChildEnv re-adds provider-key vars over the top of it.
//
// Found by architecture-review (P2): buildAgentChildEnv (execution-backend/
// agent.ts) re-added every var matching AGENT_PROVIDER_KEY_ENV_RE (CW_/
// ANTHROPIC_/.../AWS_ prefixes) AFTER buildChildEnv had already applied
// policy.env.deny -- so a custom profile that explicitly denies e.g.
// AWS_SECRET_ACCESS_KEY still forwarded it to a spawned agent child. A
// second, independent bypass: buildChildEnv itself returned early on
// policy.env.inherit:true, before its own deny loop ever ran, so a profile
// combining inherit:true with deny:[...] ("everything except these") also
// silently ignored deny. Both proved here against a REAL spawned child (not
// a synthetic buildChildEnv() call -- see sandbox-env-batch-hardening-smoke.js
// for the synthetic/deterministic coverage of the same two fixes).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { runBackend } = require(path.join(pluginRoot, "dist/shell/execution-backend/registry.js"));
const { sha256 } = require(path.join(pluginRoot, "dist/core/hash.js"));
const { showBundledSandboxProfile, sandboxContextForValidation } = require(path.join(pluginRoot, "dist/shell/sandbox-profile.js"));

const ctx = sandboxContextForValidation(pluginRoot);
const readonly = showBundledSandboxProfile("readonly", ctx);
for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];

function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cw-agent-sandbox-deny-"));
  const stub = path.join(work, "stub-agent.js");
  // Booleans only (never real values) -- portable across dev machines and CI.
  fs.writeFileSync(
    stub,
    "process.stdout.write(JSON.stringify({" +
      "hasAnthropicKey: typeof process.env.ANTHROPIC_API_KEY === 'string'," +
      "hasAwsSecret: typeof process.env.AWS_SECRET_ACCESS_KEY === 'string'," +
      "hasUser: typeof process.env.USER === 'string'," +
      "hasInheritOnly: typeof process.env.__CW_INHERIT_ONLY__ === 'string'" +
      "}));\n",
    "utf8"
  );

  const priorUser = process.env.USER;
  process.env.USER = "cw-smoke-user";
  process.env.ANTHROPIC_API_KEY = "cw-smoke-anthropic-key";
  process.env.AWS_SECRET_ACCESS_KEY = "cw-smoke-aws-secret";
  process.env.__CW_INHERIT_ONLY__ = "cw-smoke-inherit-only";
  try {
    // ---- 1. deny beats the provider-key re-add for a REAL agent child -----------
    {
      const denyAwsPolicy = { ...readonly, env: { inherit: false, expose: [], deny: ["AWS_SECRET_ACCESS_KEY"] } };
      const expectedStdout = JSON.stringify({ hasAnthropicKey: true, hasAwsSecret: false, hasUser: true, hasInheritOnly: false });
      const agent = runBackend({
        schemaVersion: 1,
        cwd: pluginRoot,
        sandboxPolicy: denyAwsPolicy,
        label: "agent-sandbox-deny-provider-key",
        backendId: "agent",
        delegation: { command: process.execPath, args: [stub] }
      });
      assert.equal(agent.status, "completed", `real spawn under a deny-AWS_SECRET_ACCESS_KEY policy completes (evidence: ${JSON.stringify(agent.evidence)})`);
      const stdoutEntry = agent.evidence.find((e) => e.startsWith("stdoutSha256:"));
      assert.equal(
        stdoutEntry,
        `stdoutSha256:${sha256(expectedStdout)}`,
        "AWS_SECRET_ACCESS_KEY is denied (absent) while the undenied ANTHROPIC_API_KEY and USER still reach the child"
      );
    }

    // ---- 2. deny beats inherit:true for a REAL agent child -----------------------
    {
      const inheritDenyPolicy = { ...readonly, env: { inherit: true, expose: [], deny: ["__CW_INHERIT_ONLY__"] } };
      const expectedStdout = JSON.stringify({ hasAnthropicKey: true, hasAwsSecret: true, hasUser: true, hasInheritOnly: false });
      const agent = runBackend({
        schemaVersion: 1,
        cwd: pluginRoot,
        sandboxPolicy: inheritDenyPolicy,
        label: "agent-sandbox-deny-inherit",
        backendId: "agent",
        delegation: { command: process.execPath, args: [stub] }
      });
      assert.equal(agent.status, "completed", `real spawn under inherit:true + deny completes (evidence: ${JSON.stringify(agent.evidence)})`);
      const stdoutEntry = agent.evidence.find((e) => e.startsWith("stdoutSha256:"));
      assert.equal(
        stdoutEntry,
        `stdoutSha256:${sha256(expectedStdout)}`,
        "__CW_INHERIT_ONLY__ is denied even though inherit:true would otherwise carry it; everything else inherited normally"
      );
    }
  } finally {
    if (priorUser === undefined) delete process.env.USER;
    else process.env.USER = priorUser;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.__CW_INHERIT_ONLY__;
    fs.rmSync(work, { recursive: true, force: true });
  }

  process.stdout.write("agent-backend-sandbox-deny-smoke: ok (env.deny wins over both the provider-key re-add and inherit:true for a REAL spawned agent child)\n");
}

main();
