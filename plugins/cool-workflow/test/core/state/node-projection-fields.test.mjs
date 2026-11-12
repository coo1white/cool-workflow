#!/usr/bin/env node
// statecore-node-projection-fields (milestone 3) — pins rawNodeProjection's
// exact 13-field list. Rebuild risk:
// "The 13-field node projection is used by snapshots. Adding or dropping
// a field (or including updatedAt) silently changes every snapshot
// digest." (The reclamation tombstone hash-chain that also used it went
// with the frozen surfaces, 2026-11-12.) SPEC/state-core.md:
// "rawNodeProjection(node) — the ONE place that lists the 13 projected
// fields: id, kind, status, loopStage, inputs, outputs, artifacts,
// evidence, errors, parents, children, contractId, metadata (no
// createdAt/updatedAt/schemaVersion)".

import assert from "node:assert/strict";
import { createStateNode } from "../../../dist/core/state/state-node.js";
import {
  rawNodeProjection,
  projectNodeBody,
  replayStableStringify,
  normalizeValue,
} from "../../../dist/core/state/node-projection.js";

// Exactly the 13 documented fields — no more, no less.
{
  const node = createStateNode({ kind: "task", loopStage: "interpret" });
  const projection = rawNodeProjection(node);
  const keys = Object.keys(projection).sort();
  assert.deepEqual(
    keys,
    ["artifacts", "children", "contractId", "errors", "evidence", "id", "inputs", "kind", "loopStage", "metadata", "outputs", "parents", "status"].sort(),
    "rawNodeProjection must carry exactly these 13 fields"
  );
  assert.equal(keys.length, 13, "must be exactly 13 fields");
}

// createdAt/updatedAt/schemaVersion must NEVER leak into the projection —
// this is the load-bearing exclusion the tombstone chain depends on.
{
  const node = createStateNode({ kind: "task", loopStage: "interpret" });
  const projection = rawNodeProjection(node);
  assert.equal("createdAt" in projection, false, "createdAt must be excluded from the projection");
  assert.equal("updatedAt" in projection, false, "updatedAt must be excluded from the projection");
  assert.equal("schemaVersion" in projection, false, "schemaVersion must be excluded from the projection");
}

// projectNodeBody === normalizeValue(rawNodeProjection(node)).
{
  const node = createStateNode({ kind: "task", loopStage: "interpret" });
  const body = projectNodeBody(node);
  assert.deepEqual(body, normalizeValue(rawNodeProjection(node)));
}

// Field ORDER never affects the digest input bytes (normalizeValue sorts
// keys) — two nodes with the same field content but conceptually
// "different insertion order" (simulated via property assignment order on
// a plain object passed through rawNodeProjection's shape) hash the same.
{
  const nodeA = createStateNode({ id: "x", kind: "task", loopStage: "interpret", outputs: { z: 1, a: 2 } });
  const nodeB = createStateNode({ id: "x", kind: "task", loopStage: "interpret", outputs: { a: 2, z: 1 } });
  assert.equal(replayStableStringify(rawNodeProjection(nodeA)), replayStableStringify(rawNodeProjection(nodeB)), "key order in nested objects must not affect the digest bytes");
}

// A change to ANY of the 13 fields changes the digest input.
{
  const node = createStateNode({ kind: "task", loopStage: "interpret" });
  const base = replayStableStringify(rawNodeProjection(node));
  const changedStatus = replayStableStringify(rawNodeProjection({ ...node, status: "running" }));
  assert.notEqual(base, changedStatus, "a status change must change the projection digest");
}

// A change to updatedAt (NOT in the projection) must NOT change the
// digest — this is the entire point of excluding it.
{
  const node = createStateNode({ kind: "task", loopStage: "interpret" });
  const base = replayStableStringify(rawNodeProjection(node));
  const changedTimestamp = replayStableStringify(rawNodeProjection({ ...node, updatedAt: "2099-01-01T00:00:00.000Z" }));
  assert.equal(base, changedTimestamp, "changing ONLY updatedAt must NOT change the projection digest (it is excluded)");
}

process.stdout.write("statecore-node-projection-fields: ok\n");
