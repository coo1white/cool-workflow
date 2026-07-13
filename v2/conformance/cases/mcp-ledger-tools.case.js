#!/usr/bin/env node
"use strict";

// mcp ledger tools — a repo-free, deterministic slice of the tool set
// that exercises edge cases the spec calls out explicitly: verdict is
// upper-cased and restricted to APPROVED/REJECTED, and cw_ledger_verify
// fails closed with an exact digest-mismatch code on a tampered entry.
// Also covers a required-argument OR-group ("keyA|keyB").

const { freshDir, caseMain, assert } = require("../lib");
const { startServer, serverPathFor } = require("./fixtures/mcp-client");

const CW_BIN = process.env.CW_BIN;

caseMain(async () => {
  const serverPath = serverPathFor(CW_BIN);
  const home = freshDir("mcp-home");
  const client = startServer(serverPath, { home });
  try {
    client.send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "cw_ledger_propose", arguments: { from: "agentA", to: "agentB", title: "t", rationale: "r" } },
    });
    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "cw_ledger_review", arguments: { from: "agentB", to: "agentA", target: "ldg-xyz", verdict: "approved" } },
    });
    client.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "cw_ledger_review", arguments: { from: "agentB", to: "agentA", target: "ldg-xyz", verdict: "sideways" } },
    });

    const [propose, review, badVerdict] = await client.waitForCount(3, 10000);

    const proposeEntry = JSON.parse(propose.result.content[0].text);
    assert.equal(proposeEntry.kind, "proposal");
    assert.equal(proposeEntry.from, "agentA");
    assert.equal(proposeEntry.to, "agentB");
    assert.match(proposeEntry.id, /^ldg-/);
    assert.match(proposeEntry.digest, /^sha256:[0-9a-f]{64}$/);

    const reviewEntry = JSON.parse(review.result.content[0].text);
    assert.equal(reviewEntry.verdict, "APPROVED", "verdict must be upper-cased");

    // A bad verdict is a tools/call OUTCOME, not a broken request, so it
    // comes back as a normal result shaped isError: true, not a bare
    // JSON-RPC error. This message matches no recoveryHint branch, so
    // there is no "Try:" line.
    assert.equal(badVerdict.error, undefined, "a failed tools/call is a result, not an error");
    assert.deepEqual(badVerdict.result, {
      content: [{ type: "text", text: 'verdict must be "approved" or "rejected".' }],
      isError: true,
    });

    // cw_ledger_verify: entry must round-trip through the tool as the
    // parsed OBJECT the propose call handed back (not a JSON string).
    client.send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "cw_ledger_verify", arguments: { entry: proposeEntry } } });
    const tampered = Object.assign({}, proposeEntry, { title: "TAMPERED" });
    client.send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "cw_ledger_verify", arguments: { entry: tampered } } });

    const [verifyGood, verifyTampered] = await client.waitForCount(2, 10000);

    const goodResult = JSON.parse(verifyGood.result.content[0].text);
    assert.equal(goodResult.ok, true);
    assert.equal(goodResult.id, proposeEntry.id);
    assert.equal(goodResult.failedChecks.length, 0);

    const tamperedResult = JSON.parse(verifyTampered.result.content[0].text);
    assert.equal(tamperedResult.ok, false, "a tampered entry must fail verification");
    const digestCheck = tamperedResult.failedChecks.find((c) => c.name === "digest");
    assert.ok(digestCheck, "digest check must be a reported failure");
    assert.equal(digestCheck.code, "ledger-digest-mismatch");

    // Required-argument OR-group: cw_topology_show needs topologyId|id.
    // A missing required argument is a tools/call OUTCOME, so this comes
    // back as a normal result shaped isError: true, not a bare JSON-RPC
    // error. This message matches no recoveryHint branch, so there is no
    // "Try:" line.
    client.send({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "cw_topology_show", arguments: {} } });
    const [missingOrGroup] = await client.waitForCount(1, 10000);
    assert.equal(missingOrGroup.error, undefined, "a failed tools/call is a result, not an error");
    assert.equal(missingOrGroup.result.isError, true);
    assert.equal(
      missingOrGroup.result.content[0].text,
      "MCP tool cw_topology_show missing required argument: topologyId or id",
    );
  } finally {
    client.close();
  }
});
