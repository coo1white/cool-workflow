"use strict";
// real-execution-backends-smoke (v0.1.34). Proves the delegating backends really
// execute and fail closed — WITHOUT requiring a container daemon (CI has none):
//   1. FAIL CLOSED: no image / no endpoint / no command / unreachable endpoint /
//      container with no runtime-or-daemon  -> status "refused", no output digest.
//   2. HAPPY PATH (remote, via a FAKE local HTTP runner in a separate process):
//      real POST -> canonical command:/exitCode:/stdoutSha256: evidence, byte-stable
//      SHAPE vs node, handle recorded in provenance (NEVER in evidence).
// The container happy-path (real docker run) needs a live daemon and is exercised
// separately when one is available.

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const { runBackend, sha256 } = require(path.join(pluginRoot, "dist/execution-backend.js"));
const { showBundledSandboxProfile, sandboxContextForValidation } = require(path.join(pluginRoot, "dist/sandbox-profile.js"));

const ctx = sandboxContextForValidation(pluginRoot);
const ro = showBundledSandboxProfile("readonly", ctx);
for (const v of ["CW_REMOTE_ENDPOINT", "CW_CI_ENDPOINT", "CW_CONTAINER_IMAGE", "CW_REMOTE_JOB", "CW_CI_JOB", "CW_BACKEND"]) delete process.env[v];

const base = { schemaVersion: 1, cwd: pluginRoot, sandboxPolicy: ro, label: "t" };
const isRefused = (e) => e.status === "refused" && e.provenance.attestation.status === "refused" && !e.evidence.some((x) => x.startsWith("stdoutSha256:"));
const code = (e) => (e.evidence[0] || "").replace("refused:", "");

async function main() {
  // --- 1. FAIL CLOSED -------------------------------------------------------
  const noImage = runBackend({ ...base, backendId: "container", command: "node", args: ["-v"], delegation: {} });
  assert.ok(isRefused(noImage) && code(noImage) === "delegation-target-missing", "container w/o image refuses");

  const noEndpoint = runBackend({ ...base, backendId: "remote", command: "echo", args: ["hi"], delegation: {} });
  assert.ok(isRefused(noEndpoint) && code(noEndpoint) === "delegation-target-missing", "remote w/o endpoint refuses");

  const ciNoTarget = runBackend({ ...base, backendId: "ci", command: "echo", args: ["hi"], delegation: {} });
  assert.ok(isRefused(ciNoTarget) && code(ciNoTarget) === "delegation-target-missing", "ci w/o target refuses");

  const noCommand = runBackend({ ...base, backendId: "remote", delegation: { endpoint: "http://127.0.0.1:1" } });
  assert.ok(isRefused(noCommand) && code(noCommand) === "no-command", "delegating w/o command refuses");

  const unreachable = runBackend({ ...base, backendId: "remote", command: "echo", args: ["hi"], delegation: { endpoint: "http://127.0.0.1:1/none" } });
  assert.ok(isRefused(unreachable) && code(unreachable) === "delegation-failed", "remote unreachable endpoint refuses (real POST failed)");

  // container with an image but NO reachable runtime/daemon must refuse too
  // (no fabricated completion). Works whether docker is absent or its daemon is down.
  const containerImage = runBackend({ ...base, backendId: "container", command: "node", args: ["-e", "0"], delegation: { image: "node:lts-slim" } });
  assert.ok(
    containerImage.status === "completed" || isRefused(containerImage),
    "container w/ image either completes (live daemon) or refuses (no runtime/daemon) — never fabricates"
  );
  if (isRefused(containerImage)) assert.equal(code(containerImage), "runtime-unavailable", "container w/o reachable daemon refuses runtime-unavailable");

  // --- 2. HAPPY PATH via a fake remote runner (separate process) ------------
  const SERVER = `
    const http = require("http");
    const s = http.createServer((req, res) => {
      let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
        const job = JSON.parse(b || "{}");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ exitCode: 0, stdout: "FAKE_RUNNER_OK:" + job.command }));
      });
    });
    s.listen(0, "127.0.0.1", () => process.stdout.write("PORT:" + s.address().port + "\\n"));
  `;
  const server = spawn(process.execPath, ["-e", SERVER], { stdio: ["ignore", "pipe", "ignore"] });
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("fake runner did not start")), 8000);
      server.stdout.on("data", (d) => { const m = /PORT:(\d+)/.exec(String(d)); if (m) { clearTimeout(timer); resolve(Number(m[1])); } });
    });

    const remote = runBackend({ ...base, backendId: "remote", command: "echo", args: ["a", "b"], delegation: { endpoint: `http://127.0.0.1:${port}` } });
    assert.equal(remote.status, "completed", "remote against the fake runner completes");

    // canonical evidence, identical shape to node (command:/exitCode:/stdoutSha256:)
    assert.deepEqual(
      remote.evidence.map((e) => e.split(":")[0]),
      ["command", "exitCode", "stdoutSha256"],
      "delegated evidence is the canonical shape, byte-stable vs node"
    );
    assert.ok(remote.evidence.includes("command:echo a b"), "command line recorded verbatim");
    assert.ok(remote.evidence.includes("exitCode:0"), "the runner's exit code is recorded");
    assert.ok(remote.evidence.includes(`stdoutSha256:${sha256("FAKE_RUNNER_OK:echo")}`), "stdout digest is the runner's real output");

    // the handle lives in provenance, NEVER in evidence
    assert.ok(remote.provenance.handle && remote.provenance.handle.kind === "remote", "handle recorded in provenance");
    assert.ok(!remote.evidence.some((e) => e.startsWith("handle:") || e.startsWith("delegated:")), "handle/delegated are NOT in evidence (byte-stability)");
    assert.ok(typeof sha256 === "function", "sha256 is exported for evidence parity");
  } finally {
    server.kill();
  }

  process.stdout.write("real-execution-backends-smoke: ok (fail-closed refusals + real HTTP delegation produces canonical, handle-in-provenance evidence)\n");
}

main().catch((e) => {
  process.stderr.write(`real-execution-backends-smoke: FAILED\n${e.stack || e.message}\n`);
  process.exit(1);
});
