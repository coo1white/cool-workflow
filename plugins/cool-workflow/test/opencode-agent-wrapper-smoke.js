#!/usr/bin/env node
"use strict";

// opencode-agent-wrapper-smoke -- the OpenCode builtin agent adapter works with
// a PATH shim. No live OpenCode API key needed.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const wrapper = path.join(pluginRoot, "scripts", "agents", "opencode-agent.js");

const RESULT = `# Analysis

opencode shim answer

\`\`\`cw:result
{
  "summary": "opencode shim answer",
  "findings": [],
  "evidence": ["README.md:1"]
}
\`\`\`
`;

function shimDir(behavior) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-opencode-shim-"));
  const shim = path.join(dir, "opencode");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.writeFileSync(path.join(__dirname, "invocation.json"), JSON.stringify(args));
if (${JSON.stringify(behavior)} === "crash") {
  process.stderr.write("opencode shim boom");
  process.exit(3);
}
if (${JSON.stringify(behavior)} === "garbage") {
  process.stdout.write("not-json\\n");
  process.exit(0);
}
// Mirror real opencode (>=1.x) --format json: { type, part } JSONL events.
// type:"text" -> part.text (grouped by part.messageID); the LAST message is the
// final answer. type:"step_finish" -> part.tokens. NO model field is emitted.
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
emit({ type: "step_start", part: { type: "step-start", messageID: "msg_a" } });
emit({ type: "text", part: { type: "text", messageID: "msg_a", text: "reading repo..." } });
emit({ type: "tool_use", part: { type: "tool", tool: "read", state: { input: { filePath: "README.md" } } } });
emit({ type: "text", part: { type: "text", messageID: "msg_b", text: ${JSON.stringify(RESULT)} } });
emit({ type: "step_finish", part: { type: "step-finish", messageID: "msg_b", tokens: { input: 12, output: 10, total: 22, reasoning: 0, cache: { read: 0, write: 0 } } } });
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
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cw-opencode-wrapper-smoke-"));
  const inputPath = path.join(work, "input.md");
  const resultPath = path.join(work, "result.md");
  const marker = "Check release path marker-opencode-77.";
  fs.writeFileSync(inputPath, `# Worker w-1\n\n- Result: ${resultPath}\n\n## Task\n\n${marker}\n`, "utf8");

  {
    const dir = shimDir("ok");
    const child = runWrapper(dir, inputPath, resultPath);
    assert.equal(child.status, 0, `opencode wrapper exits 0 (stderr: ${child.stderr})`);
    const invocation = readInvocation(dir);
    assert.deepEqual(invocation.slice(0, 3), ["run", "--format", "json"], "opencode runs with --format json");
    assert.ok(invocation.includes("--dangerously-skip-permissions"), "passes --dangerously-skip-permissions");
    // `opencode run` takes the message as a positional arg; there is no --prompt flag.
    // A --prompt flag would leave the positional [message..] empty (prompt never reaches opencode).
    assert.ok(!invocation.includes("--prompt"), "opencode run must NOT use a --prompt flag (it does not exist)");
    const prompt = invocation[invocation.length - 1];
    assert.ok(prompt.includes(marker), "worker input reaches opencode as the positional message");
    assert.ok(prompt.includes("cw:result"), "cw result contract is appended");
    assert.equal(fs.readFileSync(resultPath, "utf8"), RESULT, "final message persisted to result.md");
    assert.equal(child.stderr, "", "default piped success is silent on stderr");
    const report = JSON.parse(child.stdout);
    // opencode --format json emits NO model field; without --model the provenance
    // model is undefined (honest). The deepseek variant records its requested model.
    assert.equal(report.model, undefined, "plain opencode carries no model field");
    assert.equal(report.usage.input_tokens, 12, "usage summed from step_finish token events");
    assert.equal(report.result, RESULT, "stdout report carries final result for CW provenance");
    console.log("opencode: default --format json + result persistence + provenance OK");
  }

  {
    fs.rmSync(resultPath, { force: true });
    const dir = shimDir("ok");
    const child = runWrapper(dir, inputPath, resultPath, { CW_AGENT_STREAM: "1" });
    assert.equal(child.status, 0, `stream opencode wrapper exits 0 (stderr: ${child.stderr})`);
    assert.ok(!/\x1b\[/.test(child.stderr), "non-TTY trace carries NO ANSI/cursor escapes");
    assert.match(child.stderr, /→ opencode: reading/, "CW_AGENT_STREAM=1 opts non-TTY into a plain append-only trace");
    assert.equal(fs.readFileSync(resultPath, "utf8"), RESULT, "stream path persists final message");
    console.log("opencode: CW_AGENT_STREAM=1 piped success OK");
  }

  {
    fs.rmSync(resultPath, { force: true });
    const crash = runWrapper(shimDir("crash"), inputPath, resultPath);
    assert.notEqual(crash.status, 0, "crashing opencode exits nonzero");
    assert.ok(!fs.existsSync(resultPath), "no result.md on crash");

    const garbage = runWrapper(shimDir("garbage"), inputPath, resultPath);
    assert.notEqual(garbage.status, 0, "non-JSONL opencode stdout fails closed");
    console.log("opencode: fail-closed on crash + garbage output OK");
  }

  {
    const { resolveAgentConfig } = require(path.join(pluginRoot, "dist", "agent-config.js"));
    const cfg = resolveAgentConfig({ "agent-command": "builtin:opencode" }, {});
    assert.ok(cfg.command && cfg.command.includes("opencode-agent.js"), "builtin:opencode expands to the packaged wrapper");
    assert.ok(cfg.command.includes("{{input}}") && cfg.command.includes("{{result}}"), "expanded template carries worker substitutions");
    console.log("opencode: builtin:opencode alias resolution OK");
  }

  fs.rmSync(work, { recursive: true, force: true });
  console.log("opencode-agent-wrapper-smoke: ok");
}

main();
