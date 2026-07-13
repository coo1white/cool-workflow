#!/usr/bin/env node
"use strict";

// concurrent-subworkflow-no-wasted-spawn-smoke — proves prepareConcurrentOutcomes
// no longer spawns a real agent child for a sub-workflow task in a concurrent
// round, only to have processSelectedTask throw the outcome away and take the
// runSubWorkflow branch instead.
//
// Topology: a parent workflow with ONE parallel() phase holding 2 plain agent
// siblings + 1 sub-workflow task (maxConcurrentAgents=3, so all 3 land in one
// concurrent round). The sub-workflow's child app has its OWN parallel() phase
// with 2 plain agent tasks (maxConcurrentAgents=2, so the recursive drive()
// call also widens to a concurrent round of 2).
//
// The stub agent script marks every REAL OS spawn into a shared counter file
// the moment it starts, before it does any work. That counts spawns whether or
// not the result is later used — the only signal that can tell "spawned and
// discarded" apart from "never spawned".
//
// Before the fix: prepareConcurrentOutcomes builds a spawn job for the
// sub-workflow task too (only a cache hit was skipped), so the parent round
// wastes one spawn on "map:sub" — 3 (2 siblings + 1 wasted) + 2 (child fan) = 5.
// After the fix: the sub-workflow task is skipped up front — 2 (siblings only)
// + 2 (child fan) = 4.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { plan: pipelinePlan } = require(path.join(pluginRoot, "dist/shell/pipeline.js"));
const { drive } = require(path.join(pluginRoot, "dist/shell/drive.js"));
const { loadRunFromCwd } = require(path.join(pluginRoot, "dist/shell/run-store.js"));
const api = require(path.join(pluginRoot, "dist/core/workflow-apps/app-schema.js"));

const FIXED_NOW = "2026-07-13T00:00:00.000Z";
const cwd0 = process.cwd();

function writeStub(file, counterPath) {
  const lines = [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    `const counterPath = ${JSON.stringify(counterPath)};`,
    // Marked the instant this process starts — before any work happens —
    // so a spawn that is later discarded still gets counted.
    'fs.appendFileSync(counterPath, "1\\n");',
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
  return pipelinePlan(
    {
      id: def.id,
      title: def.title,
      summary: def.summary || "",
      version: "0.0.1",
      workflow: def,
      sandboxProfiles: def.sandboxProfiles || [],
      sourcePath: path.join(work, `${def.id}.app.json`)
    },
    { repo: work }
  );
}

function main() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND", "CW_APPS_DIR"]) delete process.env[v];
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-subwf-nospawn-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  const counterPath = path.join(work, "spawn-counter.log");
  fs.writeFileSync(counterPath, "", "utf8");
  const stub = writeStub(path.join(work, "stub.js"), counterPath);

  process.chdir(work);
  try {
    const childDef = api.workflow({
      id: "nospawn-child",
      title: "nospawn-child",
      limits: { maxAgents: 2, maxConcurrentAgents: 2 },
      inputs: [{ name: "repo", type: "path", required: true }],
      phases: [api.parallel("ChildFan", [api.agent("child:t1", "Child probe 1."), api.agent("child:t2", "Child probe 2.")])]
    });

    const parentTasks = [
      api.agent("map:sibling1", "Sibling probe 1."),
      api.agent("map:sibling2", "Sibling probe 2."),
      { id: "map:sub", kind: "agent", subWorkflow: { appId: "nospawn-child", inputs: {} } }
    ];
    const parentDef = api.workflow({
      id: "nospawn-parent",
      title: "nospawn-parent",
      limits: { maxAgents: 3, maxConcurrentAgents: 3 },
      inputs: [{ name: "repo", type: "path", required: true }],
      phases: [api.parallel("ParentFan", parentTasks)]
    });

    const appsDir = path.join(work, "apps");
    const childAppDir = path.join(appsDir, "nospawn-child");
    fs.mkdirSync(childAppDir, { recursive: true });
    process.env.CW_APPS_DIR = appsDir;
    fs.writeFileSync(
      path.join(childAppDir, "app.json"),
      JSON.stringify({ schemaVersion: 1, id: childDef.id, title: childDef.title, summary: "throwaway", version: "0.0.0", inputs: [{ name: "repo", type: "path", required: true }], workflow: { entrypoint: "workflow.js" } }, null, 2),
      "utf8"
    );
    fs.writeFileSync(
      path.join(childAppDir, "workflow.js"),
      `module.exports = ({ workflow, parallel, agent, input }) => workflow({
        id: "nospawn-child",
        title: "nospawn-child",
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

      const result = drive(run.id, work, {
        now: FIXED_NOW,
        concurrency: 3,
        agentConfig: { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}"], source: "flag", timeoutMs: 15000 }
      });

      assert.equal(result.status, "complete", "parent run completes");
      assert.equal(result.completedWorkers, 3, "all 3 parent tasks (2 siblings + 1 sub-workflow) completed");

      const reloaded = loadRunFromCwd(run.id, work);
      const completedIds = reloaded.tasks.filter((t) => t.status === "completed").map((t) => t.id).sort();
      assert.deepEqual(completedIds, ["map:sibling1", "map:sibling2", "map:sub"], "functional outcome unchanged by the fix");

      const spawnLines = fs.readFileSync(counterPath, "utf8").split("\n").filter((line) => line.length > 0);
      assert.equal(spawnLines.length, 4, `expected exactly 4 real agent spawns (2 parent siblings + 2 child fan tasks), the sub-workflow task must never trigger a wasted spawn; observed ${spawnLines.length}`);

      console.log("concurrent-subworkflow-no-wasted-spawn: exactly 4 real agent spawns, no wasted spawn on the sub-workflow task ok");
    } finally {
      delete process.env.CW_APPS_DIR;
    }
  } finally {
    process.chdir(cwd0);
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log("concurrent-subworkflow-no-wasted-spawn-smoke: ok");
}

main();
