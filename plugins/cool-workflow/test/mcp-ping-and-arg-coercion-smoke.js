#!/usr/bin/env node
"use strict";

// mcp-ping-and-arg-coercion-smoke — three fail-open/protocol fixes on the
// MCP surface, all driven over a real stdio round-trip to dist/mcp-server.js:
//
//   P2-5  `ping` is mandatory in the negotiated 2024-11-05 protocol and must
//         answer with an EMPTY result ({}), not a -32601 "Unknown method".
//   P2-4  A JSON number/boolean argument (e.g. {"runId": 5}) must NOT be
//         silently dropped (which returned a success-shaped WRONG answer);
//         it is coerced to its string form so it behaves like the CLI argv.
//   P3-16 A missing/invalid `cwd` yields the crafted "MCP cwd is not a
//         directory" isError result, never a raw ENOENT.
//
// Portable: node + child_process only, same transport a real MCP client uses.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MCP = path.join(__dirname, "..", "dist", "mcp-server.js");
assert.ok(fs.existsSync(MCP), "dist/mcp-server.js must exist (run npm run build)");

/** Send a batch of newline-delimited requests, return all parsed replies. */
function rpc(messages) {
  const input = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
  const r = spawnSync("node", [MCP], { input, encoding: "utf8" });
  return r.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// ---- P2-5: ping answers with an empty result ---------------------------
{
  const replies = rpc([{ jsonrpc: "2.0", id: 7, method: "ping" }]);
  const ping = replies.find((m) => m.id === 7);
  assert.ok(ping, "server must reply to ping");
  assert.equal(ping.error, undefined, "ping must not be a -32601 error");
  assert.deepEqual(ping.result, {}, "ping must answer with an empty result object");
}

// ---- P2-5: a ping notification (no id) gets NO reply -------------------
{
  // Pair the notification with a following id'd ping so we can prove the
  // notification produced no line of its own (only the second reply exists).
  const replies = rpc([
    { jsonrpc: "2.0", method: "ping" },
    { jsonrpc: "2.0", id: 9, method: "ping" },
  ]);
  const withId = replies.filter((m) => m.id === 9);
  assert.equal(withId.length, 1, "the id'd ping is answered exactly once");
  assert.equal(replies.filter((m) => !("id" in m)).length, 0, "a ping notification (no id) gets no reply");
}

// ---- P2-4: a numeric runId is coerced, not silently dropped ------------
{
  // {"runId": 5} used to be dropped by optionalString, so cw_status returned
  // the "no run yet" payload. After coercion it looks up run "5" and honestly
  // reports it not found — never the misleading "create a run first" shape.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cw-mcp-coerce-"));
  const replies = rpc([{ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "cw_status", arguments: { runId: 5, cwd } } }]);
  const status = replies.find((m) => m.id === 3);
  assert.ok(status, "server must reply to cw_status");
  const text = status.result.content[0].text;
  assert.ok(/not found|Run not found/i.test(text) || status.result.isError, `a numeric runId must be treated as run id "5" (honest not-found), got: ${text}`);
  assert.ok(!/no run yet|create one|cw plan <workflow-id>/i.test(text), "a numeric runId must NOT be dropped into the 'you have no run' payload");
}

// ---- P3-16: a missing cwd yields the crafted message, not a raw ENOENT --
{
  const missing = path.join(os.tmpdir(), "cw-definitely-no-such-dir-xyz-123");
  const replies = rpc([{ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "cw_list", arguments: { cwd: missing } } }]);
  const listed = replies.find((m) => m.id === 4);
  assert.ok(listed, "server must reply to cw_list");
  assert.equal(listed.result.isError, true, "a missing cwd is an isError result");
  const text = listed.result.content[0].text;
  assert.match(text, /MCP cwd is not a directory/, "missing cwd yields the crafted message");
  assert.ok(!/ENOENT/.test(text), "missing cwd must not leak a raw ENOENT");
  assert.ok(text.includes(missing), "the crafted message names the resolved cwd");
}

// ---- P3-16: a non-string cwd is coerced then validated ----------------
{
  const replies = rpc([{ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "cw_list", arguments: { cwd: 12345 } } }]);
  const listed = replies.find((m) => m.id === 5);
  assert.ok(listed, "server must reply");
  assert.equal(listed.result.isError, true, "a numeric cwd (coerced to \"12345\") is not a directory -> isError");
  assert.match(listed.result.content[0].text, /MCP cwd is not a directory/, "numeric cwd is validated, not silently skipped");
}

process.stdout.write("mcp-ping-and-arg-coercion-smoke: ok\n");
