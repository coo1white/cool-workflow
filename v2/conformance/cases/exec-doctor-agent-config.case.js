#!/usr/bin/env node
"use strict";

// cw doctor / cw fix react to agent config the same way whether the value
// comes from auto-detect, env, or a broken builtin:<name>. A bad
// builtin:<name> must fail closed with the exact refusal text — never a
// silent fall-through to "no agent configured".

const { run, caseMain, assert } = require("../lib");

caseMain(() => {
  // 1) No agent, auto-detect off: doctor WARNS (not an error), --json
  // carries the same fix text `cw fix` prints standalone.
  const doctorText = run(["doctor"], { env: { CW_NO_AUTO_AGENT: "1" } });
  assert.equal(doctorText.status, 0);
  assert.match(doctorText.stdout, /! agent: No agent backend configured/);
  assert.match(doctorText.stdout, /ready, with 1 warning/);

  const doctorJson = run(["doctor", "--json"], { env: { CW_NO_AUTO_AGENT: "1" } });
  assert.equal(doctorJson.status, 0);
  const report = JSON.parse(doctorJson.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.ok, true);
  const agentCheck = report.checks.find((c) => c.name === "agent");
  assert.equal(agentCheck.status, "warn");
  assert.equal(
    agentCheck.detail,
    "No agent backend configured — `demo` and `--preview` work, but a real run reports status: blocked."
  );
  assert.equal(
    agentCheck.fix,
    'Pass --agent-command "claude -p", set $CW_AGENT_COMMAND, or use --agent-command builtin:claude.'
  );
  assert.equal(report.summary, "ready, with 1 warning");

  const fix = run(["fix"], { env: { CW_NO_AUTO_AGENT: "1" } });
  assert.equal(fix.status, 0);
  assert.match(fix.stdout, /^Fix Commands\n {2}1\. Pass --agent-command "claude -p", set \$CW_AGENT_COMMAND, or use --agent-command builtin:claude\.\n/);

  // 2) An unknown builtin:<name> fails closed with the exact refusal —
  // doctor never silently falls back to "unconfigured".
  const badBuiltin = run(["doctor"], { env: { CW_AGENT_COMMAND: "builtin:doesnotexist" } });
  assert.equal(badBuiltin.status, 1);
  assert.equal(badBuiltin.stdout, "");
  assert.equal(
    badBuiltin.stderr,
    'cw: Unknown builtin agent template "doesnotexist" — available: claude, codex, gemini, gemini-cli, opencode, deepseek\n'
  );

  const badBuiltinJson = run(["doctor", "--json"], { env: { CW_AGENT_COMMAND: "builtin:doesnotexist" } });
  assert.equal(badBuiltinJson.status, 1);
  assert.equal(badBuiltinJson.stdout, "");
  assert.equal(badBuiltinJson.stderr, badBuiltin.stderr);
});
