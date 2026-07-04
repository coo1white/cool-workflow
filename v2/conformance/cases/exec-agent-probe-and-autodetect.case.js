#!/usr/bin/env node
"use strict";

// The `agent` backend probe is NEVER a refusal when unconfigured — it is
// "unverified" with ready:false and a clear reason (unlike a real refusal
// code). CW_NO_AUTO_AGENT=1 turns PATH auto-detect off deterministically,
// so `backend agent config` shows source:"none" instead of guessing an
// agent CLI that happens to be on the test host's PATH.

const { run, caseMain, assert } = require("../lib");

caseMain(() => {
  const probe = run(["backend", "probe", "agent"], { env: { CW_NO_AUTO_AGENT: "1" } });
  assert.equal(probe.status, 0);
  const payload = JSON.parse(probe.stdout);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.backendId, "agent");
  assert.equal(payload.readiness, "unverified");
  assert.equal(payload.ready, false);
  assert.equal(
    payload.reason,
    "no agent configured (set CW_AGENT_COMMAND or CW_AGENT_ENDPOINT, or pass --agent-command/--agent-endpoint)"
  );
  const checkNames = payload.checks.map((c) => c.name).sort();
  assert.deepEqual(checkNames, ["agent-command", "agent-endpoint"]);
  assert.ok(payload.checks.every((c) => c.ok === false));

  // agentConfigShow with auto-detect off and nothing set: configured
  // false, source "none" — deterministic regardless of what happens to be
  // on this host's PATH.
  const cfg = run(["backend", "agent", "config"], { env: { CW_NO_AUTO_AGENT: "1" } });
  assert.equal(cfg.status, 0);
  const cfgPayload = JSON.parse(cfg.stdout);
  assert.equal(cfgPayload.schemaVersion, 1);
  assert.equal(cfgPayload.configured, false);
  assert.equal(cfgPayload.source, "none");
  assert.equal(cfgPayload.fileExists, false);
  assert.equal(cfgPayload.config.schemaVersion, 1);
  assert.equal(cfgPayload.config.source, "none");

  // With a command in the env, source becomes "env" and configured true —
  // proving the resolution layering works independent of auto-detect.
  const cfgEnv = run(["backend", "agent", "config"], {
    env: { CW_NO_AUTO_AGENT: "1", CW_AGENT_COMMAND: "echo hi", CW_AGENT_MODEL: "policy-model" },
  });
  assert.equal(cfgEnv.status, 0);
  const cfgEnvPayload = JSON.parse(cfgEnv.stdout);
  assert.equal(cfgEnvPayload.configured, true);
  assert.equal(cfgEnvPayload.source, "env");
  assert.equal(cfgEnvPayload.config.command, "echo");
  assert.deepEqual(cfgEnvPayload.config.args, ["hi"]);
  assert.equal(cfgEnvPayload.config.model, "policy-model");
});
