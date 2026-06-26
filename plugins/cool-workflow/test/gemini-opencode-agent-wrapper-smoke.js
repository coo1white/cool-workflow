#!/usr/bin/env node
"use strict";

// gemini-opencode-agent-wrapper-smoke -- the Gemini (via opencode) builtin adapter
// selects a google/gemini model and reaches the shared opencode runner. A PATH
// shim stands in for `opencode`, so no live Gemini key is needed.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const wrapper = path.join(pluginRoot, "scripts", "agents", "gemini-opencode-agent.js");

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

function shimDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-gemini-oc-shim-"));
  const shim = path.join(dir, "opencode");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.writeFileSync(path.join(__dirname, "invocation.json"), JSON.stringify(args));
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
emit({ type: "step_start", part: { type: "step-start", messageID: "msg_a" } });
emit({ type: "text", part: { type: "text", messageID: "msg_a", text: "reading repo..." } });
emit({ type: "text", part: { type: "text", messageID: "msg_b", text: ${JSON.stringify(RESULT)} } });
emit({ type: "step_finish", part: { type: "step-finish", messageID: "msg_b", tokens: { input: 8, output: 6, total: 14 } } });
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

const readInvocation = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "invocation.json"), "utf8"));
const modelOf = (args) => { const i = args.indexOf("--model"); return i >= 0 ? args[i + 1] : undefined; };

function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cw-gemini-oc-wrapper-smoke-"));
  const inputPath = path.join(work, "input.md");
  const resultPath = path.join(work, "result.md");
  const marker = "Check release path marker-gemini-58.";
  fs.writeFileSync(inputPath, `# Worker w-1\n\n- Result: ${resultPath}\n\n## Task\n\n${marker}\n`, "utf8");

  {
    const dir = shimDir();
    const child = runWrapper(dir, inputPath, resultPath);
    assert.equal(child.status, 0, `gemini-opencode wrapper exits 0 (stderr: ${child.stderr})`);
    const invocation = readInvocation(dir);
    assert.deepEqual(invocation.slice(0, 3), ["run", "--format", "json"], "runs opencode with --format json");
    assert.ok(invocation.includes("--dangerously-skip-permissions"), "passes --dangerously-skip-permissions");
    assert.equal(modelOf(invocation), "google/gemini-3.5-flash", "default Gemini model is selected via --model");
    assert.ok(!invocation.includes("--prompt"), "message is positional; there is no --prompt flag");
    assert.ok(invocation[invocation.length - 1].includes(marker), "worker input reaches opencode as the positional message");
    assert.equal(fs.readFileSync(resultPath, "utf8"), RESULT, "final message persisted to result.md");
    const report = JSON.parse(child.stdout);
    assert.equal(report.model, "google/gemini-3.5-flash", "provenance records the requested Gemini model");
    console.log("gemini-opencode: default model selection + result persistence OK");
  }

  {
    fs.rmSync(resultPath, { force: true });
    const dir = shimDir();
    const child = runWrapper(dir, inputPath, resultPath, { CW_GEMINI_MODEL: "google/gemini-2.5-pro" });
    assert.equal(child.status, 0, `gemini model override exits 0 (stderr: ${child.stderr})`);
    assert.equal(modelOf(readInvocation(dir)), "google/gemini-2.5-pro", "CW_GEMINI_MODEL overrides the model");
    console.log("gemini-opencode: CW_GEMINI_MODEL override OK");
  }

  {
    fs.rmSync(resultPath, { force: true });
    const dir = shimDir();
    const child = runWrapper(dir, inputPath, resultPath, { CW_AGENT_STREAM: "1" });
    assert.equal(child.status, 0, `stream wrapper exits 0 (stderr: ${child.stderr})`);
    assert.match(child.stderr, /→ gemini: reading/, "live trace is labelled gemini, not opencode");
    console.log("gemini-opencode: live trace labelled gemini OK");
  }

  {
    const { resolveAgentConfig } = require(path.join(pluginRoot, "dist", "agent-config.js"));
    const cfg = resolveAgentConfig({ "agent-command": "builtin:gemini" }, {});
    assert.ok(cfg.command && cfg.command.includes("gemini-opencode-agent.js"), "builtin:gemini routes through opencode");
    console.log("gemini-opencode: builtin:gemini alias resolution OK");
  }

  fs.rmSync(work, { recursive: true, force: true });
  console.log("gemini-opencode-agent-wrapper-smoke: ok");
}

main();
