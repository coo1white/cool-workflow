#!/usr/bin/env node
// drivedecide-reopenparked — reopenableParkedTaskIds: the tasks a resume may
// run again are exactly the failed tasks whose LAST error is the
// retry-budget park. Every other stop stays failed.

import assert from "node:assert/strict";
import { reopenableParkedTaskIds, AGENT_PARKED_CODE } from "../../../dist/core/pipeline/drive-decide.js";

assert.equal(AGENT_PARKED_CODE, "agent-delegation-parked", "the code the drive records on a park");

const park = { code: "agent-delegation-parked" };
const run = (tasks) => ({ tasks });

assert.deepEqual(
  reopenableParkedTaskIds(run([
    { id: "a", status: "failed", errors: [park] },
    { id: "b", status: "completed", errors: [park] },
    { id: "c", status: "pending" },
    { id: "d", status: "running", errors: [] },
  ])),
  ["a"],
  "only a failed task is reopenable"
);

assert.deepEqual(
  reopenableParkedTaskIds(run([
    { id: "park-last", status: "failed", errors: [{ code: "worker-result-missing" }, park] },
    { id: "other-last", status: "failed", errors: [park, { code: "worker-boundary-violation" }] },
    { id: "no-errors", status: "failed" },
    { id: "empty-errors", status: "failed", errors: [] },
  ])),
  ["park-last"],
  "only the LAST error counts"
);

assert.deepEqual(
  reopenableParkedTaskIds(run([
    { id: "z", status: "failed", errors: [park] },
    { id: "a", status: "failed", errors: [park] },
  ])),
  ["z", "a"],
  "plan order is kept"
);

console.log("drivedecide-reopenparked: ok");
