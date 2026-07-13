#!/usr/bin/env node
"use strict";

// http-delegate-child-multibyte-stdin-smoke — the CI gate for the http-delegate
// child's stdin reader.
//
// THE BUG this pins: the child read a JSON job off stdin by accumulating raw
// Buffer chunks with `b += c` and NO `setEncoding("utf8")`. Each ~64KB pipe
// chunk was coerced to a string on its OWN — so a multibyte UTF-8 char split
// across a chunk boundary decoded to U+FFFD on BOTH sides (the trailing bytes
// of one chunk and the leading bytes of the next). For a job body over ~64KB
// with non-ASCII text (this project's prompts are frequently Chinese) the job
// POSTed to the endpoint was silently corrupted, or the outer JSON.parse threw
// and the whole delegation refused. `process.stdin.setEncoding("utf8")` makes
// Node's StringDecoder carry the partial bytes across the boundary, so the
// string is rebuilt byte-for-byte.
//
// Hermetic: a tiny local HTTP runner (its OWN reader is byte-correct — it sets
// req.setEncoding("utf8") so ONLY the child's reader is under test) echoes the
// received `command` straight back as `stdout`. We feed the child a > 200KB job
// whose `command` is ALL 3-byte CJK chars (so many chunk boundaries land
// mid-char) and assert the value round-trips byte-for-byte. Against the pre-fix
// child this FAILS (garbage / U+FFFD); with setEncoding it PASSES. No live
// agent, no model SDK, no second repo.

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const childScript = path.join(pluginRoot, "scripts", "children", "http-delegate-child.js");

// A byte-correct fake runner: it echoes the job's `command` back as `stdout`,
// so the child's reported stdout IS whatever `command` the child managed to
// reconstruct from stdin and POST. Its OWN body reader sets utf8 encoding, so a
// round-trip failure can only come from the child's stdin reader (the code
// under test), never from this stub.
const SERVER = `
  const http = require("http");
  const s = http.createServer((req, res) => {
    req.setEncoding("utf8");
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      let job; try { job = JSON.parse(b || "{}"); } catch (e) { job = { command: "PARSE_ERROR:" + e.message }; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ exitCode: 0, stdout: String(job.command || "") }));
    });
  });
  s.listen(0, "127.0.0.1", () => process.stdout.write("PORT:" + s.address().port + "\\n"));
`;

async function main() {
  const server = spawn(process.execPath, ["-e", SERVER], { stdio: ["ignore", "pipe", "ignore"] });
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("fake runner did not start")), 8000);
      server.stdout.on("data", (d) => { const m = /PORT:(\d+)/.exec(String(d)); if (m) { clearTimeout(timer); resolve(Number(m[1])); } });
    });
    const endpoint = `http://127.0.0.1:${port}`;

    // A body well over one 64KB pipe chunk, made ENTIRELY of a 3-byte CJK char
    // so no chunk boundary can align to a char boundary — every boundary splits
    // a "中" into a 1+2 or 2+1 byte straddle. ~200K chars ~= 600KB of UTF-8.
    const command = "中".repeat(200000);
    assert.ok(Buffer.byteLength(command, "utf8") > 64 * 1024, "body must exceed one pipe chunk");
    const job = JSON.stringify({ command, jobId: "mb-1" });

    const child = spawn(process.execPath, [childScript], {
      env: { ...process.env, CW_DELEGATE_ENDPOINT: endpoint },
      stdio: ["pipe", "pipe", "inherit"],
    });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => (out += d));
    const done = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (codeVal) => resolve(codeVal));
    });
    child.stdin.write(job);
    child.stdin.end();
    await done;

    let parsed;
    try {
      parsed = JSON.parse(out.trim() || "{}");
    } catch (e) {
      assert.fail(`child stdout was not valid JSON: ${e.message}\n${out.slice(0, 200)}`);
    }
    assert.ok(!parsed.error, `child must not refuse the delegation (got error: ${parsed.error})`);
    assert.equal(parsed.exitCode, 0, "child reports the runner's exit code");
    // THE assertion: the multibyte command survived the stdin reader byte-for-byte.
    assert.equal(
      Buffer.byteLength(String(parsed.stdout), "utf8"),
      Buffer.byteLength(command, "utf8"),
      "round-tripped command has the same UTF-8 byte length (no U+FFFD substitution)"
    );
    assert.equal(parsed.stdout, command, "the > 200KB all-multibyte stdin body round-trips byte-for-byte");
  } finally {
    server.kill();
  }

  process.stdout.write("http-delegate-child-multibyte-stdin-smoke: ok (a large all-multibyte stdin job round-trips byte-for-byte through the child's stdin reader)\n");
}

main().catch((e) => {
  process.stderr.write(`http-delegate-child-multibyte-stdin-smoke: FAILED\n${e.stack || e.message}\n`);
  process.exit(1);
});
