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
const { buildChildEnv, CW_NEVER_FORWARD_ENV } = require(path.join(pluginRoot, "dist/shell/execution-backend/local.js"));
const { buildAgentChildEnv } = require(path.join(pluginRoot, "dist/shell/execution-backend/agent.js"));
const { buildContainerEnvArgs } = require(path.join(pluginRoot, "dist/shell/execution-backend/container.js"));
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

  // ---- 4c. CW's own secrets are NEVER forwarded to a child (security audit) -----
  // buildAgentChildEnv re-adds every CW_* var (the CW_ arm of
  // AGENT_PROVIDER_KEY_ENV_RE), which used to sweep in CW_RELEASE_VERDICT_PRIVKEY
  // and CW_WORKBENCH_TOKEN — the release signing key and the workbench bearer
  // token — into EVERY spawned agent child unless the operator remembered to
  // deny each by name. Both are now on a fail-closed CW_NEVER_FORWARD_ENV list
  // that wins over inherit/expose/deny AND over the provider-key re-add. The
  // agent-attest private key is deliberately NOT on the list: the attest
  // wrapper runs as the agent and must receive it.
  {
    const base = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      // Plain marker strings, never real-secret shapes: the test checks these vars
      // by NAME (present/absent/equal), so the value is irrelevant — and a real PEM
      // block here would trip the gitleaks `private-key` rule in the `scan` gate.
      CW_RELEASE_VERDICT_PRIVKEY: "verdict-signing-key-PLACEHOLDER-not-real",
      CW_WORKBENCH_TOKEN: "workbench-token-PLACEHOLDER-not-real",
      CW_AGENT_ATTEST_PRIVKEY: "attest-signing-key-PLACEHOLDER-not-real",
      CW_AGENT_MODEL: "some-model",
      ANTHROPIC_API_KEY: "sk-ant-not-a-real-key",
    };

    // The constant lists exactly the two parent-only secrets, and NOT the attest key.
    assert.ok(CW_NEVER_FORWARD_ENV.has("CW_RELEASE_VERDICT_PRIVKEY"), "verdict key on never-forward list");
    assert.ok(CW_NEVER_FORWARD_ENV.has("CW_WORKBENCH_TOKEN"), "workbench token on never-forward list");
    assert.ok(!CW_NEVER_FORWARD_ENV.has("CW_AGENT_ATTEST_PRIVKEY"), "attest key NOT on the list (wrapper needs it)");

    // buildChildEnv under inherit:true would forward everything — the backstop strips the two secrets.
    const inherited = buildChildEnv({ env: { inherit: true, expose: [], deny: [] } }, base);
    assert.equal(inherited.CW_RELEASE_VERDICT_PRIVKEY, undefined, "inherit:true still strips the verdict key");
    assert.equal(inherited.CW_WORKBENCH_TOKEN, undefined, "inherit:true still strips the workbench token");
    assert.equal(inherited.CW_AGENT_MODEL, "some-model", "non-secret CW_ config still inherited");

    // buildAgentChildEnv under a locked-down (inherit:false) policy: the provider-key
    // re-add must NOT put the two secrets back, but MUST still forward the attest key + others.
    const { env, forwarded } = buildAgentChildEnv({ env: { inherit: false, expose: [], deny: [] } }, base);
    assert.equal(env.CW_RELEASE_VERDICT_PRIVKEY, undefined, "verdict key never re-added to agent child");
    assert.equal(env.CW_WORKBENCH_TOKEN, undefined, "workbench token never re-added to agent child");
    assert.equal(env.CW_AGENT_ATTEST_PRIVKEY, base.CW_AGENT_ATTEST_PRIVKEY, "attest key STILL forwarded (wrapper signs with it)");
    assert.equal(env.CW_AGENT_MODEL, "some-model", "non-secret CW_ config still forwarded");
    assert.equal(env.ANTHROPIC_API_KEY, base.ANTHROPIC_API_KEY, "provider key still forwarded");
    assert.ok(!forwarded.includes("CW_RELEASE_VERDICT_PRIVKEY"), "trust-audit forwarded[] excludes the verdict key");
    assert.ok(!forwarded.includes("CW_WORKBENCH_TOKEN"), "trust-audit forwarded[] excludes the workbench token");
    assert.ok(forwarded.includes("CW_AGENT_ATTEST_PRIVKEY"), "trust-audit forwarded[] still records the attest key");

    // Even an explicit expose of a never-forward secret loses to the backstop.
    const exposed = buildChildEnv({ env: { inherit: false, expose: ["CW_WORKBENCH_TOKEN"], deny: [] } }, base);
    assert.equal(exposed.CW_WORKBENCH_TOKEN, undefined, "explicit expose cannot override the never-forward backstop");

    // The container backend builds its own `-e` args (NOT via buildChildEnv), so it
    // must apply the same backstop — else inherit:true still copies the secrets in.
    const containerArgs = buildContainerEnvArgs({ env: { inherit: true, expose: [], deny: [] } }, base);
    const flat = containerArgs.join("\n");
    assert.ok(!/CW_RELEASE_VERDICT_PRIVKEY=/.test(flat), "container -e args exclude the verdict key under inherit:true");
    assert.ok(!/CW_WORKBENCH_TOKEN=/.test(flat), "container -e args exclude the workbench token under inherit:true");
    assert.ok(/CW_AGENT_ATTEST_PRIVKEY=/.test(flat), "container still passes the attest key (wrapper needs it)");
    assert.ok(/CW_AGENT_MODEL=some-model/.test(flat), "container still passes non-secret CW_ config");
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
