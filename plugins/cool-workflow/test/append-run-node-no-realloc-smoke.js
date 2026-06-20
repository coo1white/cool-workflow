#!/usr/bin/env node
// append-run-node-no-realloc-smoke — appendRunNode must mutate run.nodes IN
// PLACE, not rebuild the whole array on every append.
//
// The old code did `run.nodes = index >= 0 ? nodes.map(...) : [...nodes, node]`,
// allocating a fresh array of size 1..N over a run that appends N nodes — O(N^2)
// memory churn + GC on a hot path (every dispatch/result/blackboard node). This
// proves the array reference is now stable across appends (the observable
// signature of the no-realloc fix — it FAILS against the old reallocating code)
// while the array's content and order stay byte-identical, so persisted state is
// unchanged.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { appendRunNode, createStateNode } = require("../dist/state-node");
const { createRunPaths, ensureRunDirs } = require("../dist/state");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-append-node-"));
const paths = createRunPaths(path.join(tmp, ".cw", "runs", "rn"));
ensureRunDirs(paths);
const run = { id: "rn", paths, nodes: [] };

const node = (id, status = "completed") =>
  createStateNode({ id, kind: "input", status, loopStage: "interpret" });

// 1. Reference stability: appends must NOT reallocate run.nodes (the fails-before
//    signature — the old code reassigned run.nodes to a fresh array every call).
// The reference-identity check is intentionally the no-realloc REGRESSION guard
// for THIS optimization (it fails if anyone reintroduces array rebuilding); the
// content + order assertions below it are the durable FUNCTIONAL guard (those are
// what state.json depends on). This test builds the run directly, so no load /
// normalize path reassigns run.nodes underneath the assertion.
const ref = run.nodes;
appendRunNode(run, node("alpha"));
appendRunNode(run, node("bravo"));
appendRunNode(run, node("charlie"));
assert.equal(run.nodes, ref, "append must not reallocate run.nodes (in-place push)");
assert.deepEqual(run.nodes.map((n) => n.id), ["alpha", "bravo", "charlie"], "appends preserve insertion order");
assert.equal(run.nodes.length, 3, "three distinct ids → three nodes");

// 2. Upsert: re-appending an existing id replaces in place — same array, same
//    length, same slot, new content (byte-identical to the old map()-based upsert).
const beforeUpsert = run.nodes;
appendRunNode(run, node("bravo", "failed"));
assert.equal(run.nodes, beforeUpsert, "upsert must not reallocate run.nodes");
assert.equal(run.nodes.length, 3, "upsert must not grow the array");
assert.deepEqual(run.nodes.map((n) => n.id), ["alpha", "bravo", "charlie"], "upsert keeps the node's position");
assert.equal(run.nodes[1].status, "failed", "upsert replaces the node content in place");

// 3. Persistence is unchanged: writeRunNode wrote each node file.
for (const id of ["alpha", "bravo", "charlie"]) {
  assert.ok(fs.existsSync(path.join(paths.stateNodesDir, `${id}.json`)), `${id}.json should be persisted`);
}
assert.equal(JSON.parse(fs.readFileSync(path.join(paths.stateNodesDir, "bravo.json"), "utf8")).status, "failed",
  "the persisted node reflects the upsert");

// 4. An absent run.nodes is initialized to a real array (the `|| (run.nodes = [])`
//    branch) rather than throwing or leaving it undefined.
const run2 = { id: "r2", paths, nodes: undefined };
appendRunNode(run2, node("solo"));
assert.deepEqual(run2.nodes.map((n) => n.id), ["solo"], "appendRunNode initializes a missing nodes array");

fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write("append-run-node-no-realloc-smoke: ok\n");
