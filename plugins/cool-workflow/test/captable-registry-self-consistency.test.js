#!/usr/bin/env node
// captable-registry-self-consistency — the "one source of truth stays
// sane" standing regression guard v2/PLAN.md's whole design depends on
// (Target shape: "capability-table.ts: THE one data table"; Byte-compat
// item 5; SPEC/mcp.md's registry-lint list: "duplicate capability ids,
// duplicate MCP tool names, ... cli-only with no cli binding, ...
// reasonlessExceptions"). This v2 build's capability-table.ts does not
// (yet) port the old build's lintRegistry()/buildParityReport() as
// callable functions, so this file asserts the SAME invariants directly
// against REGISTRY's live data — cheap, and it fails loudly the moment a
// future row addition breaks one of these rules.

const assert = require("node:assert/strict");
const { REGISTRY } = require("../dist/core/capability-table");

// No duplicate capability ids anywhere in the table.
{
  const ids = REGISTRY.map((row) => row.capability);
  const seen = new Set();
  const dups = [];
  for (const id of ids) {
    if (seen.has(id)) dups.push(id);
    seen.add(id);
  }
  assert.deepEqual(dups, [], "REGISTRY must have zero duplicate capability ids");
  assert.equal(seen.size, ids.length, "capability id count must match the unique id count");
}

// No duplicate MCP tool names anywhere in the table.
{
  const tools = REGISTRY.filter((row) => row.mcp).map((row) => row.mcp.tool);
  const seen = new Set();
  const dups = [];
  for (const t of tools) {
    if (seen.has(t)) dups.push(t);
    seen.add(t);
  }
  assert.deepEqual(dups, [], "REGISTRY must have zero duplicate MCP tool names");
}

// Every cli-only or mcp-only row carries a non-empty reason (registry-lint's
// "reasonlessExceptions" rule from SPEC/mcp.md item 3: "A cli-only/mcp-only
// ... capability with no reason is itself release-blocking").
{
  const oneSurfaceRows = REGISTRY.filter((row) => row.surface === "cli-only" || row.surface === "mcp-only");
  const reasonless = oneSurfaceRows.filter((row) => !row.reason || !row.reason.trim());
  assert.deepEqual(
    reasonless.map((row) => row.capability),
    [],
    "every cli-only/mcp-only row must carry a non-empty reason"
  );
}

// Structural binding/surface agreement: cli-only rows never carry an mcp
// binding; both rows always carry an mcp binding (registry-lint's "cli-only
// with an mcp binding" / "'both' without both bindings" checks, narrowed to
// what this milestone's table can assert — a 'both' row MAY still be
// missing its cli half at this point in the build, see captable-cli-only-
// row-shape.test.js for that nuance).
{
  for (const row of REGISTRY) {
    if (row.surface === "cli-only") {
      assert.equal(row.mcp, undefined, `cli-only row ${row.capability} must not carry an mcp binding`);
      assert.ok(row.cli, `cli-only row ${row.capability} must carry a cli binding`);
    }
    if (row.surface === "both") {
      assert.ok(row.mcp, `both-surface row ${row.capability} must carry an mcp binding`);
    }
  }
}

// No row's capability id is an empty or whitespace-only string.
{
  const blank = REGISTRY.filter((row) => !row.capability || !row.capability.trim());
  assert.deepEqual(blank, [], "no row may have a blank capability id");
}

// No row's summary is an empty or whitespace-only string (every row must
// be describable — this is what both cw help and tools/list render).
{
  const blankSummary = REGISTRY.filter((row) => !row.summary || !row.summary.trim());
  assert.deepEqual(
    blankSummary.map((row) => row.capability),
    [],
    "no row may have a blank summary"
  );
}

// REGISTRY is non-trivially large (sanity bound, not an exact count pin —
// the exact count is expected to grow as later milestones add rows).
{
  assert.ok(REGISTRY.length > 150, "REGISTRY should already carry well over 150 rows at this point in the build");
}

process.stdout.write("captable-registry-self-consistency: ok\n");
