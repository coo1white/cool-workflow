#!/usr/bin/env node
// commitgate-errors — commitGateErrors: the final commit needs a verdict
// result with grounded evidence that resolves, cites no line past a file's
// end, and cites only receipts CW accepts. Each refusal has its own code.

import assert from "node:assert/strict";
import { commitGateErrors, formatCommitId, verdictTask } from "../../../dist/core/pipeline/commit-gate.js";

const task = { id: "verdict:synthesis", kind: "agent", phase: "Verdict", status: "completed", prompt: "", requiresEvidence: true };
const result = (evidence, findings = []) => ({ summary: "s", findings, evidence });
const ok = { unresolvedFileEvidence: () => [], linePastEnd: () => null, refusedReceipts: () => [] };
const codes = (errors) => errors.map((e) => e.code);

assert.deepEqual(commitGateErrors(task, result(["src/a.ts:3"]), ok), [], "grounded, resolvable evidence passes");
assert.deepEqual(codes(commitGateErrors(task, undefined, ok)), ["commit-rationale-empty-capture"]);
assert.deepEqual(codes(commitGateErrors(task, result([]), ok)), ["commit-rationale-empty-capture"], "no findings and no evidence is an empty capture");
assert.deepEqual(codes(commitGateErrors(task, result([], [{ title: "f" }]), ok)), ["commit-verifier-missing-evidence"]);
assert.deepEqual(codes(commitGateErrors(task, result(["looks fine"]), ok)), ["commit-verifier-evidence-ungrounded"]);
assert.deepEqual(
  codes(commitGateErrors(task, result(["src/gone.ts:1"]), { ...ok, unresolvedFileEvidence: (e) => e })),
  ["commit-verifier-evidence-unresolvable"]
);
const pastEnd = commitGateErrors(task, result(["src/a.ts:99"]), { ...ok, linePastEnd: () => ({ path: "src/a.ts", line: 99, lines: 3 }) });
assert.deepEqual(codes(pastEnd), ["commit-verifier-evidence-past-end"]);
assert.match(pastEnd[0].message, /src\/a\.ts:99 \(src\/a\.ts has 3 lines\)/);

// A refused receipt is checked even when the task does not require evidence.
const refused = commitGateErrors({ ...task, requiresEvidence: false }, result(["receipt:rc-0123456789abcdef"]), { ...ok, refusedReceipts: () => [{ reason: "it failed", next: "cw check -- npm test" }] });
assert.deepEqual(codes(refused), ["commit-verifier-receipt-refused"]);
assert.match(refused[0].message, /it failed\. Next: cw check -- npm test/);

assert.equal(formatCommitId(1), "state-0001");
assert.equal(verdictTask({ tasks: [{ ...task, status: "pending" }] }), undefined, "only a completed verdict task gates");
assert.equal(verdictTask({ tasks: [task] }), task);

console.log("commitgate-errors: ok");
