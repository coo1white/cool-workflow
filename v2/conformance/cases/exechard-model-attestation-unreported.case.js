#!/usr/bin/env node
"use strict";

// Model-attestation honesty — when the agent's own stdout report carries NO
// model field, the recorded/attested model must be the EXACT literal string
// "unreported", never silently backfilled from CW_AGENT_MODEL (the
// operator's policy value put into {{model}}) or from any other config.
// This is the spec's named red line: CW_AGENT_MODEL is policy going IN, the
// attested model comes ONLY from what the agent actually said about itself.

const path = require("node:path");
const { run, gitRepo, readJson, caseMain, assert } = require("../lib");

const NO_MODEL_AGENT = path.join(__dirname, "fixtures", "stub-agent-no-model.js");

function driveToComplete(repo, env, firstArgs) {
  const first = run(firstArgs, { cwd: repo, env });
  assert.equal(first.status, 0, first.stderr);
  let payload = JSON.parse(first.stdout);
  let guard = 0;
  while (payload.status !== "complete" && guard < 5) {
    const rr = run(["run", "--drive", "--once", "--run", payload.runId, "--json"], { cwd: repo, env });
    assert.equal(rr.status, 0, rr.stderr);
    payload = JSON.parse(rr.stdout);
    guard += 1;
  }
  assert.equal(payload.status, "complete", "golden path must complete even though the agent reported no model");
  return payload;
}

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  // Set a REAL, distinctive operator policy model. If this string ever
  // shows up as the attested/reported model, the backfill bug is present.
  const OPERATOR_POLICY_MODEL = "operator-policy-model-must-not-be-attested";
  const env = {
    CW_AGENT_COMMAND: `node ${NO_MODEL_AGENT} {{input}} {{result}}`,
    CW_AGENT_MODEL: OPERATOR_POLICY_MODEL,
  };

  const payload = driveToComplete(repo, env, [
    "run",
    "end-to-end-golden-path",
    "--drive",
    "--once",
    "--question",
    "prove it",
    "--repo",
    repo,
    "--json",
  ]);

  const state = readJson(payload.statePath);
  const resultNode = state.nodes.find((n) => n.kind === "result");
  assert.ok(resultNode, "a result node must exist");

  const delegation = resultNode.metadata && resultNode.metadata.agentDelegation;
  assert.ok(delegation, "agentDelegation provenance must be recorded");

  // The top-level attested model must be the exact literal "unreported" —
  // not empty string, not null, not undefined, not the operator's policy
  // value.
  assert.equal(delegation.model, "unreported", "attested model must be the exact string 'unreported'");
  assert.notEqual(delegation.model, OPERATOR_POLICY_MODEL);

  // The handle metadata carries BOTH: the operator's policy value (what was
  // asked for, going INTO {{model}}) and reportedModel (what actually came
  // back) — proving these are two separate fields, and the honest one is
  // "unreported", never quietly replaced by the policy value.
  const handleMeta = delegation.handle.metadata;
  assert.equal(handleMeta.model, OPERATOR_POLICY_MODEL, "handle.metadata.model keeps the operator's policy input");
  assert.equal(handleMeta.reportedModel, "unreported", "handle.metadata.reportedModel is the exact honest literal");
  assert.notEqual(handleMeta.reportedModel, OPERATOR_POLICY_MODEL);

  // Belt and suspenders on the raw JSON text: the operator's policy model
  // string appears somewhere (as the input), but the word "unreported"
  // must ALSO appear (as the attested output) — proving both facts are
  // recorded distinctly, not merged into one truth.
  const fs = require("node:fs");
  const stateText = fs.readFileSync(payload.statePath, "utf8");
  assert.ok(stateText.includes(OPERATOR_POLICY_MODEL));
  assert.ok(stateText.includes('"unreported"'));

  // The worker manifest / worker.json must show the same honesty — the
  // usage record, when present, still never invents a model from policy.
  const runDir = path.dirname(payload.statePath);
  const workerId = fs.readdirSync(path.join(runDir, "workers")).find((f) => f.startsWith("worker-"));
  const manifest = readJson(path.join(runDir, "workers", workerId, "manifest.json"));
  const manifestText = JSON.stringify(manifest);
  // If a usage record was stamped (the fixture DID report usage), any
  // model field inside it must still say "unreported", never the policy
  // value.
  if (/"model"\s*:/.test(manifestText)) {
    assert.ok(
      !manifestText.includes(`"model":"${OPERATOR_POLICY_MODEL}"`),
      "no manifest-level model field may equal the un-attested operator policy value"
    );
  }
});
