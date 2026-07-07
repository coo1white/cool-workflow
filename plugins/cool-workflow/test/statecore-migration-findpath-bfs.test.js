#!/usr/bin/env node
// statecore-migration-findpath-bfs (milestone 3) — pins findMigrationPath's
// BFS behavior: same-version short circuit, forward edges, reverse edges
// (only when a step declares reverse()), and the no-path error string.
// SPEC/state-core.md: "findMigrationPath(steps, fromVersion, toVersion) —
// BFS shortest path over forward edges (from -> to) plus reverse edges
// (to -> from, only when the step has reverse()); same version returns
// { reachable: true, path: [] }; no path returns { reachable: false, path:
// [], error: 'no migration path from schemaVersion <from> to <to>' }".

const assert = require("node:assert/strict");
const { findMigrationPath, RUN_STATE_MIGRATIONS } = require("../dist/core/state/migrations");

// Same version: reachable, empty path, no BFS work needed.
{
  const result = findMigrationPath(RUN_STATE_MIGRATIONS, 1, 1);
  assert.deepEqual(result, { reachable: true, path: [] }, "fromVersion === toVersion must short-circuit");
}
{
  const result = findMigrationPath(RUN_STATE_MIGRATIONS, 0, 0);
  assert.deepEqual(result, { reachable: true, path: [] }, "fromVersion === toVersion must short-circuit even at 0");
}

// Real migration ladder: forward edge 0 -> 1 exists and is found.
{
  const result = findMigrationPath(RUN_STATE_MIGRATIONS, 0, 1);
  assert.equal(result.reachable, true, "0 -> 1 must be reachable via the one real migration step");
  assert.equal(result.path.length, 1, "path must have exactly one step");
  assert.equal(result.path[0].reverse, false, "the 0->1 step must be traversed forward");
  assert.equal(result.path[0].edge.from, 0);
  assert.equal(result.path[0].edge.to, 1);
}

// Reverse edge: the real migration step declares reverse(), so 1 -> 0 is
// reachable through the reverse edge.
{
  const result = findMigrationPath(RUN_STATE_MIGRATIONS, 1, 0);
  assert.equal(result.reachable, true, "1 -> 0 must be reachable via the declared reverse() edge");
  assert.equal(result.path.length, 1);
  assert.equal(result.path[0].reverse, true, "the 1->0 step must be traversed in reverse");
}

// No path: an unreachable target version produces the exact error string.
{
  const result = findMigrationPath(RUN_STATE_MIGRATIONS, 0, 99);
  assert.equal(result.reachable, false, "an unreachable target must not be reachable");
  assert.deepEqual(result.path, [], "an unreachable target must have an empty path");
  assert.equal(
    result.error,
    "no migration path from schemaVersion 0 to 99",
    "no-path error string must match SPEC exactly"
  );
}

// No path: an unreachable source version too.
{
  const result = findMigrationPath(RUN_STATE_MIGRATIONS, 99, 1);
  assert.equal(result.reachable, false);
  assert.equal(result.error, "no migration path from schemaVersion 99 to 1");
}

// Forward-edge-only step (no reverse()) does NOT provide a reverse path:
// construct a synthetic step set to isolate this from the one real step.
{
  const steps = [
    { from: 0, to: 1, description: "no reverse declared", migrate() {} },
  ];
  const forward = findMigrationPath(steps, 0, 1);
  assert.equal(forward.reachable, true, "forward edge must still work");

  const backward = findMigrationPath(steps, 1, 0);
  assert.equal(backward.reachable, false, "a step with no reverse() must NOT provide an implicit reverse edge");
}

// Multi-hop BFS: chained forward edges 0 -> 1 -> 2 resolve to a 2-step path,
// and BFS finds the SHORTEST path when both a direct and an indirect edge
// exist.
{
  const steps = [
    { from: 0, to: 1, description: "step a", migrate() {} },
    { from: 1, to: 2, description: "step b", migrate() {} },
  ];
  const result = findMigrationPath(steps, 0, 2);
  assert.equal(result.reachable, true, "chained forward edges must be reachable");
  assert.equal(result.path.length, 2, "path must include both hops");
  assert.equal(result.path[0].edge.from, 0);
  assert.equal(result.path[1].edge.to, 2);
}
{
  // A direct 0->2 edge alongside the 0->1->2 chain: BFS must prefer the
  // single-hop direct edge (shortest path), not the two-hop chain.
  const steps = [
    { from: 0, to: 1, description: "step a", migrate() {} },
    { from: 1, to: 2, description: "step b", migrate() {} },
    { from: 0, to: 2, description: "direct step", migrate() {} },
  ];
  const result = findMigrationPath(steps, 0, 2);
  assert.equal(result.path.length, 1, "BFS must prefer the direct 1-hop edge over the 2-hop chain");
  assert.equal(result.path[0].edge.description, "direct step");
}

process.stdout.write("statecore-migration-findpath-bfs: ok\n");
