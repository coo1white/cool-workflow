#!/usr/bin/env node
"use strict";

// mcp-protocol-version-smoke — proves `initialize` now negotiates the
// protocol version instead of hard-coding it:
//   - a client that asks for a SUPPORTED version (today only
//     "2024-11-05") gets that exact version echoed back;
//   - a client that asks for an UNKNOWN version falls back to the newest
//     supported entry ("2024-11-05");
//   - a client that sends no protocolVersion at all (the conformance
//     suite's own initialize shape) gets the same fallback — so the old
//     pinned reply is unchanged.
//
// Portable: node + child_process only. Talks to the real
// dist/mcp-server.js over stdio, the same transport a real MCP client
// uses (same harness shape as mcp-tool-call-error-isresult-smoke.js).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MCP = path.join(__dirname, "..", "dist", "mcp-server.js");
assert.ok(fs.existsSync(MCP), "dist/mcp-server.js must exist (run npm run build)");

/** Sends one initialize request with the given params over a real stdio
 *  round-trip and returns the parsed reply line. */
function initialize(params) {
  const input = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params })}\n`;
  const r = spawnSync("node", [MCP], { input, encoding: "utf8" });
  const lines = r.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const line = lines.find((m) => m.id === 1);
  assert.ok(line, `MCP must reply to the initialize request: stdout=${r.stdout} stderr=${r.stderr}`);
  return line;
}

// ---- 1. A supported requested version is echoed back exactly. ----------
{
  const line = initialize({ protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0.0.0" } });
  assert.ok(!line.error, `initialize must not error: ${JSON.stringify(line.error)}`);
  assert.equal(line.result.protocolVersion, "2024-11-05", "a supported requested version must be echoed back");
  assert.deepEqual(line.result.capabilities, { tools: {} }, "capabilities shape must be unchanged");
  assert.equal(line.result.serverInfo.name, "cool-workflow", "serverInfo shape must be unchanged");
}

// ---- 2. An unknown requested version falls back to the newest
// supported entry. --------------------------------------------------------
{
  const line = initialize({ protocolVersion: "2099-01-01", capabilities: {}, clientInfo: { name: "smoke", version: "0.0.0" } });
  assert.ok(!line.error, `initialize must not error: ${JSON.stringify(line.error)}`);
  assert.equal(line.result.protocolVersion, "2024-11-05", "an unknown requested version must fall back to the newest supported entry");
}

// ---- 3. No requested version at all (empty params) keeps the old pinned
// reply byte-for-byte — the same initialize shape the conformance suite's
// mcp-basic.case.js sends. -----------------------------------------------
{
  const line = initialize({});
  assert.ok(!line.error, `initialize must not error: ${JSON.stringify(line.error)}`);
  assert.equal(line.result.protocolVersion, "2024-11-05", "no requested version must keep the old pinned reply");
}

// ---- 4. A non-string protocolVersion (bad client input) also falls back
// instead of echoing junk or crashing. ------------------------------------
{
  const line = initialize({ protocolVersion: 42 });
  assert.ok(!line.error, `initialize must not error: ${JSON.stringify(line.error)}`);
  assert.equal(line.result.protocolVersion, "2024-11-05", "a non-string requested version must fall back");
}

// ---- 5. The pure negotiation function itself. With today's one-entry
// supported list the stdio checks above are byte-identical to the old
// hard-coded reply, so THIS is the part that fails on a build without the
// negotiation mechanism (the export did not exist before). ---------------
{
  const { negotiateProtocolVersion } = require("../dist/mcp/server");
  assert.equal(typeof negotiateProtocolVersion, "function", "mcp/server must export negotiateProtocolVersion");
  assert.equal(negotiateProtocolVersion("2024-11-05"), "2024-11-05", "a supported version is echoed");
  assert.equal(negotiateProtocolVersion("2099-01-01"), "2024-11-05", "an unknown version falls back");
  assert.equal(negotiateProtocolVersion(undefined), "2024-11-05", "a missing version falls back");
  assert.equal(negotiateProtocolVersion(42), "2024-11-05", "a non-string version falls back");
}

process.stdout.write("mcp-protocol-version-smoke: ok\n");
