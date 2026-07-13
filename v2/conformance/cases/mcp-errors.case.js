#!/usr/bin/env node
"use strict";

// mcp errors — JSON-RPC framing edge cases and exact error text: unknown
// method (with and without an id), a bad-JSON line, a non-object JSON
// line, and a request with "id": null (still gets an answer, unlike a
// true notification with no "id" key at all) are all envelope-level
// problems and stay real -32xxx JSON-RPC errors. An unknown tool name,
// a missing/blank tool name, and a missing required argument are all
// tools/call OUTCOMES, so each of those instead comes back as a normal
// result shaped isError: true (see ITERATION_LOG.md "return a failed
// MCP tools/call as a normal isError result") — except a missing/blank
// tool name, which is a broken request (no tool was ever named to call)
// and so still answers -32000, same as before.

const { freshDir, caseMain, assert } = require("../lib");
const { startServer, serverPathFor } = require("./fixtures/mcp-client");

const CW_BIN = process.env.CW_BIN;

caseMain(async () => {
  const serverPath = serverPathFor(CW_BIN);
  const home = freshDir("mcp-home");
  const client = startServer(serverPath, { home });
  try {
    // 1: unknown method, has an id -> -32601 error with that id.
    client.send({ jsonrpc: "2.0", id: 10, method: "foo/bar", params: {} });
    // 2: unknown method, NO "id" key at all -> a true notification, no answer.
    client.sendRaw(JSON.stringify({ jsonrpc: "2.0", method: "foo/bar-notify", params: {} }));
    // 3: unknown tool name.
    client.send({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "cw_does_not_exist", arguments: {} } });
    // 4: tools/call with no params at all -> missing required field: name.
    client.send({ jsonrpc: "2.0", id: 12, method: "tools/call" });
    // 5: required argument missing (cw_status needs runId).
    client.send({ jsonrpc: "2.0", id: 13, method: "tools/call", params: { name: "cw_status", arguments: {} } });
    // 6: a line that is not valid JSON at all.
    client.sendRaw("{not json");
    // 7: valid JSON but not an object (a bare number).
    client.sendRaw("42");
    // 8: "id": null with an unknown method DOES get an answer, with id:null.
    client.send({ jsonrpc: "2.0", id: null, method: "foo/baz", params: {} });
    // 9: tool name present but blank/whitespace-only.
    client.send({ jsonrpc: "2.0", id: 14, method: "tools/call", params: { name: "   ", arguments: {} } });

    // 9 sends, but #2 is a true notification with no reply -> 8 reply lines.
    const replies = await client.waitForCount(8, 10000);

    assert.deepEqual(replies[0], {
      jsonrpc: "2.0",
      id: 10,
      error: { code: -32601, message: "Unknown method: foo/bar" },
    });

    // An unknown tool name is a tools/call OUTCOME, not a broken request,
    // so it comes back as a normal result shaped isError: true. This
    // message matches no recoveryHint branch, so there is no "Try:" line.
    assert.deepEqual(replies[1], {
      jsonrpc: "2.0",
      id: 11,
      result: { content: [{ type: "text", text: "Unknown tool: cw_does_not_exist" }], isError: true },
    });

    // No tool name at all is a broken request (nothing was ever named to
    // call), so this stays a real -32000 JSON-RPC error, unchanged.
    assert.deepEqual(replies[2], {
      jsonrpc: "2.0",
      id: 12,
      error: { code: -32000, message: "MCP tools/call missing required field: name" },
    });

    // A missing required tool argument is a tools/call OUTCOME, so it
    // comes back as a normal result shaped isError: true. This message
    // matches no recoveryHint branch, so there is no "Try:" line.
    assert.deepEqual(replies[3], {
      jsonrpc: "2.0",
      id: 13,
      result: { content: [{ type: "text", text: "MCP tool cw_status missing required argument: runId" }], isError: true },
    });

    // Bad-JSON line: -32700, id is null (even though no id was ever sent for this line).
    assert.equal(replies[4].jsonrpc, "2.0");
    assert.equal(replies[4].id, null);
    assert.equal(replies[4].error.code, -32700);
    assert.match(replies[4].error.message, /^Parse error: /);

    // Non-object JSON (a bare number): -32600 Invalid Request.
    assert.deepEqual(replies[5], {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request: not a JSON-RPC object" },
    });

    // "id": null with an unknown method: still answered, with id:null (not omitted).
    assert.deepEqual(replies[6], {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32601, message: "Unknown method: foo/baz" },
    });

    // Blank tool name is treated the same as missing.
    assert.deepEqual(replies[7], {
      jsonrpc: "2.0",
      id: 14,
      error: { code: -32000, message: "MCP tools/call missing required field: name" },
    });
  } finally {
    client.close();
  }
});
