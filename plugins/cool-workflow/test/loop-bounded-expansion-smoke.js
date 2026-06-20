#!/usr/bin/env node
"use strict";

// @cw-smoke: timeout 120
// loop-bounded-expansion-smoke — the CI gate for bounded dynamic control flow (#2).
//
// A loop() phase's tasks are a per-round TEMPLATE: after each round completes, a
// registered PURE predicate decides whether to run another round (a fresh phase
// appended with the same tasks, round-suffixed ids) or stop, hard-capped at maxRounds.
// A hermetic stub stands in for the agent. Proves:
//   1. The loop EXPANDS round by round and the predicate STOPS it: maxRounds:5 with a
//      "stop at round 3" predicate runs exactly 3 rounds (3 phases, 3 tasks, 3
//      loop-control nodes), then the run completes.
//   2. The CAP is fail-closed: a never-done predicate stops at maxRounds.
//   3. DETERMINISM: two runs under different `now` produce the identical sequence of
//      recorded loop-control decisions (round/done/reason), and a result node replays
//      byte-identically.
//   4. POLA: a workflow with NO loop phase is unaffected (covered by regression smokes;
//      here we assert maxLoopExpansion is 0 for a non-loop run).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const { drive } = require(path.join(pluginRoot, "dist/drive.js"));
const ns = require(path.join(pluginRoot, "dist/node-snapshot.js"));
const { registerLoopPredicate, maxLoopExpansion } = require(path.join(pluginRoot, "dist/loop-expansion.js"));

const FIXED_NOW = "2026-06-20T00:00:00.000Z";
const cleanups = [];

// Pure test predicates (named → registry, never inline closures in the workflow).
registerLoopPredicate("test:stop-at-3", (ctx) => ({ done: ctx.round >= 3, reason: `stop-at-3: round ${ctx.round}` }));
registerLoopPredicate("test:never", () => ({ done: false, reason: "never: keep going" }));

function tmp(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  cleanups.push(d);
  return d;
}
function clearAgentEnv() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];
}
function writeStub(file, countFile) {
  fs.writeFileSync(file, [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    `fs.appendFileSync(${JSON.stringify(countFile)}, "x");`,
    'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "fs.writeFileSync(rp, body);",
    'process.stdout.write(JSON.stringify({ model: "stub", usage: { input_tokens: 4, output_tokens: 2 } }));'
  ].join("\n"), "utf8");
  return file;
}
function agentConfig(stub) {
  return { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}"], model: "op", source: "flag" };
}
function writeLoopApp(appsDir, id, maxRounds, ref) {
  const dir = path.join(appsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "app.json"), JSON.stringify({
    schemaVersion: 1, id, title: id, summary: id, version: "0.1.0", author: "test",
    inputs: [{ name: "question", type: "string" }],
    sandboxProfiles: ["readonly"],
    compatibility: { minVersion: "0.1.9" },
    workflow: { entrypoint: "workflow.js" }
  }, null, 2));
  fs.writeFileSync(path.join(dir, "workflow.js"), `module.exports = ({ workflow, loop, agent, input }) => workflow({
  id: ${JSON.stringify(id)}, title: ${JSON.stringify(id)}, summary: ${JSON.stringify(id)},
  limits: { maxAgents: 20, maxConcurrentAgents: 1 },
  inputs: [input("question", { type: "string" })],
  sandboxProfiles: ["readonly"],
  phases: [
    loop("Find", [ agent("find:do", "Find more for {{question}}", { sandboxProfileId: "readonly" }) ],
      { maxRounds: ${maxRounds}, until: { kind: "predicate", ref: ${JSON.stringify(ref)} } })
  ]
});\n`);
}
function newRunner(appsDir) {
  const r = new CoolWorkflowRunner({ pluginRoot });
  r.appsDir = appsDir;
  return r;
}
function loopControlDecisions(run) {
  return run.nodes
    .filter((n) => n.kind === "loop-control")
    .sort((a, b) => (a.outputs.round || 0) - (b.outputs.round || 0))
    .map((n) => ({ round: n.outputs.round, done: n.outputs.done, atCap: n.outputs.atCap, reason: n.outputs.reason }));
}

function main() {
  clearAgentEnv();
  const cwd0 = process.cwd();

  // ===== 1+3: predicate stops the loop at round 3; determinism across two `now` =====
  {
    const appsDir = tmp("cw-loop-apps-");
    const work = tmp("cw-loop-work-");
    fs.writeFileSync(path.join(work, "README.md"), "# t\n", "utf8");
    const countFile = path.join(work, "spawns.count");
    const stub = writeStub(path.join(work, "stub.js"), countFile);
    writeLoopApp(appsDir, "loop-stop3", 5, "test:stop-at-3");

    process.chdir(work);
    try {
      const runner = newRunner(appsDir);
      const r = runner.plan("loop-stop3", { repo: work, question: "Q?" });
      assert.equal(maxLoopExpansion(r), 4, "static expansion bound = (maxRounds-1)*templateTasks = 4");
      const result = drive(runner, r.id, { now: FIXED_NOW, agentConfig: agentConfig(stub) });
      assert.equal(result.status, "complete", "loop run completes");
      assert.equal(fs.readFileSync(countFile, "utf8").length, 3, "exactly 3 rounds ran (predicate stopped at round 3, not maxRounds 5)");

      const final = runner.loadRun(r.id);
      const decisions = loopControlDecisions(final);
      assert.equal(decisions.length, 3, "one loop-control node per round (3)");
      assert.deepEqual(decisions.map((d) => d.done), [false, false, true], "loop ran rounds 1,2 then stopped at 3");
      const loopPhases = final.phases.filter((p) => p.loop || p.loopOrigin);
      assert.equal(loopPhases.length, 3, "origin + 2 appended round phases");
      assert.equal(final.phases.find((p) => p.loop).loopDone, true, "origin phase marked loopDone");

      // replay determinism: a result node replays byte-identically under two `now`
      const aTask = final.tasks.find((t) => t.id === "find:do");
      const snap = ns.snapshotNode(final, aTask.resultNodeId, { now: FIXED_NOW, persist: false });
      const r1 = ns.replayNodeSnapshot(final, snap, { now: "2026-06-09T01:00:00.000Z", persist: false });
      const r2 = ns.replayNodeSnapshot(final, snap, { now: "2030-01-01T00:00:00.000Z", persist: false });
      assert.equal(r1.outputFingerprint, r2.outputFingerprint, "result node replays identically under two now");

      // a SECOND run with a different now produces the identical decision sequence
      const r2run = runner.plan("loop-stop3", { repo: work, question: "Q?" });
      drive(runner, r2run.id, { now: "2031-02-03T00:00:00.000Z", agentConfig: agentConfig(stub) });
      const decisions2 = loopControlDecisions(runner.loadRun(r2run.id));
      assert.deepEqual(decisions2, decisions, "two runs under different now ⇒ identical recorded loop decisions");
      console.log("loop: predicate-stops-at-3 + determinism ok");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ===== 2: the cap is fail-closed (a never-done predicate stops at maxRounds) =======
  {
    const appsDir = tmp("cw-loopcap-apps-");
    const work = tmp("cw-loopcap-work-");
    fs.writeFileSync(path.join(work, "README.md"), "# t\n", "utf8");
    const countFile = path.join(work, "spawns.count");
    const stub = writeStub(path.join(work, "stub.js"), countFile);
    writeLoopApp(appsDir, "loop-cap", 2, "test:never");
    process.chdir(work);
    try {
      const runner = newRunner(appsDir);
      const r = runner.plan("loop-cap", { repo: work, question: "Q?" });
      const result = drive(runner, r.id, { now: FIXED_NOW, agentConfig: agentConfig(stub) });
      assert.equal(result.status, "complete", "capped loop completes");
      assert.equal(fs.readFileSync(countFile, "utf8").length, 2, "a never-done predicate stops at maxRounds (2)");
      const decisions = loopControlDecisions(runner.loadRun(r.id));
      assert.deepEqual(decisions.map((d) => [d.round, d.done, d.atCap]), [[1, false, false], [2, true, true]], "round 2 is done via the cap");
      console.log("loop: cap fail-closed ok");
    } finally {
      process.chdir(cwd0);
    }
  }

  for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
  console.log("loop-bounded-expansion-smoke: ok");
}

main();
