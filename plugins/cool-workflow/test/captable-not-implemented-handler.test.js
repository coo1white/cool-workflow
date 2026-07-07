#!/usr/bin/env node
// captable-not-implemented-handler — pins notYetImplemented()'s throw
// behavior (unexported, tested through its one observable effect: any
// mcp.handler for a capability NOT listed in MCP_REAL_HANDLERS throws a
// CapabilityNotImplementedError with an exact message shape). Per the
// file header comment: "Every other tool's mcp.handler is
// notYetImplemented(capability), which throws a clean, typed error if
// ever actually called."

const assert = require("node:assert/strict");
const { REGISTRY, CapabilityNotImplementedError, findCapabilityByMcpTool } = require("../dist/core/capability-table");

// CapabilityNotImplementedError is a real Error subclass with the name set.
{
  const err = new CapabilityNotImplementedError("some.capability");
  assert.ok(err instanceof Error, "CapabilityNotImplementedError must be an Error");
  assert.equal(err.name, "CapabilityNotImplementedError", "error name must be set");
  assert.equal(
    err.message,
    "some.capability is not implemented in this milestone",
    "error message must be the exact pinned template"
  );
}

// A REAL implemented handler (list) does NOT throw
// CapabilityNotImplementedError — proves the throw is conditional on
// registration, not universal.
{
  const row = findCapabilityByMcpTool("cw_list");
  assert.doesNotThrow(() => row.mcp.handler({}), "a real implemented handler must not throw CapabilityNotImplementedError");
}

// At the shipped release, MCP_REAL_HANDLERS covers every one of the 196
// declared mcp rows — notYetImplemented is a placeholder the build used
// while wiring incrementally, but no row should still fall through to it
// in a tagged release. A broad sweep, not just one named example: every
// mcp-bound row's handler must be a real implementation.
{
  const mcpRows = REGISTRY.filter((row) => row.mcp);
  assert.ok(mcpRows.length > 100, "the mcp surface must be present");
  const stillUnimplemented = [];
  for (const row of mcpRows) {
    try {
      row.mcp.handler({});
    } catch (e) {
      if (e instanceof CapabilityNotImplementedError) stillUnimplemented.push(row.capability);
    }
  }
  assert.deepEqual(stillUnimplemented, [], "no mcp row should still throw CapabilityNotImplementedError at the shipped release");
}

process.stdout.write("captable-not-implemented-handler: ok\n");
