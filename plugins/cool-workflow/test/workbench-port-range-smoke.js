#!/usr/bin/env node
"use strict";

// workbench-port-range-smoke (finding #24): `cw workbench serve --port` was
// Number()-coerced with NO range/int check. A bad value (NaN, a float, a
// number > 65535, a negative) was handed straight to server.listen(), and
// the port check that guarded it lived inside listen() — the WRONG path.
// The CLI binding runs serve as `void host.run()` (never awaited), so a
// rejection from listen() surfaced as an UNHANDLED PROMISE REJECTION stack
// dump on the real `cw workbench serve --port abc`, not a clean refusal. The
// --once/--json/MCP descriptor path had its own bug: Number("abc") -> NaN,
// and JSON.stringify(NaN) -> `"port": null` in the emitted descriptor.
//
// This drives the REAL CLI surface (spawn dist/cli.js, not listen()) and
// pins the FIXED behavior: a bad --port fails closed the same clean way as
// the sibling --require-token guard — one `cw: ...` stderr line + exit 1,
// never a crash, never a bound server, never `"port": null`.

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const node = process.execPath;

const CLEAR = /workbench serve --port must be an integer 0-65535/;

// Spawn the real CLI. A timeout guards against a regression where a bad
// port slips past the run() guard and the default serve path blocks forever.
function run(args) {
  try {
    const stdout = execFileSync(node, [cli, ...args], { cwd: pluginRoot, encoding: "utf8", timeout: 20000 });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status, stdout: String(e.stdout || ""), stderr: String(e.stderr || "") };
  }
}

// A clean refusal must NOT look like a node crash: no unhandled rejection,
// no opaque node port error, no raw stack trace lines.
function assertNoCrash(r, label) {
  assert.doesNotMatch(r.stderr, /ERR_SOCKET_BAD_PORT/, `${label}: must not surface the opaque node error`);
  assert.doesNotMatch(r.stderr, /UnhandledPromiseRejection|unhandledRejection/i, `${label}: must not be an unhandled rejection`);
  assert.doesNotMatch(r.stderr, /\n\s+at\s+/, `${label}: must not print a raw stack trace`);
  assert.notEqual(r.code, null, `${label}: must exit, not hang/timeout`);
}

// Each entry is the argv tail that carries a bad --port. `-1` uses the
// `--port=-1` form so the leading `-` is not parsed as its own flag; the bare
// `--port` (no value) parses to boolean `true` and must be refused too, not
// coerced (Number(true) === 1 would otherwise bind to port 1).
const badPortTails = [
  ["--port", "abc"],
  ["--port", "70000"],
  ["--port", "65536"],
  ["--port", "8080.5"],
  ["--port=-1"],
  ["--port"],
];

// --- (1) The DEFAULT serve path (`void host.run()`, not awaited): a bad
// --port must fail closed with the clean `cw:` line + exit 1, and must NOT
// crash as an unhandled rejection nor bind a server. ---
for (const tail of badPortTails) {
  const label = `default serve ${tail.join(" ")}`;
  const r = run(["workbench", "serve", ...tail]);
  assert.equal(r.code, 1, `${label} must exit 1, got ${r.code} (stderr: ${r.stderr})`);
  assert.match(r.stderr, /^cw: /, `${label} must fail as a clean cw: line`);
  assert.match(r.stderr, CLEAR, `${label} must carry the clear range message`);
  assert.equal(r.stdout, "", `${label} must not emit a descriptor / bind`);
  assertNoCrash(r, label);
}

// --- (2) The --once/--json descriptor path: a bad --port must fail closed
// the same way and must NEVER emit `"port": null`. ---
for (const flag of ["--once", "--json"]) {
  for (const tail of badPortTails) {
    const label = `serve ${flag} ${tail.join(" ")}`;
    const r = run(["workbench", "serve", ...tail, flag]);
    assert.equal(r.code, 1, `${label} must exit 1, got ${r.code} (stderr: ${r.stderr})`);
    assert.match(r.stderr, /^cw: /, `${label} must fail as a clean cw: line`);
    assert.match(r.stderr, CLEAR, `${label} must carry the clear range message`);
    assert.doesNotMatch(r.stdout, /"port"\s*:\s*null/, `${label} must not emit "port": null`);
    assert.equal(r.stdout, "", `${label} must print no descriptor`);
    assertNoCrash(r, label);
  }
}

// --- (3) Good ports still produce the descriptor unchanged (via --once, so
// nothing binds/blocks). 0 (ephemeral) and 65535 (top of range) are valid;
// the no-port default stays 7717. ---
for (const [args, expected] of [
  [["workbench", "serve", "--once"], 7717],
  [["workbench", "serve", "--port", "0", "--once"], 0],
  [["workbench", "serve", "--port", "65535", "--once"], 65535],
  [["workbench", "serve", "--port", "8080", "--once"], 8080],
]) {
  const r = run(args);
  assert.equal(r.code, 0, `${args.join(" ")} must succeed, got ${r.code} (stderr: ${r.stderr})`);
  assert.equal(r.stderr, "", `${args.join(" ")} must be quiet on stderr`);
  const descriptor = JSON.parse(r.stdout);
  assert.equal(descriptor.port, expected, `${args.join(" ")} must report port ${expected}`);
}

// --- (4) A VALID but BUSY port (EADDRINUSE) must also fail closed cleanly.
// The port-range guard only covers a malformed --port value; the bind itself
// can still fail at runtime when the port is taken. That reject used to
// surface as an unhandled-rejection stack dump on the un-awaited
// `void host.run()`; it must now be a clean `cw:` line + exit 1. ---
(async () => {
  const blocker = http.createServer((_req, res) => res.end("busy"));
  await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const busyPort = blocker.address().port;
  try {
    const label = `busy port ${busyPort}`;
    const r = run(["workbench", "serve", "--port", String(busyPort)]);
    assert.equal(r.code, 1, `${label} must exit 1, got ${r.code} (stderr: ${r.stderr})`);
    assert.match(r.stderr, /^cw: /m, `${label} must fail as a clean cw: line`);
    assert.match(r.stderr, /EADDRINUSE|address already in use|Try:/i, `${label} must explain the bind failure`);
    assert.equal(r.stdout, "", `${label} must not emit a descriptor / bind`);
    assertNoCrash(r, label);
  } finally {
    blocker.close();
  }
  process.stdout.write("workbench-port-range-smoke: ok\n");
})().catch((error) => {
  process.stderr.write(`workbench-port-range-smoke: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
