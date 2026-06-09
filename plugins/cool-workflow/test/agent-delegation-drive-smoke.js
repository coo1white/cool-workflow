#!/usr/bin/env node
"use strict";

// agent-delegation-drive-smoke (v0.1.38) — the CI gate for Agent Delegation Drive.
//
// Hermetic: a STUB agent (a tiny node child) stands in for `claude -p` / `codex
// exec`. No live agent binary, no second repo, no network, no model SDK. Proves:
//   1. the `agent` driver is delegating + in the sorted 7-row backend set (the
//      other 6 descriptors unchanged vs an inline golden);
//   2. probe of an UNCONFIGURED agent == remote's unconfigured shape (unverified /
//      ready:false / reason) — NOT a hard refusal;
//   3. runBackend unconfigured ⇒ delegation-target-missing refusal (never fabricated);
//   4. a stub completed envelope's evidence triple is the agent CHILD's, byte-stable
//      in SHAPE vs node; the handle/model/digests/args live ONLY in provenance;
//   5. operator model ≠ attested model; no model reported ⇒ `unreported`;
//   6. a templated secret never lands in recorded provenance;
//   7. a stub that writes no/invalid result.md fails closed (the drive parks);
//   8. `--drive --once` is deterministic under an injected `now`;
//   9. a failing agent hop parks past the retry budget (reuse v0.1.37 retryOrPark);
//  10. REPLAY determinism: the verdict node replays byte-identically under two
//      different `now`, WITHOUT re-spawning the agent, carrying the same digests;
//  11. THE RED LINE: no model SDK in package.json and no model-SDK import / model
//      API URL anywhere in src/**/*.ts.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const eb = require(path.join(pluginRoot, "dist/execution-backend.js"));
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const { drive, drivePreview } = require(path.join(pluginRoot, "dist/drive.js"));
const ns = require(path.join(pluginRoot, "dist/node-snapshot.js"));
const { showBundledSandboxProfile, sandboxContextForValidation } = require(path.join(pluginRoot, "dist/sandbox-profile.js"));

const FIXED_NOW = "2026-06-09T00:00:00.000Z";
const cleanups = [];
function tmpWorkspace() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-add-smoke-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  cleanups.push(work);
  return work;
}
function clearAgentEnv() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];
}

// A stub agent: argv[2]=resultPath. Options: { fail, invalid, noModel, model }.
function writeStub(file, opts = {}) {
  const model = opts.model || "stub-agent-model";
  const lines = ['const fs = require("fs");', "const fence = String.fromCharCode(96).repeat(3);", "const rp = process.argv[2];"];
  if (opts.fail) {
    lines.push('process.stderr.write("agent boom");', "process.exit(1);");
  } else if (opts.noResult) {
    // Exits 0 but writes NO result.md ⇒ the accept layer fails closed for EVERY worker.
    lines.push("// intentionally writes no result.md");
  } else if (opts.invalid) {
    // No cw:result fence + no evidence ⇒ rejected for evidence-gated workers.
    lines.push('fs.writeFileSync(rp, "# nope\\n\\nno cw result envelope here\\n");');
  } else {
    lines.push(
      'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub section", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
      "fs.writeFileSync(rp, body);"
    );
  }
  lines.push(opts.noModel ? 'process.stdout.write(JSON.stringify({ ok: true }));' : `process.stdout.write(JSON.stringify({ model: ${JSON.stringify(model)}, usage: { input_tokens: 4, output_tokens: 2 } }));`);
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

function newBase(cwd) {
  const ctx = sandboxContextForValidation(pluginRoot);
  const ro = showBundledSandboxProfile("readonly", ctx);
  return { schemaVersion: 1, cwd, sandboxPolicy: ro, label: "t" };
}

function main() {
  clearAgentEnv();

  // ---- 1. driver registry: sorted 7-row set + 6 descriptors unchanged ------
  assert.deepEqual(eb.backendIds(), ["agent", "bun", "ci", "container", "node", "remote", "shell"], "sorted 7-row set");
  assert.equal(eb.backendIds().length, 7, "length 7 (+1 over v0.1.37)");
  const agent = eb.getBackendDescriptor("agent");
  assert.equal(agent.kind, "delegating");
  assert.equal(agent.locality, "local", "agent locality is FIXED local");
  assert.equal(agent.default, false);
  const GOLDEN_SIX = [
    { id: "bun", kind: "local", locality: "local", default: false, delegate: "bun", readiness: "ready", enforces: ["command", "env"], attests: ["read", "write", "network"] },
    { id: "ci", kind: "delegating", locality: "remote", default: false, delegate: "ci-runner", readiness: "unverified", enforces: ["command", "env"], attests: ["read", "write", "network"] },
    { id: "container", kind: "delegating", locality: "local", default: false, delegate: "docker", readiness: "unverified", enforces: ["read", "write", "command", "network", "env"], attests: [] },
    { id: "node", kind: "local", locality: "local", default: true, delegate: undefined, readiness: "ready", enforces: ["command", "env"], attests: ["read", "write", "network"] },
    { id: "remote", kind: "delegating", locality: "remote", default: false, delegate: "remote-runner", readiness: "unverified", enforces: ["command", "env"], attests: ["read", "write", "network"] },
    { id: "shell", kind: "local", locality: "local", default: false, delegate: "/bin/sh", readiness: "ready", enforces: ["command", "env"], attests: ["read", "write", "network"] }
  ];
  const six = eb
    .listBackendDescriptors()
    .filter((d) => d.id !== "agent")
    .map((d) => ({ id: d.id, kind: d.kind, locality: d.locality, default: d.default, delegate: d.delegate, readiness: d.readiness, enforces: d.enforces, attests: d.attests }));
  assert.deepEqual(six, GOLDEN_SIX, "the other 6 descriptors are unchanged vs the inline golden");

  // ---- 2. probe: unconfigured agent == remote's unconfigured SHAPE ----------
  const pa = eb.probeBackend("agent");
  const pr = eb.probeBackend("remote");
  assert.equal(pa.readiness, "unverified", "unconfigured agent is unverified (NOT refused/unavailable)");
  assert.equal(pa.ready, false);
  assert.ok(pa.reason && pa.reason.trim(), "non-empty reason");
  assert.equal(pa.kind, pr.kind, "kind matches remote");
  assert.equal(pa.readiness, pr.readiness, "readiness matches remote");
  assert.equal(pa.ready, pr.ready, "ready matches remote");
  // configured ⇒ ready
  process.env.CW_AGENT_COMMAND = "true";
  assert.equal(eb.probeBackend("agent").readiness, "ready", "configured ⇒ ready");
  delete process.env.CW_AGENT_COMMAND;

  // ---- 3. runBackend unconfigured ⇒ delegation-target-missing refusal -------
  const workEnv = tmpWorkspace();
  const baseEnv = newBase(workEnv);
  const refused = eb.runBackend({ ...baseEnv, backendId: "agent", delegation: {} });
  assert.equal(refused.status, "refused", "unconfigured agent refuses");
  assert.ok(refused.evidence[0].includes("delegation-target-missing"), `refusal code: ${refused.evidence[0]}`);
  assert.ok(!refused.evidence.some((e) => e.startsWith("stdoutSha256:")), "no output digest on refusal (no fabricated completion)");

  // ---- 4. byte-stable evidence triple vs node (same command) ---------------
  const cmd = process.execPath;
  const cmdArgs = ["-e", "process.stdout.write('byte-stable-payload')"];
  const nodeEnv = eb.runBackend({ ...baseEnv, backendId: "node", command: cmd, args: cmdArgs });
  const agentEnv = eb.runBackend({
    ...baseEnv,
    backendId: "agent",
    command: cmd,
    args: cmdArgs,
    manifest: { workerDir: workEnv, inputPath: path.join(workEnv, "in.md"), resultPath: path.join(workEnv, "r.md"), prompt: "" },
    delegation: { command: cmd, args: cmdArgs }
  });
  assert.equal(nodeEnv.status, "completed");
  assert.equal(agentEnv.status, "completed");
  assert.equal(JSON.stringify(agentEnv.result), JSON.stringify(nodeEnv.result), "result envelope byte-stable across node/agent for the same command");
  const stripCommand = (ev) => ev.filter((e) => !e.startsWith("command:"));
  assert.deepEqual(stripCommand(agentEnv.evidence), stripCommand(nodeEnv.evidence), "evidence arrays equal after stripping the backend-specific command: entry");
  assert.equal(agentEnv.provenance.handle.kind, "process", "agent handle is kind:process");

  // ---- 5. handle/model/digests/args ONLY in provenance, never in evidence --
  const workA = tmpWorkspace();
  const stub = writeStub(path.join(workA, "stub.js"), { model: "reported-opus" });
  const baseA = newBase(workA);
  const manifestA = { workerDir: workA, inputPath: path.join(workA, "input.md"), resultPath: path.join(workA, "result.md"), prompt: "p" };
  fs.writeFileSync(manifestA.inputPath, "the worker prompt", "utf8");
  const env5 = eb.runBackend({ ...baseA, cwd: workA, backendId: "agent", manifest: manifestA, delegation: { command: process.execPath, args: [stub, "{{result}}"], model: "operator-pick" } });
  assert.equal(env5.status, "completed");
  const reportedModel = env5.provenance.handle.metadata.reportedModel;
  assert.equal(reportedModel, "reported-opus", "attested model is the agent-REPORTED model");
  const evJoined5 = JSON.stringify(env5.evidence);
  assert.ok(!evJoined5.includes("reported-opus"), "model id absent from evidence");
  assert.ok(!evJoined5.includes("operator-pick"), "operator model absent from evidence");

  // ---- 6. operator model ≠ attested model; no model ⇒ unreported -----------
  assert.notEqual(reportedModel, "operator-pick", "operator-chosen model does NOT become the attested model");
  const stubNoModel = writeStub(path.join(workA, "stub-nomodel.js"), { noModel: true });
  const env6 = eb.runBackend({ ...baseA, cwd: workA, backendId: "agent", manifest: { ...manifestA, resultPath: path.join(workA, "r6.md") }, delegation: { command: process.execPath, args: [stubNoModel, "{{result}}"], model: "operator-pick" } });
  assert.equal(env6.provenance.handle.metadata.reportedModel, "unreported", "no reported model ⇒ unreported (never backfilled from CW_AGENT_MODEL)");

  // ---- 7. a templated secret never lands in recorded provenance ------------
  const env7 = eb.runBackend({ ...baseA, cwd: workA, backendId: "agent", manifest: { ...manifestA, resultPath: path.join(workA, "r7.md") }, delegation: { command: process.execPath, args: [stub, "{{result}}", "--api-key", "sk-SUPERSECRET12345"], model: "m" } });
  const prov7 = JSON.stringify(env7.provenance);
  assert.ok(!prov7.includes("sk-SUPERSECRET12345"), "templated secret absent from recorded provenance");
  assert.ok(prov7.includes("<redacted>"), "secret was redacted");

  // ---- 8/10. drive the REAL architecture-review app (stub agent) -----------
  const cwd0 = process.cwd();
  // HAPPY: full 14-worker drive, zero hand-written result.md.
  const workH = tmpWorkspace();
  const stubH = writeStub(path.join(workH, "stub.js"), { model: "drive-opus" });
  process.chdir(workH);
  try {
    const runner = new CoolWorkflowRunner({ pluginRoot });
    const run = runner.plan("architecture-review", { repo: workH, question: "Sound?" });
    const planned = run.tasks.length;
    const result = drive(runner, run.id, { now: FIXED_NOW, agentConfig: { schemaVersion: 1, command: process.execPath, args: [stubH, "{{result}}"], model: "op", source: "flag" } });
    assert.equal(result.status, "complete");
    assert.equal(result.completedWorkers, planned, "EVERY planned worker driven (count-agnostic)");
    assert.ok(result.commitId, "committed");
    const final = runner.loadRun(run.id);
    assert.ok(final.tasks.every((t) => t.status === "completed"), "all tasks completed");
    const verdict = final.tasks.find((t) => /^verdict[:/]/i.test(t.id));
    assert.ok(verdict && verdict.status === "completed" && verdict.resultNodeId, "verdict artifact accepted via the SAME agent backend");
    // every result node carries the agent-delegation provenance (kind process),
    // and the digests/model are ABSENT from evidence.
    const resultNodes = final.nodes.filter((n) => n.kind === "result");
    assert.equal(resultNodes.length, planned, "one result node per worker");
    for (const n of resultNodes) {
      const ad = n.metadata && n.metadata.agentDelegation;
      assert.ok(ad, `result node carries agentDelegation provenance: ${n.id}`);
      assert.equal(ad.handle.kind, "process");
      assert.equal(ad.model, "drive-opus", "attested model");
      assert.ok(ad.promptDigest.startsWith("sha256:") && ad.resultDigest.startsWith("sha256:"));
      const ev = JSON.stringify(n.evidence);
      assert.ok(!ev.includes(ad.resultDigest) && !ev.includes("drive-opus"), "digests/model absent from node evidence");
    }
    const audit = runner.auditSummary(run.id);
    const byKind = audit.byKind || {};
    assert.ok((byKind["worker.agent-delegation"] || 0) >= 1, "worker.agent-delegation audit events recorded");

    // ---- 10. REPLAY determinism (bound to node-snapshot) -------------------
    const snap = ns.snapshotNode(final, verdict.resultNodeId, { now: FIXED_NOW, persist: false });
    assert.ok(snap.body.metadata.agentDelegation, "snapshot body carries the agent-delegation provenance (covered by replay)");
    const r1 = ns.replayNodeSnapshot(final, snap, { now: "2026-06-09T01:00:00.000Z", persist: false });
    const r2 = ns.replayNodeSnapshot(final, snap, { now: "2030-01-01T00:00:00.000Z", persist: false });
    assert.equal(r1.outputFingerprint, r2.outputFingerprint, "two replays with different now ⇒ identical outputFingerprint");
    assert.equal(JSON.stringify(r1.body), JSON.stringify(r2.body), "two replays byte-identical in body");
    assert.notEqual(r1.replayedAt, r2.replayedAt, "injected now differs");
    assert.equal(r1.body.metadata.agentDelegation.promptDigest, snap.body.metadata.agentDelegation.promptDigest, "replay carries the SAME prompt digest");
    assert.equal(r1.body.metadata.agentDelegation.resultDigest, snap.body.metadata.agentDelegation.resultDigest, "replay carries the SAME result digest");
    assert.equal(r1.body.metadata.agentDelegation.model, "drive-opus", "replay carries the SAME attested model id");
    // NO RE-SPAWN: remove the agent binary + clear config; replay still reproduces
    // byte-identically (it reads the snapshot, never re-invokes the agent).
    fs.rmSync(stubH, { force: true });
    clearAgentEnv();
    const r3 = ns.replayNodeSnapshot(final, snap, { now: "2031-02-03T00:00:00.000Z", persist: false });
    assert.equal(r3.outputFingerprint, r1.outputFingerprint, "replay reproduces WITHOUT re-spawning the agent (binary unavailable)");
  } finally {
    process.chdir(cwd0);
  }

  // ---- 7b. NO result.md ⇒ fail closed at the first worker (no fabrication) --
  {
    const workN = tmpWorkspace();
    const stubN = writeStub(path.join(workN, "stub.js"), { noResult: true });
    process.chdir(workN);
    try {
      const runner = new CoolWorkflowRunner({ pluginRoot });
      const run = runner.plan("architecture-review", { repo: workN, question: "q" });
      const result = drive(runner, run.id, { now: FIXED_NOW, policy: { maxAttempts: 2 }, agentConfig: { schemaVersion: 1, command: process.execPath, args: [stubN, "{{result}}"], source: "flag" } });
      assert.equal(result.status, "parked", "an agent that writes no result.md fails closed (parks)");
      assert.equal(result.completedWorkers, 0, "no worker fabricated when no result.md is produced");
      assert.ok(!result.commitId, "no commit on a fail-closed park");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ---- 7c. INVALID result.md ⇒ the evidence-gated worker rejects it --------
  {
    const workI = tmpWorkspace();
    const stubI = writeStub(path.join(workI, "stub.js"), { invalid: true });
    process.chdir(workI);
    try {
      const runner = new CoolWorkflowRunner({ pluginRoot });
      const run = runner.plan("architecture-review", { repo: workI, question: "q" });
      const result = drive(runner, run.id, { now: FIXED_NOW, policy: { maxAttempts: 2 }, agentConfig: { schemaVersion: 1, command: process.execPath, args: [stubI, "{{result}}"], source: "flag" } });
      assert.equal(result.status, "parked", "an invalid (evidence-less) result.md fails closed at the evidence-gated worker");
      assert.ok(result.completedWorkers < result.plannedWorkers, "the run did not complete on invalid output");
      assert.ok(!result.commitId, "no commit when an evidence-gated worker is unsatisfied");
      const finalI = runner.loadRun(run.id);
      const verdictI = finalI.tasks.find((t) => /^verdict[:/]/i.test(t.id));
      assert.notEqual(verdictI.status, "completed", "verdict NOT accepted on invalid upstream output");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ---- 9. failing agent hop parks past the retry budget (retryOrPark) ------
  {
    const workP = tmpWorkspace();
    const stubP = writeStub(path.join(workP, "stub.js"), { fail: true });
    process.chdir(workP);
    try {
      const runner = new CoolWorkflowRunner({ pluginRoot });
      const run = runner.plan("architecture-review", { repo: workP, question: "q" });
      const result = drive(runner, run.id, { now: FIXED_NOW, policy: { maxAttempts: 3 }, agentConfig: { schemaVersion: 1, command: process.execPath, args: [stubP, "{{result}}"], source: "flag" } });
      assert.equal(result.status, "parked");
      const park = result.steps.find((s) => s.action === "park");
      assert.ok(park, "a park step occurred");
      assert.equal(park.attempts, 3, "parked at maxAttempts (reuse v0.1.37 retryOrPark)");
      assert.equal(result.completedWorkers, 0, "no fabricated completion");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ---- 8. `--drive --once` deterministic under injected now -----------------
  {
    const mkOnce = () => {
      const w = tmpWorkspace();
      const s = writeStub(path.join(w, "stub.js"), { model: "once-m" });
      process.chdir(w);
      try {
        const runner = new CoolWorkflowRunner({ pluginRoot });
        const run = runner.plan("architecture-review", { repo: w, question: "q" });
        return drive(runner, run.id, { once: true, now: FIXED_NOW, agentConfig: { schemaVersion: 1, command: process.execPath, args: [s, "{{result}}"], source: "flag" } });
      } finally {
        process.chdir(cwd0);
      }
    };
    const a = mkOnce();
    const b = mkOnce();
    assert.equal(a.steps.length, 1, "--once advances exactly one step");
    assert.equal(b.steps.length, 1);
    const project = (s) => ({ action: s.action, status: s.status, taskId: s.taskId, phase: s.phase, backendId: s.backendId, handleKind: s.handleKind, reportedModel: s.reportedModel });
    assert.deepEqual(project(a.steps[0]), project(b.steps[0]), "--once step is deterministic given an injected now");
    assert.equal(a.completedWorkers, 1, "one worker advanced");
  }

  // ---- read-only preview payloads are deterministic (parity-safe) ----------
  {
    const w = tmpWorkspace();
    process.chdir(w);
    try {
      const runner = new CoolWorkflowRunner({ pluginRoot });
      const run = runner.plan("architecture-review", { repo: w, question: "q" });
      clearAgentEnv();
      const p1 = drivePreview(runner, run.id, {});
      const p2 = drivePreview(runner, run.id, {});
      assert.equal(JSON.stringify(p1), JSON.stringify(p2), "drive preview is deterministic (no now-derived numeric field)");
      assert.equal(p1.agentConfigured, false);
      assert.equal(p1.plannedWorkers, run.tasks.length);
      for (const [k, v] of Object.entries(p1)) if (typeof v === "number") assert.ok(Number.isInteger(v), `${k} is an integer count, not a wall-clock value`);
    } finally {
      process.chdir(cwd0);
    }
  }

  // ---- 11. THE RED LINE — no model SDK dependency / import / model API URL --
  const pkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8"));
  const SDK_PKGS = ["@anthropic-ai", "openai", "@google/generative-ai", "@google-cloud/aiplatform", "ollama", "cohere", "mistralai"];
  for (const section of ["dependencies", "devDependencies"]) {
    for (const dep of Object.keys(pkg[section] || {})) {
      for (const sdk of SDK_PKGS) assert.ok(!dep.includes(sdk), `${section} must not contain a model SDK: ${dep}`);
    }
  }
  // grep src/**/*.ts for an IMPORT/REQUIRE of any model SDK + for model API URLs.
  // (Vendor NAMES in prose documenting vendor-neutrality are allowed; an IMPORT is
  // the red line.)
  const srcFiles = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) srcFiles.push(full);
    }
  })(path.join(pluginRoot, "src"));
  const escaped = SDK_PKGS.map((s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|");
  const importRe = new RegExp(`(?:from|import|require\\()\\s*['"][^'"]*(?:${escaped})`);
  const URL_LITERALS = ["/chat/completions", "api.anthropic.com", "api.openai.com"];
  for (const file of srcFiles) {
    const text = fs.readFileSync(file, "utf8");
    assert.ok(!importRe.test(text), `model-SDK import found in ${path.relative(pluginRoot, file)} — that is the red line`);
    for (const lit of URL_LITERALS) assert.ok(!text.includes(lit), `model API URL literal "${lit}" found in ${path.relative(pluginRoot, file)} — that is the red line`);
  }

  for (const dir of cleanups) fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write("agent-delegation-drive-smoke: ok (agent driver delegating + fail-closed; byte-stable two-layer evidence; operator≠attested model; secret-stripped; deterministic drive; park-on-failure; replay without re-spawn; red line held)\n");
}

main();
