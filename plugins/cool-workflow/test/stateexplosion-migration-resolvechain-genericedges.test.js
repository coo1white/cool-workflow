#!/usr/bin/env node
// stateexplosion-migration-resolvechain-genericedges — pins resolveChain's
// GENERIC edge-walk branch (used when contract.contract !== "run-state"
// and contract.edges is non-empty) — this branch exists in the source but
// is never exercised by the real registry today (workflow-app always has
// zero edges), so this test constructs a synthetic MigrationContract
// object directly to pin the walk logic itself: sequential edge-following,
// the "no edge from version" failure, and the "edges.length === 0 but not
// current" failure string.
//
// Evidence: SPEC/state-core.md "resolveChain(contract, detected) ...
// exact errors: ... <contract> schemaVersion <d> is not current (<cur>)
// and no migration edges exist, no migration edge from <contract>
// schemaVersion <v>"; the old build's contract-migration code (ported 1:1 in
// core/state/contract-migration.ts's resolveChain).

const assert = require("node:assert/strict");
const { resolveChain } = require("../dist/core/state/contract-migration");

function syntheticContract(edges) {
  return {
    contract: "workflow-app",
    currentVersion: 3,
    minVersion: 0,
    edges,
  };
}

// Zero edges, detected !== current -> exact "not current and no migration edges exist" error.
{
  const contract = syntheticContract([]);
  const result = resolveChain(contract, 0);
  assert.equal(result.reachable, false, "zero edges + detected !== current is unreachable");
  assert.equal(
    result.error,
    "workflow-app schemaVersion 0 is not current (3) and no migration edges exist",
    "exact 'not current and no migration edges exist' error string"
  );
}

// Sequential edges: 0 -> 1 -> 2 -> 3 walks the full chain when every hop has an edge.
{
  const contract = syntheticContract([
    { contract: "workflow-app", from: 0, to: 1, description: "a", proof: { invariant: "x", addsDefaulted: [], dropsNothing: true } },
    { contract: "workflow-app", from: 1, to: 2, description: "b", proof: { invariant: "x", addsDefaulted: [], dropsNothing: true } },
    { contract: "workflow-app", from: 2, to: 3, description: "c", proof: { invariant: "x", addsDefaulted: [], dropsNothing: true } },
  ]);
  const result = resolveChain(contract, 0);
  assert.equal(result.reachable, true, "a fully-connected chain of edges from 0 to current (3) is reachable");
  assert.deepEqual(result.chain, [0, 1, 2, 3], "chain walks every hop in order: [0,1,2,3]");
}

// A missing hop in the middle of the chain -> unreachable, exact "no migration edge from" error, partial chain preserved.
{
  const contract = syntheticContract([
    { contract: "workflow-app", from: 0, to: 1, description: "a", proof: { invariant: "x", addsDefaulted: [], dropsNothing: true } },
    // no edge from 1 -> anything
    { contract: "workflow-app", from: 2, to: 3, description: "c", proof: { invariant: "x", addsDefaulted: [], dropsNothing: true } },
  ]);
  const result = resolveChain(contract, 0);
  assert.equal(result.reachable, false, "a broken chain (missing hop from version 1) is unreachable");
  assert.equal(result.error, "no migration edge from workflow-app schemaVersion 1", "exact 'no migration edge from' error string, naming the STUCK version");
  assert.deepEqual(result.chain, [0, 1], "the partial chain walked so far ([0,1]) is preserved even though the walk failed");
}

// Detected already at currentVersion with edges present: reachable trivially without needing any edge.
{
  const contract = syntheticContract([{ contract: "workflow-app", from: 0, to: 1, description: "a", proof: { invariant: "x", addsDefaulted: [], dropsNothing: true } }]);
  const result = resolveChain(contract, 3);
  assert.equal(result.reachable, true, "detected already at currentVersion needs no edge walk at all");
  assert.deepEqual(result.chain, [3], "chain for an already-current version is just [detected], even with edges present in the contract");
}

process.stdout.write("stateexplosion-migration-resolvechain-genericedges: ok\n");
