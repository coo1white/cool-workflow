#!/usr/bin/env node
"use strict";
// @cw-smoke: tags fast

// mcp-queue-epipe-smoke — two robustness bugs in the MCP stdio server, both
// tied to a raw stdout write that fails part-way through a reply.
//
// FINDING 1 (queue poisoning): mcp/server.ts's startServer chains every
// request through one promise (`queue = queue.then(() => handleLine(line))`)
// so replies keep arrival order. With NO per-task rejection handler, ONE
// step that rejects (a raw `process.stdout.write` that throws mid-reply —
// the client closed the pipe, a serialize error, etc.) leaves `queue`
// PERMANENTLY rejected: every `.then` after it is skipped, so the server
// goes silent and never answers another request. The fix adds a per-task
// `.catch` that logs the one failure to stderr and keeps `queue` resolved,
// so later requests are still served.
//
// FINDING 2 (no EPIPE guard on the MCP entry): mcp-server.ts started the
// loop with no broken-pipe guard. When an MCP client closes the read end of
// our stdout mid-reply, the raw write gives an async 'error' event that no
// promise `.catch` can see; with no listener Node comes down hard with a
// `write EPIPE` stack and exit 1. cli/entry.ts's `main()` already guards its
// own writes this way; the MCP entry now does the same (a copy, not an
// import — the purity gate forbids an mcp/ file importing cli/), so a client
// that goes away mid-reply makes the server stop QUIETLY with exit 0.
//
// Both are driven against the REAL built server over stdio, the transport a
// real MCP client uses. Portable: node only, isolated tmpdir.
//
// Included in `npm test` (auto-discovered as a *-smoke.js file).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const MCP_ENTRY = path.join(pluginRoot, "dist", "mcp-server.js");
const MCP_LOOP = path.join(pluginRoot, "dist", "mcp", "server.js");
const node = process.execPath;

assert.ok(fs.existsSync(MCP_ENTRY), "dist/mcp-server.js must exist (run npm run build)");
assert.ok(fs.existsSync(MCP_LOOP), "dist/mcp/server.js must exist (run npm run build)");

// ---- FINDING 1: a request whose reply write throws must NOT poison the
// queue — a later request still gets its reply. -----------------------------
//
// A tiny child loads the REAL built server loop, then makes the FIRST stdout
// write throw synchronously — a stand-in for the raw write that throws
// mid-reply the fix is about (a broken pipe on the very next byte, a
// serialize error). It then runs startServer and lets us feed it lines. The
// first line is broken JSON (its parse-error reply is the write that throws);
// the second line is a valid `initialize` with id 2 that MUST still be
// answered.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-mcp-queue-"));
const poisonChild = path.join(tmp, "poison-child.js");
fs.writeFileSync(
  poisonChild,
  [
    '"use strict";',
    "// Make ONLY the first stdout write throw (a raw write that fails",
    "// mid-reply), then run the real server loop.",
    "let failedOnce = false;",
    "const realWrite = process.stdout.write.bind(process.stdout);",
    "process.stdout.write = function (chunk) {",
    "  if (!failedOnce) { failedOnce = true; throw new Error('SIMULATED_WRITE_FAILURE'); }",
    "  return realWrite(chunk);",
    "};",
    `const { startServer } = require(${JSON.stringify(MCP_LOOP)});`,
    "startServer();",
    "",
  ].join("\n")
);

function runQueuePoison() {
  return new Promise((resolve, reject) => {
    const child = spawn(node, [poisonChild], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.on("error", reject);
    child.on("close", () => {
      const replies = stdout
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      resolve(replies);
    });
    // Line 1: broken JSON -> its parse-error reply is the write that throws.
    child.stdin.write("{bad json\n");
    // Line 2: a valid initialize -> must still be answered if the queue is
    // not poisoned by line 1's failed write.
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} })}\n`);
    child.stdin.end();
  });
}

async function testQueueNotPoisoned() {
  // Run a few times: the bug is about async ordering, so more than one run
  // guards against a lucky green.
  for (let i = 0; i < 3; i++) {
    const replies = await runQueuePoison();
    const id2 = replies.find((m) => m.id === 2);
    assert.ok(
      id2,
      `run ${i + 1}: after one request's reply write throws, a later request (id 2) must STILL be answered — the queue must not be poisoned. Got replies: ${JSON.stringify(replies)}`
    );
    assert.ok(
      id2.result && id2.result.serverInfo && id2.result.serverInfo.name === "cool-workflow",
      `run ${i + 1}: the id-2 reply must be the real initialize result, got ${JSON.stringify(id2)}`
    );
  }
}

// ---- FINDING 2: a client that closes stdout mid-reply makes the server stop
// quietly (exit 0, silent stderr), not crash with a `write EPIPE` stack. -----
function runBrokenPipe() {
  return new Promise((resolve, reject) => {
    const child = spawn(node, [MCP_ENTRY], { stdio: ["pipe", "pipe", "pipe"] });
    // Close OUR read end of the child's stdout at once, before it boots — its
    // first reply write is then certain to hit a broken pipe (no race).
    child.stdout.destroy();
    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stderr }));
    // An initialize makes the server try to write a reply -> broken pipe.
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
    child.stdin.end();
  });
}

async function testEpipeQuietExit() {
  for (let i = 0; i < 3; i++) {
    const { code, signal, stderr } = await runBrokenPipe();
    const label = `broken-pipe run ${i + 1}`;
    assert.equal(signal, null, `${label}: no signal kill, got ${signal}`);
    assert.equal(code, 0, `${label}: a client that closes stdout mid-reply must exit 0, got ${code}\nstderr:\n${stderr}`);
    assert.equal(stderr, "", `${label}: broken pipe must print NOTHING on stderr, got:\n${stderr}`);
    assert.ok(!stderr.includes("EPIPE"), `${label}: no EPIPE stack trace`);
  }
}

async function main() {
  await testQueueNotPoisoned();
  await testEpipeQuietExit();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.stdout.write(
    "mcp-queue-epipe-smoke: ok (one failed reply write does not poison the queue; a client closing stdout mid-reply exits 0 and silent)\n"
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
