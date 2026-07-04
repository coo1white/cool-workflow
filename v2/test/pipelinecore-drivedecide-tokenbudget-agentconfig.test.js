#!/usr/bin/env node
// pipelinecore-drivedecide-tokenbudget-agentconfig — terminalOrConfigStep's
// token-budget and unconfigured-agent blocked branches, exact reason
// strings, and check ORDER (token budget before agent config).
// SPEC/pipeline-run.md "Drive loop — src/drive.ts" (token budget:
// src/drive.ts:186-197, 517; unconfigured agent: src/drive.ts:132-134,
// 199-207).

const assert = require("node:assert/strict");
const { terminalOrConfigStep } = require("../dist/core/pipeline/drive-decide");

function run() {
  return { id: "run-1", tasks: [{ id: "t1", phase: "p1", status: "pending" }], commits: [] };
}

const SELECTED = { id: "t1", phase: "p1", status: "pending" };

// Token budget exhausted (spent >= budget, budget > 0) -> blocked with the
// exact reason string.
{
  const result = terminalOrConfigStep(run(), SELECTED, true, { spent: 1000, budget: 1000 });
  assert.equal(result.kind, "blocked");
  assert.equal(result.step.reason, "token budget exhausted: 1000 recorded tokens >= budget 1000 — refusing to spawn further agents");
  assert.equal(result.step.taskId, "t1");
  assert.equal(result.step.phase, "p1");
}

// Token budget spent EXCEEDING budget also blocks (>=, not just ==).
{
  const result = terminalOrConfigStep(run(), SELECTED, true, { spent: 1500, budget: 1000 });
  assert.equal(result.kind, "blocked");
  assert.equal(result.step.reason, "token budget exhausted: 1500 recorded tokens >= budget 1000 — refusing to spawn further agents");
}

// Token budget spent BELOW budget -> not blocked on this check.
{
  const result = terminalOrConfigStep(run(), SELECTED, true, { spent: 500, budget: 1000 });
  assert.equal(result.kind, undefined);
}

// budget of 0 (or negative) means the check is DISABLED (budget > 0
// guard) even if spent is very high.
{
  const result = terminalOrConfigStep(run(), SELECTED, true, { spent: 999999, budget: 0 });
  assert.equal(result.kind, undefined, "a budget of 0 must disable the token-budget check entirely");
}

// No tokenBudget object at all (undefined) -> the check is skipped
// entirely, no throw.
{
  const result = terminalOrConfigStep(run(), SELECTED, true, undefined);
  assert.equal(result.kind, undefined);
}

// Unconfigured agent (agentConfigured: false) -> blocked with the exact
// reason string, when the token budget check does NOT block first.
{
  const result = terminalOrConfigStep(run(), SELECTED, false, undefined);
  assert.equal(result.kind, "blocked");
  assert.equal(
    result.step.reason,
    "agent backend not configured (set CW_AGENT_COMMAND/CW_AGENT_ENDPOINT or pass --agent-command/--agent-endpoint) — refusing rather than fabricating a completion"
  );
  assert.equal(result.step.taskId, "t1");
  assert.equal(result.step.phase, "p1");
}

// Check ORDER: token budget is checked BEFORE agent config — when BOTH
// are simultaneously true (budget exhausted AND agent unconfigured), the
// TOKEN BUDGET reason wins.
{
  const result = terminalOrConfigStep(run(), SELECTED, false, { spent: 1000, budget: 1000 });
  assert.ok(result.step.reason.startsWith("token budget exhausted"), "token budget must be checked before agent configuration");
}

// Both checks pass (budget fine, agent configured) -> kind undefined,
// proceed to process the task.
{
  const result = terminalOrConfigStep(run(), SELECTED, true, { spent: 0, budget: 1000 });
  assert.equal(result.kind, undefined);
}

process.stdout.write("pipelinecore-drivedecide-tokenbudget-agentconfig: ok\n");
