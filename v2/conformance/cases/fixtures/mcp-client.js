#!/usr/bin/env node
"use strict";

// mcp-client — a tiny black-box JSON-RPC client for driving
// scripts/mcp-server.js as a child process over stdin/stdout.
//
// The MCP server is NOT a CLI command, so lib.run() cannot reach it.
// This helper spawns it directly with node:child_process, the same way
// a real MCP host would, and talks newline-framed JSON-RPC per the spec
// (mcp.md): one JSON object per line, no Content-Length headers.
//
// Only used by cases/mcp-*.case.js. Talks to the built server file only
// (the same file a real MCP client would launch) — never requires or
// reads any src/ or internal module.

const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

// serverPathFor(cliBinPath) — the MCP server ships as dist/mcp-server.js,
// a sibling of dist/cli.js (mcp.md: "scripts/mcp-server.js — 4-line shim:
// require('../dist/mcp-server.js')"). Both builds under test are expected
// to keep that sibling layout.
function serverPathFor(cliBinPath) {
  return path.join(path.dirname(cliBinPath), "mcp-server.js");
}

// startServer(serverPath, opts) — spawn the server with a private,
// isolated env (mirrors lib.run's isolation) and a line-framed reader.
// Gives back { send(obj), sendRaw(line), waitForCount(n, ms), close() }.
function startServer(serverPath, opts) {
  opts = opts || {};
  const home = opts.home || fs.mkdtempSync(path.join(require("node:os").tmpdir(), "mcp-home-"));
  const cwd = opts.cwd || home;
  for (const d of [home]) fs.mkdirSync(d, { recursive: true });

  const child = spawn(process.execPath, [serverPath], {
    cwd,
    env: Object.assign(
      {
        PATH: process.env.PATH,
        HOME: home,
        CW_HOME: path.join(home, ".cw-home"),
        XDG_STATE_HOME: path.join(home, ".state"),
        TMPDIR: path.join(home, "tmp"),
        NO_COLOR: "1",
      },
      opts.env || {}
    ),
    stdio: ["pipe", "pipe", "pipe"],
  });

  let outBuf = "";
  const lines = [];
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    outBuf += chunk;
    for (;;) {
      const idx = outBuf.indexOf("\n");
      if (idx === -1) break;
      const line = outBuf.slice(0, idx);
      outBuf = outBuf.slice(idx + 1);
      if (line.trim()) lines.push(line);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  function sendRaw(text) {
    child.stdin.write(text.endsWith("\n") ? text : `${text}\n`);
  }
  function send(obj) {
    sendRaw(JSON.stringify(obj));
  }

  // waitForCount(n, timeoutMs) — poll until at least n MORE framed reply
  // lines have arrived since the last waitForCount call, or reject on
  // timeout. Each call consumes the next n lines (a cursor), so a case
  // that sends several small batches in sequence gets each batch's own
  // replies, not the same head of the stream every time.
  let cursor = 0;
  function waitForCount(n, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 5000);
    const want = cursor + n;
    return new Promise((resolve, reject) => {
      (function poll() {
        if (lines.length >= want) {
          const slice = lines.slice(cursor, want).map((l) => JSON.parse(l));
          cursor = want;
          return resolve(slice);
        }
        if (Date.now() > deadline) {
          return reject(
            new Error(`mcp-client: timed out waiting for ${n} more reply line(s); got ${lines.length - cursor}. stderr: ${stderr}`)
          );
        }
        setTimeout(poll, 20);
      })();
    });
  }

  function close() {
    try {
      child.stdin.end();
    } catch {
      /* ignore */
    }
    child.kill();
  }

  return { send, sendRaw, waitForCount, close, get stderr() { return stderr; } };
}

module.exports = { startServer, serverPathFor };
