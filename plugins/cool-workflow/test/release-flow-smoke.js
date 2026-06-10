#!/usr/bin/env node
"use strict";

// release-flow-smoke — exercises scripts/release-flow.js, the portable,
// vendor-neutral release orchestrator. We run the REAL script against throwaway
// git fixtures with:
//   - the deterministic gate stubbed out (CW_RELEASE_FLOW_GATE_CMD=true) so we
//     test the ORCHESTRATION layer, not the full build/test suite (that is
//     covered by release-gate-smoke.js) and avoid recursing into npm test;
//   - the reviewer delegated to a STUB agent (CW_AGENT_COMMAND) that writes a
//     chosen verdict — proving the delegate→verdict→verify path works for ANY
//     configured agent, and fails CLOSED on REJECTED / missing / unconfigured.
//
// Every assertion fails if the orchestration logic is reverted. Portable:
// node + git only, isolated tmpdir. No real model is ever spawned.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const FLOW = path.resolve(__dirname, "..", "scripts", "release-flow.js");
assert.ok(fs.existsSync(FLOW), "release-flow.js must exist");

// ---- red line (static): the orchestrator spawns shell:false and embeds no
// model SDK / API key. Mirrors quickstart-smoke.js's guard.
{
  const src = fs.readFileSync(FLOW, "utf8");
  assert.match(src, /shell:\s*false/, "agent delegation must spawn shell:false (red line)");
  for (const sdk of ["@anthropic-ai", "openai", "@google/generative-ai", "ollama", "cohere", "mistralai"]) {
    assert.ok(!new RegExp(`require\\(["'][^"']*${sdk}`).test(src), `release-flow must not import a model SDK: ${sdk}`);
  }
  assert.ok(!/api[._-]?key/i.test(src.replace(/CW_AGENT[A-Z_]*/g, "")), "release-flow must not handle an API key");
}

let caseId = 0;
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cw-flow-${caseId++}-`));
  run("git", ["init", "-q", "-b", "work"], dir);
  run("git", ["config", "user.email", "t@t"], dir);
  run("git", ["config", "user.name", "t"], dir);
  run("git", ["config", "commit.gpgsign", "false"], dir);
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  run("git", ["add", "-A"], dir);
  run("git", ["commit", "-q", "-m", "init"], dir);
  return dir;
}
function run(bin, args, cwd, env) {
  const r = spawnSync(bin, args, { cwd, encoding: "utf8", env: env || process.env });
  return { code: r.status, out: (r.stdout || ""), err: (r.stderr || "") };
}

// A stub "agent": node script that writes a chosen verdict to {{result}}.
// verdict arg: APPROVED | REJECTED | NONE (writes nothing).
function writeStub(dir) {
  const stub = path.join(dir, "stub-agent.js");
  fs.writeFileSync(stub, `
const fs = require("node:fs");
const resultPath = process.argv[2];
const kind = process.argv[3];
if (kind === "APPROVED") fs.writeFileSync(resultPath, "APPROVED " + (process.env.STUB_SHA||"sha") + "\\nstub: capability sentence.\\n");
else if (kind === "REJECTED") fs.writeFileSync(resultPath, "REJECTED\\n1. stub gate failure.\\n");
// NONE: write nothing (simulate an agent that produced no verdict)
process.exit(0);
`);
  return stub;
}

function runFlow(dir, { agentCmd } = {}) {
  const env = { ...process.env, CW_RELEASE_FLOW_GATE_CMD: "true" };
  if (agentCmd === undefined) {
    delete env.CW_AGENT_COMMAND;
    delete env.CW_AGENT_ENDPOINT;
  } else {
    env.CW_AGENT_COMMAND = agentCmd;
  }
  return run("node", [FLOW, "--check"], dir, env);
}

// ---- Case 1: stub APPROVES → flow succeeds, verdict written ----
{
  const dir = fixture();
  const stub = writeStub(dir);
  const r = runFlow(dir, { agentCmd: `node ${stub} {{result}} APPROVED` });
  assert.equal(r.code, 0, `APPROVED stub should pass:\n${r.err}\n${r.out}`);
  const sha = run("git", ["rev-parse", "HEAD"], dir).out.trim();
  const verdict = path.join(dir, ".cw-release", `review-${sha}.verdict`);
  assert.ok(fs.existsSync(verdict), "verdict file must be written");
  assert.match(fs.readFileSync(verdict, "utf8"), /^APPROVED /, "verdict must be APPROVED");
  assert.match(r.out, /"verdict": "APPROVED"/, "summary should report APPROVED");
}

// ---- Case 2: stub REJECTS → fail closed ----
{
  const dir = fixture();
  const stub = writeStub(dir);
  const r = runFlow(dir, { agentCmd: `node ${stub} {{result}} REJECTED` });
  assert.equal(r.code, 1, "REJECTED verdict must fail the flow");
  assert.match(r.err, /not APPROVED|blocked/i, "should explain the block");
}

// ---- Case 3: stub writes nothing → fail closed (missing verdict) ----
{
  const dir = fixture();
  const stub = writeStub(dir);
  const r = runFlow(dir, { agentCmd: `node ${stub} {{result}} NONE` });
  assert.equal(r.code, 1, "missing verdict must fail the flow");
  assert.match(r.err, /no verdict|fail closed/i, "should explain the missing verdict");
}

// ---- Case 4: no agent configured → fail closed with guidance ----
{
  const dir = fixture();
  const r = runFlow(dir, { agentCmd: undefined });
  assert.equal(r.code, 1, "unconfigured agent must fail closed");
  assert.match(r.err, /no reviewer agent configured|CW_AGENT_COMMAND/, "should tell the operator how to configure");
}

// ---- Case 5: a failing gate stops the flow before any review ----
{
  const dir = fixture();
  const stub = writeStub(dir);
  const env = { ...process.env, CW_RELEASE_FLOW_GATE_CMD: "false", CW_AGENT_COMMAND: `node ${stub} {{result}} APPROVED` };
  const r = run("node", [FLOW, "--check"], dir, env);
  assert.equal(r.code, 1, "a red gate must stop the flow");
  assert.match(r.err, /gate FAILED/i, "should name the gate failure");
  const sha = run("git", ["rev-parse", "HEAD"], dir).out.trim();
  assert.ok(!fs.existsSync(path.join(dir, ".cw-release", `review-${sha}.verdict`)), "no verdict before a green gate");
}

process.stdout.write("release-flow-smoke: ok\n");
