#!/usr/bin/env node
"use strict";

// mcp-tool-call-error-isresult-smoke — proves a failed MCP tools/call
// (unknown tool, missing required argument, or the tool's own handler
// throwing) comes back as a normal JSON-RPC RESULT shaped
// { content: [...], isError: true } — not a bare -32000 JSON-RPC protocol
// error. Many MCP hosts never surface a protocol error back to the calling
// model, so the model could not read the message or try again; a normal
// result with isError: true is always visible to the model.
//
// Also checks that:
//   - the second line, "Try: <hint>", is appended ONLY when
//     core/format/recovery-hint.ts's recoveryHint finds one for that exact
//     message (it does not for every failure — it returns undefined rather
//     than a wrong guess, so some isError results carry no hint at all);
//   - the envelope-level "tools/call missing required field: name" check
//     is UNCHANGED — it still answers a real -32000 JSON-RPC error, because
//     a malformed request is not a tool-call outcome;
//   - the success path is UNCHANGED — no top-level error, no isError key.
//
// Portable: node + child_process only. Talks to the real
// dist/mcp-server.js over stdio, the same transport a real MCP client uses.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MCP = path.join(__dirname, "..", "dist", "mcp-server.js");
assert.ok(fs.existsSync(MCP), "dist/mcp-server.js must exist (run npm run build)");

/** Sends one initialize + one other request over a real stdio round-trip,
 *  returns the parsed reply line for the second request (by its id). */
function callOnce(method, params) {
  const input =
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n` +
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, method, params })}\n`;
  const r = spawnSync("node", [MCP], { input, encoding: "utf8" });
  const lines = r.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const line = lines.find((m) => m.id === 2);
  assert.ok(line, `MCP must reply to request id 2: stdout=${r.stdout} stderr=${r.stderr}`);
  return line;
}

// ---- 1. Missing required argument: cw_status with an EMPTY arguments
// object (missing the required `runId`) is a normal result, isError: true,
// with the exact handler message. No "Try:" line — the message
// ("MCP tool cw_status missing required argument: runId") does not match
// any of recoveryHint's patterns, so no hint exists to append. -----------
{
  const line = callOnce("tools/call", { name: "cw_status", arguments: {} });
  assert.ok(!line.error, `cw_status with a missing required argument must not be a JSON-RPC error: ${JSON.stringify(line.error)}`);
  assert.ok(line.result, "a result must be present");
  assert.equal(line.result.isError, true, "result.isError must be true");
  assert.equal(line.result.content.length, 1, "exactly one content block");
  assert.equal(line.result.content[0].type, "text");
  assert.equal(
    line.result.content[0].text,
    "MCP tool cw_status missing required argument: runId",
    "content[0].text must be the exact handler message, with no Try: line (no hint matches it)"
  );
}

// ---- 2. Unknown tool name is a normal result, isError: true, with the
// exact "Unknown tool: <name>" message. No "Try:" line either (this
// message does not match any recoveryHint pattern). -----------------------
{
  const line = callOnce("tools/call", { name: "cw_totally_bogus_tool_xyz", arguments: {} });
  assert.ok(!line.error, `an unknown tool must not be a JSON-RPC error: ${JSON.stringify(line.error)}`);
  assert.equal(line.result.isError, true);
  assert.equal(line.result.content.length, 1);
  assert.equal(line.result.content[0].text, "Unknown tool: cw_totally_bogus_tool_xyz");
}

// ---- 3. A tool handler's own thrown error is ALSO a normal result,
// isError: true — and here the message DOES match a recoveryHint pattern
// ("app" + "not found"), so the text carries a real "Try: cw app list"
// recovery line, proving the hint mechanism works end-to-end. ------------
{
  const line = callOnce("tools/call", { name: "cw_app_show", arguments: { appId: "totally-bogus-app-xyz" } });
  assert.ok(!line.error, `a handler's own error must not be a JSON-RPC error: ${JSON.stringify(line.error)}`);
  assert.equal(line.result.isError, true);
  assert.equal(line.result.content.length, 1);
  assert.equal(
    line.result.content[0].text,
    "Workflow app not found: totally-bogus-app-xyz\nTry: cw app list",
    "content[0].text must carry the handler message plus a Try: line when recoveryHint finds a match"
  );
}

// ---- 4. The envelope-level "missing field: name" check is UNCHANGED — a
// tools/call with no `name` at all is a malformed request, not a tool-call
// outcome, and still answers a real -32000 JSON-RPC error (not a result).
{
  const line = callOnce("tools/call", {});
  assert.ok(!line.result, "a missing-name request must not be a normal result");
  assert.ok(line.error, "a missing-name request must still be a JSON-RPC error");
  assert.equal(line.error.code, -32000);
  assert.equal(line.error.message, "MCP tools/call missing required field: name");
}

// ---- 5. The success path is UNCHANGED — a working tools/call has no
// top-level error and no isError key on the result at all.
{
  const line = callOnce("tools/call", { name: "cw_list", arguments: {} });
  assert.ok(!line.error, "a successful tools/call must not be a JSON-RPC error");
  assert.equal(line.result.isError, undefined, "a successful result must carry no isError key");
  assert.ok(Array.isArray(line.result.content) && line.result.content.length >= 1, "a successful result must still carry content");
}

process.stdout.write("mcp-tool-call-error-isresult-smoke: ok\n");
