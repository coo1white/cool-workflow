#!/usr/bin/env node
"use strict";

// Batch delegate child (extracted from execution-backend/agent.ts so it is a
// real, greppable, lint-able file instead of an embedded `node -e` template
// string — F11). Spawned via `node <this-path>` (shell:false) by
// runAgentBatchOutcomes.
//
// Reads jobs JSON on stdin, spawns ALL concurrently (shell:false, inherited env —
// the agent's own credentials resolve; CW never reads them), per-job SIGTERM at
// timeoutMs + SIGKILL at +5s, caps each captured stdout at 32MB RAW and each
// written NDJSON line at 33MB SERIALIZED (see LINE_CAP below). Streams ONE
// NDJSON line per job — `{i, spawnError?, exitCode, stdout}\n` — the INSTANT
// that job settles (not once at the end): the parent's spawnSync call has its
// own combined-output cap, so writing incrementally means a job whose line
// already flushed keeps its real outcome even if a LATER job's output pushes
// the combined stream over that cap and the whole child gets killed. `i` is
// the job's index (settle order is concurrent, not submission order — the
// parent cannot infer which line belongs to which job without it). stderr is
// drained (a full pipe must never wedge a child). A kill yields exitCode null
// — the no-exit-code refusal.
//
// THE RED LINE: this child only `spawn`s the operator-resolved agent binary with
// shell:false. It imports NO model SDK and reads NO credentials.
//
// A direct kill of THIS process (e.g. the parent's spawnSync `timeout` option,
// or a signal that reaches this child but not the grandchildren it spawned)
// used to orphan every still-running job -- no SIGINT/SIGTERM handler existed
// here, so the kernel default (instant termination) left them running with no
// one left to reap them. Now the first stop signal forwards SIGTERM to every
// still-tracked child (same escalation shape the per-job timeout below
// already uses) and lets each one's own `close` handler settle it normally;
// a second signal escalates straight to SIGKILL and exits immediately.
const children = new Set();
function killAllChildren(signal) {
  for (const child of children) {
    try { child.kill(signal); } catch {}
  }
}
// Bounded self-exit deadline after the FIRST stop signal (finding #2). The
// escalation above forwards SIGTERM, then SIGKILLs every TRACKED child at +5s.
// But a job's own grandchild is NOT tracked here, and if it inherited the
// job's stdout pipe it holds that pipe open past the job's death — so the
// job's `close` never fires, this process's captured `child.stdout` stream
// never ends, and the event loop stays alive forever. The single SIGTERM the
// drive sent could then never actually stop this child: a deadlock. The
// deadline force-exits (after the +5s SIGKILL window, so tracked children die
// first) so one wedged grandchild can no longer hold the whole batch hostage.
// Default 8s; CW_BATCH_STOP_DEADLINE_MS overrides it (opt-in, e.g. for tests).
const STOP_DEADLINE_MS = (() => {
  const raw = Number(process.env.CW_BATCH_STOP_DEADLINE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 8000;
})();
let stopSignalReceived = false;
function onStopSignal(signal) {
  if (stopSignalReceived) {
    killAllChildren("SIGKILL");
    process.exit(signal === "SIGINT" ? 130 : 143);
    return;
  }
  stopSignalReceived = true;
  killAllChildren("SIGTERM");
  setTimeout(() => killAllChildren("SIGKILL"), 5000).unref();
  // unref'd on purpose: when the batch stops cleanly (every child settles and
  // its stdout closes) the loop empties and this process exits promptly, so a
  // graceful stop is never padded out to the full deadline. The timer only
  // ever FIRES when something else — a wedged grandchild holding a pipe — is
  // still keeping the loop alive; then it reaps any tracked stragglers and
  // exits with the signal's conventional code.
  setTimeout(() => {
    killAllChildren("SIGKILL");
    process.exit(signal === "SIGINT" ? 130 : 143);
  }, STOP_DEADLINE_MS).unref();
}
process.on("SIGINT", () => onStopSignal("SIGINT"));
process.on("SIGTERM", () => onStopSignal("SIGTERM"));

const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
let raw = "";
const MAX_STDIN_BYTES = 32 * 1024 * 1024;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { if (raw.length < MAX_STDIN_BYTES) raw += d; });
process.stdin.on("end", () => {
  let jobs;
  try {
    jobs = JSON.parse(raw);
  } catch (e) {
    process.stdout.write(JSON.stringify([{ spawnError: `invalid stdin JSON: ${String(e && e.message || e)}`, exitCode: null, stdout: "" }]));
    return;
  }
  if (!jobs.length) { process.stdout.write("[]"); return; }
  const CAP = 32 * 1024 * 1024;
  // The parent (runAgentBatchOutcomes) grants maxBuffer = 34MB PER JOB for
  // the COMBINED NDJSON stream it captures from this child. CAP above bounds
  // each job's RAW stdout bytes, but the line written by settle() is the
  // ESCAPED serialization — JSON escaping grows bytes (quotes and
  // backslashes 2x, control chars up to 6x as \uXXXX), so a raw-capped
  // stdout could still serialize into a line far past the parent's per-job
  // budget, push the combined stream over maxBuffer, and ENOBUFS the WHOLE
  // batch. LINE_CAP bounds the SERIALIZED line itself, held under the
  // parent's 34MB per-job grant with a small safety margin.
  const LINE_CAP = 33 * 1024 * 1024;
  jobs.forEach((job, i) => {
    let stdout = "";
    let stdoutBytes = 0;
    let stdoutTruncated = false;
    let settled = false;
    // appendedBytes tracks only the raw bytes actually folded into `stdout`
    // so far — an O(1) running counter. The old code re-ran
    // Buffer.byteLength(stdout) over the WHOLE accumulated string on every
    // chunk (O(size-so-far) per chunk, O(bytes^2) total for a chatty job),
    // and all concurrently-running jobs in a batch share one event loop, so
    // that rescan delayed every other job's stream/kill-timer handling too.
    // decoder buffers any multi-byte UTF-8 sequence left incomplete at a
    // chunk boundary and prepends it to the next write, so a character split
    // across two stdout reads decodes correctly instead of the old
    // per-chunk chunk.toString() turning each half into a replacement
    // character (U+FFFD).
    let appendedBytes = 0;
    const decoder = new StringDecoder("utf8");
    // Flush any bytes the decoder is still holding for an incomplete
    // trailing multi-byte character. Must run before EVERY settle() call
    // that reports non-empty stdout (both the "close" and "error" child
    // events can be the one that fires first), not just one of them — a
    // process can end via "error" before "close" (e.g. a post-spawn stream
    // or kill error), and if only "close" flushed, those trailing bytes
    // would be silently dropped instead of surfacing correctly or as an
    // explicit replacement character.
    const flushDecoder = () => {
      const tail = decoder.end();
      if (tail) stdout += tail;
    };
    const settle = (o) => {
      if (settled) return;
      settled = true;
      let line = JSON.stringify({ i, ...o }) + "\n";
      const lineBytes = Buffer.byteLength(line);
      if (lineBytes > LINE_CAP) {
        // Same fail-closed shape as the raw-cap path in the close handler
        // below: capped output is never evidence, so drop it entirely and
        // name the cap — never ship a line the parent's buffer cannot hold.
        line = JSON.stringify({ i, spawnError: `serialized stdout line exceeded ${LINE_CAP} byte cap (${lineBytes} bytes)`, exitCode: null, stdout: "" }) + "\n";
      }
      process.stdout.write(line);
    };
    let child;
    try {
      // stdin "ignore" (not the default inherited pipe): this child never
      // feeds a job any stdin, but the default leaves each job's stdin a pipe
      // we never write to and never close, so a vendor CLI that reads stdin to
      // EOF blocks until its own timeout instead of getting an immediate EOF.
      // Mirrors the serial path (agent.ts runAgentProcess stdio ["ignore",...]).
      child = spawn(job.binary, job.args, { cwd: job.cwd, env: job.env || process.env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      settle({ spawnError: String((error && error.message) || error), exitCode: null, stdout: "" });
      return;
    }
    children.add(child);
    const term = setTimeout(() => { try { child.kill("SIGTERM"); } catch {} }, job.timeoutMs);
    const kill = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, job.timeoutMs + 5000);
    child.stdout.on("data", (d) => {
      const chunk = Buffer.isBuffer(d) ? d : Buffer.from(String(d));
      stdoutBytes += chunk.length;
      if (stdoutTruncated) return;
      const remaining = CAP - appendedBytes;
      if (remaining <= 0 || chunk.length > remaining) {
        stdoutTruncated = true;
        // The close handler's truncated branch always reports stdout:""
        // (below), so this partial decode is dead weight on THAT path — but
        // the error handler below does NOT discard stdout on truncation, so
        // it is still decoded here for that path.
        if (remaining > 0) stdout += decoder.write(chunk.subarray(0, remaining));
        return;
      }
      stdout += decoder.write(chunk);
      appendedBytes += chunk.length;
    });
    child.stderr.on("data", () => {});
    child.on("error", (error) => {
      clearTimeout(term); clearTimeout(kill);
      children.delete(child);
      // Flush the decoder here too, symmetric with the close handler below —
      // "error" can fire instead of "close" (e.g. a post-spawn stream or
      // kill error), and this path reports the accumulated `stdout` as-is
      // (it does not discard it on truncation the way close does), so any
      // bytes still held in the decoder for a not-yet-complete trailing
      // multi-byte character must be flushed or they are silently lost.
      flushDecoder();
      settle({ spawnError: String((error && error.message) || error), exitCode: null, stdout });
    });
    child.on("close", (code) => {
      clearTimeout(term); clearTimeout(kill);
      children.delete(child);
      if (stdoutTruncated) {
        settle({ spawnError: `stdout exceeded ${CAP} byte cap (${stdoutBytes} bytes)`, exitCode: null, stdout: "" });
        return;
      }
      flushDecoder();
      settle({ exitCode: typeof code === "number" ? code : null, stdout });
    });
  });
});
