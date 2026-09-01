#!/usr/bin/env node
"use strict";

// agent-muse-native-smoke -- the Muse Code builtin agent adapter works
// without a live muse login. A PATH shim stands in for `muse exec`, using
// the recorded 1.0.1 shape: a non-JSON banner, lifecycle noise, then a
// DISTINCT `run.terminal.completed`/`.failed` record. Also pins `-muse`.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const wrapper = path.join(pluginRoot, "scripts", "agents", "muse-agent.js");

const RESULT = `# Analysis

muse shim answer

\`\`\`cw:result
{
  "summary": "muse shim answer",
  "findings": [],
  "evidence": ["README.md:1"]
}
\`\`\`
`;

// Probed real example: the vendor's own words, printed verbatim, not paraphrased.
const REASON = "your saved API key was rejected — run `muse login` or add a new key";

function shimDir(behavior) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-muse-shim-"));
  const shim = path.join(dir, "muse");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const promptFile = args[args.indexOf("--prompt-file") + 1];
const prompt = fs.readFileSync(promptFile, "utf8");
fs.writeFileSync(path.join(__dirname, "invocation.json"), JSON.stringify({ args, prompt }));
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
// muse prints a non-JSON banner line before any record -- must be tolerated.
process.stdout.write("muse: workspace root: /private/tmp (cwd default)\\n");
if (${JSON.stringify(behavior)} === "crash") {
  process.stderr.write("muse shim boom");
  process.exit(3);
}
if (${JSON.stringify(behavior)} === "garbage") {
  process.stdout.write("{not-json\\n");
  process.exit(0);
}
// 1.0.1 lifecycle noise the parser must ignore without choking.
for (const t of ["runtime.command.accepted", "session.run.linked", "turn.input.user", "run.lifecycle.started", "task.lifecycle.started"]) emit({ payload_type: t, payload: {} });
emit({ payload_type: "run.output.delta", payload: { text: ${JSON.stringify(RESULT)} } });
if (${JSON.stringify(behavior)} === "noterminal") { process.exit(0); }
if (${JSON.stringify(behavior)} === "failed") {
  // 1.0.1: a failure is a DISTINCT payload_type, "run.terminal.failed" --
  // not "run.terminal.completed" with a varying payload.terminal.
  emit({ payload_type: "run.terminal.failed", payload: { terminal: "failed", text: null, reason: ${JSON.stringify(REASON)} } });
  process.exit(0);
}
emit({
  payload_type: "run.terminal.completed",
  payload: { terminal: "completed", text: ${JSON.stringify(RESULT)}, reason: null },
  usage: ${JSON.stringify(behavior)} === "meta" ? { input_tokens: 11, output_tokens: 4 } : undefined
});
process.exit(0);
`;
  fs.writeFileSync(shim, source, "utf8");
  fs.chmodSync(shim, 0o755);
  return dir;
}

function runWrapper(dir, inputPath, resultPath, extraEnv = {}) {
  return spawnSync(process.execPath, [wrapper, inputPath, resultPath], {
    encoding: "utf8",
    env: { ...process.env, ...extraEnv, PATH: `${dir}${path.delimiter}${process.env.PATH}` },
    timeout: 30000
  });
}

function readInvocation(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "invocation.json"), "utf8"));
}

function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cw-muse-wrapper-smoke-"));
  const inputPath = path.join(work, "input.md");
  const resultPath = path.join(work, "result.md");
  const marker = "Check release path marker-muse-7.";
  fs.writeFileSync(inputPath, `# Worker w-1\n\n- Result: ${resultPath}\n\n## Task\n\n${marker}\n`, "utf8");

  {
    const dir = shimDir("ok");
    const child = runWrapper(dir, inputPath, resultPath);
    assert.equal(child.status, 0, `muse wrapper exits 0 (stderr: ${child.stderr})`);
    const invocation = readInvocation(dir);
    assert.deepEqual(invocation.args.slice(0, 2), ["exec", "--json"], "muse runs in exec JSON mode");
    assert.ok(invocation.args.includes("--prompt-file"), "muse takes the prompt from a file");
    assert.equal(invocation.args[invocation.args.indexOf("--model") + 1], "muse-spark-1.2", "default model is Meta's official id muse-spark-1.2, not bare spark");
    assert.ok(invocation.args.includes("--workspace"), "muse gets --workspace so its own tools root at the worker dir");
    assert.equal(invocation.args[invocation.args.indexOf("--reasoning-effort") + 1], "low", "default reasoning effort is low (fast delegated worker)");
    assert.ok(invocation.prompt.includes(marker), "worker input reaches muse via --prompt-file");
    assert.ok(invocation.prompt.includes("cw:result"), "cw result contract is appended");
    assert.equal(fs.readFileSync(resultPath, "utf8"), RESULT, "terminal.completed text is persisted to result.md");
    assert.equal(child.stderr, "", "default piped success is silent on stderr");
    const report = JSON.parse(child.stdout);
    assert.equal(report.model, "muse-spark-1.2", "model is self-reported: the id actually passed via --model");
    assert.equal(report.result, RESULT, "stdout report carries final result for CW provenance");
    console.log("muse: default prompt-file + terminal.completed + non-JSON banner tolerance OK");
  }

  {
    // CW_RELEASE_REVIEW=1 raises the default effort to "high"; an explicit
    // CW_MUSE_REASONING_EFFORT always wins over that signal.
    for (const [env, expected] of [[{ CW_RELEASE_REVIEW: "1" }, "high"], [{ CW_RELEASE_REVIEW: "1", CW_MUSE_REASONING_EFFORT: "medium" }, "medium"]]) {
      fs.rmSync(resultPath, { force: true });
      const dir = shimDir("ok");
      const child = runWrapper(dir, inputPath, resultPath, env);
      assert.equal(child.status, 0, `muse wrapper exits 0 (stderr: ${child.stderr})`);
      assert.equal(readInvocation(dir).args[readInvocation(dir).args.indexOf("--reasoning-effort") + 1], expected, `effort resolves to ${expected} for ${JSON.stringify(env)}`);
    }
    console.log("muse: --reasoning-effort default/review/override OK");
  }

  {
    fs.rmSync(resultPath, { force: true });
    const child = runWrapper(shimDir("ok"), inputPath, resultPath, { CW_MUSE_MODEL: "muse-large" });
    assert.equal(child.status, 0, `custom-model muse wrapper exits 0 (stderr: ${child.stderr})`);
    const report = JSON.parse(child.stdout);
    assert.equal(report.model, "muse-large", "CW_MUSE_MODEL overrides the self-reported model");
    console.log("muse: CW_MUSE_MODEL override OK");
  }

  {
    fs.rmSync(resultPath, { force: true });
    const child = runWrapper(shimDir("meta"), inputPath, resultPath);
    assert.equal(child.status, 0, `usage-bearing muse wrapper exits 0 (stderr: ${child.stderr})`);
    const report = JSON.parse(child.stdout);
    assert.equal(report.usage.input_tokens, 11, "a usage-bearing event (meta provider) is reported when present");
    console.log("muse: best-effort usage extraction OK");
  }

  {
    // FAIL CLOSED on terminal !== "completed", result.md ABSENT; a
    // "run.terminal.failed" record's payload.reason is the WHOLE stderr line.
    fs.rmSync(resultPath, { force: true });
    const failed = runWrapper(shimDir("failed"), inputPath, resultPath);
    assert.notEqual(failed.status, 0, "terminal !== completed must exit non-zero");
    assert.ok(!fs.existsSync(resultPath), "no result.md when terminal !== completed");
    assert.match(failed.stderr, new RegExp(`^${REASON.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n$`), "payload.reason from run.terminal.failed is the wrapper's whole error line, word for word");

    const noTerminal = runWrapper(shimDir("noterminal"), inputPath, resultPath);
    assert.notEqual(noTerminal.status, 0, "a run that ends with no terminal event must exit non-zero");
    assert.ok(!fs.existsSync(resultPath), "no result.md when no terminal event was seen");

    const crash = runWrapper(shimDir("crash"), inputPath, resultPath);
    assert.notEqual(crash.status, 0, "a non-zero muse exit must exit non-zero");
    assert.ok(!fs.existsSync(resultPath), "no result.md on a crashing muse exit");

    const garbage = runWrapper(shimDir("garbage"), inputPath, resultPath);
    assert.notEqual(garbage.status, 0, "an unparseable JSON-looking line fails closed");
    assert.ok(!fs.existsSync(resultPath), "no result.md on an unparseable stream");
    console.log("muse: fail-closed on terminal!=completed / no-terminal / crash / unparseable stream OK");
  }

  {
    fs.rmSync(resultPath, { force: true });
    const child = runWrapper(shimDir("ok"), inputPath, resultPath, { CW_AGENT_STREAM: "1" });
    assert.equal(child.status, 0, `stream muse wrapper exits 0 (stderr: ${child.stderr})`);
    assert.ok(!/\x1b\[/.test(child.stderr), "non-TTY trace carries NO ANSI/cursor escapes");
    assert.equal(fs.readFileSync(resultPath, "utf8"), RESULT, "stream path still persists the final message");
    console.log("muse: CW_AGENT_STREAM=1 piped success OK");
  }

  {
    // -muse flag reaches builtin:muse, and the running list mechanism
    // (src/shell/agent-config.ts's `known` array) auto-detects it too.
    const { resolveAgentConfig } = require(path.join(pluginRoot, "dist", "shell", "agent-config.js"));
    const cfg = resolveAgentConfig({ "agent-command": "builtin:muse" }, {});
    assert.ok(cfg.command && cfg.command.includes("muse-agent.js"), "builtin:muse expands to the packaged wrapper");
    assert.ok(cfg.command.includes("{{input}}") && cfg.command.includes("{{result}}"), "expanded template carries worker substitutions");

    const shim = fs.mkdtempSync(path.join(os.tmpdir(), "cw-muse-detect-"));
    try {
      const binDir = path.join(shim, "bin");
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, "muse"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const env = { PATH: binDir, HOME: shim };
      const detected = resolveAgentConfig({}, env);
      assert.equal(detected.source, "auto", "a muse binary on PATH must be auto-detected");
      assert.ok(detected.command && detected.command.includes("muse-agent.js"), "auto-detected muse resolves to muse-agent.js");
    } finally {
      fs.rmSync(shim, { recursive: true, force: true });
    }
    console.log("muse: builtin:muse resolution + auto-detect OK");
  }

  {
    const cli = path.join(pluginRoot, "dist", "cli.js");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-muse-flag-"));
    const cwHome = path.join(tmp, "home");
    fs.mkdirSync(cwHome, { recursive: true });
    try {
      const env = { ...process.env, CW_NO_AUTO_AGENT: "1", CW_HOME: cwHome };
      delete env.CW_AGENT_COMMAND;
      const r = spawnSync(process.execPath, [cli, "quickstart", "-q", "x", "--check", "--json", "--repo", tmp, "-muse"], { encoding: "utf8", env });
      const payload = JSON.parse(r.stdout);
      const agent = payload.checks.find((c) => c.name === "agent");
      assert.ok(agent, "the --check payload must have an 'agent' check");
      assert.equal(agent.status, "ok", "-muse must pin the agent (builtin:muse), like -claude/-codex/-gemini/-deepseek");
      assert.equal(r.status, 0, "an all-ok --check must exit 0");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    console.log("muse: -muse CLI flag pins builtin:muse OK");
  }

  fs.rmSync(work, { recursive: true, force: true });
  console.log("agent-muse-native-smoke: ok");
}

main();
