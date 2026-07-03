#!/usr/bin/env node
"use strict";

// mcp cwd + payload identity — args.cwd is resolved, must be a real
// directory (else the raw ENOENT bubbles up as -32000), and is used to
// re-base the runner so a relative-path capability acts on the right
// repo, not the server's own process cwd. Also pins that a payload for
// a "both"-surface capability (cw_status) is byte-identical to the
// same command's `cw status --json`, run over a real run built with
// the deterministic stub agent (plan->dispatch->result->verify->commit).

const path = require("node:path");
const { run, gitRepo, freshDir, caseMain, assert, stubAgentEnv } = require("../lib");
const { startServer, serverPathFor } = require("./fixtures/mcp-client");

const CW_BIN = process.env.CW_BIN;

caseMain(async () => {
  // A missing cwd: the raw ENOENT should surface through -32000.
  const serverPath = serverPathFor(CW_BIN);
  const home = freshDir("mcp-home");
  const client = startServer(serverPath, { home });
  try {
    const missingDir = path.join(home, "no-such-subdir");
    client.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "cw_list", arguments: { cwd: missingDir } } });
    const [badCwd] = await client.waitForCount(1, 10000);
    assert.equal(badCwd.error.code, -32000);
    assert.match(badCwd.error.message, /ENOENT/);
    assert.ok(badCwd.error.message.includes(missingDir), "error must name the resolved cwd");

    // A real run, built through the CLI with the deterministic stub agent.
    const repo = gitRepo({ "a.txt": "hello\n" });
    const runResult = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
    assert.equal(runResult.status, 0);
    const runPayload = JSON.parse(runResult.stdout);
    const runId = runPayload.runId;
    assert.ok(runId, "run must produce a runId");

    // cw_status with an ABSENT runId in an empty repo, using cwd re-basing:
    // must be "not found" against the repo path, not the server's own cwd.
    client.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "cw_status", arguments: { runId: "not-a-real-run", cwd: repo } } });
    const [notFound] = await client.waitForCount(1, 10000);
    assert.equal(notFound.error.code, -32000);
    assert.ok(
      notFound.error.message.includes(path.join(repo, ".cw", "runs", "not-a-real-run", "state.json")),
      "error must name the re-based path under the given cwd, not the server cwd"
    );

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
