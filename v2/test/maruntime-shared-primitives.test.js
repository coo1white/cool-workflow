#!/usr/bin/env node
// maruntime-shared-primitives (multiagent-core bucket) — pins
// core/multi-agent/runtime.ts's shared, non-record helpers: createId,
// unique (the SORTING kernel-side variant), compact, touch, pluralKind,
// statusToNodeStatus (kernel table, default "pending"), countBy,
// uniqueEdges, indexRow.
//
// Evidence: SPEC/multi-agent.md "Record id scheme" (section A), "Status ->
// state-node mapping" (Invariants section), rebuild risk 1 and 7.

const assert = require("node:assert/strict");
const {
  createId,
  unique,
  compact,
  touch,
  pluralKind,
  statusToNodeStatus,
  countBy,
  uniqueEdges,
  indexRow,
} = require("../dist/core/multi-agent/runtime");

// createId: `${prefix}-${4-digit zero-padded seq}`, pure position math.
{
  assert.equal(createId("mar", 1), "mar-0001", "seq 1 pads to 4 digits");
  assert.equal(createId("role", 42), "role-0042", "seq 42 pads to 4 digits");
  assert.equal(createId("fanin", 10000), "fanin-10000", "seq beyond 4 digits is not truncated");
}

// unique (kernel side): drops falsy values AND sorts (default string sort).
// This is the byte-compat item 3 SORTING variant — the opposite of
// topology.ts/candidate-scoring.ts's insertion-order unique().
{
  assert.deepEqual(unique(["b", "a", "c"]), ["a", "b", "c"], "kernel unique() sorts");
  assert.deepEqual(unique(["z", "", "a", null, undefined, "z"]), ["a", "z"], "kernel unique() drops falsy and dedupes");
  assert.deepEqual(unique([]), [], "kernel unique() of empty is empty");
  assert.deepEqual(unique(["10", "9", "2"]), ["10", "2", "9"], "kernel unique() uses default STRING sort, not numeric");
}

// compact: strips undefined-valued keys; returns undefined for falsy input
// or an object that becomes empty after stripping.
{
  assert.equal(compact(undefined), undefined, "compact(undefined) is undefined");
  assert.deepEqual(compact({ a: 1, b: undefined }), { a: 1 }, "compact drops undefined-valued keys");
  assert.equal(compact({ a: undefined }), undefined, "compact of an all-undefined object collapses to undefined");
  assert.deepEqual(compact({ a: 0, b: false, c: "" }), { a: 0, b: false, c: "" }, "compact keeps falsy-but-defined values (0, false, empty string)");
}

// touch: sets updatedAt in place and returns the same record reference.
{
  const record = { updatedAt: "1970-01-01T00:00:00.000Z", id: "x" };
  const returned = touch(record, "2020-01-01T00:00:00.000Z");
  assert.equal(returned, record, "touch returns the same object reference");
  assert.equal(record.updatedAt, "2020-01-01T00:00:00.000Z", "touch mutates updatedAt");
}

// pluralKind: the six known kinds map to their exact plural directory
// names; an unknown kind falls back to a naive `${kind}s` suffix.
{
  assert.equal(pluralKind("multi-agent-run"), "runs");
  assert.equal(pluralKind("agent-role"), "roles");
  assert.equal(pluralKind("agent-group"), "groups");
  assert.equal(pluralKind("agent-membership"), "memberships");
  assert.equal(pluralKind("agent-fanout"), "fanouts");
  assert.equal(pluralKind("agent-fanin"), "fanins");
  assert.equal(pluralKind("something-else"), "something-elses", "unknown kind falls back to naive plural");
}

// statusToNodeStatus: kernel-side table, default "pending" (distinct from
// coordinator/classify.ts's own table, which defaults to "completed" —
// see SPEC rebuild risk 7; collapsing the two tables changes graph output).
{
  assert.equal(statusToNodeStatus("completed"), "completed");
  assert.equal(statusToNodeStatus("reported"), "completed");
  assert.equal(statusToNodeStatus("ready"), "completed");
  assert.equal(statusToNodeStatus("running"), "running");
  assert.equal(statusToNodeStatus("forming"), "running");
  assert.equal(statusToNodeStatus("collecting"), "running");
  assert.equal(statusToNodeStatus("verifying"), "running");
  assert.equal(statusToNodeStatus("assigned"), "running");
  assert.equal(statusToNodeStatus("active"), "running");
  assert.equal(statusToNodeStatus("dispatched"), "running");
  assert.equal(statusToNodeStatus("blocked"), "blocked");
  assert.equal(statusToNodeStatus("failed"), "failed");
  assert.equal(statusToNodeStatus("cancelled"), "rejected");
  assert.equal(statusToNodeStatus("rejected"), "rejected");
  assert.equal(statusToNodeStatus("some-unknown-status"), "pending", "unknown status defaults to pending (kernel side)");
}

// countBy: builds a frequency map keyed by the projection function.
{
  const items = [{ status: "a" }, { status: "b" }, { status: "a" }];
  assert.deepEqual(countBy(items, (item) => item.status), { a: 2, b: 1 }, "countBy tallies by key");
  assert.deepEqual(countBy([], (item) => item.status), {}, "countBy of empty list is empty object");
}

// uniqueEdges: dedupes on (from, to, label) triple, keeps first occurrence,
// preserves insertion order (this is a graph-edge helper, not the
// sort-vs-no-sort `unique()` family, but it must not reorder or drop
// distinct labels between the same two nodes).
{
  const edges = [
    { from: "a", to: "b", label: "x" },
    { from: "a", to: "b", label: "x" },
    { from: "a", to: "b", label: "y" },
    { from: "a", to: "b" },
  ];
  const deduped = uniqueEdges(edges);
  assert.equal(deduped.length, 3, "exact duplicate (from,to,label) triples collapse to one");
  assert.deepEqual(deduped[0], { from: "a", to: "b", label: "x" }, "first occurrence is kept");
  assert.deepEqual(deduped[1], { from: "a", to: "b", label: "y" }, "distinct label is its own edge");
  assert.deepEqual(deduped[2], { from: "a", to: "b" }, "no-label edge is distinct from a labeled one");
}

// indexRow: projects only id/status/updatedAt (used for multi-agent
// index.json rows).
{
  const row = indexRow({ id: "mar-0001", status: "planned", updatedAt: "1970-01-01T00:00:00.000Z", extra: "dropped" });
  assert.deepEqual(row, { id: "mar-0001", status: "planned", updatedAt: "1970-01-01T00:00:00.000Z" }, "indexRow keeps only id/status/updatedAt");
}

process.stdout.write("maruntime-shared-primitives: ok\n");
