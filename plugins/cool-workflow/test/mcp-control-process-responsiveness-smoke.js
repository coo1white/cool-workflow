#!/usr/bin/env node
"use strict";
// @cw-smoke: tags fast

// The MCP parent must answer ping while the durable tool child waits on a
// real file lock. Before the control/tool split, the same sync lock wait ran
// in the parent and held ping behind tools/call until this test removes lock.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const mcp = path.join(pluginRoot, "dist", "mcp-server.js");
assert.ok(fs.existsSync(mcp), "dist/mcp-server.js must exist (run npm run build)");

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cw-mcp-control-"));
const storePath = path.join(cwd, ".cw", "schedules", "tasks.json");
const lockPath = `${storePath}.lock`;
fs.mkdirSync(path.dirname(storePath), { recursive: true });
fs.writeFileSync(lockPath, `${process.pid}@${new Date().toISOString()}\n`, { mode: 0o600 });

const server = spawn(process.execPath, [mcp], { cwd: pluginRoot, stdio: ["pipe", "pipe", "pipe"] });
let nextId = 1;
const pending = new Map();
const replies = [];
let stderr = "";
server.stderr.setEncoding("utf8");
server.stderr.on("data", (chunk) => (stderr += chunk));
readline.createInterface({ input: server.stdout }).on("line", (line) => {
  const message = JSON.parse(line);
  replies.push(message);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  waiter.resolve(message);
});

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timed out waiting for MCP reply ${id}`));
    }, 10000);
    pending.set(id, {
      resolve(message) {
        clearTimeout(timer);
        resolve(message);
      },
    });
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

function closeServer() {
  return new Promise((resolve) => {
    server.on("close", resolve);
    server.stdin.end();
  });
}

(async () => {
  let lockGone = false;
  const release = setTimeout(() => {
    lockGone = true;
    fs.rmSync(lockPath, { force: true });
  }, 1500);
  try {
    const tool = rpc("tools/call", {
      name: "cw_schedule_create",
      arguments: { cwd, kind: "loop", interval: 1, prompt: "control process test" },
    });
    const ping = await rpc("ping", {});
    assert.equal(lockGone, false, "ping must answer before the held tool lock is released");
    assert.deepEqual(ping.result, {}, "ping keeps its empty MCP result");
    const toolReply = await tool;
    assert.equal(toolReply.result.isError, undefined, `schedule tool must complete after lock release: ${JSON.stringify(toolReply)}\nstderr:\n${stderr}`);
    assert.equal(replies[0].id, ping.id, "ping reply must arrive before the blocked tools/call reply");
  } finally {
    clearTimeout(release);
    fs.rmSync(lockPath, { force: true });
    await closeServer();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
  process.stdout.write("mcp-control-process-responsiveness-smoke: ok\n");
})().catch(async (error) => {
  fs.rmSync(lockPath, { force: true });
  server.kill();
  fs.rmSync(cwd, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
});
