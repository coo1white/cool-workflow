#!/usr/bin/env node
// drivedecide-finalstatus — finalDriveStatus: a parked task wins, then a
// blocked last step; "complete" needs every planned worker completed.

import assert from "node:assert/strict";
import { finalDriveStatus } from "../../../dist/core/pipeline/drive-decide.js";

const inputs = (overrides) => ({ completedWorkers: 0, plannedWorkers: 0, lastStepStatus: undefined, parkedWorkers: 0, ...overrides });

assert.equal(finalDriveStatus(inputs({ completedWorkers: 3, plannedWorkers: 3, lastStepStatus: "complete" })), "complete");
assert.equal(finalDriveStatus(inputs({ completedWorkers: 3, plannedWorkers: 3, lastStepStatus: "ok" })), "complete");

// A parked worker wins over a merely-blocked last step.
assert.equal(finalDriveStatus(inputs({ parkedWorkers: 1, lastStepStatus: "blocked" })), "parked");
assert.equal(finalDriveStatus(inputs({ lastStepStatus: "parked" })), "parked");

// A blocked last step (a refused final commit) is blocked even with all workers done.
assert.equal(finalDriveStatus(inputs({ completedWorkers: 3, plannedWorkers: 3, lastStepStatus: "blocked" })), "blocked");

// Work left with no parked or blocked step (an interrupted drive) is not complete.
assert.equal(finalDriveStatus(inputs({ completedWorkers: 1, plannedWorkers: 3, lastStepStatus: "ok" })), "blocked");
assert.equal(finalDriveStatus(inputs({})), "blocked", "a run with no planned workers is never complete");

console.log("drivedecide-finalstatus: ok");
