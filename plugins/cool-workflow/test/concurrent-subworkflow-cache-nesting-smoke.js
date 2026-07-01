#!/usr/bin/env node
"use strict";

// concurrent-subworkflow-cache-nesting-smoke — the deferred-checkpoint fix
// (batch a concurrent round's dispatch/accept mutations into ONE cached
// in-memory run object, flushed to disk exactly once at round end) is only
// safe if the cache is REENTRANT. A parallel() phase's sub-workflow task
// recursively calls drive() for a CHILD run on the SAME runner instance; if
// that child run ALSO has a parallel() phase, it too enters
// driveConcurrentRound and wraps ITSELF in runner.loadWithCache — a naive
// (non-reentrant) implementation would clobber the PARENT round's cache in
// its own `finally`, silently discarding the parent round's other
// concurrently-processed sibling tasks' dispatch/accept mutations before
// they ever reach the parent round's own end-of-round flush.
//
// This proves the fix holds: a parallel() phase with 2 plain agent siblings
// + 1 sub-workflow task (whose child workflow ALSO has a parallel() phase)
// all complete and — critically — are all durably persisted to disk, not
// just held in a since-clobbered in-memory cache.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const lifecycle = require(path.join(pluginRoot, "dist/orchestrator/lifecycle-operations.js"));
const { drive } = require(path.join(pluginRoot, "dist/drive.js"));
const api = require(path.join(pluginRoot, "dist/workflow-api.js"));

const FIXED_NOW = "2026-06-09T00:00:00.000Z";
const cwd0 = process.cwd();

function writeStub(file) {
  const lines = [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    "setTimeout(() => {",
    '  const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "ok", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "  fs.writeFileSync(rp, body);",
    '  process.stdout.write(JSON.stringify({ model: "stub-m", usage: { input_tokens: 4, output_tokens: 2 } }));',
    "  process.exit(0);",
    "}, 200);"
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

function planApp(work, def) {
  return lifecycle.plan(
    { app: { schemaVersion: 1, id: def.id, title: def.title, version: "0.0.1", workflow: def }, source: { kind: "manifest", path: path.join(work, `${def.id}.app.json`), manifestPath: path.join(work, `${def.id}.app.json`) } },
    { repo: work }
  );
}

function main() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-subwf-cache-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  const stub = writeStub(path.join(work, "stub.js"));
  const agentCommand = `${process.execPath} ${stub} {{result}}`;
  process.chdir(work);
  try {
    const runner = new CoolWorkflowRunner({ pluginRoot });

    // Child workflow: its OWN parallel() phase (so the recursive drive() call
    // ALSO enters driveConcurrentRound, on the SAME runner instance).
    const childDef = api.workflow({
      id: "cache-nesting-child",
      title: "cache-nesting-child",
      limits: { maxAgents: 2, maxConcurrentAgents: 2 },
      inputs: [{ name: "repo", type: "path", required: true }],
      phases: [api.parallel("ChildFan", [api.agent("child:t1", "Child probe 1."), api.agent("child:t2", "Child probe 2.")])]
    });

    // Parent workflow: 2 plain sibling agents + 1 sub-workflow task, ALL in
    // the SAME parallel() phase/round.
    const parentTasks = [
      api.agent("map:sibling1", "Sibling probe 1."),
      api.agent("map:sibling2", "Sibling probe 2."),
      { id: "map:sub", kind: "agent", subWorkflow: { appId: "cache-nesting-child", inputs: {} } }
    ];
    const parentDef = api.workflow({
      id: "cache-nesting-parent",
      title: "cache-nesting-parent",
      limits: { maxAgents: 3, maxConcurrentAgents: 3 },
      inputs: [{ name: "repo", type: "path", required: true }],
      phases: [api.parallel("ParentFan", parentTasks)]
    });

    // The child app must be resolvable by appId when the sub-workflow task
    // recursively calls runner.plan("cache-nesting-child", ...) — register it
    // as a real app on disk under pluginRoot/apps/ isn't appropriate for a
    // throwaway smoke run, so use the SAME lifecycle.plan() manifest path the
    // runner itself resolves through: loadWorkflowAppById reads from
    // pluginRoot/apps/<id>/app.json. Instead, drive through a stub loader by
    // writing a throwaway app directory and cleaning it up afterward.
    const childAppDir = path.join(pluginRoot, "apps", "cache-nesting-child");
    fs.mkdirSync(childAppDir, { recursive: true });
    fs.writeFileSync(
      path.join(childAppDir, "app.json"),
      JSON.stringify({ schemaVersion: 1, id: childDef.id, title: childDef.title, summary: "throwaway", version: "0.0.0", inputs: [{ name: "repo", type: "path", required: true }], workflow: { entrypoint: "workflow.js" } }, null, 2),
      "utf8"
    );
    fs.writeFileSync(
      path.join(childAppDir, "workflow.js"),
      `module.exports = ({ workflow, parallel, agent, input }) => workflow({
        id: "cache-nesting-child",
        title: "cache-nesting-child",
        summary: "throwaway",
        limits: { maxAgents: 2, maxConcurrentAgents: 2 },
        inputs: [input("repo", { type: "path", required: true })],
        phases: [parallel("ChildFan", [agent("child:t1", "Child probe 1."), agent("child:t2", "Child probe 2.")])]
      });\n`,
      "utf8"
    );

    try {
      const run = planApp(work, parentDef);
      assert.equal(run.tasks.length, 3, "parent has 3 tasks in one parallel phase");

      const result = drive(runner, run.id, {
        now: FIXED_NOW,
        concurrency: 3,
        agentConfig: { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}"], source: "flag", timeoutMs: 15000 }
      });

      assert.equal(result.status, "complete", "parent run completes despite a nested concurrent sub-workflow");
      assert.equal(result.completedWorkers, 3, "all 3 parent tasks (2 siblings + 1 sub-workflow) completed");

      // The critical assertion: reload from DISK (fresh CoolWorkflowRunner
      // instance, no cache at all) and confirm every task's completion
      // actually reached state.json — not just an in-memory object that got
      // silently discarded when the nested child round's loadWithCache
      // cleared the parent round's cache.
      const freshRunner = new CoolWorkflowRunner({ pluginRoot });
      const reloaded = freshRunner.loadRun(run.id);
      const completedIds = reloaded.tasks.filter((t) => t.status === "completed").map((t) => t.id).sort();
      assert.deepEqual(completedIds, ["map:sibling1", "map:sibling2", "map:sub"], "every sibling AND the sub-workflow task persisted to disk");
      console.log("concurrent-subworkflow-cache-nesting: nested concurrent sub-workflow does not clobber sibling tasks' persisted state ok");
    } finally {
      fs.rmSync(childAppDir, { recursive: true, force: true });
    }
  } finally {
    process.chdir(cwd0);
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log("concurrent-subworkflow-cache-nesting-smoke: ok (reentrant loadWithCache protects a parent round from a nested concurrent child drive)");
}

main();
