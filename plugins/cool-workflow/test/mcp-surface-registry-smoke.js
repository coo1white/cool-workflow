#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const srcServer = path.join(pluginRoot, "src", "mcp-server.ts");
const srcSurface = path.join(pluginRoot, "src", "mcp-surface.ts");
const distServer = path.join(pluginRoot, "dist", "mcp-server.js");
const registry = require(path.join(pluginRoot, "dist", "capability-registry.js"));
const surface = require(path.join(pluginRoot, "dist", "mcp-surface.js"));

function liveMcpTools() {
  const out = execFileSync(process.execPath, [distServer], {
    cwd: pluginRoot,
    input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`,
    encoding: "utf8"
  });
  const line = out.trim().split("\n").find((entry) => entry.includes('"tools"'));
  assert.ok(line, "MCP server returned no tools/list result");
  return JSON.parse(line).result.tools;
}

const serverSource = fs.readFileSync(srcServer, "utf8");
const surfaceSource = fs.readFileSync(srcSurface, "utf8");
assert.match(serverSource, /from "\.\/mcp-surface"/, "mcp-server transport must import the MCP surface module");
assert.doesNotMatch(serverSource, /function\s+callTool\s*\(/, "callTool must live outside mcp-server transport");
assert.doesNotMatch(serverSource, /function\s+toolDefinitions\s*\(/, "toolDefinitions must live outside mcp-server transport");
assert.doesNotMatch(surfaceSource, /\btool\("cw_/, "MCP surface must derive tool names from capability ids");

const liveTools = liveMcpTools();
const surfaceTools = surface.toolDefinitions();
assert.deepEqual(liveTools, surfaceTools, "tools/list must be exactly the exported MCP surface definitions");

for (const tool of liveTools) {
  const descriptor = registry.mcpCapabilityForTool(tool.name);
  assert.ok(descriptor, `${tool.name}: live MCP tool must be backed by the capability registry`);
  assert.ok(tool.description && tool.description.trim(), `${tool.name}: live MCP tool must carry a description`);
  assert.equal(tool.inputSchema?.type, "object", `${tool.name}: live MCP tool must expose an object input schema`);
  assert.deepEqual(
    registry.mcpToolDefinition(descriptor.capability, tool.description, tool.inputSchema.properties),
    tool,
    `${tool.name}: registry helper must reproduce the public tools/list entry`
  );
}

process.stdout.write(`mcp-surface-registry-smoke: ok (${liveTools.length} tools)\n`);
