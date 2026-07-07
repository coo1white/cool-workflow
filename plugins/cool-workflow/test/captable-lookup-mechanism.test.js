#!/usr/bin/env node
// captable-lookup-mechanism — pins the three lookup functions
// core/capability-table.ts exports over the REGISTRY data table:
// findCapability, findCapabilityByCliPath, findCapabilityByMcpTool.
// Per v2/PLAN.md's Target shape, capability-table.ts is THE one data
// table; every later milestone adds rows only, never touches these
// lookup helpers again. SPEC/mcp.md, SPEC/orchestrator.md, SPEC/cli-
// surface.md all describe this as "one source of truth" for both front
// doors, so the lookups must be exact (no partial/prefix matches).

const assert = require("node:assert/strict");
const {
  findCapability,
  findCapabilityByCliPath,
  findCapabilityByMcpTool,
  REGISTRY,
} = require("../dist/core/capability-table");

// findCapability: a real, declared capability id resolves to its row.
{
  const row = findCapability("list");
  assert.ok(row, "findCapability(list) must resolve");
  assert.equal(row.capability, "list", "resolved row must carry the requested capability id");
}

// findCapability: an unknown capability id returns undefined (not throw).
{
  const row = findCapability("this.capability.does.not.exist");
  assert.equal(row, undefined, "findCapability of an unknown id must return undefined");
}

// findCapability: empty-string id returns undefined.
{
  assert.equal(findCapability(""), undefined, "findCapability('') must return undefined");
}

// findCapabilityByCliPath: a real declared path resolves to the right row.
{
  const row = findCapabilityByCliPath(["version"]);
  assert.ok(row, "findCapabilityByCliPath([version]) must resolve");
  assert.equal(row.capability, "version", "path [version] must resolve to the version capability");
}

// findCapabilityByCliPath: a real multi-token path resolves exactly.
{
  const row = findCapabilityByCliPath(["sandbox", "list"]);
  assert.ok(row, "findCapabilityByCliPath([sandbox,list]) must resolve");
  assert.equal(row.capability, "sandbox.list", "2-token path must resolve to sandbox.list");
}

// findCapabilityByCliPath: unknown path returns undefined.
{
  assert.equal(
    findCapabilityByCliPath(["nope", "not-a-real-verb"]),
    undefined,
    "an unknown path must return undefined"
  );
}

// findCapabilityByCliPath: empty path array returns undefined (no row has a zero-length path).
{
  assert.equal(findCapabilityByCliPath([]), undefined, "empty path array must return undefined");
}

// findCapabilityByCliPath: path length must match EXACTLY — a path longer
// than any declared row must NOT fall back to a prefix match.
{
  assert.equal(
    findCapabilityByCliPath(["list", "extra-token"]),
    undefined,
    "a path longer than any declared row must not match"
  );
}

// findCapabilityByCliPath: a path SHORTER than a declared row's path must
// not match that longer row either — it may match a distinct shorter row
// instead (e.g. sandbox.usage's 1-token fallback path), but never the
// 2-token sandbox.list row.
{
  const row = findCapabilityByCliPath(["sandbox"]);
  assert.ok(row, "1-token [sandbox] must resolve to some row");
  assert.notEqual(row.capability, "sandbox.list", "[sandbox] alone must not resolve to the 2-token sandbox.list row");
}

// findCapabilityByMcpTool: a real declared tool name resolves.
{
  const row = findCapabilityByMcpTool("cw_list");
  assert.ok(row, "findCapabilityByMcpTool(cw_list) must resolve");
  assert.equal(row.capability, "list", "cw_list must resolve to the list capability");
}

// findCapabilityByMcpTool: unknown tool name returns undefined.
{
  assert.equal(
    findCapabilityByMcpTool("cw_this_tool_does_not_exist"),
    undefined,
    "an unknown mcp tool name must return undefined"
  );
}

// findCapabilityByMcpTool: every row it can resolve must actually be
// present, unmodified, in REGISTRY (no synthesized/copied row).
{
  const row = findCapabilityByMcpTool("cw_status");
  const direct = REGISTRY.find((r) => r.capability === "status");
  assert.equal(row, direct, "findCapabilityByMcpTool must return the SAME row object as REGISTRY holds, not a copy");
}

process.stdout.write("captable-lookup-mechanism: ok\n");
