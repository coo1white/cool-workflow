#!/usr/bin/env node

// Model-attestation honesty — when the agent's own stdout report carries NO
// model field, the recorded model must be the EXACT literal string
// "unreported", never silently backfilled from CW_AGENT_MODEL (the
// operator's policy value put into {{model}}) or from any other config.
// This is the spec's named red line: CW_AGENT_MODEL is policy going IN, the
// recorded model comes ONLY from what the agent actually said about itself.

import fs from "node:fs";
import path from "node:path";
import { run, gitRepo, readJson, caseMain, assert } from "../lib.mjs";

const NO_MODEL_AGENT = path.join(import.meta.dirname, "fixtures", "stub-agent-no-model.mjs");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  // A REAL, distinctive operator policy model. If this string ever shows
  // up as a recorded model, the backfill bug is present.
  const OPERATOR_POLICY_MODEL = "operator-policy-model-must-not-be-attested";
  const env = {
    CW_AGENT_COMMAND: `node ${NO_MODEL_AGENT} {{input}} {{result}}`,
    CW_AGENT_MODEL: OPERATOR_POLICY_MODEL,
  };

  const r = run(["-q", "prove it", "--json"], { cwd: repo, env });
  assert.equal(r.status, 0, r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.status, "complete", "the run completes even though the agent reported no model");

  const state = readJson(payload.statePath);
  const agentTasks = state.tasks.filter((t) => t.status === "completed");
  assert.ok(agentTasks.length > 0);
  for (const task of agentTasks) {
    assert.equal(task.model, "unreported", `${task.id}: recorded model must be the exact string 'unreported'`);
  }

  // Nowhere in the run's files is the policy value recorded as a model.
  const runDir = path.dirname(payload.statePath);
  for (const name of ["state.json", "telemetry.json", "report.md"]) {
    const file = path.join(runDir, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    assert.ok(!text.includes(`"model": "${OPERATOR_POLICY_MODEL}"`) && !text.includes(`"model":"${OPERATOR_POLICY_MODEL}"`), `${name}: no model field may equal the policy value`);
  }
});
