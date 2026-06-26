#!/usr/bin/env node
"use strict";

// gemini-agent-wrapper-smoke -- the Gemini builtin agent adapter works without
// a live Gemini login. A PATH shim stands in for `gemini`.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const wrapper = path.join(pluginRoot, "scripts", "agents", "gemini-agent.js");

const RESULT = `# Analysis

gemini shim answer

\`\`\`cw:result
{
  "summary": "gemini shim answer",
  "findings": [],
  "evidence": ["README.md:1"]
}
\`\`\`
`;

function shimDir(behavior) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-gemini-shim-"));
  const shim = path.join(dir, "gemini");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.writeFileSync(path.join(__dirname, "invocation.json"), JSON.stringify(args));
if (${JSON.stringify(behavior)} === "crash") {
  process.stderr.write("gemini shim boom");
  process.exit(3);
}
const formatFlag = args.indexOf("--output-format");
const format = formatFlag >= 0 ? args[formatFlag + 1] : "text";
if (${JSON.stringify(behavior)} === "garbage") {
  process.stdout.write("not-json\\n");
  process.exit(0);
}
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
if (format !== "stream-json" && format !== "json") {
  process.stdout.write(${JSON.stringify(RESULT)});
  process.exit(0);
}
emit({ type: "system", subtype: "init" });
emit({ type: "assistant", message: { model: "gemini-shim-model", content: "reading repo..." } });
emit({ type: "tool_call", name: "Read", args: { file_path: "README.md" } });
emit({ type: "delta", text: "# Analysis\\n\\ngemini shim answer" });
emit({ type: "turn_completed", usage: { input_tokens: 15, output_tokens: 9 }, status: "done" });
emit({ type: "result", subtype: "success", result: ${JSON.stringify(RESULT)} });
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
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cw-gemini-wrapper-smoke-"));
  const inputPath = path.join(work, "input.md");
  const resultPath = path.join(work, "result.md");
  const marker = "Check release path marker-gemini-99.";
  fs.writeFileSync(inputPath, `# Worker w-1\n\n- Result: ${resultPath}\n\n## Task\n\n${marker}\n`, "utf8");

  {
    const dir = shimDir("ok");
    const child = runWrapper(dir, inputPath, resultPath);
    assert.equal(child.status, 0, `gemini wrapper exits 0 (stderr: ${child.stderr})`);
    const invocation = readInvocation(dir);
    assert.ok(invocation.includes("-p"), "gemini runs with -p");
    const pIndex = invocation.indexOf("-p");
    const prompt = invocation[pIndex + 1];
    assert.ok(prompt.includes(marker), "worker input reaches gemini stdin");
    assert.ok(prompt.includes("cw:result"), "cw result contract is appended");
    const formatIdx = invocation.indexOf("--output-format");
    assert.deepEqual(invocation.slice(formatIdx, formatIdx + 2), ["--output-format", "stream-json"]);
    assert.ok(invocation.includes("--approval-mode"), "gemini runs in approval mode");
    const approvalIdx = invocation.indexOf("--approval-mode");
    assert.equal(invocation[approvalIdx + 1], "plan", "approval-mode plan = read-only");
    assert.equal(fs.readFileSync(resultPath, "utf8"), RESULT, "final message persisted to result.md");
    assert.equal(child.stderr, "", "default piped success is silent on stderr");
    const report = JSON.parse(child.stdout);
    assert.equal(report.model, "gemini-shim-model", "model extracted from JSONL events");
    assert.equal(report.usage.input_tokens, 15, "usage extracted from JSONL events");
    assert.equal(report.result, RESULT, "stdout report carries final result for CW provenance");
    console.log("gemini: default prompt + stream-json + approval-mode plan + result persistence OK");
  }

  {
    fs.rmSync(resultPath, { force: true });
    const dir = shimDir("ok");
    const child = runWrapper(dir, inputPath, resultPath, { CW_AGENT_STREAM: "1" });
    assert.equal(child.status, 0, `stream gemini wrapper exits 0 (stderr: ${child.stderr})`);
    assert.ok(!/\x1b\[/.test(child.stderr), "non-TTY trace carries NO ANSI/cursor escapes");
    assert.match(child.stderr, /→ gemini: reading/, "CW_AGENT_STREAM=1 opts non-TTY into a plain append-only trace");
    assert.equal(fs.readFileSync(resultPath, "utf8"), RESULT, "stream path persists final message");
    console.log("gemini: CW_AGENT_STREAM=1 piped success OK");
  }

  {
    fs.rmSync(resultPath, { force: true });
    const crash = runWrapper(shimDir("crash"), inputPath, resultPath);
    assert.notEqual(crash.status, 0, "crashing gemini exits nonzero");
    assert.ok(!fs.existsSync(resultPath), "no result.md on crash");

    const garbage = runWrapper(shimDir("garbage"), inputPath, resultPath);
    assert.notEqual(garbage.status, 0, "non-JSONL gemini stdout fails closed");
    console.log("gemini: fail-closed on crash + garbage output OK");
  }

  {
    const { resolveAgentConfig } = require(path.join(pluginRoot, "dist", "agent-config.js"));
    // builtin:gemini now routes through opencode (where the user's key lives);
    // the native Gemini CLI wrapper is preserved as builtin:gemini-cli.
    const cfg = resolveAgentConfig({ "agent-command": "builtin:gemini-cli" }, {});
    assert.ok(cfg.command && cfg.command.includes("gemini-agent.js"), "builtin:gemini-cli expands to the native Gemini CLI wrapper");
    assert.ok(cfg.command.includes("{{input}}") && cfg.command.includes("{{result}}"), "expanded template carries worker substitutions");
    assert.throws(() => resolveAgentConfig({ "agent-command": "builtin:nope" }, {}), /Unknown builtin agent template/, "unknown builtin fails closed");
    console.log("gemini: builtin:gemini-cli alias resolution OK");
  }

  fs.rmSync(work, { recursive: true, force: true });
  console.log("gemini-agent-wrapper-smoke: ok");
}

main();
