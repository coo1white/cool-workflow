#!/usr/bin/env node
"use strict";

// Track C: an MCP client gets a small core tool list by default, so the
// tool list does not fill its context. CW_MCP_TOOLS=full lists every tool.
// The profile decides only what tools/list shows: tools/call still takes
// every known tool, and CW_MCP_ENABLED_TOOLS / CW_MCP_DISABLED_TOOLS, when
// set, decide the list in its place.

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const mcp = path.join(root, "dist", "mcp-server.js");
const { toolDefinitions } = require(path.join(root, "dist", "mcp", "dispatch.js"));
const { MCP_CORE_TOOLS } = require(path.join(root, "dist", "core", "capability-data.js"));
const node = process.execPath;

const CORE = [
  "cw_app_list",
  "cw_app_show",
  "cw_app_run",
  "cw_run_drive_step",
  "cw_status",
  "cw_report",
  "cw_run_resume",
  "cw_run_list",
  "cw_audit_verify",
  "cw_backend_probe",
  "cw_run_export",
  "cw_run_restore",
];

function rpc(messages, env = {}) {
  const input = messages.map((message) => JSON.stringify(message)).join("\n") + "\n";
  const base = { ...process.env };
  for (const name of ["CW_MCP_TOOLS", "CW_MCP_ENABLED_TOOLS", "CW_MCP_DISABLED_TOOLS"]) delete base[name];
  const result = spawnSync(node, [mcp], { input, encoding: "utf8", env: { ...base, ...env } });
  return { ...result, lines: result.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line)) };
}

function listed(env) {
  const result = rpc([{ jsonrpc: "2.0", id: 1, method: "tools/list" }], env);
  assert.equal(result.status, 0, `server exits cleanly: ${result.stderr}`);
  return result.lines.find((line) => line.id === 1).result.tools;
}

const all = toolDefinitions();
assert.deepEqual([...MCP_CORE_TOOLS], CORE, "the core profile is the twelve named tools, in order");

// 1. Unset and `core` both list exactly the core twelve, in core order, with
// the same definitions the full list carries.
for (const env of [{}, { CW_MCP_TOOLS: "core" }]) {
  const tools = listed(env);
  assert.deepEqual(tools.map((tool) => tool.name), CORE, `default list is the core profile (${JSON.stringify(env)})`);
  for (const tool of tools) {
    assert.deepEqual(tool, all.find((entry) => entry.name === tool.name), `${tool.name}: same definition as the full list`);
  }
}

// 2. `full` lists every tool, in registry order.
{
  const tools = listed({ CW_MCP_TOOLS: "full" });
  assert.deepEqual(tools, all, "full lists every tool definition");
  assert.ok(tools.length > CORE.length, "full lists more than the core profile");
}

// 3. Any other value stops startup, before any JSON-RPC output.
for (const value of ["", "Core", "all", "cw_list"]) {
  const result = rpc([{ jsonrpc: "2.0", id: 1, method: "tools/list" }], { CW_MCP_TOOLS: value });
  assert.notEqual(result.status, 0, `CW_MCP_TOOLS=${JSON.stringify(value)} stops startup`);
  assert.equal(result.stdout, "", `CW_MCP_TOOLS=${JSON.stringify(value)} writes no stdout`);
  assert.match(result.stderr, /MCP tool policy CW_MCP_TOOLS must be core or full/, "names the variable and the good values");
}

// 4. The profile is not a permission: a tool outside it is still callable.
{
  assert.ok(!CORE.includes("cw_list"), "cw_list is outside the core profile");
  const result = rpc([{ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "cw_list", arguments: {} } }]);
  assert.equal(result.status, 0, `server exits cleanly: ${result.stderr}`);
  const call = result.lines.find((line) => line.id === 2);
  assert.equal(call.result.isError, undefined, "non-core tool call works under the default profile");
  assert.ok(Array.isArray(JSON.parse(call.result.content[0].text)), "cw_list gives its normal JSON");
}

// 5. The ENABLED / DISABLED policy decides the list; the profile is not applied.
{
  assert.deepEqual(
    listed({ CW_MCP_ENABLED_TOOLS: "cw_status,cw_list" }).map((tool) => tool.name),
    ["cw_list", "cw_status"],
    "an allowlist is listed as is, in registry order, even with a non-core tool"
  );
  assert.deepEqual(
    listed({ CW_MCP_TOOLS: "core", CW_MCP_ENABLED_TOOLS: "cw_list" }).map((tool) => tool.name),
    ["cw_list"],
    "an allowlist wins over an explicit core profile"
  );
  const denied = listed({ CW_MCP_DISABLED_TOOLS: "cw_status" }).map((tool) => tool.name);
  assert.equal(denied.length, all.length - 1, "a deny list alone lists every other tool, not the core profile");
  assert.ok(!denied.includes("cw_status"), "the denied tool is not listed");
  assert.ok(denied.includes("cw_list"), "non-core tools are listed under a deny list");
}

process.stdout.write(`mcp-tool-profile-smoke: ok (core ${CORE.length} of ${all.length} tools)\n`);
