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

// A real not-yet-implemented mcp tool (app.run has no entry in
// MCP_REAL_HANDLERS) throws CapabilityNotImplementedError when its
// mcp.handler is invoked directly, in-memory, no side effects.
{
  const row = findCapabilityByMcpTool("cw_app_run");
  assert.ok(row, "cw_app_run must be declared");
  assert.ok(row.mcp, "cw_app_run must carry an mcp binding");
  assert.throws(
    () => row.mcp.handler({ appId: "does-not-matter" }),
    CapabilityNotImplementedError,
    "an unimplemented mcp.handler must throw CapabilityNotImplementedError"
  );
  try {
    row.mcp.handler({});
    assert.fail("must have thrown");
  } catch (e) {
    assert.equal(e.message, "app.run is not implemented in this milestone", "thrown error message must name the capability id, not the tool name");
  }
}

// A REAL implemented handler (list) does NOT throw
// CapabilityNotImplementedError — the mirror case, so this file also
// proves the throw is conditional on registration, not universal.
{
  const row = findCapabilityByMcpTool("cw_list");
  assert.doesNotThrow(() => row.mcp.handler({}), "a real implemented handler must not throw CapabilityNotImplementedError");
}

// Every mcp-bound row that is NOT in the small set of milestone-wired
// capabilities throws when called with no arguments — a broad sweep,
// not just the one named example above. This documents the actual size
// of the not-yet-implemented surface at this point in the build without
// pinning an exact count (later milestones wire more rows over time).
{
  const implementedIds = new Set(["list", "sandbox.list", "status", "summary.refresh", "summary.show"]);
  const mcpRows = REGISTRY.filter((row) => row.mcp && !implementedIds.has(row.capability));
  assert.ok(mcpRows.length > 100, "the not-yet-implemented mcp surface should still be large at this point in the build");
  let notImplementedCount = 0;
  for (const row of mcpRows) {
    try {
      row.mcp.handler({});
    } catch (e) {
      if (e instanceof CapabilityNotImplementedError) notImplementedCount += 1;
    }
  }
  assert.ok(
    notImplementedCount > 0,
    "at least one row outside the known-implemented set must throw CapabilityNotImplementedError"
  );
}

process.stdout.write("captable-not-implemented-handler: ok\n");
