#!/usr/bin/env node
"use strict";

// mcp cwd + payload identity — args.cwd is resolved, must be a real
// directory (else a crafted "MCP cwd is not a directory" isError:true
// result, not a bare JSON-RPC error and not a raw ENOENT), and is used to
// re-base the runner so a relative-path capability acts on the right repo,
// not the server's own process cwd. Also pins that a payload for a
// "both"-surface capability (cw_status) is byte-identical to the same
// command's `cw status --json`, run over a real run built with the
// deterministic stub agent (plan->dispatch->result->verify->commit).

const path = require("node:path");
const { run, gitRepo, freshDir, caseMain, assert, stubAgentEnv } = require("../lib");
const { startServer, serverPathFor } = require("./fixtures/mcp-client");

const CW_BIN = process.env.CW_BIN;

caseMain(async () => {
  // A missing cwd: a crafted "not a directory" message comes back as an
  // isError:true result (not a bare -32000 JSON-RPC error, and not a raw
  // ENOENT — the crafted message is what the recovery-hint matcher keys on).
  const serverPath = serverPathFor(CW_BIN);
  const home = freshDir("mcp-home");
  const client = startServer(serverPath, { home });
  try {
    const missingDir = path.join(home, "no-such-subdir");
    client.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "cw_list", arguments: { cwd: missingDir } } });
    const [badCwd] = await client.waitForCount(1, 10000);
    assert.equal(badCwd.error, undefined, "a failed tools/call is a result, not an error");
    assert.equal(badCwd.result.isError, true);
    const badCwdText = badCwd.result.content[0].text;
    assert.match(badCwdText, /MCP cwd is not a directory/);
    assert.ok(!/ENOENT/.test(badCwdText), "a missing cwd yields the crafted message, not a raw ENOENT");
    assert.ok(badCwdText.includes(missingDir), "error must name the resolved cwd");

    // A real run, built through the CLI with the deterministic stub agent.
    const repo = gitRepo({ "a.txt": "hello\n" });
    const runResult = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
    assert.equal(runResult.status, 0);
    const runPayload = JSON.parse(runResult.stdout);
    const runId = runPayload.runId;
    assert.ok(runId, "run must produce a runId");

    // cw_status with an ABSENT runId: loadRunFromCwd's "Run not found: <id>"
    // (shell/run-store.ts) names the run, not a raw filesystem path — actual
    // cwd re-basing (that this looked under `repo`, not the server's own
    // cwd) is proven conclusively below instead, by round-tripping a REAL
    // run that only exists under `repo`. This message also matches the
    // "run not found" recoveryHint branch, so a "Try: cw run list" line
    // is appended.
    client.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "cw_status", arguments: { runId: "not-a-real-run", cwd: repo } } });
    const [notFound] = await client.waitForCount(1, 10000);
    assert.equal(notFound.error, undefined, "a failed tools/call is a result, not an error");
    assert.equal(notFound.result.isError, true);
    const notFoundText = notFound.result.content[0].text;
    assert.ok(notFoundText.includes("Run not found: not-a-real-run"), "error must name the missing run id");
    assert.ok(notFoundText.includes("Try: cw run list"), "error should carry the run-not-found recovery hint");

    // cw_status against the REAL run: payload must be byte-identical
    // (aside from generation-moment fields there are none here) to the
    // CLI's own `cw status <id> --json`.
    const cliStatus = run(["status", runId, "--json"], { cwd: repo });
    assert.equal(cliStatus.status, 0);
    const cliJson = JSON.parse(cliStatus.stdout);

    client.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "cw_status", arguments: { runId, cwd: repo } } });
    const [mcpStatus] = await client.waitForCount(1, 10000);
    assert.equal(typeof mcpStatus.result.content[0].text, "string");
    const mcpJson = JSON.parse(mcpStatus.result.content[0].text);
    assert.deepEqual(mcpJson, cliJson, "cw_status payload must equal cw status --json exactly");
    assert.equal(mcpJson.runId, runId);

    // cw_worker_summary similarly round-trips against the CLI's --json.
    const cliWorkerSummary = run(["worker", "summary", runId, "--json"], { cwd: repo });
    assert.equal(cliWorkerSummary.status, 0);
    const cliWorkerJson = JSON.parse(cliWorkerSummary.stdout);

    client.send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "cw_worker_summary", arguments: { runId, cwd: repo } } });
    const [mcpWorkerSummary] = await client.waitForCount(1, 10000);
    const mcpWorkerJson = JSON.parse(mcpWorkerSummary.result.content[0].text);
    assert.deepEqual(mcpWorkerJson, cliWorkerJson, "cw_worker_summary payload must equal cw worker summary --json exactly");
  } finally {
    client.close();
  }
});
