#!/usr/bin/env node
"use strict";

// mcp-client-rawstdin — a variant of fixtures/mcp-client.js for exactly
// one need: writing raw bytes to the MCP server's stdin WITHOUT the
// auto-newline that fixtures/mcp-client.js's sendRaw() always adds.
// Only mcplinecap-oversize-line.case.js uses this: it must be able to
// send an oversize chunk with NO trailing newline at all (to test the
// "unconsumed buffer exceeds cap with no newline yet" path per mcp.md),
// then send a real newline as a separate write.
//
// Kept as its own file (not an edit to fixtures/mcp-client.js) because
// other cases depend on that file's exact current sendRaw behavior.

const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

function serverPathFor(cliBinPath) {
  return path.join(path.dirname(cliBinPath), "mcp-server.js");
}

function startServer(serverPath, opts) {
  opts = opts || {};
  const home = opts.home || fs.mkdtempSync(path.join(os.tmpdir(), "mcp-home-raw-"));
  const cwd = opts.cwd || home;
  fs.mkdirSync(home, { recursive: true });

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

  // A server that answers-and-moves-on before a huge stdin write is
  // fully drained can make the writable side see EPIPE — expected,
  // not a bug in the case, so it must not crash the process.
  child.stdin.on("error", () => {});

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

  // writeRaw(bufOrString) — write bytes to stdin with NO auto-newline.
  function writeRaw(data) {
    try {
      child.stdin.write(data);
    } catch {
      /* EPIPE etc: server already answered and moved on */
    }
  }
  function send(obj) {
    writeRaw(`${JSON.stringify(obj)}\n`);
  }

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
            new Error(`mcp-client-rawstdin: timed out waiting for ${n} more reply line(s); got ${lines.length - cursor}. stderr: ${stderr}`)
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

  return { writeRaw, send, waitForCount, close, get stderr() { return stderr; } };
}

module.exports = { startServer, serverPathFor };
