#!/usr/bin/env node
"use strict";

// enforcement-labels-smoke — the CI gate for per-dimension guarantee labels
// and the model-identity label.
//
// Hermetic: a stub agent (a tiny node child) is wired in through
// CW_AGENT_COMMAND — no live agent, no network, no model. Proves:
//   1. state.json carries backendAttestation.guarantees on the driven
//      worker: write is "enforced", and read/command/network are NOT
//      "enforced" on the default drive path (CW itself only makes the
//      write boundary true; the rest is attested or absent).
//   2. the worker usage record carries modelProvenance:
//      "agent-self-reported" when the stub names a model, "absent" when
//      it does not — never made up, never backfilled.
//   3. report.md renders the new per-worker guarantee line and the
//      "- Model provenance:" tally line.
//   4. `telemetry verify --json` carries modelSelfReported/modelAbsent,
//      and the human render prints the "model:" line.

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");

const cleanups = [];
function tmpRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-enforcement-labels-")));
  fs.writeFileSync(path.join(dir, "a.txt"), "hello\n", "utf8");
  cleanups.push(dir);
  return dir;
}

// A stub agent: argv[2]=input path, argv[3]=result path. It writes a
// result.md with a cw:result fence whose evidence resolves in the repo,
// then prints ONE stdout JSON line. With opts.model it names a model (and
// reports usage); without it, it reports usage but NO model.
function writeStub(dir, opts = {}) {
  const file = path.join(dir, opts.model ? "stub-model.js" : "stub-no-model.js");
  const report = opts.model
    ? `{ model: ${JSON.stringify(opts.model)}, usage: { input_tokens: 4, output_tokens: 2 } }`
    : "{ usage: { input_tokens: 4, output_tokens: 2 } }";
  fs.writeFileSync(
    file,
    [
      'const fs = require("node:fs");',
      "const fence = String.fromCharCode(96).repeat(3);",
      "const rp = process.argv[3];",
      'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub", findings: [], evidence: ["a.txt:1"] }) + "\\n" + fence + "\\n";',
      "fs.writeFileSync(rp, body);",
      `process.stdout.write(JSON.stringify(${report}) + "\\n");`,
    ].join("\n"),
    "utf8"
  );
  return file;
}

function stubEnv(stub) {
  const env = { ...process.env, CW_AGENT_COMMAND: `${process.execPath} ${stub} {{input}} {{result}}` };
  for (const v of ["CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND", "CW_NO_AUTO_AGENT"]) delete env[v];
  return env;
}

function driveRun(repo, stub) {
  const stdout = execFileSync(
    process.execPath,
    [cli, "run", "end-to-end-golden-path", "--drive", "--question", "prove it", "--repo", repo, "--json"],
    { cwd: repo, env: stubEnv(stub), encoding: "utf8" }
  );
  return JSON.parse(stdout);
}

function telemetryVerify(repo, runId, json) {
  const args = [cli, "telemetry", "verify", runId];
  if (json) args.push("--json");
  return execFileSync(process.execPath, args, { cwd: repo, encoding: "utf8" });
}

function main() {
  // ---- 1+2a. model-reporting stub: guarantees + "agent-self-reported" ----
  const repoA = tmpRepo();
  const stubA = writeStub(repoA, { model: "stub-reported-model" });
  const payloadA = driveRun(repoA, stubA);
  const stateA = JSON.parse(fs.readFileSync(payloadA.statePath, "utf8"));
  assert.ok(Array.isArray(stateA.workers) && stateA.workers.length >= 1, "the driven run has a worker scope");
  const workerA = stateA.workers[0];
  const guarantees = workerA.backendAttestation && workerA.backendAttestation.guarantees;
  assert.ok(guarantees, "state.json worker carries backendAttestation.guarantees");
  assert.equal(guarantees.write, "enforced", "write is the ONE CW-enforced dimension on the default path");
  for (const dim of ["read", "command", "network"]) {
    assert.notEqual(guarantees[dim], "enforced", `${dim} is never labeled enforced on the default path`);
    assert.ok(["attested", "absent"].includes(guarantees[dim]), `${dim} label is attested or absent`);
  }
  assert.ok(workerA.usage, "a model-reporting stub leaves a usage record");
  assert.equal(workerA.usage.modelProvenance, "agent-self-reported", "the model identity label is agent-self-reported");
  assert.equal(workerA.usage.model, "stub-reported-model", "the recorded model is the agent-reported one");

  // ---- 3. report.md carries the new lines --------------------------------
  const reportA = fs.readFileSync(payloadA.reportPath, "utf8");
  assert.match(
    reportA,
    /- [^\n]+: backend=agent guarantees write=enforced read=(attested|absent) command=(attested|absent) network=(attested|absent) env=(attested|absent) model=agent-self-reported\n/,
    "report.md renders the per-worker guarantee line"
  );
  assert.ok(
    reportA.includes("- Model provenance: 1 agent-self-reported · 0 absent (agent-self-reported, never CW-verified)"),
    "report.md renders the model-provenance tally"
  );

  // ---- 4. telemetry verify carries the model counts ----------------------
  const verifyA = JSON.parse(telemetryVerify(repoA, payloadA.runId, true));
  assert.equal(verifyA.modelSelfReported, 1, "telemetry verify --json counts the self-reported model");
  assert.equal(verifyA.modelAbsent, 0, "telemetry verify --json counts no absent model");
  const humanA = telemetryVerify(repoA, payloadA.runId, false);
  assert.ok(humanA.includes("model: agent-self-reported 1 · absent 0"), "human render prints the model line");

  // ---- 2b. no-model stub: the identity stays absent ----------------------
  const repoB = tmpRepo();
  const stubB = writeStub(repoB, {});
  const payloadB = driveRun(repoB, stubB);
  const stateB = JSON.parse(fs.readFileSync(payloadB.statePath, "utf8"));
  const workerB = stateB.workers[0];
  assert.ok(workerB.usage, "a usage-only stub still leaves a usage record");
  assert.equal(workerB.usage.modelProvenance, "absent", "no reported model gives the label absent");
  assert.ok(!workerB.usage.model, "no model id is made up for the record");
  const reportB = fs.readFileSync(payloadB.reportPath, "utf8");
  assert.match(reportB, /- [^\n]+: backend=agent guarantees write=enforced [^\n]+ model=absent\n/, "the worker line says model=absent");
  assert.ok(
    reportB.includes("- Model provenance: 0 agent-self-reported · 1 absent (agent-self-reported, never CW-verified)"),
    "the tally counts the absent model"
  );
  const verifyB = JSON.parse(telemetryVerify(repoB, payloadB.runId, true));
  assert.equal(verifyB.modelSelfReported, 0);
  assert.equal(verifyB.modelAbsent, 1);

  for (const dir of cleanups) fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write(
    "enforcement-labels-smoke: ok (guarantees labeled per dimension, write-only enforced on the default path; model identity agent-self-reported/absent; report + telemetry verify surfaces)\n"
  );
}

main();
