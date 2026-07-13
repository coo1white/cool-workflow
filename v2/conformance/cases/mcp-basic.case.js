#!/usr/bin/env node
"use strict";

// mcp basic — the JSON-RPC stdio server: initialize, tools/list, and
// tools/call for a few read-only tools. Confirms the wrapping shape
// (content[0].text is a pretty-printed JSON STRING, not a raw object)
// and a stable, non-empty tool set with input schemas.

const { freshDir, caseMain, assert } = require("../lib");
const { startServer, serverPathFor } = require("./fixtures/mcp-client");

const CW_BIN = process.env.CW_BIN;

caseMain(async () => {
  const serverPath = serverPathFor(CW_BIN);
  const home = freshDir("mcp-home");
  const client = startServer(serverPath, { home });
  try {
    client.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    client.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    client.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "cw_list", arguments: {} } });
    client.send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "cw_sandbox_list", arguments: { cwd: home } } });

    const [init, list, callList, callSandbox] = await client.waitForCount(4, 10000);

    // initialize
    assert.equal(init.jsonrpc, "2.0");
    assert.equal(init.id, 1);
    assert.deepEqual(init.result.protocolVersion, "2024-11-05");
    assert.deepEqual(init.result.capabilities, { tools: {} });
    assert.equal(init.result.serverInfo.name, "cool-workflow");
    assert.match(init.result.serverInfo.version, /^\d+\.\d+\.\d+$/);

    // tools/list — stable, non-empty, every entry has a schema
    assert.equal(list.id, 2);
    const tools = list.result.tools;
    assert.ok(Array.isArray(tools) && tools.length > 0, "tools/list must return a non-empty array");
    assert.ok(tools.length >= 100, "tool set should be large (196 in the spec snapshot)");

    const byName = new Map(tools.map((t) => [t.name, t]));
    assert.ok(byName.has("cw_list"), "cw_list must be in the tool set");
    assert.ok(byName.has("cw_status"), "cw_status must be in the tool set");
    assert.ok(byName.has("cw_sandbox_list"), "cw_sandbox_list must be in the tool set");

    // First tool is cw_list, per the source order of toolDefinitions().
    assert.equal(tools[0].name, "cw_list");

    // Every tool: a name, a non-empty description, and a valid input schema.
    for (const t of tools) {
      assert.equal(typeof t.name, "string");
      assert.ok(t.name.length > 0);
      assert.equal(typeof t.description, "string");
      assert.ok(t.description.length > 0, `${t.name} must have a description`);
      assert.equal(t.inputSchema.type, "object");
      assert.equal(typeof t.inputSchema.properties, "object");
      assert.equal(t.inputSchema.additionalProperties, true);
    }

    // No duplicate tool names.
    assert.equal(new Set(tools.map((t) => t.name)).size, tools.length, "tool names must be unique");

    assert.deepEqual(byName.get("cw_list").inputSchema, {
      type: "object",
      properties: {},
      additionalProperties: true,
    });

    // Behavior-hint annotations: a checked pure read carries readOnlyHint
    // true, a checked delete sweep carries destructiveHint true, and a
    // tool not checked by hand has NO annotations key at all.
    assert.deepEqual(byName.get("cw_node_list").annotations, { readOnlyHint: true }, "cw_node_list must be marked read-only");
    assert.deepEqual(
      byName.get("cw_gc_run").annotations,
      { readOnlyHint: false, destructiveHint: true },
      "cw_gc_run must be marked destructive"
    );
    assert.ok(!("annotations" in byName.get("cw_plan")), "cw_plan must carry no annotations key");

    // tools/call — content[0].text is a STRING holding pretty JSON, not a raw object.
    assert.equal(callList.id, 3);
    const listContent = callList.result.content;
    assert.ok(Array.isArray(listContent) && listContent.length === 1);
    assert.equal(listContent[0].type, "text");
    assert.equal(typeof listContent[0].text, "string");
    const listPayload = JSON.parse(listContent[0].text);
    assert.ok(Array.isArray(listPayload), "cw_list payload must be an array");
    assert.ok(listPayload.length > 0);
    for (const wf of listPayload) {
      assert.equal(typeof wf.id, "string");
      assert.equal(typeof wf.title, "string");
    }
    // 2-space pretty print, not a compact single-line dump.
    assert.ok(listContent[0].text.startsWith("[\n  {\n"), "text must be 2-space pretty-printed JSON");

    assert.equal(callSandbox.id, 4);
    const sandboxText = callSandbox.result.content[0].text;
    assert.equal(typeof sandboxText, "string");
    const sandboxPayload = JSON.parse(sandboxText);
    assert.ok(Array.isArray(sandboxPayload));
    const sandboxIds = sandboxPayload.map((p) => p.id);
    assert.ok(sandboxIds.includes("default"), "sandbox.list must include the default profile");
    for (const profile of sandboxPayload) {
      assert.equal(profile.schemaVersion, 1);
      assert.equal(typeof profile.id, "string");
      assert.equal(typeof profile.title, "string");
    }
  } finally {
    client.close();
  }
});
