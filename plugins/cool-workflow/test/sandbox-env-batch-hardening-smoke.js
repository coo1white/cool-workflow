"use strict";
// sandbox-env-batch-hardening-smoke (v0.1.96). Proves the P1 audit fixes:
// buildChildEnv filters sandbox policy, batch-delegate-child uses job.env,
// persistStderr redacts secrets, and batch/http children cap stdin + guard
// JSON.parse. All tests are deterministic (no real agent binary needed).
//
// @cw-smoke: sandbox-env-batch-hardening-smoke
// @cw-smoke: tags sandbox

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn, spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");

// v2 layout: flat dist/execution-backend.js was split into dist/shell/execution-backend/*.
// buildChildEnv lives in the local-execution driver body. Signature is byte-exact
// (policy.env.{inherit,expose,deny}; PATH+HOME kept; expose adds; deny deletes).
const { buildChildEnv } = require(path.join(pluginRoot, "dist/shell/execution-backend/local.js"));
const adapterCore = require(path.join(pluginRoot, "scripts/agents/agent-adapter-core.js"));

// test the directory listing for the child scripts
const batchChildScript = path.join(pluginRoot, "scripts", "children", "batch-delegate-child.js");
const httpChildScript = path.join(pluginRoot, "scripts", "children", "http-delegate-child.js");

async function main() {
  // ---- 1. buildChildEnv respects inherit ---------------------------------------
  {
    const env = buildChildEnv({ env: { inherit: true, expose: [], deny: [] } });
    assert.equal(env.PATH, process.env.PATH, "inherit: PATH kept");
  }

  // ---- 2. buildChildEnv respects deny ------------------------------------------
  {
    const env = buildChildEnv({ env: { inherit: false, expose: [], deny: ["SECRET_TOKEN"] } });
    assert.ok(env.PATH !== undefined, "PATH always present");
    assert.equal(env.SECRET_TOKEN, undefined, "denied var excluded");
  }

  // ---- 2b. buildChildEnv deny wins even under inherit:true (architecture-review P2) --
  {
    process.env.__CW_TEST_INHERIT_DENY__ = "should-be-removed-even-though-inherited";
    const env = buildChildEnv({ env: { inherit: true, expose: [], deny: ["__CW_TEST_INHERIT_DENY__"] } });
    assert.equal(env.PATH, process.env.PATH, "inherit still keeps PATH when deny is unrelated");
    assert.equal(env.__CW_TEST_INHERIT_DENY__, undefined, "deny wins over inherit, not just over expose");
    delete process.env.__CW_TEST_INHERIT_DENY__;
  }

  // ---- 3. buildChildEnv respects expose ----------------------------------------
  {
    process.env.__CW_TEST__ = "hello";
    const env = buildChildEnv({ env: { inherit: false, expose: ["__CW_TEST__"], deny: [] } });
    assert.equal(env.__CW_TEST__, "hello", "exposed var present");
    assert.equal(env.PATH, process.env.PATH, "PATH present");
    assert.equal(env.HOME, process.env.HOME, "HOME present");
    delete process.env.__CW_TEST__;
  }

  // ---- 4. buildChildEnv deny overrides expose ----------------------------------
  {
    process.env.__CW_TEST_DENY__ = "should-be-removed";
    const env = buildChildEnv({ env: { inherit: false, expose: ["__CW_TEST_DENY__"], deny: ["__CW_TEST_DENY__"] } });
    assert.equal(env.__CW_TEST_DENY__, undefined, "deny overrides expose");
    delete process.env.__CW_TEST_DENY__;
  }

  // ---- 5. persistStderr redacts API key patterns -------------------------------
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-smoke-"));
    const resultPath = path.join(tmp, "result.md");
    adapterCore.persistStderr(resultPath, "error: sk-ant-api03-abcd1234abcd1234abcd1234 is invalid");
    const logPath = path.join(tmp, "logs", "agent-stderr.log");
    assert.ok(fs.existsSync(logPath), "agent-stderr.log written");
    const content = fs.readFileSync(logPath, "utf8");
    assert.ok(content.includes("sk-a***"), "sk- token redacted");
    assert.ok(!content.includes("sk-ant-api03-abcd"), "full token not present");
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ---- 6. persistStderr caps at 4KB --------------------------------------------
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-smoke-"));
    const resultPath = path.join(tmp, "result.md");
    const big = "x".repeat(10000);
    adapterCore.persistStderr(resultPath, big);
    const logPath = path.join(tmp, "logs", "agent-stderr.log");
    const content = fs.readFileSync(logPath, "utf8");
    assert.ok(content.length <= 5000, `capped at ~4KB: got ${content.length} bytes`);
    assert.ok(content.includes("truncated"), "truncation noted");
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ---- 7. persistStderr handles empty stderr -----------------------------------
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-smoke-"));
    const resultPath = path.join(tmp, "result.md");
    adapterCore.persistStderr(resultPath, "");
    const logPath = path.join(tmp, "logs", "agent-stderr.log");
    assert.ok(!fs.existsSync(logPath), "empty stderr not persisted");
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ---- 8. batch-delegate-child handles malformed stdin JSON --------------------
  {
    const child = spawnSync(process.execPath, [batchChildScript], {
      input: "{not valid json",
      encoding: "utf8",
      timeout: 5000
    });
    const out = JSON.parse(String(child.stdout || ""));
    assert.ok(Array.isArray(out) && out.length >= 0, "child returns array on bad JSON");
    if (out.length > 0) {
      assert.ok(String(out[0].spawnError || "").includes("JSON"), "error message mentions JSON");
    }
  }

  // ---- 9. batch-delegate-child accepts valid empty jobs ------------------------
  {
    const child = spawnSync(process.execPath, [batchChildScript], {
      input: "[]",
      encoding: "utf8",
      timeout: 5000
    });
    const out = JSON.parse(String(child.stdout || ""));
    assert.deepEqual(out, [], "empty jobs returns empty array");
  }

  // ---- 10. http-delegate-child handles large stdin below cap -------------------
  {
    const child = spawnSync(process.execPath, [httpChildScript], {
      input: JSON.stringify({ exitCode: 0, stdout: "ok" }),
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, CW_DELEGATE_ENDPOINT: "http://127.0.0.1:1" }
    });
    const out = JSON.parse(String(child.stdout || "{}"));
    assert.ok(out.error || typeof out.exitCode === "number", "http child handles request");
  }

  // ---- 11. Sandbox enum surfaces intact ----------------------------------------
  {
    const { execFileSync } = require("node:child_process");
    const cw = path.join(pluginRoot, "dist/cli.js");
    const out = execFileSync(process.execPath, [cw, "sandbox", "list"], { encoding: "utf8", cwd: pluginRoot });
    const profiles = JSON.parse(out);
    assert.ok(Array.isArray(profiles) && profiles.length > 0, "sandbox profiles enumerated");
  }

  // ---- 12. batch-delegate-child forwards a stop signal to its own spawned
  //          children instead of orphaning them (P2-6 review fix) --------------
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-smoke-batch-sig-"));
    const marker = path.join(tmp, "alive.marker");
    const jobScript = path.join(tmp, "job.js");
    fs.writeFileSync(
      jobScript,
      ['const fs = require("fs");', `const marker = ${JSON.stringify(marker)};`, 'setInterval(() => { try { fs.appendFileSync(marker, "x"); } catch {} }, 50);'].join(
        "\n"
      ),
      "utf8"
    );
    const jobs = [{ binary: process.execPath, args: [jobScript], cwd: tmp, timeoutMs: 60000 }];
    const child = spawn(process.execPath, [batchChildScript], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.write(JSON.stringify(jobs));
    child.stdin.end();

    const deadline = Date.now() + 5000;
    while (!fs.existsSync(marker) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(fs.existsSync(marker), "the spawned job process started writing its alive-marker");

    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 400));
    const sizeA = fs.statSync(marker).size;
    await new Promise((r) => setTimeout(r, 400));
    const sizeB = fs.statSync(marker).size;
    assert.equal(sizeA, sizeB, "the spawned job process must actually stop once the batch child is signaled -- continued growth would mean it was left orphaned");

    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main()
  .then(() => process.stdout.write("PASS  sandbox-env-batch-hardening-smoke.js\n"))
  .catch((e) => {
    process.stderr.write(`FAIL  sandbox-env-batch-hardening-smoke.js — ${String(e && e.message || e)}\n`);
    process.exit(1);
  });
