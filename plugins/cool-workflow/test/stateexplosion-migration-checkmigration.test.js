#!/usr/bin/env node
// stateexplosion-migration-checkmigration — pins checkMigration's
// MigrationVerdict: status ladder (unsupported/migrated/normalized/
// current), detectedVersion inference for a missing/non-number
// schemaVersion, and the unknown-contract throw.
//
// Evidence: SPEC/state-core.md "checkMigration(contractId, snapshot) —
// MigrationVerdict { schemaVersion: 1, contract, status, detectedVersion,
// currentVersion, reachable, chain, changes, errors }; a missing/non-number
// schemaVersion detects as 0 for run-state and 0 for workflow-app";
// "Unknown contract id throws Unknown migration contract: <id>".

const assert = require("node:assert/strict");
const { checkMigration } = require("../dist/core/state/contract-migration");

// A legacy run-state snapshot (no schemaVersion) detects as version 0 and
// migrates to "migrated" status (since it moves 0 -> 1).
{
  const verdict = checkMigration("run-state", { id: "run-1" });
  assert.equal(verdict.schemaVersion, 1, "MigrationVerdict.schemaVersion literal is 1");
  assert.equal(verdict.contract, "run-state", "contract is echoed back");
  assert.equal(verdict.detectedVersion, 0, "a run-state snapshot missing schemaVersion detects as version 0 (legacy)");
  assert.equal(verdict.currentVersion, 1, "currentVersion for run-state is 1");
  assert.equal(verdict.reachable, true, "0 -> 1 is reachable");
  assert.deepEqual(verdict.chain, [0, 1], "chain is [0, 1]");
  assert.equal(verdict.status, "migrated", "detectedVersion (0) below current (1) with a successful migration -> status 'migrated'");
  assert.deepEqual(verdict.errors, [], "a clean migratable legacy snapshot has zero errors");
}

// A run-state snapshot already at schemaVersion 1 with a fully normalized
// shape -> status "current", changes 0.
{
  const currentSnapshot = {
    schemaVersion: 1,
    id: "run-1",
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    cwd: "/tmp",
    workflow: { id: "wf", title: "Wf", summary: "", limits: { maxAgents: 8, maxConcurrentAgents: 4 } },
    inputs: {},
    loopStage: "interpret",
    phases: [],
    tasks: [],
    dispatches: [],
    commits: [],
    paths: {
      runDir: "/tmp/run-1",
      state: "/tmp/run-1/state.json",
      report: "/tmp/run-1/report.md",
      tasksDir: "/tmp/run-1/tasks",
      resultsDir: "/tmp/run-1/results",
      dispatchesDir: "/tmp/run-1/dispatches",
      artifactsDir: "/tmp/run-1/artifacts",
      commitsDir: "/tmp/run-1/commits",
      stateNodesDir: "/tmp/run-1/nodes",
      feedbackDir: "/tmp/run-1/feedback",
      auditDir: "/tmp/run-1/audit",
      workersDir: "/tmp/run-1/workers",
      candidatesDir: "/tmp/run-1/candidates",
      multiAgentDir: "/tmp/run-1/multi-agent",
      blackboardDir: "/tmp/run-1/blackboard",
      topologiesDir: "/tmp/run-1/topologies",
    },
    nodes: [],
    contracts: [],
    feedback: [],
    audit: { schemaVersion: 1, eventLogPath: "x", summaryPath: "x", indexPath: "x" },
    workers: [],
    sandboxProfiles: [],
    candidates: [],
    candidateSelections: [],
    multiAgent: { schemaVersion: 1, runs: [], roles: [], groups: [], memberships: [], fanouts: [], fanins: [] },
    blackboard: { schemaVersion: 1, boards: [], topics: [], messages: [], contexts: [], artifacts: [], snapshots: [], decisions: [] },
    topologies: { schemaVersion: 1, runs: [] },
  };
  const verdict = checkMigration("run-state", currentSnapshot);
  assert.equal(verdict.detectedVersion, 1, "an explicit schemaVersion:1 snapshot detects as version 1");
  assert.equal(verdict.status, "current", "a fully normalized, already-current snapshot has status 'current'");
  assert.equal(verdict.changes, 0, "a fully normalized snapshot needs zero migration changes");
}

// A run-state snapshot with schemaVersion below the minimum supported ->
// status "unsupported", chain empty, exact error message.
{
  const verdict = checkMigration("run-state", { schemaVersion: -1 });
  assert.equal(verdict.status, "unsupported", "below-minimum schemaVersion is unsupported");
  assert.equal(verdict.reachable, false, "below-minimum schemaVersion is not reachable");
  assert.deepEqual(verdict.chain, [], "unsupported verdict has an empty chain");
  assert.deepEqual(verdict.errors, ["run-state schemaVersion -1 is below the minimum supported 0"], "unsupported verdict carries resolveChain's exact error string");
  assert.equal(verdict.changes, 0, "an unsupported verdict reports 0 changes (it never runs the migration)");
}

// A run-state snapshot with schemaVersion above current -> unsupported.
{
  const verdict = checkMigration("run-state", { schemaVersion: 5 });
  assert.equal(verdict.status, "unsupported", "above-current schemaVersion is unsupported");
  assert.deepEqual(verdict.errors, ["run-state schemaVersion 5 is newer than this runtime (1)"], "exact 'newer than runtime' error");
}

// workflow-app contract: a missing/non-number schemaVersion detects as 0 (SPEC-named behavior).
{
  const verdict = checkMigration("workflow-app", {});
  assert.equal(verdict.detectedVersion, 0, "workflow-app snapshot missing schemaVersion detects as 0");
  assert.equal(verdict.status, "unsupported", "0 is below workflow-app's minVersion (1), so it's unsupported");
}

// workflow-app at its current version (1) -> status "current", changes 0.
{
  const verdict = checkMigration("workflow-app", { schemaVersion: 1 });
  assert.equal(verdict.status, "current", "workflow-app snapshot already at schemaVersion 1 is current");
  assert.equal(verdict.changes, 0, "workflow-app current verdict has 0 changes");
  assert.deepEqual(verdict.errors, [], "workflow-app current verdict has no errors");
}

// Unknown contract id throws the exact error message.
{
  assert.throws(
    () => checkMigration("not-a-real-contract", {}),
    (err) => err instanceof Error && err.message === "Unknown migration contract: not-a-real-contract",
    "an unknown contract id throws 'Unknown migration contract: <id>'"
  );
}

// A non-integer schemaVersion detects as +Infinity, which is treated as "above current" -> unsupported.
{
  const verdict = checkMigration("run-state", { schemaVersion: 1.5 });
  assert.equal(verdict.status, "unsupported", "a non-integer schemaVersion is treated as unsupported (detected as +Infinity)");
}

process.stdout.write("stateexplosion-migration-checkmigration: ok\n");
