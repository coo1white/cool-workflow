#!/usr/bin/env node
// @cw-smoke: timeout 45

// A signal to the MCP parent must stop a tool child that is waiting on a real
// state lock. Releasing the lock after the parent is gone must not let that
// old child make a late queue write. The next server must still work.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const mcp = path.join(pluginRoot, "dist", "mcp-server.js");
assert.ok(fs.existsSync(mcp), "dist/mcp-server.js must exist (run npm run build)");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP parent did not stop after ${signal}`)), 2000);
    child.once("exit", (code, actualSignal) => {
      clearTimeout(timer);
      resolve({ code, signal: actualSignal });
    });
  });
}

async function signalStopsBlockedTool(signal) {
  const cwd = tmpDir("cw-mcp-tool-stop-");
  // cw_queue_add writes the home queue under its file lock; the home lives
  // in the temp dir so the held lock is this test's own.
  const home = path.join(cwd, "home");
  const storePath = path.join(home, "registry", "queue.json");
  const lockPath = `${storePath}.lock`;
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(lockPath, `${process.pid}@${new Date().toISOString()}\n`, { mode: 0o600 });
  const server = spawn(process.execPath, [mcp], { cwd: pluginRoot, stdio: ["pipe", "ignore", "ignore"], env: { ...process.env, CW_HOME: home } });
  try {
    server.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "cw_queue_add", arguments: { cwd, app: "stop-test" } },
      })}\n`
    );
    // Give the durable child time to receive the request and enter the lock
    // acquire path. The fresh lock remains held throughout this wait.
    await wait(250);
    const exited = waitForExit(server, signal);
    server.kill(signal);
    assert.deepEqual(await exited, { code: null, signal }, `MCP parent keeps the ${signal} exit form`);
    fs.rmSync(lockPath, { force: true });
    // The old synchronous acquire could wait for up to six seconds. A late
    // child write after this span proves the parent did not contain it.
    await wait(6500);
    assert.equal(fs.existsSync(storePath), false, `${signal} leaves no late queue write`);
  } finally {
    server.kill();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

(async () => {
  await signalStopsBlockedTool("SIGINT");
  await signalStopsBlockedTool("SIGTERM");
  const fresh = spawnSync(process.execPath, [mcp], {
    cwd: pluginRoot,
    input: '{"jsonrpc":"2.0","id":1,"method":"ping"}\n',
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(fresh.status, 0, `a fresh MCP server still starts: ${fresh.stderr}`);
  assert.match(fresh.stdout, /"result":\{\}/, "a fresh MCP server answers ping");
  process.stdout.write("mcp-tool-shutdown-containment-smoke: ok\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
