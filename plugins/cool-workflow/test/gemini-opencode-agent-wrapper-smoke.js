#!/usr/bin/env node
"use strict";

// gemini-opencode-agent-wrapper-smoke -- the Gemini (via opencode) builtin adapter
// selects a google/gemini model and reaches the shared opencode runner. A PATH
// shim stands in for `opencode`, so no live Gemini key is needed.
//
// The prompt goes to `opencode run` on STDIN, never as an argument or a
// positional message: argv carries only the fixed flags plus --model.

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
fs.writeFileSync(path.join(__dirname, "stdin.txt"), fs.readFileSync(0));
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
    assert.deepEqual(invocation, ["run", "--format", "json", "--dangerously-skip-permissions", "--model", "google/gemini-3.7-flash"], "runs opencode with the fixed flags + --model, no prompt in argv");
    assert.equal(modelOf(invocation), "google/gemini-3.7-flash", "default Gemini model is selected via --model");
    assert.ok(!invocation.includes("--prompt"), "message is delivered on stdin; there is no --prompt flag");
    const prompt = fs.readFileSync(path.join(dir, "stdin.txt"), "utf8");
    assert.ok(prompt.includes(marker), "worker input reaches opencode on stdin");
    assert.ok(!invocation.some((arg) => arg.includes(marker)), "the prompt is never passed as an argument");
    assert.equal(fs.readFileSync(resultPath, "utf8"), RESULT, "final message persisted to result.md");
    const report = JSON.parse(child.stdout);
    assert.equal(report.model, "google/gemini-3.7-flash", "provenance records the requested Gemini model");
    console.log("gemini-opencode: default model selection + stdin prompt delivery + result persistence OK");
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
    // A 1.2 MB prompt is WELL past Linux's 131072-byte argument limit, but
    // since the prompt never goes on argv or as a positional message — it
    // goes on stdin — this just works: no E2BIG, the whole prompt reaches
    // opencode.
    fs.rmSync(resultPath, { force: true });
    const bigInput = path.join(work, "big-input.md");
    const BIG_MARKER = "end of a 1.2 MB worker input (marker-9e4).";
    fs.writeFileSync(bigInput, `# Worker w-big\n\n${"earlier phase result line\n".repeat(48000)}\n${BIG_MARKER}\n`, "utf8");
    const dir = shimDir();
    const child = runWrapper(dir, bigInput, resultPath);
    assert.equal(child.status, 0, `a 1.2 MB prompt completes (stderr: ${child.stderr.slice(0, 300)})`);
    const stdinBytes = fs.readFileSync(path.join(dir, "stdin.txt"));
    assert.ok(stdinBytes.length >= 1200000, "the whole 1.2 MB prompt arrives on stdin (byte length at least matches the input)");
    assert.ok(stdinBytes.toString("utf8").includes(BIG_MARKER), "the big prompt's tail marker reaches opencode on stdin");
    assert.equal(fs.readFileSync(resultPath, "utf8"), RESULT, "result.md written for the big prompt");
    console.log("gemini-opencode: a 1.2 MB prompt goes on stdin, no E2BIG OK");
  }

  {
    const { resolveAgentConfig } = require(path.join(pluginRoot, "dist", "shell", "agent-config.js"));
    const cfg = resolveAgentConfig({ "agent-command": "builtin:gemini" }, {});
    assert.ok(cfg.command && cfg.command.includes("gemini-opencode-agent.js"), "builtin:gemini routes through opencode");
    console.log("gemini-opencode: builtin:gemini alias resolution OK");
  }

  fs.rmSync(work, { recursive: true, force: true });
  console.log("gemini-opencode-agent-wrapper-smoke: ok");
}

main();
