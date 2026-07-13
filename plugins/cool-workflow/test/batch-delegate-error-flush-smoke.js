#!/usr/bin/env node
"use strict";

// batch-delegate-error-flush-smoke — the batch delegate child's stdout
// StringDecoder must be flushed no matter which child event settles a job.
//
// The child's per-job `child.stdout` "data" handler decodes each raw chunk
// through a StringDecoder so a multi-byte UTF-8 character split across two
// chunk boundaries reassembles correctly instead of corrupting into
// replacement characters (see batch-output-overflow-smoke.js scenario 4).
// A StringDecoder can hold up to 3 bytes of an incomplete trailing
// character in its own internal buffer; calling `decoder.end()` flushes
// that trailing content into the returned string.
//
// A first attempt at this fix only called `decoder.end()` inside the
// `child.on("close", ...)` handler. But `child.on("error", ...)` — which
// fires instead of "close" when the ChildProcess itself errors after
// spawning (e.g. a post-spawn stream or kill failure) — settles the job
// using the SAME `stdout` variable and does NOT go through "close". If
// "error" fires while the decoder is still holding an incomplete trailing
// character, and nothing flushes it there, those bytes are silently
// dropped from the settled `stdout` — worse than the OLD (pre-StringDecoder)
// code, which decoded every chunk in isolation and so always surfaced a
// trailing incomplete sequence (as a replacement character) the instant it
// arrived, never losing it outright.
//
// This test forces the "error" path specifically: `node:child_process`'s
// `spawn` is monkeypatched (via a `-r` preload, before the delegate script
// requires it) to return a fake ChildProcess that emits a SPLIT multi-byte
// character on `stdout` and then emits "error" — never "close". This is the
// only reliable, portable way to observe the "error before close" ordering,
// since a real OS process essentially never emits child.on("error") after
// its stdout has already produced data.
//
// @cw-smoke: batch-delegate-error-flush-smoke

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const batchChildScript = path.join(pluginRoot, "scripts", "children", "batch-delegate-child.js");

// The first 2 of 3 bytes of U+4E2D "中" (0xE4 0xB8 0xAD) — an incomplete
// trailing sequence a StringDecoder must buffer, not decode outright.
const SPLIT_BYTES = [0xE4, 0xB8];
const SIMULATED_ERROR_MESSAGE = "simulated post-spawn error";

function writePreload(file) {
  const src = `
"use strict";
const child_process = require("node:child_process");
const { EventEmitter } = require("node:events");
child_process.spawn = function fakeSpawn() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  process.nextTick(() => {
    child.stdout.emit("data", Buffer.from(${JSON.stringify(SPLIT_BYTES)}));
    process.nextTick(() => {
      child.emit("error", new Error(${JSON.stringify(SIMULATED_ERROR_MESSAGE)}));
    });
  });
  return child;
};
`;
  fs.writeFileSync(file, src, "utf8");
  return file;
}

function runDelegateWithFakeSpawn(work) {
  const preload = writePreload(path.join(work, "fake-spawn-preload.js"));
  const job = { binary: "irrelevant", args: [], cwd: work, timeoutMs: 10000 };
  const child = spawn(process.execPath, ["-r", preload, batchChildScript], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  child.stdout.on("data", (d) => { stdout += d.toString(); });
  child.stdin.write(JSON.stringify([job]));
  child.stdin.end();
  const exitCode = new Promise((resolve) => child.on("close", resolve));
  return { stdoutPromise: exitCode.then(() => stdout) };
}

async function main() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-batch-error-flush-")));
  try {
    const { stdoutPromise } = runDelegateWithFakeSpawn(work);
    const raw = await stdoutPromise;
    const line = raw.trim().split("\n").filter(Boolean)[0];
    assert.ok(line, "the delegate child writes exactly one NDJSON line for the one job");
    const outcome = JSON.parse(line);
    assert.equal(outcome.exitCode, null, "an error-settled job carries no exit code");
    assert.equal(outcome.spawnError, SIMULATED_ERROR_MESSAGE, "the job's spawnError is the simulated ChildProcess error");
    // The decoder was holding an incomplete 2-byte trailing sequence when
    // "error" fired. Flushed, StringDecoder.end() turns it into exactly one
    // U+FFFD replacement character — proving the error handler flushed the
    // decoder instead of silently dropping those bytes.
    assert.equal(outcome.stdout, "�", "the decoder's pending incomplete trailing bytes are flushed into stdout on the error path, not silently dropped");
    console.log("batch-delegate-error-flush-smoke: the error handler flushes a pending incomplete UTF-8 tail instead of dropping it ok");
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
