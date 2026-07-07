#!/usr/bin/env node
// captable-cli-only-row-shape — pins the shape produced by the internal
// (unexported) addCliOnlyCapability/attachCliBinding helpers, observed
// through their one visible effect: REGISTRY row shape. Per SPEC/mcp.md
// "Declared one-surface capabilities (13 cli-only, each with a recorded
// reason)" and PLAN.md byte-compat item 5, a cli-only row must: carry
// surface:"cli-only", carry a non-empty `reason`, carry a `cli` binding,
// and carry NO `mcp` binding. A "both" row (built from MCP_TOOL_DATA) is
// the mirror: it always starts with an `mcp` binding and MAY additionally
// carry a `cli` binding layered on by attachCliBinding.

const assert = require("node:assert/strict");
const { REGISTRY, findCapability } = require("../dist/core/capability-table");

// version: a real declared cli-only row (addCliOnlyCapability's exact call
// site in capability-table.ts) — cli-only, has cli, has NO mcp, has reason.
{
  const row = findCapability("version");
  assert.ok(row, "version capability must be declared");
  assert.equal(row.surface, "cli-only", "version must be surface:cli-only");
  assert.ok(row.cli, "version must carry a cli binding");
  assert.equal(row.mcp, undefined, "version must carry NO mcp binding");
  assert.equal(typeof row.reason, "string", "version must carry a reason");
  assert.ok(row.reason.trim().length > 0, "version's reason must be non-empty");
  assert.deepEqual(row.cli.path, ["version"], "version's cli.path must be exactly [version]");
}

// list: a "both" row (from MCP_TOOL_DATA) with a cli binding layered on
// top via attachCliBinding — must carry BOTH mcp and cli.
{
  const row = findCapability("list");
  assert.equal(row.surface, "both", "list must be surface:both");
  assert.ok(row.mcp, "list must carry an mcp binding (declared in MCP_TOOL_DATA)");
  assert.ok(row.cli, "list must carry a cli binding (attached at milestone 2)");
  assert.equal(row.mcp.tool, "cw_list", "list's mcp.tool must be cw_list");
  assert.deepEqual(row.cli.path, ["list"], "list's cli.path must be exactly [list]");
}

// At the shipped release, every "both" row has had a cli binding attached
// (attachCliBinding ran for all 196 mcp rows) — the "both" surface field
// is set unconditionally by MCP_TOOL_DATA and cli.path is now populated on
// every one of them, not just a handful of early ones.
{
  const row = findCapability("app.run");
  assert.ok(row, "app.run must be declared");
  assert.equal(row.surface, "both", "app.run's declared surface field is 'both'");
  assert.ok(row.mcp, "app.run must carry an mcp binding");
  assert.ok(row.cli, "app.run must carry a cli binding at the shipped release");
}

// Standing invariant: no "both" row is left without a cli binding at the
// shipped release (regression guard — if a future mcp-only tool is added
// and never wired to a cli path, this must fail).
{
  const bothRowsMissingCli = REGISTRY.filter((row) => row.surface === "both" && !row.cli);
  assert.deepEqual(bothRowsMissingCli.map((row) => row.capability), [], "every both-surface row must carry a cli binding");
}

// Every cli-only row in the whole table must carry a reason (regression
// guard on addCliOnlyCapability's REQUIRED reason parameter — the
// function signature makes this structurally guaranteed, but pin it as a
// standing behavioral fact too).
{
  const cliOnlyRows = REGISTRY.filter((row) => row.surface === "cli-only");
  assert.ok(cliOnlyRows.length > 0, "at least one cli-only row must exist");
  for (const row of cliOnlyRows) {
    assert.equal(typeof row.reason, "string", `cli-only row ${row.capability} must carry a string reason`);
    assert.ok(row.reason.trim().length > 0, `cli-only row ${row.capability}'s reason must be non-empty`);
    assert.ok(row.cli, `cli-only row ${row.capability} must carry a cli binding`);
    assert.equal(row.mcp, undefined, `cli-only row ${row.capability} must carry no mcp binding`);
  }
}

// Every "both" row must carry an mcp binding (surface:both is set
// unconditionally by the MCP_TOOL_DATA map — a "both" row missing mcp
// would be a real structural break).
{
  const bothRows = REGISTRY.filter((row) => row.surface === "both");
  assert.ok(bothRows.length > 0, "at least one both-surface row must exist");
  for (const row of bothRows) {
    assert.ok(row.mcp, `both-surface row ${row.capability} must carry an mcp binding`);
  }
}

process.stdout.write("captable-cli-only-row-shape: ok\n");
