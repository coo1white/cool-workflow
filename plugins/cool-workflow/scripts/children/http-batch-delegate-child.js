#!/usr/bin/env node
"use strict";

// HTTP batch delegate child — the endpoint-mode sibling of batch-delegate-child.js.
// Spawned via `node <this-path>` (shell:false) by runEndpointBatchOutcomes when a
// concurrent drive round (`--concurrency N`) has one or more ENDPOINT-configured
// agents. Without it, endpoint tasks in a concurrent round each spawned their own
// blocking http-delegate-child one after another, so `--concurrency N` ran N
// endpoint delegations strictly SERIALLY. This child POSTs all N at once from a
// single process (one Node process holds N in-flight fetches trivially — no per-job
// child process is needed for HTTP the way it is for a vendor CLI).
//
// Reads a JSON array `[{ endpoint, job, timeoutMs }, ...]` on stdin, where `job` is
// the ALREADY-serialized POST body (byte-identical to the string the serial
// runAgentEndpoint builds, so the concurrent path posts the same bytes). Fires all
// jobs concurrently, each POST + optional jobId poll matching http-delegate-child.js,
// and streams ONE NDJSON line per job — `{i, spawnError?, exitCode, stdout}\n` — the
// INSTANT that job settles. `i` is the job's index (settle order is concurrent, not
// submission order, so the parent cannot map a line to its job without it). The line
// shape and the incremental-streaming reason are shared with batch-delegate-child.js:
// the parent (runEndpointBatchOutcomes) reuses reconcileBatchOutcomes to read them.
//
// THE RED LINE: this child speaks ONLY plain HTTP to the operator-configured
// endpoint. It imports NO model SDK, holds NO API key, and constructs NO model API
// request. It re-uses the caller's inherited env for any endpoint auth exactly as
// http-delegate-child.js does; it reads no credential itself.

const MAX_STDIN_BYTES = 32 * 1024 * 1024;
// Per-job caps mirror batch-delegate-child.js: CAP bounds each job's RAW stdout
// bytes; LINE_CAP bounds the ESCAPED NDJSON line (JSON escaping grows bytes), held
// under the parent's 34MB-per-job maxBuffer grant with a small margin so one job's
// line can never push the combined stream past the parent's buffer and ENOBUFS the
// whole batch.
const CAP = 32 * 1024 * 1024;
const LINE_CAP = 33 * 1024 * 1024;

// In-flight fetch controllers so a stop signal aborts every open request at once.
// No grandchild processes exist here (unlike batch-delegate-child.js), so there is
// no wedged-pipe deadlock to guard — aborting the fetches empties the event loop
// and the process exits on its own.
const controllers = new Set();
let stopSignalReceived = false;
function onStopSignal(signal) {
  if (stopSignalReceived) {
    process.exit(signal === "SIGINT" ? 130 : 143);
    return;
  }
  stopSignalReceived = true;
  for (const controller of controllers) {
    try { controller.abort(); } catch {}
  }
  // If aborting does not drain the loop promptly (a hung socket), force-exit.
  setTimeout(() => process.exit(signal === "SIGINT" ? 130 : 143), 5000).unref();
}
process.on("SIGINT", () => onStopSignal("SIGINT"));
process.on("SIGTERM", () => onStopSignal("SIGTERM"));

function writeSettleLine(i, outcome) {
  let line = JSON.stringify({ i, ...outcome }) + "\n";
  if (Buffer.byteLength(line) > LINE_CAP) {
    // Same fail-closed shape as the raw-cap path: capped output is never evidence,
    // so drop it entirely and name the cap — never ship a line the parent's buffer
    // cannot hold.
    line = JSON.stringify({ i, spawnError: `serialized stdout line exceeded ${LINE_CAP} byte cap (${Buffer.byteLength(line)} bytes)`, exitCode: null, stdout: "" }) + "\n";
  }
  process.stdout.write(line);
}

// One job: POST the pre-serialized body, poll a returned jobId until done, and
// return { exitCode, stdout } or throw. Byte-for-byte the same POST + poll contract
// as http-delegate-child.js, plus a per-job deadline so one hung endpoint settles as
// its own error instead of pinning the whole batch to the parent's backstop timeout.
async function runOne(entry) {
  const { endpoint, job, timeoutMs } = entry;
  if (!endpoint) throw new Error("no endpoint");
  const deadline = Date.now() + (Number(timeoutMs) > 0 ? Number(timeoutMs) : 600000);
  const controller = new AbortController();
  controllers.add(controller);
  const abortAt = setTimeout(() => { try { controller.abort(); } catch {} }, Math.max(0, deadline - Date.now()));
  try {
    const post = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof job === "string" ? job : JSON.stringify(job),
      signal: controller.signal,
    });
    if (!post.ok) throw new Error("runner responded " + post.status);
    let data = await post.json();
    let guard = 0;
    while (data && data.jobId && data.done !== true && guard++ < 600) {
      if (Date.now() >= deadline) throw new Error("endpoint poll timed out");
      await new Promise((r) => setTimeout(r, 1000));
      const poll = await fetch(endpoint + (endpoint.includes("?") ? "&" : "?") + "jobId=" + encodeURIComponent(data.jobId), { signal: controller.signal });
      if (!poll.ok) throw new Error("poll responded " + poll.status);
      data = await poll.json();
    }
    if (typeof data.exitCode !== "number") throw new Error("runner did not report an exitCode");
    let stdout = String(data.stdout || "");
    if (Buffer.byteLength(stdout) > CAP) throw new Error(`stdout exceeded ${CAP} byte cap (${Buffer.byteLength(stdout)} bytes)`);
    return { exitCode: data.exitCode, stdout };
  } finally {
    clearTimeout(abortAt);
    controllers.delete(controller);
  }
}

(async () => {
  // setEncoding("utf8") (as batch-delegate-child.js does), NOT `b += <Buffer>`:
  // without it each data chunk is a raw Buffer coerced to a string on its own, so
  // a multibyte char split across a ~64KB pipe-chunk boundary decodes to U+FFFD
  // and the POSTed prompt is silently corrupted. With the encoding set, Node's
  // StringDecoder carries partial bytes across chunk boundaries.
  const read = () => new Promise((res) => { let b = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (c) => { if (b.length < MAX_STDIN_BYTES) b += c; }); process.stdin.on("end", () => res(b)); });
  let jobs;
  try {
    jobs = JSON.parse((await read()) || "[]");
  } catch (e) {
    process.stdout.write(JSON.stringify([{ spawnError: `invalid stdin JSON: ${String((e && e.message) || e)}`, exitCode: null, stdout: "" }]));
    return;
  }
  if (!Array.isArray(jobs) || !jobs.length) { process.stdout.write("[]"); return; }
  // allSettled, not Promise.all: one failing job never rejects the others, and
  // every job's line is already written by runOne's settle below regardless.
  await Promise.allSettled(jobs.map(async (entry, i) => {
    try {
      const out = await runOne(entry);
      writeSettleLine(i, { exitCode: out.exitCode, stdout: out.stdout });
    } catch (e) {
      writeSettleLine(i, { spawnError: String((e && e.message) || e), exitCode: null, stdout: "" });
    }
  }));
})();
