#!/usr/bin/env node
// maruntime-topology-role-width (multiagent-core bucket) — pins
// withLegacyRoleCounts (mapperCount floor 1 / judgeCount floor 2 folded
// into roleCounts), materializedRoles (width math + id/title suffixing),
// fanoutRoleIds (collector-role exclusion by id SUFFIX).
//
// Evidence: SPEC/multi-agent.md section B ("Role width rules", "Fanout
// roles at apply time"), rebuild risk 3 (fanout filter by suffix).

const assert = require("node:assert/strict");
const { OFFICIAL_TOPOLOGIES, withLegacyRoleCounts, materializedRoles, fanoutRoleIds } = require("../dist/core/multi-agent/topology");

const mapReduce = OFFICIAL_TOPOLOGIES.find((t) => t.id === "map-reduce");
const judgePanel = OFFICIAL_TOPOLOGIES.find((t) => t.id === "judge-panel");

// withLegacyRoleCounts: mapperCount floors at 1, judgeCount floors at 2;
// an explicit roleCounts entry always wins over the legacy flag.
{
  assert.deepEqual(withLegacyRoleCounts({ mapperCount: 0 }).roleCounts, { mapper: 1 }, "mapperCount floors at 1");
  assert.deepEqual(withLegacyRoleCounts({ judgeCount: 1 }).roleCounts, { judge: 2 }, "judgeCount floors at 2");
  assert.deepEqual(withLegacyRoleCounts({ mapperCount: 5, judgeCount: 4 }).roleCounts, { mapper: 5, judge: 4 });
  assert.deepEqual(withLegacyRoleCounts({ judgeCount: 1, roleCounts: { judge: 1 } }).roleCounts, { judge: 1 }, "explicit roleCounts.judge=1 wins over the judgeCount floor");
  assert.equal(withLegacyRoleCounts({}).roleCounts, undefined, "no legacy flags and no roleCounts leaves the input untouched");
}

// materializedRoles width math: default map-reduce mints mapper-1,
// mapper-2, reducer (unwidened role keeps its bare id).
{
  const roles = materializedRoles(mapReduce, {});
  assert.deepEqual(roles.map((r) => r.id), ["mapper-1", "mapper-2", "reducer"]);
  assert.deepEqual(roles.map((r) => r.title), ["Mapper 1", "Mapper 2", "Reducer"]);
}

// Default judge-panel mints judge-1, judge-2, judge-3, panel-chair.
{
  const roles = materializedRoles(judgePanel, {});
  assert.deepEqual(roles.map((r) => r.id), ["judge-1", "judge-2", "judge-3", "panel-chair"]);
}

// Explicit roleCounts overrides the role's own default count.
{
  const roles = materializedRoles(mapReduce, { roleCounts: { mapper: 1 } });
  assert.deepEqual(roles.map((r) => r.id), ["mapper", "reducer"], "width 1 keeps the bare role id, no -1 suffix");
}

{
  const roles = materializedRoles(mapReduce, { roleCounts: { mapper: 4 } });
  assert.deepEqual(roles.map((r) => r.id), ["mapper-1", "mapper-2", "mapper-3", "mapper-4", "reducer"]);
}

// Width floors at 1 even with a bogus 0/negative roleCounts entry.
{
  const roles = materializedRoles(mapReduce, { roleCounts: { mapper: 0 } });
  assert.deepEqual(roles.map((r) => r.id), ["mapper", "reducer"], "roleCounts of 0 floors to width 1 (max(1, ...))");
}

// fanoutRoleIds: excludes ids ending -reducer/-synthesizer/-panel-chair;
// this is a SUFFIX match, not a role-name equality check. NOTE: the real
// call site (applyTopology) always mints materialized role ids as
// `${topologyRunId}-${role.id}` (SPEC section B, "Derived default ids off
// it"), so a collector role's real persisted id is always
// `<prefix>-reducer` / `<prefix>-synthesizer` / `<prefix>-panel-chair` —
// never the bare topology-role id. These tests use that realistic,
// prefixed shape.
{
  assert.deepEqual(fanoutRoleIds(["mapper-1", "mapper-2", "run-abc-reducer"]), ["mapper-1", "mapper-2"], "collector role ending -reducer is excluded");
  assert.deepEqual(fanoutRoleIds(["position-a", "position-b", "run-abc-synthesizer"]), ["position-a", "position-b"]);
  assert.deepEqual(fanoutRoleIds(["judge-1", "judge-2", "judge-3", "run-abc-panel-chair"]), ["judge-1", "judge-2", "judge-3"]);
  assert.deepEqual(fanoutRoleIds(["mapper-1", "team-reducer"]), ["mapper-1"], "id ENDING in -reducer is excluded even with a compound prefix, alongside a real fanout role");
}

// If the filter empties the whole list, ALL roles fan out (never an
// empty fanout).
{
  assert.deepEqual(fanoutRoleIds(["run-abc-reducer"]), ["run-abc-reducer"], "filtering everything out falls back to fanning out all roles");
  assert.deepEqual(fanoutRoleIds(["run-abc-reducer", "run-abc-synthesizer", "run-abc-panel-chair"]), ["run-abc-reducer", "run-abc-synthesizer", "run-abc-panel-chair"], "all-collector input still fans out (never empties)");
}

// A role id that merely CONTAINS "reducer" but doesn't END with
// "-reducer" is NOT excluded (this is a suffix, not substring, match). A
// BARE "reducer" with no hyphenated prefix also does not end with
// "-reducer" (no leading hyphen) and is therefore NOT excluded either —
// this only matters for a caller that (unlike applyTopology) passes an
// unprefixed collector role id straight through.
{
  assert.deepEqual(fanoutRoleIds(["reducer-worker"]), ["reducer-worker"], "reducer-worker does not end with -reducer, so it fans out normally");
  assert.deepEqual(fanoutRoleIds(["mapper-1", "reducer"]), ["mapper-1", "reducer"], "a bare, unprefixed \"reducer\" id has no leading hyphen and does NOT match the -reducer suffix");
}

process.stdout.write("maruntime-topology-role-width: ok\n");
