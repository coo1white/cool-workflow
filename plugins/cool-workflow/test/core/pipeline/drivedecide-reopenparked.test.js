#!/usr/bin/env node
// pipelinecore-drivedecide-reopenparked — reopenableParkedTaskIds: the tasks
// a resume may run again are exactly the failed tasks whose worker's LAST
// error is the retry-budget park. Every other stop stays failed.

const assert = require("node:assert/strict");
const { reopenableParkedTaskIds, AGENT_PARKED_CODE } = require("../../../dist/core/pipeline/drive-decide");

assert.equal(AGENT_PARKED_CODE, "agent-delegation-parked", "the code handleHop records on a park");

function run(tasks, workers) {
  return { tasks, workers };
}

// A parked task is reopenable; completed, pending and running tasks are not.
{
  const r = run(
    [
      { id: "a", status: "failed", workerId: "w-a" },
      { id: "b", status: "completed", workerId: "w-b" },
      { id: "c", status: "pending" },
      { id: "d", status: "running", workerId: "w-d" },
    ],
    [
      { id: "w-a", errors: [{ code: "agent-delegation-parked" }] },
      { id: "w-b", errors: [{ code: "agent-delegation-parked" }] },
      { id: "w-d", errors: [] },
    ]
  );
  assert.deepEqual(reopenableParkedTaskIds(r), ["a"]);
}

// Only the LAST error counts: a park after an earlier other error is
// reopenable; a sandbox/boundary/result stop after a park is not.
{
  const r = run(
    [
      { id: "park-last", status: "failed", workerId: "w1" },
      { id: "boundary-last", status: "failed", workerId: "w2" },
      { id: "sandbox", status: "failed", workerId: "w3" },
      { id: "no-errors", status: "failed", workerId: "w4" },
      { id: "no-worker", status: "failed" },
      { id: "unknown-worker", status: "failed", workerId: "w-gone" },
    ],
    [
      { id: "w1", errors: [{ code: "worker-result-missing" }, { code: "agent-delegation-parked" }] },
      { id: "w2", errors: [{ code: "agent-delegation-parked" }, { code: "worker-boundary-violation" }] },
      { id: "w3", errors: [{ code: "sandbox-write-denied" }] },
      { id: "w4" },
    ]
  );
  assert.deepEqual(reopenableParkedTaskIds(r), ["park-last"]);
}

// Run order is kept; a run with no workers array gives nothing.
{
  const r = run(
    [
      { id: "z", status: "failed", workerId: "wz" },
      { id: "a", status: "failed", workerId: "wa" },
    ],
    [
      { id: "wa", errors: [{ code: "agent-delegation-parked" }] },
      { id: "wz", errors: [{ code: "agent-delegation-parked" }] },
    ]
  );
  assert.deepEqual(reopenableParkedTaskIds(r), ["z", "a"]);
  assert.deepEqual(reopenableParkedTaskIds({ tasks: [{ id: "x", status: "failed", workerId: "w" }] }), []);
}

process.stdout.write("pipelinecore-drivedecide-reopenparked: ok\n");
