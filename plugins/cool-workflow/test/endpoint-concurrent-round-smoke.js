"use strict";
// endpoint-concurrent-round-smoke — proves endpoint-mode (HTTP-delegate) agents
// get REAL concurrency in a `--concurrency N` drive round, closing the perf gap
// where an endpoint agent ran N delegations strictly serially (one blocking
// http-delegate-child per task) with no warning.
//
// Three parts:
//   1. DETERMINISTIC concurrency proof. A fake HTTP runner holds every request
//      open until N are in flight AT ONCE (a rendezvous barrier), then releases
//      all N. runEndpointBatchOutcomes(N jobs) settles only if the child POSTed
//      all N concurrently — a serial client never fills the barrier, so each POST
//      would hit its per-job timeout and come back a spawnError. Success (all N
//      exitCode 0) can ONLY happen under true concurrency; this is not a timing
//      threshold that could flake.
//   2. Error mapping. A runner that returns no exitCode / a non-2xx status makes
//      each job settle as a spawnError (exitCode null), never a fake success.
//   3. Prepared-outcome settle. runBackend({backendId:"agent", endpoint,
//      preparedAgentOutcome}) settles the pre-collected outcome through
//      runAgentEndpoint without re-spawning — a success writes result.md as
//      transport and completes; a spawnError refuses.
//
// THE RED LINE holds: the child speaks only plain HTTP to the operator endpoint;
// no model SDK, no key. The fake runner here is a stand-in for that endpoint.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const { runEndpointBatchOutcomes, prepareEndpointJob } = require(path.join(pluginRoot, "dist/shell/execution-backend/agent.js"));
const { runBackend } = require(path.join(pluginRoot, "dist/shell/execution-backend/registry.js"));
const { showBundledSandboxProfile, sandboxContextForValidation } = require(path.join(pluginRoot, "dist/shell/sandbox-profile.js"));

const ctx = sandboxContextForValidation(pluginRoot);
const ro = showBundledSandboxProfile("readonly", ctx);
for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];

// Start one of the fake runners below (its source is a self-contained string run
// via `node -e`). Resolves to the listening port. Returns { port, kill }.
function startRunner(source) {
  const server = spawn(process.execPath, ["-e", source], { stdio: ["ignore", "pipe", "ignore"] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { server.kill(); } catch {} reject(new Error("fake runner did not start")); }, 8000);
    server.stdout.on("data", (d) => {
      const m = /PORT:(\d+)/.exec(String(d));
      if (m) { clearTimeout(timer); resolve({ port: Number(m[1]), kill: () => { try { server.kill(); } catch {} } }); }
    });
  });
}

// N = 4: small enough to stay well under any HTTP connection-pool limit (so all N
// really open at once and fill the barrier), large enough that N-way concurrency
// is a real claim. A rendezvous barrier — respond to every held request only once
// N are in flight.
const N = 4;
const BARRIER_RUNNER = `
  const http = require("http");
  const N = ${N};
  let held = [];
  const s = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      held.push(res);
      if (held.length === N) {
        const batch = held; held = [];
        for (let i = 0; i < batch.length; i++) {
          batch[i].writeHead(200, { "content-type": "application/json" });
          batch[i].end(JSON.stringify({ exitCode: 0, stdout: "OK-BARRIER-" + i }));
        }
      }
    });
  });
  s.listen(0, "127.0.0.1", () => process.stdout.write("PORT:" + s.address().port + "\\n"));
`;

const NO_EXITCODE_RUNNER = `
  const http = require("http");
  const s = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "boom, no exitCode" }));
    });
  });
  s.listen(0, "127.0.0.1", () => process.stdout.write("PORT:" + s.address().port + "\\n"));
`;

const FIVE_HUNDRED_RUNNER = `
  const http = require("http");
  const s = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      res.writeHead(500); res.end("nope");
    });
  });
  s.listen(0, "127.0.0.1", () => process.stdout.write("PORT:" + s.address().port + "\\n"));
`;

// Echoes the RAW request body back as stdout, so the caller can prove the POST
// body it sent survived the child's stdin decode byte-for-byte (multibyte guard).
const ECHO_RUNNER = `
  const http = require("http");
  const s = http.createServer((req, res) => {
    const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ exitCode: 0, stdout: body }));
    });
  });
  s.listen(0, "127.0.0.1", () => process.stdout.write("PORT:" + s.address().port + "\\n"));
`;

async function main() {
  // ---- 0. prepareEndpointJob shape --------------------------------------------
  {
    const cliOnly = prepareEndpointJob({ schemaVersion: 1, backendId: "agent", cwd: pluginRoot, sandboxPolicy: ro, delegation: { command: "claude", args: ["x"] } });
    assert.equal(cliOnly, undefined, "prepareEndpointJob returns undefined for a CLI-binary agent (that path is prepareAgentSpawn)");
    const unconf = prepareEndpointJob({ schemaVersion: 1, backendId: "agent", cwd: pluginRoot, sandboxPolicy: ro, delegation: {} });
    assert.equal(unconf, undefined, "prepareEndpointJob returns undefined when unconfigured");
    const ep = prepareEndpointJob({ schemaVersion: 1, backendId: "agent", cwd: pluginRoot, sandboxPolicy: ro, manifest: { prompt: "hi", resultPath: "/tmp/r.md" }, delegation: { endpoint: "http://127.0.0.1:9/x", model: "m" }, timeoutMs: 1234 });
    assert.ok(ep && ep.endpoint === "http://127.0.0.1:9/x" && ep.timeoutMs === 1234, "prepareEndpointJob resolves endpoint + timeout");
    const body = JSON.parse(ep.job);
    assert.equal(body.prompt, "hi", "job body carries the prompt");
    assert.equal(body.model, "m", "job body carries the operator model");
    assert.equal(body.resultPath, "/tmp/r.md", "job body carries the resultPath");
    assert.equal(body.sandboxProfileId, ro.id, "job body carries the sandbox profile id from request.sandboxPolicy");
  }

  // ---- 1. DETERMINISTIC concurrency proof (rendezvous barrier) -----------------
  {
    const runner = await startRunner(BARRIER_RUNNER);
    try {
      const endpoint = `http://127.0.0.1:${runner.port}`;
      const jobs = Array.from({ length: N }, () => ({ endpoint, job: JSON.stringify({ prompt: "x" }), timeoutMs: 6000 }));
      const t0 = Date.now();
      const settled = runEndpointBatchOutcomes(jobs);
      const elapsed = Date.now() - t0;
      assert.equal(settled.length, N, "one outcome per job");
      for (let i = 0; i < N; i++) {
        assert.ok(!settled[i].spawnError, `job ${i} settled without a spawnError (got: ${settled[i].spawnError})`);
        assert.equal(settled[i].exitCode, 0, `job ${i} exit 0`);
        assert.ok(settled[i].stdout.startsWith("OK-BARRIER-"), `job ${i} carries the runner's stdout`);
      }
      // The barrier only ever releases under true N-way concurrency; a serial
      // client would time out here (elapsed ~ N * 6000ms). This log is a sanity
      // aid, not the assertion — the barrier itself is the deterministic proof.
      console.log(`  [concurrency] ${N} endpoint jobs settled in ${elapsed}ms (serial would need ~${N * 6000}ms and would time out)`);
      assert.ok(elapsed < 6000, `all ${N} jobs settled inside one per-job window (${elapsed}ms), i.e. concurrently`);
    } finally {
      runner.kill();
    }
  }

  // ---- 2. ERROR MAPPING: no exitCode, and non-2xx ------------------------------
  {
    const runner = await startRunner(NO_EXITCODE_RUNNER);
    try {
      const endpoint = `http://127.0.0.1:${runner.port}`;
      const settled = runEndpointBatchOutcomes([{ endpoint, job: "{}", timeoutMs: 4000 }]);
      assert.equal(settled.length, 1, "one outcome");
      assert.equal(settled[0].exitCode, null, "no fabricated exit code when the runner reports none");
      assert.ok(settled[0].spawnError && /exitCode/i.test(settled[0].spawnError), `spawnError names the missing exitCode (got: ${settled[0].spawnError})`);
    } finally {
      runner.kill();
    }
  }
  {
    const runner = await startRunner(FIVE_HUNDRED_RUNNER);
    try {
      const endpoint = `http://127.0.0.1:${runner.port}`;
      const settled = runEndpointBatchOutcomes([{ endpoint, job: "{}", timeoutMs: 4000 }]);
      assert.equal(settled[0].exitCode, null, "a 5xx is a failure, never a fake success");
      assert.ok(settled[0].spawnError && /500/.test(settled[0].spawnError), `spawnError carries the HTTP status (got: ${settled[0].spawnError})`);
    } finally {
      runner.kill();
    }
  }

  // ---- 3. Empty batch is a no-op -----------------------------------------------
  {
    assert.deepEqual(runEndpointBatchOutcomes([]), [], "empty endpoint batch settles to []");
  }

  // ---- 3b. MULTIBYTE stdin round-trip (the child must decode utf8 across pipe
  //          chunk boundaries, not coerce each raw Buffer chunk on its own). A
  //          large multibyte body crosses ≥1 ~64KB stdin chunk boundary, so a
  //          non-utf8 reader would corrupt it (U+FFFD); the echo runner proves
  //          the POSTed body survived byte-for-byte. -------------------------------
  {
    const runner = await startRunner(ECHO_RUNNER);
    try {
      const endpoint = `http://127.0.0.1:${runner.port}`;
      const body = JSON.stringify({ prompt: "中".repeat(80000) }); // ~240KB, all multibyte
      const settled = runEndpointBatchOutcomes([{ endpoint, job: body, timeoutMs: 6000 }]);
      assert.ok(!settled[0].spawnError, `multibyte job settled cleanly (got: ${settled[0].spawnError})`);
      assert.equal(settled[0].exitCode, 0, "multibyte job exit 0");
      assert.equal(settled[0].stdout, body, "the POSTed multibyte body round-trips byte-for-byte (no chunk-boundary corruption)");
    } finally {
      runner.kill();
    }
  }

  // ---- 4. PREPARED-OUTCOME settle through runAgentEndpoint (no re-spawn) --------
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-endpoint-settle-"));
    try {
      const resultPath = path.join(dir, "result.md");
      // success: the runner stdout carried a `result` body; settle writes it as
      // transport and the envelope completes.
      const ok = runBackend({
        schemaVersion: 1,
        cwd: pluginRoot,
        sandboxPolicy: ro,
        label: "endpoint-settle",
        backendId: "agent",
        manifest: { resultPath, prompt: "do it" },
        delegation: { endpoint: "http://127.0.0.1:9/never-called", model: "m" },
        preparedAgentOutcome: { exitCode: 0, stdout: JSON.stringify({ result: "HELLO_FROM_ENDPOINT" }) },
      });
      assert.equal(ok.status, "completed", "prepared endpoint success completes without re-spawning");
      assert.equal(ok.provenance.handle.metadata.mode, "endpoint", "handle mode is endpoint");
      assert.ok(fs.existsSync(resultPath), "settle wrote result.md as transport");
      assert.ok(fs.readFileSync(resultPath, "utf8").includes("HELLO_FROM_ENDPOINT"), "result.md carries the endpoint body");

      // A per-job HTTP spawnError => the SAME refusal wording a serial run records
      // for the same failure (`agent endpoint error: <msg>`, from runAgentEndpoint's
      // serial `parsed.error` branch), never a completion. This locks the parity
      // the concurrent path promises.
      const badHttp = runBackend({
        schemaVersion: 1,
        cwd: pluginRoot,
        sandboxPolicy: ro,
        label: "endpoint-settle-fail",
        backendId: "agent",
        manifest: { resultPath: path.join(dir, "none.md"), prompt: "do it" },
        delegation: { endpoint: "http://127.0.0.1:9/never-called", model: "m" },
        preparedAgentOutcome: { spawnError: "runner responded 500", exitCode: null, stdout: "" },
      });
      assert.equal(badHttp.status, "refused", "a prepared endpoint HTTP spawnError refuses");
      assert.ok((badHttp.result.summary || "").includes("agent endpoint error: runner responded 500"), `concurrent HTTP-failure reason matches the serial wording (got: ${badHttp.result.summary})`);
      assert.ok(!/agent endpoint delegation failed/.test(badHttp.result.summary || ""), "an HTTP failure does NOT use the process-level 'delegation failed' wording");

      // A whole-batch-child process failure (reconcileBatchOutcomes' fallback,
      // prefixed `batch delegate failed:`) maps to the serial `child.error`
      // wording instead.
      const badProc = runBackend({
        schemaVersion: 1,
        cwd: pluginRoot,
        sandboxPolicy: ro,
        label: "endpoint-settle-proc-fail",
        backendId: "agent",
        manifest: { resultPath: path.join(dir, "none2.md"), prompt: "do it" },
        delegation: { endpoint: "http://127.0.0.1:9/never-called", model: "m" },
        preparedAgentOutcome: { spawnError: "batch delegate failed: spawn ENOMEM", exitCode: null, stdout: "" },
      });
      assert.equal(badProc.status, "refused", "a prepared batch-process failure refuses");
      assert.ok((badProc.result.summary || "").includes("agent endpoint delegation failed: batch delegate failed:"), `process-failure uses the delegation-failed wording (got: ${badProc.result.summary})`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log("endpoint-concurrent-round-smoke: PASS");
}

main().catch((e) => { console.error(e); process.exit(1); });
