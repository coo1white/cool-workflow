#!/usr/bin/env node
"use strict";

// opencode-agent-wrapper-smoke -- the OpenCode builtin agent adapter works with
// a PATH shim. No live OpenCode API key needed.
//
// The prompt goes to `opencode run` on STDIN, never as an argument or a
// positional message: `opencode run --format json --dangerously-skip-permissions
// [--model X]` carries no prompt in argv, and the wrapper writes the whole
// prompt to the child's stdin.

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
fs.writeFileSync(path.join(__dirname, "stdin.txt"), fs.readFileSync(0));
if (${JSON.stringify(behavior)} === "crash") {
  process.stderr.write("opencode shim boom");
  process.exit(3);
}
if (${JSON.stringify(behavior)} === "garbage") {
  process.stdout.write("not-json\\n");
  process.exit(0);
}
if (${JSON.stringify(behavior)} === "auth-error") {
  // Real opencode failures (auth, rate limit) surface as a legacy result-shape
  // JSONL line on STDOUT, then the process exits nonzero with EMPTY real
  // stderr — the shape that used to collapse to a bare "opencode exited 1"
  // with no reason at all.
  process.stdout.write(JSON.stringify({ result: "OpenCode auth error: session expired" }) + "\\n");
  process.exit(1);
}
if (${JSON.stringify(behavior)} === "error-event") {
  // Real opencode 1.18 reports an API failure (a blocked host, a 403) as a
  // { type: "error" } JSONL event on STDOUT and exits 1 with empty stderr.
  process.stdout.write(JSON.stringify({ type: "error", sessionID: "ses_shim", error: { name: "APIError", data: { message: "Forbidden: request blocked for host api.example.test", statusCode: 403 } } }) + "\\n");
  process.exit(1);
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
    assert.deepEqual(invocation, ["run", "--format", "json", "--dangerously-skip-permissions"], "opencode argv carries ONLY the fixed flags, no prompt (plain opencode requests no --model)");
    // `opencode run` takes no positional prompt and no --prompt flag; the
    // message is delivered on stdin only.
    assert.ok(!invocation.includes("--prompt"), "opencode run must NOT use a --prompt flag (it does not exist)");
    const prompt = fs.readFileSync(path.join(dir, "stdin.txt"), "utf8");
    assert.ok(prompt.includes(marker), "worker input reaches opencode on stdin");
    assert.ok(prompt.includes("cw:result"), "cw result contract is appended");
    assert.ok(!invocation.some((arg) => arg.includes(marker)), "the prompt is never passed as an argument");
    assert.equal(fs.readFileSync(resultPath, "utf8"), RESULT, "final message persisted to result.md");
    assert.equal(child.stderr, "", "default piped success is silent on stderr");
    const report = JSON.parse(child.stdout);
    // opencode --format json emits NO model field; without --model the provenance
    // model is undefined (honest). The deepseek variant records its requested model.
    assert.equal(report.model, undefined, "plain opencode carries no model field");
    assert.equal(report.usage.input_tokens, 12, "usage summed from step_finish token events");
    assert.equal(report.result, RESULT, "stdout report carries final result for CW provenance");
    console.log("opencode: default --format json + stdin prompt delivery + result persistence + provenance OK");
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
    fs.rmSync(resultPath, { force: true });
    const authErr = runWrapper(shimDir("auth-error"), inputPath, resultPath);
    assert.notEqual(authErr.status, 0, "auth-error shim exits nonzero");
    assert.ok(!fs.existsSync(resultPath), "no result.md on an auth-style failure");
    assert.ok(authErr.stderr.includes("OpenCode auth error: session expired"), "wrapper's own stderr carries the PARSED stdout result, not just the bare exit code");
    const logPath = path.join(work, "logs", "agent-stderr.log");
    assert.ok(fs.existsSync(logPath), "agent-stderr.log persisted for the failed hop");
    const log = fs.readFileSync(logPath, "utf8");
    assert.ok(log.includes("OpenCode auth error: session expired"), "persisted log carries the PARSED stdout result");
    console.log("opencode: empty-stderr failure surfaces parsed stdout result (auth-style) OK");
  }

  {
    fs.rmSync(resultPath, { force: true });
    const errEvent = runWrapper(shimDir("error-event"), inputPath, resultPath);
    assert.equal(errEvent.status, 1, "an error-event shim exits 1");
    assert.ok(!fs.existsSync(resultPath), "no result.md when opencode reports an error event");
    assert.ok(errEvent.stderr.includes("APIError: Forbidden: request blocked for host api.example.test"), "stderr names the error event's reason, not a bare exit code");
    const log = fs.readFileSync(path.join(work, "logs", "agent-stderr.log"), "utf8");
    assert.ok(log.includes("APIError: Forbidden: request blocked for host api.example.test"), "the log names the error event's reason");
    console.log("opencode: a { type: \"error\" } event names the failure OK");
  }

  {
    // A 1.2 MB prompt is WELL past Linux's 131072-byte argument limit (and
    // macOS's ~1 MB for all arguments combined), but since the prompt never
    // goes on argv or as a positional message — it goes on stdin — this just
    // works: no E2BIG, the whole prompt reaches opencode.
    fs.rmSync(resultPath, { force: true });
    const bigInput = path.join(work, "big-input.md");
    const BIG_MARKER = "end of a 1.2 MB worker input (marker-9e4).";
    fs.writeFileSync(bigInput, `# Worker w-big\n\n${"earlier phase result line\n".repeat(48000)}\n${BIG_MARKER}\n`, "utf8");
    const dir = shimDir("ok");
    const child = runWrapper(dir, bigInput, resultPath);
    assert.equal(child.status, 0, `a 1.2 MB prompt completes (stderr: ${child.stderr.slice(0, 300)})`);
    const stdinBytes = fs.readFileSync(path.join(dir, "stdin.txt"));
    assert.ok(stdinBytes.length >= 1200000, "the whole 1.2 MB prompt arrives on stdin (byte length at least matches the input)");
    assert.ok(stdinBytes.toString("utf8").includes(BIG_MARKER), "the big prompt's tail marker reaches opencode on stdin");
    assert.equal(fs.readFileSync(resultPath, "utf8"), RESULT, "result.md written for the big prompt");
    console.log("opencode: a 1.2 MB prompt goes on stdin, no E2BIG OK");
  }

  {
    // v2 rebuild: flat dist/agent-config.js moved to dist/shell/agent-config.js
    // (same resolveAgentConfig(args, env) signature).
    const { resolveAgentConfig } = require(path.join(pluginRoot, "dist", "shell", "agent-config.js"));
    const cfg = resolveAgentConfig({ "agent-command": "builtin:opencode" }, {});
    assert.ok(cfg.command && cfg.command.includes("opencode-agent.js"), "builtin:opencode expands to the packaged wrapper");
    assert.ok(cfg.command.includes("{{input}}") && cfg.command.includes("{{result}}"), "expanded template carries worker substitutions");
    console.log("opencode: builtin:opencode alias resolution OK");
  }

  fs.rmSync(work, { recursive: true, force: true });
  console.log("opencode-agent-wrapper-smoke: ok");
}

main();
