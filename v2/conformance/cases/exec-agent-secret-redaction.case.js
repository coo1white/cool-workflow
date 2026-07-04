#!/usr/bin/env node
"use strict";

// stripSecretArgs — a raw --api-key value must NEVER appear anywhere in
// the durable provenance CW writes (state.json's result-node metadata),
// even though the run completes normally and the agent process itself
// did receive the real value on its own argv.

const fs = require("node:fs");
const { run, gitRepo, readJson, caseMain, assert, stubAgentEnv } = require("../lib");

const RAW_SECRET = "sk-THISISASECRETVALUE1234567890";

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const stub = stubAgentEnv("a.txt:1");
  // Put the flag AFTER {{input}} {{result}} so the stub agent's own
  // argv[2]/argv[3] positions (its input/result paths) are untouched.
  stub.CW_AGENT_COMMAND = `${stub.CW_AGENT_COMMAND} --api-key ${RAW_SECRET}`;

  const r = run(["quickstart", "--app", "end-to-end-golden-path", "--question", "Prove it works"], {
    cwd: repo,
    env: stub,
  });
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.status, "complete");

  const stateText = fs.readFileSync(payload.statePath, "utf8");
  assert.ok(!stateText.includes(RAW_SECRET), "the raw secret must never be persisted to state.json");

  const state = readJson(payload.statePath);
  const resultNode = state.nodes.find((n) => n.kind === "result");
  assert.ok(resultNode, "a result node must exist");
  const delegation = resultNode.metadata.agentDelegation;
  assert.ok(delegation, "agentDelegation provenance must be recorded");

  assert.ok(delegation.args.includes("--api-key"), "the flag name itself is kept");
  assert.ok(delegation.args.includes("<redacted>"), "the value after --api-key becomes <redacted>");
  assert.ok(!delegation.args.some((a) => a.includes(RAW_SECRET)), "no arg may contain the raw secret");
  assert.ok(!delegation.handle.ref.includes(RAW_SECRET), "the recorded handle ref must be stripped too");
  assert.ok(delegation.handle.metadata.args.every((a) => !a.includes(RAW_SECRET)));

  // Same worker-level provenance file (workers/index.json + manifest) must
  // also be clean — belt and suspenders on the same accept path.
  const runDir = require("node:path").dirname(payload.statePath);
  const indexText = fs.readFileSync(require("node:path").join(runDir, "workers", "index.json"), "utf8");
  assert.ok(!indexText.includes(RAW_SECRET));
});
