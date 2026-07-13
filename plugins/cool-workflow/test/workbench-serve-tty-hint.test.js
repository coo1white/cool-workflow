#!/usr/bin/env node
"use strict";

// workbench-serve-tty-hint.test — `cw workbench serve` had NO human-friendly
// line at all, even on a real interactive terminal: the only output was the
// one JSON descriptor line on STDOUT (the data channel, unchanged by this
// test). This pins the small additive fix: a "workbench serving at ..." line
// on STDERR, gated the SAME way term.ts's printSuccessSummary is (silent on
// a non-TTY stream so a piped/agent run never gets extra chrome).
//
// Uses the same fakeStream({isTTY, write, text()}) shape as
// test/cli-progress-summary-smoke.js so this stays fast (no real terminal,
// no spawned CLI process) and directly exercises the TTY gate.

const assert = require("node:assert/strict");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const host = require(path.join(pluginRoot, "dist", "shell", "workbench-host.js"));

// A stream stand-in: captures writes; `isTTY` decides whether the hint prints.
function fakeStream(isTTY) {
  const buf = [];
  return { isTTY, write: (s) => (buf.push(String(s)), true), text: () => buf.join("") };
}

// ===== 1. formatServeHint is a pure function: exact line for a given port =====
{
  assert.equal(
    host.formatServeHint(7717),
    "workbench serving at http://127.0.0.1:7717 (Ctrl-C to stop)",
    "formatServeHint renders the exact expected line for a fixed port"
  );
  assert.equal(
    host.formatServeHint(58151),
    "workbench serving at http://127.0.0.1:58151 (Ctrl-C to stop)",
    "formatServeHint renders the exact expected line for an ephemeral --port 0 bound port"
  );
  console.log("workbench-serve-tty-hint: formatServeHint renders the exact line ok");
}

// ===== 2. printServeHint on a TTY stream writes that exact line =====
{
  const s = fakeStream(true);
  host.printServeHint(7717, s);
  assert.equal(s.text(), `${host.formatServeHint(7717)}\n`, "printServeHint writes the hint line + newline on a TTY stream");
  console.log("workbench-serve-tty-hint: printServeHint writes the hint on a TTY stream ok");
}

// ===== 3. printServeHint on a non-TTY stream writes NOTHING (piped/agent runs stay clean) =====
{
  const s = fakeStream(false);
  host.printServeHint(7717, s);
  assert.equal(s.text(), "", "printServeHint writes nothing when the stream is not a TTY");
  console.log("workbench-serve-tty-hint: printServeHint is silent on a non-TTY stream ok");
}

console.log("workbench-serve-tty-hint.test: ok");
