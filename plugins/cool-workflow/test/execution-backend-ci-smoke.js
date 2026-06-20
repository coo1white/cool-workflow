"use strict";
// execution-backend-ci-smoke (v0.1.88). Proves the CI backend integrates through
// the full dispatch path: success-path completion, canonical evidence shape,
// handle-in-provenance, probe readiness, and fail-closed refusals.
//
// The CI backend shares runHttpDelegation with the remote backend — it POSTs the
// job to CW_CI_ENDPOINT and records the runner's exit + stdout digest as canonical
// evidence. Existing tests cover only refusal (no CW_CI_ENDPOINT set). This smoke
// proves the success path with a fake local HTTP runner.

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const { runBackend, sha256, probeBackend } = require(path.join(pluginRoot, "dist/execution-backend.js"));
const { showBundledSandboxProfile, sandboxContextForValidation } = require(path.join(pluginRoot, "dist/sandbox-profile.js"));

const ctx = sandboxContextForValidation(pluginRoot);
const ro = showBundledSandboxProfile("readonly", ctx);
for (const v of ["CW_REMOTE_ENDPOINT", "CW_CI_ENDPOINT", "CW_CONTAINER_IMAGE", "CW_BACKEND"]) delete process.env[v];

const base = { schemaVersion: 1, cwd: pluginRoot, sandboxPolicy: ro, label: "ci-smoke" };
const isRefused = (e) => e.status === "refused" && e.provenance.attestation.status === "refused" && !e.evidence.some((x) => x.startsWith("stdoutSha256:"));
const code = (e) => (e.evidence[0] || "").replace("refused:", "");

async function main() {
  // ---- 1. FAIL CLOSED: no endpoint configured ----------------------------------
  const ciNoTarget = runBackend({ ...base, backendId: "ci", command: "echo", args: ["hi"], delegation: {} });
  assert.ok(isRefused(ciNoTarget) && code(ciNoTarget) === "delegation-target-missing", "ci w/o endpoint refuses (code: delegation-target-missing)");

  const ciNoCommand = runBackend({ ...base, backendId: "ci", delegation: { endpoint: "http://127.0.0.1:1" } });
  assert.ok(isRefused(ciNoCommand) && code(ciNoCommand) === "no-command", "ci w/o command refuses (code: no-command)");

  // ---- 2. PROBE: unconfigured -> unverified -----------------------------------
  {
    delete process.env.CW_CI_ENDPOINT;
    const probe = probeBackend("ci");
    assert.equal(probe.readiness, "unverified", "ci probe is unverified when CW_CI_ENDPOINT is not set");
    assert.ok(probe.checks.some((c) => c.name === "ci-endpoint" && !c.ok), "ci-endpoint check is not ok when unset");
  }

  // ---- 3. SUCCESS PATH via a fake local CI runner (separate process) -----------
  const SERVER = `
    const http = require("http");
    const s = http.createServer((req, res) => {
      let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
        const job = JSON.parse(b || "{}");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ exitCode: 0, stdout: "CI_RUNNER_OK:" + job.command + ":" + (job.jobId || "no-job") }));
      });
    });
    s.listen(0, "127.0.0.1", () => process.stdout.write("PORT:" + s.address().port + "\\n"));
  `;
  const server = spawn(process.execPath, ["-e", SERVER], { stdio: ["ignore", "pipe", "ignore"] });
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("fake CI runner did not start")), 8000);
      server.stdout.on("data", (d) => { const m = /PORT:(\d+)/.exec(String(d)); if (m) { clearTimeout(timer); resolve(Number(m[1])); } });
    });

    const endpoint = `http://127.0.0.1:${port}`;
    process.env.CW_CI_ENDPOINT = endpoint;

    // (a) probe is ready when CW_CI_ENDPOINT is set
    const probe = probeBackend("ci");
    assert.equal(probe.readiness, "ready", "ci probe is ready when CW_CI_ENDPOINT is set");
    assert.ok(probe.checks.some((c) => c.name === "ci-endpoint" && c.ok), "ci-endpoint check is ok when set");

    // (b) runBackend -> completed, canonical evidence, handle in provenance
    const ci = runBackend({
      ...base,
      backendId: "ci",
      command: "check",
      args: ["--mode", "verify"],
      delegation: { jobId: "ci-job-42" }
    });
    delete process.env.CW_CI_ENDPOINT;

    assert.equal(ci.status, "completed", "ci backend against the fake runner completes");
    assert.equal(ci.provenance.backendId, "ci", "provenance records the CI backend id");
    assert.equal(ci.provenance.kind, "delegating", "ci is a delegating backend");
    assert.equal(ci.provenance.locality, "remote", "ci locality is remote");

    // canonical evidence shape: command, exitCode, stdoutSha256
    assert.deepEqual(
      ci.evidence.map((e) => e.split(":")[0]),
      ["command", "exitCode", "stdoutSha256"],
      "ci delegated evidence is the canonical shape, byte-stable vs node"
    );
    assert.ok(ci.evidence.includes("command:check --mode verify"), "command line recorded verbatim");
    assert.ok(ci.evidence.includes("exitCode:0"), "the runner's exit code is recorded");
    const expectedStdout = sha256("CI_RUNNER_OK:check:ci-job-42");
    assert.ok(ci.evidence.includes(`stdoutSha256:${expectedStdout}`), "stdout digest is the runner's real output");

    // the handle lives in provenance, NEVER in evidence
    assert.ok(ci.provenance.handle, "ci records a delegation handle in provenance");
    assert.equal(ci.provenance.handle.kind, "ci", "handle kind is ci");
    assert.equal(ci.provenance.handle.jobId, "ci-job-42", "handle carries the jobId");
    assert.equal(ci.provenance.handle.endpoint, endpoint, "handle carries the endpoint");
    assert.equal(ci.provenance.handle.ref, `${endpoint}#ci-job-42`, "handle ref is endpoint#jobId");
    assert.ok(!ci.evidence.some((e) => e.startsWith("handle:") || e.startsWith("delegated:")), "handle/delegated are NOT in evidence (byte-stability)");

    // attestation is recorded
    assert.ok(ci.provenance.attestation, "ci records a sandbox attestation");
    assert.ok(["enforced", "attested"].includes(ci.provenance.attestation.status), "attestation is honored, not refused");

    // (c) runBackend with delegation endpoint also works (no env needed)
    const ci2 = runBackend({
      ...base,
      backendId: "ci",
      command: "lint",
      args: ["--fix"],
      delegation: { endpoint, jobId: "ci-job-43" }
    });
    assert.equal(ci2.status, "completed", "ci with delegation endpoint completes");
    assert.ok(ci2.evidence.includes("command:lint --fix"), "command recorded from delegation path");
    assert.ok(ci2.evidence.includes(`stdoutSha256:${sha256("CI_RUNNER_OK:lint:ci-job-43")}`), "stdout digest matches");

  } finally {
    server.kill();
  }

  // ---- 4. FAIL CLOSED: unreachable endpoint ------------------------------------
  {
    const unreachable = runBackend({
      ...base,
      backendId: "ci",
      command: "echo",
      args: ["hi"],
      delegation: { endpoint: "http://127.0.0.1:1/none" }
    });
    assert.ok(isRefused(unreachable) && code(unreachable) === "delegation-failed", "ci unreachable endpoint refuses (code: delegation-failed)");
  }

  process.stdout.write("execution-backend-ci-smoke: ok (fail-closed refusals + real HTTP delegation produces canonical, handle-in-provenance evidence + probe readiness)\n");
}

main().catch((e) => {
  process.stderr.write(`execution-backend-ci-smoke: FAILED\n${e.stack || e.message}\n`);
  process.exit(1);
});
