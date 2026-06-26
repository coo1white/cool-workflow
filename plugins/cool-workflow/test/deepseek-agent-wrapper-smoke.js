#!/usr/bin/env node
"use strict";

// deepseek-agent-wrapper-smoke -- the DeepSeek (via opencode) builtin adapter
// selects the DeepSeek model and reaches the shared opencode runner. A PATH shim
// stands in for the `opencode` binary, so no live DeepSeek API key is needed.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const wrapper = path.join(pluginRoot, "scripts", "agents", "deepseek-agent.js");

const RESULT = `# Analysis

deepseek shim answer

\`\`\`cw:result
{
  "summary": "deepseek shim answer",
  "findings": [],
  "evidence": ["README.md:1"]
}
\`\`\`
`;

function shimDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-deepseek-shim-"));
  const shim = path.join(dir, "opencode");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.writeFileSync(path.join(__dirname, "invocation.json"), JSON.stringify(args));
// Mirror real opencode --format json: { type, part } JSONL; final answer is the
// LAST message's text; usage from step_finish; NO model field (provenance model
// comes from the requested --model deepseek/...).
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
emit({ type: "step_start", part: { type: "step-start", messageID: "msg_a" } });
emit({ type: "text", part: { type: "text", messageID: "msg_a", text: "reading repo..." } });
emit({ type: "text", part: { type: "text", messageID: "msg_b", text: ${JSON.stringify(RESULT)} } });
emit({ type: "step_finish", part: { type: "step-finish", messageID: "msg_b", tokens: { input: 9, output: 7, total: 16 } } });
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

function modelOf(args) {
  const i = args.indexOf("--model");
  return i >= 0 ? args[i + 1] : undefined;
}

function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cw-deepseek-wrapper-smoke-"));
  const inputPath = path.join(work, "input.md");
  const resultPath = path.join(work, "result.md");
  const marker = "Check release path marker-deepseek-31.";
  fs.writeFileSync(inputPath, `# Worker w-1\n\n- Result: ${resultPath}\n\n## Task\n\n${marker}\n`, "utf8");

  {
    const dir = shimDir();
    const child = runWrapper(dir, inputPath, resultPath);
    assert.equal(child.status, 0, `deepseek wrapper exits 0 (stderr: ${child.stderr})`);
    const invocation = readInvocation(dir);
    assert.deepEqual(invocation.slice(0, 3), ["run", "--format", "json"], "deepseek runs opencode with --format json");
    assert.ok(invocation.includes("--dangerously-skip-permissions"), "passes --dangerously-skip-permissions");
    // The whole point of -deepseek: it must actually select a DeepSeek model,
    // not silently fall back to opencode's default model.
    assert.equal(modelOf(invocation), "deepseek/deepseek-chat", "default DeepSeek model is selected via --model");
    assert.ok(!invocation.includes("--prompt"), "message is positional; there is no --prompt flag");
    const prompt = invocation[invocation.length - 1];
    assert.ok(prompt.includes(marker), "worker input reaches opencode as the positional message");
    assert.ok(prompt.includes("cw:result"), "cw result contract is appended");
    assert.equal(fs.readFileSync(resultPath, "utf8"), RESULT, "final message persisted to result.md");
    const report = JSON.parse(child.stdout);
    assert.equal(report.result, RESULT, "stdout report carries final result for CW provenance");
    assert.equal(report.model, "deepseek/deepseek-chat", "provenance records the requested DeepSeek model");
    assert.equal(report.usage.input_tokens, 9, "usage summed from step_finish token events");
    console.log("deepseek: default model selection + result persistence OK");
  }

  {
    fs.rmSync(resultPath, { force: true });
    const dir = shimDir();
    const child = runWrapper(dir, inputPath, resultPath, { CW_DEEPSEEK_MODEL: "deepseek/deepseek-reasoner" });
    assert.equal(child.status, 0, `deepseek model override exits 0 (stderr: ${child.stderr})`);
    assert.equal(modelOf(readInvocation(dir)), "deepseek/deepseek-reasoner", "CW_DEEPSEEK_MODEL overrides the model");
    console.log("deepseek: CW_DEEPSEEK_MODEL override OK");
  }

  {
    fs.rmSync(resultPath, { force: true });
    const dir = shimDir();
    const child = runWrapper(dir, inputPath, resultPath, { CW_AGENT_STREAM: "1" });
    assert.equal(child.status, 0, `stream deepseek wrapper exits 0 (stderr: ${child.stderr})`);
    assert.match(child.stderr, /→ deepseek: reading/, "live trace is labelled deepseek, not opencode");
    console.log("deepseek: live trace labelled deepseek OK");
  }

  {
    const { resolveAgentConfig } = require(path.join(pluginRoot, "dist", "agent-config.js"));
    const cfg = resolveAgentConfig({ "agent-command": "builtin:deepseek" }, {});
    assert.ok(cfg.command && cfg.command.includes("deepseek-agent.js"), "builtin:deepseek expands to the deepseek wrapper");
    assert.ok(cfg.command.includes("{{input}}") && cfg.command.includes("{{result}}"), "expanded template carries worker substitutions");
    console.log("deepseek: builtin:deepseek alias resolution OK");
  }

  fs.rmSync(work, { recursive: true, force: true });
  console.log("deepseek-agent-wrapper-smoke: ok");
}

main();
