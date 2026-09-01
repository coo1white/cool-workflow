#!/usr/bin/env node
// captable-projection-helpers — pins cliCapabilities()/declaredMcpTools(),
// the two read-projections `core/format/help.ts`'s formatCommandHelp and
// the MCP tools/list handler are built on (v2/PLAN.md Target shape:
// "formatHelp/formatCommandHelp become pure projections of the table").

const assert = require("node:assert/strict");
const { cliCapabilities, declaredMcpTools, REGISTRY } = require("../dist/core/capability-table");

// cliCapabilities(): every returned row actually carries a .cli binding
// (the whole point of the CliCapability-narrowed return type).
{
  const rows = cliCapabilities();
  assert.ok(rows.length > 0, "cliCapabilities() must return at least one row");
  for (const row of rows) {
    assert.ok(row.cli, `cliCapabilities() row ${row.capability} must carry a .cli binding`);
  }
}

// cliCapabilities(): count matches a manual filter of REGISTRY exactly
// (no extra rows synthesized, none silently dropped).
{
  const rows = cliCapabilities();
  const manual = REGISTRY.filter((row) => Boolean(row.cli));
  assert.equal(rows.length, manual.length, "cliCapabilities() count must match REGISTRY.filter(has cli)");
  assert.deepEqual(
    rows.map((r) => r.capability),
    manual.map((r) => r.capability),
    "cliCapabilities() must preserve REGISTRY's row order"
  );
}

// cliCapabilities(): a known cli-only row (version) and a known both-with-
// cli row (list) are both present.
{
  const ids = cliCapabilities().map((r) => r.capability);
  assert.ok(ids.includes("version"), "cliCapabilities() must include version");
  assert.ok(ids.includes("list"), "cliCapabilities() must include list");
  assert.ok(ids.includes("app.run"), "cliCapabilities() must include app.run (it carries a cli binding at the shipped release)");
}

// declaredMcpTools(): returns exactly 199 tool names (198 + cw_run_link,
// added by this cycle), in the pinned tools/list source order.
{
  const tools = declaredMcpTools();
  assert.equal(tools.length, 199, "declaredMcpTools() must report exactly 199 tool names");
  assert.equal(tools[0], "cw_list", "the first declared tool must be cw_list");
  assert.equal(tools[tools.length - 1], "cw_run_link", "the last declared tool must be cw_run_link");
}

// declaredMcpTools(): every name is unique.
{
  const tools = declaredMcpTools();
  assert.equal(new Set(tools).size, tools.length, "declaredMcpTools() must have no duplicate names");
}

// declaredMcpTools(): every returned name starts with the cw_ prefix.
{
  const tools = declaredMcpTools();
  const bad = tools.filter((t) => !t.startsWith("cw_"));
  assert.deepEqual(bad, [], "every declared MCP tool name must start with cw_");
}

process.stdout.write("captable-projection-helpers: ok\n");
