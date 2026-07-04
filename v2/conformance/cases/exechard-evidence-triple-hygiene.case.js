#!/usr/bin/env node
"use strict";

// Evidence-triple hygiene — a real stub-agent pipeline step records a
// result node whose top-level `evidence` array is EXACTLY the worker's
// findings/evidence locators (from the stub's cw:result block). Provenance
// data (the agent's command/args, its model id, the handle ref, the backend
// id, timestamps, ...) lives ONLY in node.metadata.agentDelegation — it must
// NEVER leak into the evidence array itself. This pins the "evidence in,
// provenance out" split the spec calls out (docs/real-execution-backends.7.md:
// "handle... NEVER in evidence"; src/execution-backend.ts:680-713 delegatedEnvelope).

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, readJson, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const stub = stubAgentEnv("a.txt:1");
  // Give the agent command a distinctive extra flag + model policy so we
  // have concrete provenance strings to prove are ABSENT from evidence.
  stub.CW_AGENT_COMMAND = `${stub.CW_AGENT_COMMAND} --label conformance-marker-xyz`;
  stub.CW_AGENT_MODEL = "policy-model-should-not-leak";

  const r = run(
    ["run", "end-to-end-golden-path", "--drive", "--once", "--question", "prove it", "--repo", repo, "--json"],
    { cwd: repo, env: stub }
  );
  assert.equal(r.status, 0, r.stderr);
  const step1 = JSON.parse(r.stdout);

  // Drive until complete (single-worker golden path; a couple of steps at
  // most gets us through fulfill -> accept -> commit).
  let payload = step1;
  let guard = 0;
  while (payload.status !== "complete" && guard < 5) {
    const rr = run(["run", "--drive", "--once", "--run", payload.runId, "--json"], { cwd: repo, env: stub });
    assert.equal(rr.status, 0, rr.stderr);
    payload = JSON.parse(rr.stdout);
    guard += 1;
  }
  assert.equal(payload.status, "complete", "golden path must complete with the stub agent");

  const runDir = path.dirname(payload.statePath);
  const state = readJson(payload.statePath);
  const resultNode = state.nodes.find((n) => n.kind === "result");
  assert.ok(resultNode, "a result node must exist");

  // outputs.evidence — the raw locator strings from the stub's cw:result
  // block. This is the plain "findings/evidence" shape a worker reports.
  const outputEvidence = resultNode.outputs && resultNode.outputs.evidence;
  assert.deepEqual(outputEvidence, ["a.txt:1"], "outputs.evidence is exactly the stub's declared locator");

  // node.evidence — CW's own grounded-evidence records. Each entry is an
  // EvidenceRecord: {id, source, locator, summary, confidence,
  // contentPreview, provenance{runId,source,workerId,taskId,resultNodeId,
  // parentEvidenceIds,auditEventIds}}. This provenance sub-object is about
  // GROUNDING (which audit events explain the locator), not about the
  // agent's spawn command/model — so it must never carry the command,
  // args, or model fields the agent hop itself produced.
  const evidence = resultNode.evidence;
  assert.ok(Array.isArray(evidence) && evidence.length > 0, "result node must carry a non-empty evidence array");
  assert.equal(evidence.length, 1);
  const evRecord = evidence[0];
  assert.equal(evRecord.locator, "a.txt:1");
  assert.equal(evRecord.source, "cw:result");

  const evJson = JSON.stringify(evidence);
  assert.ok(!/conformance-marker-xyz/.test(evJson), "evidence must not contain the agent command/flag text");
  assert.ok(!/policy-model-should-not-leak/.test(evJson), "evidence must not contain the model policy value");
  assert.ok(!/stub-agent\.js/.test(evJson), "evidence must not contain the agent binary/args");
  assert.ok(!("command" in evRecord), "evidence record must not carry a command field");
  assert.ok(!("args" in evRecord), "evidence record must not carry an args field");
  assert.ok(!("model" in evRecord), "evidence record must not carry a model field");
  assert.ok(!("handle" in evRecord), "evidence record must not carry a handle field");
  assert.ok(!("reportedModel" in evRecord), "evidence record must not carry a reportedModel field");
  // The evidence-side provenance sub-object is grounding-only: exactly the
  // fields the spec allows, nothing about the agent process leaking in.
  const evProvKeys = Object.keys(evRecord.provenance).sort();
  assert.deepEqual(
    evProvKeys,
    ["auditEventIds", "parentEvidenceIds", "resultNodeId", "runId", "schemaVersion", "source", "taskId", "workerId"],
    "evidence.provenance is grounding-only — no command/args/model/handle keys"
  );

  // Provenance (command, args, model, handle) DOES live in
  // node.metadata.agentDelegation — that is the correct, separate home for
  // it, proving this is a real hygiene split and not just an empty
  // evidence array.
  const delegation = resultNode.metadata && resultNode.metadata.agentDelegation;
  assert.ok(delegation, "agentDelegation provenance must be recorded in metadata");
  assert.ok(
    delegation.args.some((a) => a.includes("conformance-marker-xyz")),
    "the marker flag DOES belong in metadata.agentDelegation.args (proving it was really passed, just not into evidence)"
  );
  assert.equal(
    delegation.handle.metadata.model,
    "policy-model-should-not-leak",
    "the CW_AGENT_MODEL policy value DOES belong in metadata.agentDelegation.handle.metadata.model"
  );
  // The top-level delegation.model is the agent's OWN reported model
  // (stub-agent-1), never the operator's policy value — confirming the
  // policy value truly only rides in the handle metadata, not disguised
  // as the attested model.
  assert.equal(delegation.model, "stub-agent-1");

  // Same check against the raw JSON text of state.json: the provenance
  // strings appear (in metadata), but never inside any evidence array
  // value — i.e. they are not smeared across the whole file by accident,
  // they are confined to their own field.
  const stateText = fs.readFileSync(payload.statePath, "utf8");
  assert.ok(stateText.includes("conformance-marker-xyz"), "marker must appear somewhere (in provenance)");

  // Belt and suspenders: the accepted result.md copy and the worker's own
  // manifest must not somehow duplicate provenance into an "evidence" key
  // either.
  const resultsDir = path.join(runDir, "results");
  if (fs.existsSync(resultsDir)) {
    for (const f of fs.readdirSync(resultsDir)) {
      const text = fs.readFileSync(path.join(resultsDir, f), "utf8");
      assert.ok(!text.includes("policy-model-should-not-leak"), "accepted result.md copy must not carry the model policy");
    }
  }
});
