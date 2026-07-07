#!/usr/bin/env node
// stateexplosion-migration-contracts-registry — pins listMigrationContracts
// and resolveChain: the two declared contracts (run-state, workflow-app)
// and resolveChain's fail-closed reachability with exact error strings.
//
// Evidence: SPEC/state-core.md "listMigrationContracts()" and
// "resolveChain(contract, detected) — fail-closed reachability; exact
// errors: ...".

const assert = require("node:assert/strict");
const { listMigrationContracts, resolveChain, CONTRACT_MIGRATION_SCHEMA_VERSION } = require("../dist/core/state/contract-migration");

// CONTRACT_MIGRATION_SCHEMA_VERSION is pinned at 1.
{
  assert.equal(CONTRACT_MIGRATION_SCHEMA_VERSION, 1, "CONTRACT_MIGRATION_SCHEMA_VERSION must be 1");
}

// Exactly two contracts: run-state and workflow-app.
{
  const contracts = listMigrationContracts();
  assert.equal(contracts.length, 2, "exactly two migration contracts are declared");
  assert.deepEqual(contracts.map((c) => c.contract), ["run-state", "workflow-app"], "the two contracts are run-state then workflow-app, in that order");
}

// run-state contract: currentVersion 1, minVersion 0, edges derived 1:1 from RUN_STATE_MIGRATIONS.
{
  const [runState] = listMigrationContracts();
  assert.equal(runState.currentVersion, 1, "run-state currentVersion is 1");
  assert.equal(runState.minVersion, 0, "run-state minVersion is 0");
  assert.equal(runState.edges.length, 1, "run-state has exactly one migration edge (0 -> 1)");
  assert.deepEqual(
    runState.edges[0],
    {
      contract: "run-state",
      from: 0,
      to: 1,
      description: "Mark legacy run state without schemaVersion as run-state schema 1.",
      proof: {
        invariant: "run-state 0 -> 1: adds defaults only, drops no existing key",
        addsDefaulted: ["schemaVersion"],
        dropsNothing: true,
      },
    },
    "run-state's single edge matches the SPEC's exact literal proof object"
  );
}

// workflow-app contract: currentVersion 1, minVersion 1, zero edges.
{
  const [, workflowApp] = listMigrationContracts();
  assert.equal(workflowApp.currentVersion, 1, "workflow-app currentVersion is 1");
  assert.equal(workflowApp.minVersion, 1, "workflow-app minVersion is 1");
  assert.deepEqual(workflowApp.edges, [], "workflow-app has zero migration edges");
}

// resolveChain: detected below minVersion -> unreachable with the exact error string.
{
  const [runState] = listMigrationContracts();
  const result = resolveChain(runState, -1);
  assert.equal(result.reachable, false, "detected below minVersion is unreachable");
  assert.equal(result.error, "run-state schemaVersion -1 is below the minimum supported 0", "exact 'below minimum' error string");
  assert.deepEqual(result.chain, [], "an unreachable chain is empty");
}

// resolveChain: detected above currentVersion -> unreachable with the exact error string.
{
  const [runState] = listMigrationContracts();
  const result = resolveChain(runState, 99);
  assert.equal(result.reachable, false, "detected above currentVersion is unreachable");
  assert.equal(result.error, "run-state schemaVersion 99 is newer than this runtime (1)", "exact 'newer than runtime' error string");
}

// resolveChain: run-state 0 -> 1 is reachable via the BFS path resolver, chain = [0, 1].
{
  const [runState] = listMigrationContracts();
  const result = resolveChain(runState, 0);
  assert.equal(result.reachable, true, "run-state schemaVersion 0 is reachable to current (1)");
  assert.deepEqual(result.chain, [0, 1], "run-state chain from 0 is [0, 1]");
}

// resolveChain: detected already at currentVersion -> reachable with a 1-element chain.
{
  const [runState] = listMigrationContracts();
  const result = resolveChain(runState, 1);
  assert.equal(result.reachable, true, "run-state schemaVersion 1 (already current) is trivially reachable");
  assert.deepEqual(result.chain, [1], "chain for an already-current version is just [detected]");
}

// resolveChain for workflow-app (zero edges): current version is reachable, anything else is not, with the exact error string.
{
  const [, workflowApp] = listMigrationContracts();
  const atCurrent = resolveChain(workflowApp, 1);
  assert.equal(atCurrent.reachable, true, "workflow-app at its current version (1) is reachable");
  assert.deepEqual(atCurrent.chain, [1], "workflow-app at-current chain is [1]");
}

// resolveChain for workflow-app: below minVersion is caught by the SAME
// generic min/max checks (minVersion === currentVersion === 1 here, so
// detected=0 falls below the minimum, not into the "no edges" branch).
{
  const [, workflowApp] = listMigrationContracts();
  const result = resolveChain(workflowApp, 0);
  assert.equal(result.reachable, false, "workflow-app schemaVersion 0 is below its minVersion (1)");
  assert.equal(result.error, "workflow-app schemaVersion 0 is below the minimum supported 1", "exact 'below minimum' error string for workflow-app");
}

process.stdout.write("stateexplosion-migration-contracts-registry: ok\n");
