#!/usr/bin/env node
"use strict";

// mcplinecap oversize line — the MCP stdin line-size cap. Per mcp.md:
// "the unconsumed stdin buffer is capped at MAX_LINE_BYTES = 16 * 1024
// * 1024; when it goes over with no newline, the partial bytes are
// dropped and a -32700 error with the exact text 'Parse error: request
// line exceeds 16777216 bytes' is sent with id: null."
//
// This sends a single "line" (no newline anywhere in it) one byte over
// the cap, confirms the server answers with the exact documented
// refusal instead of hanging/crashing/truncating silently, and then
// confirms the connection is still alive and framing correctly by
// sending a real newline plus a normal request right after.
//
// Measured wall-clock for this exact scenario (one-off, local runs):
// the oversize refusal arrives in ~0.5s (well under the suite's 60s
// per-case default timeout), so this is not a "too slow" gap — it is
// closed here as a normal case.

const { freshDir, caseMain, assert } = require("../lib");
const { startServer, serverPathFor } = require("./fixtures/mcp-client-rawstdin");

const CW_BIN = process.env.CW_BIN;
const MAX_LINE_BYTES = 16 * 1024 * 1024;

caseMain(async () => {
  const serverPath = serverPathFor(CW_BIN);
  const home = freshDir("mcp-home");
  const client = startServer(serverPath, { home });
  try {
    const start = Date.now();

    // One byte over the cap, no newline anywhere in the write.
    const oversize = Buffer.alloc(MAX_LINE_BYTES + 1, "a".charCodeAt(0));
    client.writeRaw(oversize);

    const [refusal] = await client.waitForCount(1, 20000);
    const elapsedMs = Date.now() - start;

    assert.ok(elapsedMs < 20000, `oversize-line refusal took too long: ${elapsedMs}ms`);

    assert.equal(refusal.jsonrpc, "2.0");
    assert.equal(refusal.id, null, "oversize-line refusal must carry id: null");
    assert.equal(refusal.error.code, -32700);
    assert.equal(
      refusal.error.message,
      "Parse error: request line exceeds 16777216 bytes",
      "exact oversize-line refusal text from mcp.md"
    );

    // The dropped oversize bytes had no newline, so nothing else should
    // have been queued as a line yet. Now send a trailing newline (a
    // now-empty line, since the oversize buffer was dropped) plus a
    // normal well-formed request, and confirm the server is still
    // alive and frames correctly afterward — no hang, no crash, no
    // corrupted subsequent parsing.
    client.writeRaw("\n");
    client.send({ jsonrpc: "2.0", id: 900, method: "initialize", params: {} });

    const after = await client.waitForCount(1, 10000);
    const initReply = after.find((r) => r.id === 900) || after[after.length - 1];

    assert.equal(initReply.jsonrpc, "2.0");
    assert.equal(initReply.id, 900);
    assert.equal(initReply.result.protocolVersion, "2024-11-05");
    assert.equal(initReply.result.serverInfo.name, "cool-workflow");

    // A line more than TWICE the cap must still yield EXACTLY ONE -32700,
    // not one per 16MB crossed (the discard flag suppresses the duplicates).
    // Proof by ordering: consume the single refusal, then terminate the line
    // and send a normal request — the VERY NEXT reply must be that request's
    // answer (id 901). A buggy build that emitted a second -32700 would put
    // an extra id:null error line here instead.
    const doubleOversize = Buffer.alloc(MAX_LINE_BYTES * 2 + 1, "b".charCodeAt(0));
    client.writeRaw(doubleOversize);
    const [secondRefusal] = await client.waitForCount(1, 20000);
    assert.equal(secondRefusal.error.code, -32700, "an over-2x line still refuses with -32700");
    client.writeRaw("\n");
    client.send({ jsonrpc: "2.0", id: 901, method: "initialize", params: {} });
    const [nextReply] = await client.waitForCount(1, 10000);
    assert.equal(nextReply.id, 901, "the next reply is the follow-up request, not a duplicate -32700 (exactly one error per oversize line)");
    assert.equal(nextReply.result.serverInfo.name, "cool-workflow", "the server still frames a normal request after a >2x oversize line");
  } finally {
    client.close();
  }
});
