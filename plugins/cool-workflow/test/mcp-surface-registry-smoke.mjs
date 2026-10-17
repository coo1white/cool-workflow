#!/usr/bin/env node
// The MCP surface lives in:
//   - src/mcp-server.ts (entry)  -> imports ./mcp/server (the transport);
//   - src/mcp/server.ts (transport) -> imports { callTool, toolDefinitions }
//     from ./dispatch, so the transport still does NOT define them itself;
//   - src/mcp/dispatch.ts (the surface) -> derives every tool from
//     mcpToolDefinitions() in ../core/capability-table, no hardcoded cw_
//     tool names;
//   - src/core/capability-table.ts -> the one data table; findCapabilityByMcpTool
//     replaces mcpCapabilityForTool, mcpToolDefinitions() (bulk) replaces the
//     old per-tool mcpToolDefinition() builder.
// Every assertion below keeps its original INTENT: the live tools/list is
// derived from the capability table, never hand-hardcoded in the transport,
// and the registry's own builder reproduces the public tools/list entry.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");
// v2 layout: entry (mcp-server.ts) -> transport (mcp/server.ts) -> surface
// (mcp/dispatch.ts) -> capability table (core/capability-table.ts).
const srcEntry = path.join(pluginRoot, "src", "mcp-server.ts");
const srcTransport = path.join(pluginRoot, "src", "mcp", "server.ts");
const srcSurface = path.join(pluginRoot, "src", "mcp", "dispatch.ts");
const distServer = path.join(pluginRoot, "dist", "mcp-server.js");
import * as registry from "../dist/core/capability-table.js";
import * as surface from "../dist/mcp/dispatch.js";

function liveMcpTools() {
  const out = execFileSync(process.execPath, [distServer], {
    cwd: pluginRoot,
    env: { ...process.env, CW_MCP_TOOLS: "full" },
    input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`,
    encoding: "utf8"
  });
  const line = out.trim().split("\n").find((entry) => entry.includes('"tools"'));
  assert.ok(line, "MCP server returned no tools/list result");
  return JSON.parse(line).result.tools;
}

const entrySource = fs.readFileSync(srcEntry, "utf8");
const transportSource = fs.readFileSync(srcTransport, "utf8");
const surfaceSource = fs.readFileSync(srcSurface, "utf8");
// The entry binary only starts the transport; the transport imports its
// callTool/toolDefinitions from the surface module (old: from "./mcp-surface").
assert.match(entrySource, /from "\.\/mcp\/server\.js"/, "mcp-server entry must start the MCP transport module");
assert.match(transportSource, /from "\.\/dispatch\.js"/, "mcp transport must import the MCP surface module");
// callTool/toolDefinitions must live OUTSIDE the transport (in the surface).
assert.doesNotMatch(transportSource, /function\s+callTool\s*\(/, "callTool must live outside mcp transport");
assert.doesNotMatch(transportSource, /function\s+toolDefinitions\s*\(/, "toolDefinitions must live outside mcp transport");
// The surface must DERIVE tool names from capability rows, never hardcode a
// cw_ tool literal (old: no `.tool("cw_`; v2: builds from mcpToolDefinitions).
assert.doesNotMatch(surfaceSource, /"cw_/, "MCP surface must derive tool names from capability ids");
assert.match(surfaceSource, /mcpToolDefinitions/, "MCP surface must derive tool definitions from the capability table");

const liveTools = liveMcpTools();
const surfaceTools = surface.toolDefinitions();
assert.deepEqual(liveTools, surfaceTools, "tools/list must be exactly the exported MCP surface definitions");

// v2 has no per-tool mcpToolDefinition() builder; the registry's own bulk
// builder mcpToolDefinitions() is the v2 equivalent. Index it by name so we
// can still assert, per tool, that the registry builder reproduces the exact
// public tools/list entry (original lines 43-47's intent).
const registryDefinitions = new Map(registry.mcpToolDefinitions().map((def) => [def.name, def]));

for (const tool of liveTools) {
  const descriptor = registry.findCapabilityByMcpTool(tool.name);
  assert.ok(descriptor, `${tool.name}: live MCP tool must be backed by the capability registry`);
  assert.ok(tool.description && tool.description.trim(), `${tool.name}: live MCP tool must carry a description`);
  assert.equal(tool.inputSchema?.type, "object", `${tool.name}: live MCP tool must expose an object input schema`);
  assert.deepEqual(
    registryDefinitions.get(tool.name),
    tool,
    `${tool.name}: registry helper must reproduce the public tools/list entry`
  );
}

process.stdout.write(`mcp-surface-registry-smoke: ok (${liveTools.length} tools)\n`);
