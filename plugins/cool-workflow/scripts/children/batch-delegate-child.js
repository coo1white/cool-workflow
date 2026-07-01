#!/usr/bin/env node
"use strict";

// Batch delegate child (extracted from execution-backend/agent.ts so it is a
// real, greppable, lint-able file instead of an embedded `node -e` template
// string — F11). Spawned via `node <this-path>` (shell:false) by
// runAgentBatchOutcomes.
//
// Reads jobs JSON on stdin, spawns ALL concurrently (shell:false, inherited env —
// the agent's own credentials resolve; CW never reads them), per-job SIGTERM at
// timeoutMs + SIGKILL at +5s, caps each captured stdout at 32MB. Streams ONE
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

const { spawn } = require("node:child_process");
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
  jobs.forEach((job, i) => {
    let stdout = "";
    let settled = false;
    const settle = (o) => {
      if (settled) return;
      settled = true;
      process.stdout.write(JSON.stringify({ i, ...o }) + "\n");
    };
    let child;
    try {
      child = spawn(job.binary, job.args, { cwd: job.cwd, env: job.env || process.env, shell: false });
    } catch (error) {
      settle({ spawnError: String((error && error.message) || error), exitCode: null, stdout: "" });
      return;
    }
    const term = setTimeout(() => { try { child.kill("SIGTERM"); } catch {} }, job.timeoutMs);
    const kill = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, job.timeoutMs + 5000);
    child.stdout.on("data", (d) => { if (stdout.length < CAP) stdout += d; });
    child.stderr.on("data", () => {});
    child.on("error", (error) => {
      clearTimeout(term); clearTimeout(kill);
      settle({ spawnError: String((error && error.message) || error), exitCode: null, stdout });
    });
    child.on("close", (code) => {
      clearTimeout(term); clearTimeout(kill);
      settle({ exitCode: typeof code === "number" ? code : null, stdout });
    });
  });
});
