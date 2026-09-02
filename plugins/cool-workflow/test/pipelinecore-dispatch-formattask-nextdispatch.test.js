#!/usr/bin/env node
// pipelinecore-dispatch-formattask-nextdispatch — formatDispatchTask
// (workerDir/workerResultPath derivation) and nextDispatchTasks (pending
// tasks of the first runnable phase, capped, mapped through
// formatDispatchTask). SPEC/pipeline-run.md "Dispatch — src/dispatch.ts"
// (now src/core/pipeline/dispatch.ts).

const assert = require("node:assert/strict");
const { formatDispatchTask, nextDispatchTasks } = require("../dist/core/pipeline/dispatch");

// formatDispatchTask derives workerDir from dirname(workerManifestPath)
// and workerResultPath as `<workerDir>/result.md`, but ONLY when BOTH
// workerId and workerManifestPath are present.
{
  const task = {
    id: "map:entrypoints",
    kind: "map",
    phase: "map",
    status: "running",
    taskPath: "/run/tasks/map-entrypoints.md",
    prompt: "do the thing",
    workerId: "worker-1",
    workerManifestPath: "/run/workers/worker-1/manifest.json",
    sandboxProfileId: "readonly",
    backendId: "agent",
  };
  const formatted = formatDispatchTask(task);
  assert.equal(formatted.workerDir, "/run/workers/worker-1");
  assert.equal(formatted.workerResultPath, "/run/workers/worker-1/result.md");
  assert.equal(formatted.id, "map:entrypoints");
  assert.equal(formatted.kind, "map");
  assert.equal(formatted.phase, "map");
  assert.equal(formatted.status, "running");
  assert.equal(formatted.taskPath, "/run/tasks/map-entrypoints.md");
  assert.equal(formatted.prompt, "do the thing");
  assert.equal(formatted.sandboxProfileId, "readonly");
  assert.equal(formatted.backendId, "agent");
}

// workerManifestPath present but workerId ABSENT -> workerDir IS still
// derived (workerDir only requires workerManifestPath), but
// workerResultPath stays undefined (it requires BOTH).
{
  const task = { id: "t1", kind: "map", phase: "map", status: "pending", taskPath: "/x.md", prompt: "p", workerManifestPath: "/run/workers/w1/manifest.json" };
  const formatted = formatDispatchTask(task);
  assert.equal(formatted.workerDir, "/run/workers/w1");
  assert.equal(formatted.workerResultPath, undefined, "workerResultPath requires both workerId and workerManifestPath");
}

// No workerManifestPath at all -> both workerDir and workerResultPath are
// undefined.
{
  const task = { id: "t1", kind: "map", phase: "map", status: "pending", taskPath: "/x.md", prompt: "p" };
  const formatted = formatDispatchTask(task);
  assert.equal(formatted.workerDir, undefined);
  assert.equal(formatted.workerResultPath, undefined);
}

// nextDispatchTasks: no runnable phase -> empty array.
{
  const run = { phases: [], tasks: [], workflow: { limits: { maxConcurrentAgents: 4 } } };
  assert.deepEqual(nextDispatchTasks(run), []);
}

// nextDispatchTasks: pending tasks of the first runnable phase only,
// capped at the given limit, mapped through formatDispatchTask.
{
  const run = {
    phases: [{ id: "p1", name: "p1", status: "pending", taskIds: ["t1", "t2", "t3"] }],
    tasks: [
      { id: "t1", phase: "p1", status: "pending", kind: "map", taskPath: "/t1.md", prompt: "p1" },
      { id: "t2", phase: "p1", status: "pending", kind: "map", taskPath: "/t2.md", prompt: "p2" },
      { id: "t3", phase: "p1", status: "completed", kind: "map", taskPath: "/t3.md", prompt: "p3" },
    ],
    workflow: { limits: { maxConcurrentAgents: 4 } },
  };
  const tasks = nextDispatchTasks(run);
  assert.equal(tasks.length, 2, "only pending tasks of the runnable phase are returned");
  assert.deepEqual(tasks.map((t) => t.id), ["t1", "t2"]);
}

// nextDispatchTasks: explicit limit argument caps the result even when
// workflow.limits.maxConcurrentAgents would allow more.
{
  const run = {
    phases: [{ id: "p1", name: "p1", status: "pending", taskIds: ["t1", "t2"] }],
    tasks: [
      { id: "t1", phase: "p1", status: "pending", kind: "map", taskPath: "/t1.md", prompt: "p1" },
      { id: "t2", phase: "p1", status: "pending", kind: "map", taskPath: "/t2.md", prompt: "p2" },
    ],
    workflow: { limits: { maxConcurrentAgents: 4 } },
  };
  const tasks = nextDispatchTasks(run, 1);
  assert.equal(tasks.length, 1, "explicit limit must cap below workflow.limits.maxConcurrentAgents");
}

// nextDispatchTasks: with no limit and no maxConcurrentAgents, falls back
// to the literal default 4.
{
  const run = {
    phases: [{ id: "p1", name: "p1", status: "pending", taskIds: ["t1", "t2", "t3", "t4", "t5"] }],
    tasks: Array.from({ length: 5 }, (_, i) => ({ id: `t${i + 1}`, phase: "p1", status: "pending", kind: "map", taskPath: `/t${i + 1}.md`, prompt: "p" })),
    workflow: { limits: {} },
  };
  const tasks = nextDispatchTasks(run);
  assert.equal(tasks.length, 4, "with no limit or maxConcurrentAgents configured, the default cap is 4");
}

// nextDispatchTasks: a pending task belonging to a DIFFERENT phase than
// the runnable one is excluded, even if its own status is pending.
{
  const run = {
    phases: [
      { id: "p1", name: "p1", status: "pending", taskIds: ["t1"] },
      { id: "p2", name: "p2", status: "pending", taskIds: ["t2"] },
    ],
    tasks: [
      { id: "t1", phase: "p1", status: "pending", kind: "map", taskPath: "/t1.md", prompt: "p1" },
      { id: "t2", phase: "p2", status: "pending", kind: "map", taskPath: "/t2.md", prompt: "p2" },
    ],
    workflow: { limits: { maxConcurrentAgents: 4 } },
  };
  const tasks = nextDispatchTasks(run);
  assert.deepEqual(tasks.map((t) => t.id), ["t1"], "only the runnable phase's own pending tasks are dispatched");
}

process.stdout.write("pipelinecore-dispatch-formattask-nextdispatch: ok\n");
