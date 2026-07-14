#!/usr/bin/env node
"use strict";

// Track C: an operator can limit the MCP tool authority at server start. A
// deny list has the last word and a denied call cannot start its handler.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const mcp = path.join(root, "dist", "mcp-server.js");
const node = process.execPath;

function rpc(messages, env = {}) {
  const input = messages.map((message) => JSON.stringify(message)).join("\n") + "\n";
  const result = spawnSync(node, [mcp], { input, encoding: "utf8", env: { ...process.env, ...env } });
  return { ...result, lines: result.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line)) };
}

// An allowlist filters tools/list in registry order, but does not change the
// normal result shape for a permitted read.
{
  const result = rpc([
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "cw_list", arguments: {} } },
  ], { CW_MCP_ENABLED_TOOLS: "cw_status, cw_list, cw_list" });
  assert.equal(result.status, 0, `allowlist server exits cleanly: ${result.stderr}`);
  const listed = result.lines.find((line) => line.id === 1).result.tools.map((tool) => tool.name);
  assert.deepEqual(listed, ["cw_list", "cw_status"], "allowlist is deduped and keeps registry order");
  const call = result.lines.find((line) => line.id === 2);
  assert.equal(call.result.isError, undefined, "allowed read works");
}

// Deny wins after allow. A denied mutating call is a normal MCP isError
// result and writes no state, proving the handler was not invoked.
{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cw-mcp-authority-"));
  try {
    const result = rpc([
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "cw_schedule_create", arguments: { cwd, kind: "loop", interval: 1, prompt: "must not write" } } },
    ], { CW_MCP_ENABLED_TOOLS: "cw_schedule_create,cw_list", CW_MCP_DISABLED_TOOLS: "cw_schedule_create" });
    assert.equal(result.status, 0, `deny server exits cleanly: ${result.stderr}`);
    assert.deepEqual(result.lines.find((line) => line.id === 3).result.tools.map((tool) => tool.name), ["cw_list"], "deny removes an enabled tool");
    const denied = result.lines.find((line) => line.id === 4);
    assert.equal(denied.result.isError, true, "denied call uses the present isError form");
    assert.match(denied.result.content[0].text, /disabled by policy/i, "denied call says why");
    assert.ok(!fs.existsSync(path.join(cwd, ".cw")), "denied mutating call writes no state");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

// Empty and unknown configured names fail during startup, before any JSON-RPC
// output is made.
for (const [name, value] of [["CW_MCP_ENABLED_TOOLS", ""], ["CW_MCP_DISABLED_TOOLS", "cw_not_a_real_tool"]]) {
  const result = rpc([], { [name]: value });
  assert.notEqual(result.status, 0, `${name}=${JSON.stringify(value)} stops startup`);
  assert.equal(result.stdout, "", `${name} writes no stdout`);
  assert.match(result.stderr, /MCP tool policy/i, `${name} gives a stderr diagnostic`);
}

process.stdout.write("mcp-tool-authority-policy-smoke: ok\n");
